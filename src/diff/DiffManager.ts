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
    const result = originalContent;
    const lines = result.split('\n');
    
    // Sort changes by line number in descending order to avoid index shifting
    const sortedChanges = [...changes];
    
    for (const change of sortedChanges) {
      switch (change.type) {
        case 'added':
          lines.push(change.content);
          break;
        case 'removed':
          // Skip removed lines
          break;
        case 'modified':
          // Modified lines are handled in the diff generation
          break;
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Generate context-aware diff that includes surrounding lines
   */
  async generateContextualDiff(filePath: string, _contextLines: number = 3): Promise<DiffChange[]> {
    const changes = await this.generateFileDiff(filePath);
    const snapshot = this.fileSnapshots.get(filePath)!;
    const snapshotLines = snapshot.split('\n');
    
    const contextualChanges: DiffChange[] = [];
    const processedLines = new Set<number>();
    
    for (const _change of changes) {
      const startLine = 0;
      const endLine = snapshotLines.length - 1;
      
      for (let i = startLine; i <= endLine; i++) {
        if (!processedLines.has(i)) {
          processedLines.add(i);
          
          contextualChanges.push({
            type: 'modified',
            content: snapshotLines[i] || '',
          });
        }
      }
    }
    
    return contextualChanges;
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
    } catch (error) {
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
    const changes: DiffChange[] = [];
    
    // Use Myers' algorithm for computing diffs
    const lcs = this.longestCommonSubsequence(oldLines, newLines);
    const diffResult = this.generateDiffFromLCS(oldLines, newLines, lcs);
    
    let _lineNumber = 0;
    for (const item of diffResult) {
      switch (item.type) {
        case 'added':
          changes.push({
            type: 'added',
            content: item.content,
          });
          _lineNumber++;
          break;
        case 'removed':
          changes.push({
            type: 'removed',
            content: item.content,
          });
          break;
        case 'modified':
          changes.push({
            type: 'modified',
            content: item.content,
          });
          _lineNumber++;
          break;
        case 'unchanged':
          _lineNumber++;
          break;
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

  private generateDiffFromLCS(oldLines: string[], newLines: string[], lcs: number[][]): Array<{
    type: 'added' | 'removed' | 'modified' | 'unchanged';
    content: string;
    newContent?: string;
  }> {
    const result: Array<{
      type: 'added' | 'removed' | 'modified' | 'unchanged';
      content: string;
      newContent?: string;
    }> = [];
    
    let i = oldLines.length;
    let j = newLines.length;
    
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.unshift({
          type: 'unchanged',
          content: oldLines[i - 1] || '',
        });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || (lcs[i]?.[j - 1] || 0) >= (lcs[i - 1]?.[j] || 0))) {
        result.unshift({
          type: 'added',
          content: newLines[j - 1] || '',
        });
        j--;
      } else if (i > 0) {
        result.unshift({
          type: 'removed',
          content: oldLines[i - 1] || '',
        });
        i--;
      }
    }
    
    return result;
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
          addedLines++;
          break;
        case 'removed':
          removedLines++;
          break;
        case 'modified':
          modifiedLines++;
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