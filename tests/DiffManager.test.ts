import * as fs from 'fs/promises';
import * as path from 'path';
import { DiffManager } from '../src/diff/DiffManager';
import type { DiffChange } from '../src/types';

describe('DiffManager', () => {
  describe('computeDiff (via any)', () => {
    it('merges remove+add blocks into modified with correct line numbers', () => {
      const dm = new DiffManager();
      const oldContent = [
        'a',
        'b',
        'c',
        'd',
      ].join('\n');
      const newContent = [
        'a',
        'b2',
        'c2',
        'd',
      ].join('\n');

      const changes: ReturnType<any> = (dm as any).computeDiff(oldContent, newContent, 'dummy.ts');

      // Expect a single modified block replacing lines 2-3 with 2-3
      const modified = changes.find((c: DiffChange) => c.type === 'modified');
      expect(modified).toBeTruthy();
      expect(modified!.oldStart).toBe(2);
      expect(modified!.oldEnd).toBe(3);
      expect(modified!.newStart).toBe(2);
      expect(modified!.newEnd).toBe(3);
      expect(modified!.content).toBe(['b2', 'c2'].join('\n'));
    });
  });

  describe('applyDiff', () => {
    it('applies added, removed, and modified changes correctly', () => {
      const dm = new DiffManager();
      const original = ['line1', 'line2', 'line3', 'line4'].join('\n');
      const changes: DiffChange[] = [
        // remove line2
        { type: 'removed', oldStart: 2, oldEnd: 2, content: 'line2' },
        // modify line3 -> x3
        { type: 'modified', oldStart: 3, oldEnd: 3, newStart: 3, newEnd: 3, content: 'x3' },
        // add a line before end
        { type: 'added', newStart: 4, newEnd: 4, content: 'inserted' },
      ];

      const result = dm.applyDiff(original, changes);
      expect(result.split('\n')).toEqual(['line1', 'x3', 'inserted', 'line4']);
    });
  });

  describe('generateContextualDiff', () => {
    const tmpDir = path.join(process.cwd(), 'tests', 'tmp');
    const filePath = path.join(tmpDir, 'context.txt');

    beforeAll(async () => {
      await fs.mkdir(tmpDir, { recursive: true });
    });

    it('includes surrounding context lines for added/removed/modified', async () => {
      const dm = new DiffManager();
      const oldContent = ['A', 'B', 'C', 'D', 'E', 'F'].join('\n');
      const newContent = ['A', 'B', 'X', 'Y', 'E', 'F'].join('\n');

      // snapshot from old content
      dm.createSnapshotFromContent(filePath, oldContent);
      // write new content to file so method can read it
      await fs.writeFile(filePath, newContent, 'utf8');

      const contextual = await dm.generateContextualDiff(filePath, 1);
      expect(Array.isArray(contextual)).toBe(true);
      // Should have at least one modified block containing context around X,Y
      const mod = contextual.find((c) => c.type === 'modified');
      expect(mod).toBeTruthy();
      expect(mod!.content).toContain('B');
      expect(mod!.content).toContain('X');
      expect(mod!.content).toContain('Y');
      expect(mod!.content).toContain('E');
    });
  });
});
