import { CodeReferenceOptimizer } from '../src/core/CodeReferenceOptimizer';

describe('CodeReferenceOptimizer (smoke)', () => {
  it('optimizeImports returns minimal imports and tokenSavings number', async () => {
    const astParser = {} as any;
    const cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      getByFilePath: jest.fn().mockResolvedValue([]),
    } as any;
    const diffManager = {} as any;
    const importAnalyzer = {
      extractImports: jest.fn().mockResolvedValue([
        'import a from "a";\n',
        'import b from "b";\n',
      ]),
      getMinimalImports: jest.fn().mockResolvedValue(['import a from "a";\n']),
    } as any;

    const optimizer = new CodeReferenceOptimizer(
      astParser,
      cacheManager,
      diffManager,
      importAnalyzer
    );

    const result = await optimizer.optimizeImports({
      filePath: 'dummy.ts',
      usedSymbols: ['A'],
    });

    expect(Array.isArray(result.optimizedImports)).toBe(true);
    expect(result.optimizedImports).toEqual(['import a from "a";\n']);
    expect(result.removedImports).toEqual(['import b from "b";\n']);
    expect(typeof result.tokenSavings).toBe('number');
  });

  it('extractCodeContext uses cache when available and respects maxTokens', async () => {
    const mockContext = {
      filePath: 'dummy.ts',
      extractedCode: 'function foo() { return 42; }',
      imports: ['import x from "x";'],
      symbols: ['foo'],
      dependencies: [],
      tokenCount: 9999,
      timestamp: Date.now(),
      relevanceScore: 1,
    };

    const astParser = {
      parseFile: jest.fn(),
      extractContext: jest.fn(),
    } as any;

    const cacheManager = {
      get: jest.fn().mockResolvedValue(mockContext),
      set: jest.fn().mockResolvedValue(undefined),
      getByFilePath: jest.fn().mockResolvedValue([]),
    } as any;

    const diffManager = {} as any;
    const importAnalyzer = {
      getMinimalImports: jest.fn().mockResolvedValue(['import x from "x";']),
    } as any;

    const optimizer = new CodeReferenceOptimizer(
      astParser,
      cacheManager,
      diffManager,
      importAnalyzer
    );

    const res = await optimizer.extractCodeContext({
      filePath: 'dummy.ts',
      targetSymbols: ['foo'],
      includeImports: true,
      maxTokens: 10,
    });

    expect(res.filePath).toBe('dummy.ts');
    expect(res.tokenCount).toBeLessThanOrEqual(10);
    expect(res.imports.length).toBeGreaterThanOrEqual(0);
  });
});
