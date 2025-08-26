import type { ASTParser } from "../parsers/ASTParser.js";
import type { CacheManager } from "../cache/CacheManager.js";
import type { DiffManager } from "../diff/DiffManager.js";
import type { ImportAnalyzer } from "../analysis/ImportAnalyzer.js";
import type {
  CodeContext,
  ExtractContextOptions,
  DiffAnalysisOptions,
  ImportOptimizationOptions,
  CacheStats,
} from "../types/index.js";

export class CodeReferenceOptimizer {
  constructor(
    private astParser: ASTParser,
    private cacheManager: CacheManager,
    private diffManager: DiffManager,
    private importAnalyzer: ImportAnalyzer,
  ) {}

  /**
   * Extract minimal code context using AST parsing and caching
   */
  async extractCodeContext(
    options: ExtractContextOptions,
  ): Promise<CodeContext> {
    const { filePath, targetSymbols, includeImports, maxTokens } = options;

    // Check cache first
    const cacheKey = this.generateCacheKey(
      filePath,
      targetSymbols,
      includeImports,
    );
    const cached = await this.cacheManager.get(cacheKey);

    if (cached && !this.isStale(cached, filePath)) {
      return this.truncateToTokenLimit(cached, maxTokens || 1000);
    }

    // Parse file and extract context
    const ast = await this.astParser.parseFile(filePath);
    const extractedContext = await this.astParser.extractContext(
      ast,
      targetSymbols,
    );

    // Optimize imports if requested
    let optimizedImports: string[] = [];
    if (includeImports) {
      const usedSymbols = this.extractUsedSymbols(extractedContext);
      optimizedImports = await this.importAnalyzer.getMinimalImports(
        filePath,
        usedSymbols,
      );
    }

    const context: CodeContext = {
      filePath,
      extractedCode: extractedContext.code,
      imports: optimizedImports,
      symbols: extractedContext.symbols,
      dependencies: extractedContext.dependencies,
      tokenCount: this.estimateTokenCount(
        extractedContext.code + optimizedImports.join("\n"),
      ),
      timestamp: Date.now(),
      relevanceScore: this.calculateRelevanceScore(
        extractedContext,
        targetSymbols,
      ),
    };

    // Cache the result
    await this.cacheManager.set(cacheKey, context);

    return this.truncateToTokenLimit(context, maxTokens || 1000);
  }

  /**
   * Get cached context for a file
   */
  async getCachedContext(
    filePath: string,
    cacheKey?: string,
  ): Promise<CodeContext | null> {
    if (cacheKey) {
      return await this.cacheManager.get(cacheKey);
    }

    // Find most relevant cached context for the file
    const allCached = await this.cacheManager.getByFilePath(filePath);
    if (allCached.length === 0) {
      return null;
    }

    // Return the most recent and relevant cached context
    const sortedCached = (allCached || []).sort((a, b) => {
      const scoreA = a.relevanceScore * (1 - this.getAgeWeight(a.timestamp));
      const scoreB = b.relevanceScore * (1 - this.getAgeWeight(b.timestamp));
      return scoreB - scoreA;
    });
    return sortedCached.length > 0 ? (sortedCached[0] as CodeContext) : null;
  }

  /**
   * Monitor cache: return cache stats and top cached entries
   */
  async monitorCached(options?: {
    filePath?: string;
    limit?: number;
  }): Promise<{
    stats: CacheStats;
    entries: Array<{
      key?: string;
      filePath: string;
      tokenCount: number;
      relevanceScore: number;
      timestamp: number;
      score?: number;
    }>;
  }> {
    const filePath = options?.filePath;
    const limit = options?.limit ?? 10;

    const stats = this.cacheManager.getStats();

    let entries: Array<{
      key?: string;
      filePath: string;
      tokenCount: number;
      relevanceScore: number;
      timestamp: number;
      score?: number;
    }> = [];

    if (filePath) {
      const contexts = await this.cacheManager.getByFilePath(filePath);
      const sorted = (contexts || []).sort((a, b) => {
        const scoreA = a.relevanceScore * (1 - this.getAgeWeight(a.timestamp));
        const scoreB = b.relevanceScore * (1 - this.getAgeWeight(b.timestamp));
        return scoreB - scoreA;
      });
      entries = sorted.slice(0, limit).map((c) => ({
        filePath: c.filePath,
        tokenCount: c.tokenCount,
        relevanceScore: c.relevanceScore,
        timestamp: c.timestamp,
      }));
    } else {
      const ranked = this.cacheManager.getEntriesByRelevance();
      entries = ranked.slice(0, limit).map((e) => ({
        key: e.key,
        filePath: e.context.filePath,
        tokenCount: e.context.tokenCount,
        relevanceScore: e.context.relevanceScore,
        timestamp: e.context.timestamp,
        score: e.score,
      }));
    }

    return { stats, entries };
  }

  /**
   * Analyze code differences and provide minimal updates
   */
  async analyzeCodeDiff(options: DiffAnalysisOptions): Promise<{
    changes: Array<{
      type: "added" | "removed" | "modified";
      symbol: string;
      code: string;
      lineNumber: number;
    }>;
    affectedSymbols: string[];
    minimalUpdate: string;
    tokenSavings: number;
  }> {
    const { filePath, oldContent, newContent } = options;

    // Create snapshot from old content
    this.diffManager.createSnapshotFromContent(filePath, oldContent);

    // Extract symbols from old content
    const oldSymbols = await this.extractSymbolsFromContent(
      oldContent,
      filePath,
    );
    await this.diffManager.createSymbolSnapshots(filePath, oldSymbols);

    // Extract symbols from new content
    const newSymbols = await this.extractSymbolsFromContent(
      newContent,
      filePath,
    );

    // Generate symbol-level diff
    const symbolChanges = await this.diffManager.generateSymbolDiff(
      filePath,
      newSymbols,
    );

    // Convert SymbolChange[] to the expected format
    const changes = symbolChanges.map((change) => ({
      type: change.type,
      symbol: change.symbol,
      code: change.code,
      lineNumber: change.lineNumber,
    }));

    const affectedSymbols = changes.map((change) => change.symbol);

    // Generate minimal update containing only changed parts
    const minimalUpdate = this.generateMinimalUpdate(changes);

    // Calculate token savings
    const fullContentTokens = this.estimateTokenCount(newContent);
    const minimalUpdateTokens = this.estimateTokenCount(minimalUpdate);
    const tokenSavings = fullContentTokens - minimalUpdateTokens;

    return {
      changes,
      affectedSymbols,
      minimalUpdate,
      tokenSavings,
    };
  }

  /**
   * Optimize imports to reduce redundancy
   */
  async optimizeImports(options: ImportOptimizationOptions): Promise<{
    optimizedImports: string[];
    removedImports: string[];
    tokenSavings: number;
  }> {
    const { filePath, usedSymbols } = options;

    const originalImports = await this.importAnalyzer.extractImports(filePath);
    const optimizedImports = await this.importAnalyzer.getMinimalImports(
      filePath,
      usedSymbols || [],
    );

    const removedImports = originalImports.filter(
      (imp) => !optimizedImports.includes(imp),
    );

    const originalTokens = this.estimateTokenCount(originalImports.join("\n"));
    const optimizedTokens = this.estimateTokenCount(
      optimizedImports.join("\n"),
    );
    const tokenSavings = originalTokens - optimizedTokens;

    return {
      optimizedImports,
      removedImports,
      tokenSavings,
    };
  }

  private generateCacheKey(
    filePath: string,
    targetSymbols?: string[],
    includeImports?: boolean,
  ): string {
    const symbolsKey = targetSymbols ? targetSymbols.sort().join(",") : "all";
    const importsKey = includeImports ? "with-imports" : "no-imports";
    return `${filePath}:${symbolsKey}:${importsKey}`;
  }

  private isStale(context: CodeContext, _filePath: string): boolean {
    // Check if file has been modified since cache entry
    // This would typically check file modification time
    const maxAge = 5 * 60 * 1000; // 5 minutes
    return Date.now() - context.timestamp > maxAge;
  }

  private truncateToTokenLimit(
    context: CodeContext,
    maxTokens: number,
  ): CodeContext {
    if (context.tokenCount <= maxTokens) {
      return context;
    }

    // Truncate code while preserving structure
    const lines = context.extractedCode.split("\n");
    const truncatedLines: string[] = [];
    let currentTokens = this.estimateTokenCount(context.imports.join("\n"));

    for (const line of lines) {
      const lineTokens = this.estimateTokenCount(line);
      if (currentTokens + lineTokens > maxTokens) {
        break;
      }
      truncatedLines.push(line);
      currentTokens += lineTokens;
    }

    return {
      ...context,
      extractedCode: truncatedLines.join("\n"),
      tokenCount: currentTokens,
    };
  }

  private extractUsedSymbols(context: {
    code: string;
    symbols: string[];
  }): string[] {
    // Extract symbols that are actually referenced in the code
    const usedSymbols: string[] = [];
    const codeText = context.code;

    for (const symbol of context.symbols) {
      if (codeText.includes(symbol)) {
        usedSymbols.push(symbol);
      }
    }

    return usedSymbols;
  }

  private calculateRelevanceScore(
    context: { symbols: string[] },
    targetSymbols?: string[],
  ): number {
    if (!targetSymbols || targetSymbols.length === 0) {
      return 1.0;
    }

    const matchingSymbols = context.symbols.filter((symbol) =>
      targetSymbols.includes(symbol),
    );

    return matchingSymbols.length / targetSymbols.length;
  }

  private getAgeWeight(timestamp: number): number {
    const ageMs = Date.now() - timestamp;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    return Math.min(ageMs / maxAge, 1.0);
  }

  private generateMinimalUpdate(
    changes: Array<{
      type: "added" | "removed" | "modified";
      symbol: string;
      code: string;
      lineNumber: number;
    }>,
  ): string {
    return changes
      .map((change) => {
        const action = change.type === "removed" ? "REMOVE" : "UPDATE";
        return `// ${action} ${change.symbol} at line ${change.lineNumber}\n${change.code}`;
      })
      .join("\n\n");
  }

  private async extractSymbolsFromContent(
    content: string,
    filePath: string,
  ): Promise<Map<string, string>> {
    const symbols = new Map<string, string>();

    try {
      const parsed = await this.astParser.parseContent(content, filePath);
      const extractedContext = await this.astParser.extractContext(parsed, []);

      // Extract each symbol with its code
      for (const symbol of extractedContext.symbols) {
        // For now, we'll use a simple approach to extract symbol code
        // In a more sophisticated implementation, we'd extract the actual symbol definition
        const symbolCode = this.extractSymbolCode(content, symbol);
        if (symbolCode) {
          symbols.set(symbol, symbolCode);
        }
      }
    } catch (error) {
      console.warn(`Failed to extract symbols from ${filePath}:`, error);
    }

    return symbols;
  }

  private extractSymbolCode(content: string, symbolName: string): string {
    const lines = content.split("\n");
    const symbolRegex = new RegExp(
      `(class|function|interface|type|const|let|var)\\s+${symbolName}\\b`,
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && symbolRegex.test(line)) {
        // Simple extraction - just return the line for now
        // In a more sophisticated implementation, we'd extract the full symbol definition
        return line.trim();
      }
    }

    return "";
  }

  private estimateTokenCount(text: string): number {
    // Simple token estimation (roughly 4 characters per token)
    return Math.ceil(text.length / 4);
  }
}
