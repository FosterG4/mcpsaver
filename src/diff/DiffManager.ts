import * as fs from 'fs/promises';
import type { DiffChange, SymbolChange } from '../types/index.js';

export class DiffManager {
  private fileSnapshots: Map<string, string> = new Map();
  private symbolSnapshots: Map<string, Map<string, string>> = new Map();

  /**
   * Create a snapshot of the current file state
   */
  async createSnapshot(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.fileSnapshots.set(filePath, content);
    } catch (error) {
      console.warn(`Failed to create snapshot for ${filePath}:`, error);
    }
  }

  /**
   * Create a snapshot from content string
   */
  createSnapshotFromContent(filePath: string, content: string): void {
    this.fileSnapshots.set(filePath, content);
  }

  /**
   * Create snapshots for specific symbols in a file
   */
  async createSymbolSnapshots(filePath: string, symbols: Map<string, string>): Promise<void> {
    this.symbolSnapshots.set(filePath, new Map(symbols));
  }

  /**
   * Generate diff between current file state and snapshot
   */
  async generateFileDiff(filePath: string): Promise<DiffChange[]> {
    const snapshot = this.fileSnapshots.get(filePath);
    if (!snapshot) {
      throw new Error(`No snapshot found for ${filePath}`);
    }

    try {
      const currentContent = await fs.readFile(filePath, 'utf-8');
      return this.computeDiff(snapshot, currentContent, filePath);
    } catch (error) {
      throw new Error(`Failed to read current content of ${filePath}: ${error}`);
    }
  }

  /**
   * Generate diff for specific symbols
   */
  async generateSymbolDiff(filePath: string, currentSymbols: Map<string, string>): Promise<SymbolChange[]> {
    const snapshot = this.symbolSnapshots.get(filePath);
    if (!snapshot) {
      throw new Error(`No symbol snapshot found for ${filePath}`);
    }

    const changes: SymbolChange[] = [];
    const allSymbols = new Set([...snapshot.keys(), ...currentSymbols.keys()]);

    for (const symbolName of allSymbols) {
      const oldContent = snapshot.get(symbolName);
      const newContent = currentSymbols.get(symbolName);

      if (!oldContent && newContent) {
        // Symbol added
        changes.push({
          symbol: symbolName,
          type: 'added',
          code: newContent,
          lineNumber: 0,
        });
      } else if (oldContent && !newContent) {
        // Symbol removed
        changes.push({
          symbol: symbolName,
          type: 'removed',
          code: '',
          lineNumber: 0,
          oldCode: oldContent,
        });
      } else if (oldContent && newContent && oldContent !== newContent) {
        // Symbol modified
        changes.push({
          symbol: symbolName,
          type: 'modified',
          code: newContent,
          lineNumber: 0,
          oldCode: oldContent,
        });
      }
    }

    return changes;
  }

  /**
   * Get minimal update containing only changed parts
   */
  async getMinimalUpdate(filePath: string, targetSymbols?: string[]): Promise<{
    changes: DiffChange[];
    addedLines: number;
    removedLines: number;
    modifiedLines: number;
    summary: string;
  }> {
    const changes = await this.generateFileDiff(filePath);
    
    let filteredChanges = changes;
    if (targetSymbols && targetSymbols.length > 0) {
      // Filter changes to only include target symbols
      filteredChanges = changes.filter(change => 
        targetSymbols.some(symbol => 
          change.content.includes(symbol)
        )
      );
    }

    const stats = this.calculateDiffStats(filteredChanges);
    const summary = this.generateDiffSummary(filteredChanges, stats);

    return {
      changes: filteredChanges,
      ...stats,
      summary,
    };
  }

  /**
   * Apply diff to recreate content
   */
  applyDiff(originalContent: string, changes: DiffChange[]): string {
    // Sort by oldStart ascending, undefined last
    const sorted = [...changes].sort((a, b) => (a.oldStart ?? Number.MAX_SAFE_INTEGER) - (b.oldStart ?? Number.MAX_SAFE_INTEGER));
    const lines = originalContent.split('\n');
    const result: string[] = [];
    let cursor = 1; // 1-based line cursor in original

    for (const ch of sorted) {
      const oldStart = ch.oldStart ?? cursor;
      const oldEnd = ch.oldEnd ?? (ch.oldStart ?? cursor - 1);

      // copy unchanged region before the change
      const copyUntil = Math.max(1, oldStart - 1);
      if (cursor <= copyUntil) {
        result.push(...lines.slice(cursor - 1, copyUntil));
        cursor = copyUntil + 1;
      }

      if (ch.type === 'removed') {
        // skip removed range
        cursor = Math.max(cursor, oldEnd + 1);
      } else if (ch.type === 'modified') {
        // skip old range, then insert new content
        cursor = Math.max(cursor, oldEnd + 1);
        if (ch.content) result.push(...ch.content.split('\n'));
      } else if (ch.type === 'added') {
        // insertion relative to current position
        if (ch.content) result.push(...ch.content.split('\n'));
      }
    }

    // append remainder
    if (cursor <= lines.length) {
      result.push(...lines.slice(cursor - 1));
    }

    return result.join('\n');
  }

  /**
   * Generate context-aware diff that includes surrounding lines around each change
   */
  async generateContextualDiff(filePath: string, contextLines: number = 3): Promise<DiffChange[]> {
    const snapshot = this.fileSnapshots.get(filePath);
    if (!snapshot) throw new Error(`No snapshot found for ${filePath}`);
    const currentContent = await fs.readFile(filePath, 'utf-8');
    const changes = this.computeDiff(snapshot, currentContent, filePath);

    const oldLines = snapshot.split('\n');
    const newLines = currentContent.split('\n');
    const contextual: DiffChange[] = [];

    for (const ch of changes) {
      if (ch.type === 'added') {
        const start = Math.max(1, (ch.newStart ?? 1) - contextLines);
        const end = Math.min(newLines.length, (ch.newEnd ?? ch.newStart ?? 1) + contextLines);
        const block = newLines.slice(start - 1, end).join('\n');
        contextual.push({ type: 'added', newStart: start, newEnd: end, content: block });
      } else if (ch.type === 'removed') {
        const start = Math.max(1, (ch.oldStart ?? 1) - contextLines);
        const end = Math.min(oldLines.length, (ch.oldEnd ?? ch.oldStart ?? 1) + contextLines);
        const block = oldLines.slice(start - 1, end).join('\n');
        contextual.push({ type: 'removed', oldStart: start, oldEnd: end, content: block });
      } else if (ch.type === 'modified') {
        const newStart = Math.max(1, (ch.newStart ?? 1) - contextLines);
        const newEnd = Math.min(newLines.length, (ch.newEnd ?? ch.newStart ?? 1) + contextLines);
        const block = newLines.slice(newStart - 1, newEnd).join('\n');
        contextual.push({ type: 'modified', oldStart: ch.oldStart, oldEnd: ch.oldEnd, newStart, newEnd, content: block });
      }
    }

    return contextual;
  }

  /**
   * Get diff statistics
   */
  getDiffStats(changes: DiffChange[]): {
    totalChanges: number;
    addedLines: number;
    removedLines: number;
    modifiedLines: number;
    contextLines: number;
  } {
    return this.calculateDiffStats(changes);
  }

  /**
   * Check if file has been modified since snapshot
   */
  async hasFileChanged(filePath: string): Promise<boolean> {
    const snapshot = this.fileSnapshots.get(filePath);
    if (!snapshot) {
      return true; // No snapshot means we can't tell, assume changed
    }

    try {
      const currentContent = await fs.readFile(filePath, 'utf-8');
      return currentContent !== snapshot;
    } catch {
      return true; // Error reading file, assume changed
    }
  }

  /**
   * Clear all snapshots
   */
  clearSnapshots(): void {
    this.fileSnapshots.clear();
    this.symbolSnapshots.clear();
  }

  /**
   * Clear snapshots for a specific file
   */
  clearFileSnapshots(filePath: string): void {
    this.fileSnapshots.delete(filePath);
    this.symbolSnapshots.delete(filePath);
  }

  /**
   * Get snapshot content for debugging
   */
  getSnapshot(filePath: string): string | undefined {
    return this.fileSnapshots.get(filePath);
  }

  private computeDiff(oldContent: string, newContent: string, _filePath: string): DiffChange[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const lcs = this.longestCommonSubsequence(oldLines, newLines);
    const ops = this.generateOpStream(oldLines, newLines, lcs);

    // Merge consecutive removes followed by adds into 'modified'
    const changes: DiffChange[] = [];
    let i = 0;
    while (i < ops.length) {
      const op = ops[i]!;
      if (op.type === 'removed') {
        // collect removed block
        const remStartOld = op.oldIndex + 1; // 1-based
        let remEndOld = op.oldIndex + 1;
        const removedLines: string[] = [op.content];
        i++;
        while (i < ops.length && ops[i]!.type === 'removed') {
          removedLines.push(ops[i]!.content);
          remEndOld = ops[i]!.oldIndex + 1;
          i++;
        }

        // if immediately followed by one or more added lines, consider as modified
        if (i < ops.length && ops[i]!.type === 'added') {
          const addStartNew = ops[i]!.newIndex + 1;
          let addEndNew = ops[i]!.newIndex + 1;
          const addedLines: string[] = [];
          while (i < ops.length && ops[i]!.type === 'added') {
            addedLines.push(ops[i]!.content);
            addEndNew = ops[i]!.newIndex + 1;
            i++;
          }
          changes.push({
            type: 'modified',
            oldStart: remStartOld,
            oldEnd: remEndOld,
            newStart: addStartNew,
            newEnd: addEndNew,
            content: addedLines.join('\n'),
          });
        } else {
          // pure removal
          changes.push({
            type: 'removed',
            oldStart: remStartOld,
            oldEnd: remEndOld,
            content: removedLines.join('\n'),
          });
        }
      } else if (op.type === 'added') {
        const addStartNew = op.newIndex + 1;
        let addEndNew = op.newIndex + 1;
        const addedLines: string[] = [op.content];
        i++;
        while (i < ops.length && ops[i]!.type === 'added') {
          addedLines.push(ops[i]!.content);
          addEndNew = ops[i]!.newIndex + 1;
          i++;
        }
        changes.push({
          type: 'added',
          newStart: addStartNew,
          newEnd: addEndNew,
          content: addedLines.join('\n'),
        });
      } else {
        // unchanged
        i++;
      }
    }

    return changes;
  }

  private longestCommonSubsequence(arr1: string[], arr2: string[]): number[][] {
    const m = arr1.length;
    const n = arr2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (arr1[i - 1] === arr2[j - 1]) {
          const prevValue = dp[i - 1]?.[j - 1] ?? 0;
          dp[i]![j] = prevValue + 1;
        } else {
          const topValue = dp[i - 1]?.[j] ?? 0;
          const leftValue = dp[i]?.[j - 1] ?? 0;
          dp[i]![j] = Math.max(topValue, leftValue);
        }
      }
    }
    
    return dp;
  }

  // Build a fine-grained op stream with indexes to enable merging and line numbers
  private generateOpStream(
    oldLines: string[],
    newLines: string[],
    lcs: number[][]
  ): Array<{ type: 'added' | 'removed' | 'unchanged'; content: string; oldIndex: number; newIndex: number }> {
    const ops: Array<{ type: 'added' | 'removed' | 'unchanged'; content: string; oldIndex: number; newIndex: number }> = [];
    let i = oldLines.length;
    let j = newLines.length;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        ops.unshift({ type: 'unchanged', content: oldLines[i - 1] || '', oldIndex: i - 1, newIndex: j - 1 });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || (lcs[i]?.[j - 1] || 0) >= (lcs[i - 1]?.[j] || 0))) {
        ops.unshift({ type: 'added', content: newLines[j - 1] || '', oldIndex: i - 1, newIndex: j - 1 });
        j--;
      } else if (i > 0) {
        ops.unshift({ type: 'removed', content: oldLines[i - 1] || '', oldIndex: i - 1, newIndex: j - 1 });
        i--;
      }
    }
    return ops;
  }

  private calculateDiffStats(changes: DiffChange[]): {
    totalChanges: number;
    addedLines: number;
    removedLines: number;
    modifiedLines: number;
    contextLines: number;
  } {
    let addedLines = 0;
    let removedLines = 0;
    let modifiedLines = 0;
    const contextLines = 0;
    
    for (const change of changes) {
      switch (change.type) {
        case 'added':
          addedLines += (change.newEnd ?? change.newStart ?? 0) - (change.newStart ?? 0) + 1;
          break;
        case 'removed':
          removedLines += (change.oldEnd ?? change.oldStart ?? 0) - (change.oldStart ?? 0) + 1;
          break;
        case 'modified':
          // count modified lines as size of new range
          modifiedLines += (change.newEnd ?? change.newStart ?? 0) - (change.newStart ?? 0) + 1;
          break;

      }
    }
    
    return {
      totalChanges: addedLines + removedLines + modifiedLines,
      addedLines,
      removedLines,
      modifiedLines,
      contextLines,
    };
  }

  private generateDiffSummary(_changes: DiffChange[], stats: {
    addedLines: number;
    removedLines: number;
    modifiedLines: number;
    contextLines: number;
  }): string {
    const parts: string[] = [];
    
    if (stats.addedLines > 0) {
      parts.push(`${stats.addedLines} addition${stats.addedLines === 1 ? '' : 's'}`);
    }
    
    if (stats.removedLines > 0) {
      parts.push(`${stats.removedLines} deletion${stats.removedLines === 1 ? '' : 's'}`);
    }
    
    if (stats.modifiedLines > 0) {
      parts.push(`${stats.modifiedLines} modification${stats.modifiedLines === 1 ? '' : 's'}`);
    }
    
    if (parts.length === 0) {
      return 'No changes detected';
    }
    
    return parts.join(', ');
  }
}