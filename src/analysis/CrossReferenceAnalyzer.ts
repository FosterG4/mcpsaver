import * as path from "path";
import type { SymbolInfo } from "../types/index.js";
import type {
  SemanticContext,
  SymbolRelationship,
} from "./SemanticAnalyzer.js";
import type { DependencyGraph, FileNode } from "./DependencyTracker.js";
import { SemanticAnalyzer } from "./SemanticAnalyzer.js";
import { DependencyTracker } from "./DependencyTracker.js";

export interface SymbolReference {
  symbol: string;
  file: string;
  line: number;
  column: number;
  type: "definition" | "usage" | "modification" | "call" | "import" | "export";
  context: string; // Surrounding code context
  scope: string; // Function/class/module scope
}

export interface CrossReference {
  symbol: string;
  definition: SymbolReference;
  references: SymbolReference[];
  usageCount: number;
  fileCount: number; // Number of files using this symbol
  isPublicAPI: boolean;
  isDeprecated: boolean;
  lastUsed: number; // Timestamp of last usage
}

export interface SymbolUsageMetrics {
  totalSymbols: number;
  totalReferences: number;
  averageReferencesPerSymbol: number;
  mostUsedSymbols: Array<{ symbol: string; count: number }>;
  leastUsedSymbols: Array<{ symbol: string; count: number }>;
  unusedSymbols: string[];
  publicAPIUsage: Map<string, number>;
  crossFileUsage: Map<string, number>;
}

export interface DeadCodeAnalysis {
  unusedFunctions: string[];
  unusedClasses: string[];
  unusedVariables: string[];
  unusedImports: string[];
  unreachableCode: Array<{
    file: string;
    line: number;
    reason: string;
  }>;
  potentialDeadCode: Array<{
    symbol: string;
    file: string;
    reason: string;
    confidence: number; // 0-1
  }>;
}

export interface RefactoringOpportunity {
  type:
    | "extract_method"
    | "inline_method"
    | "move_method"
    | "rename_symbol"
    | "remove_unused";
  symbol: string;
  file: string;
  description: string;
  impact: "low" | "medium" | "high";
  effort: number; // Estimated hours
  benefits: string[];
  risks: string[];
}

export interface SymbolHotspot {
  symbol: string;
  file: string;
  changeFrequency: number; // How often this symbol is modified
  usageFrequency: number; // How often this symbol is used
  complexity: number; // Cyclomatic complexity or similar metric
  riskScore: number; // Combined risk assessment
  recommendations: string[];
}

export class CrossReferenceAnalyzer {
  private semanticAnalyzer: SemanticAnalyzer;
  private dependencyTracker: DependencyTracker;
  private crossReferences: Map<string, CrossReference> = new Map();
  private symbolReferences: Map<string, SymbolReference[]> = new Map();
  private fileContexts: Map<string, SemanticContext> = new Map();

  constructor() {
    this.semanticAnalyzer = new SemanticAnalyzer();
    this.dependencyTracker = new DependencyTracker();
  }

  /**
   * Analyze cross-references across multiple files
   */
  async analyzeCrossReferences(
    filePaths: string[],
  ): Promise<Map<string, CrossReference>> {
    // Reset analysis state
    this.crossReferences.clear();
    this.symbolReferences.clear();
    this.fileContexts.clear();

    // Analyze each file to build symbol contexts
    for (const filePath of filePaths) {
      await this.analyzeFileReferences(filePath);
    }

    // Build cross-references from collected data
    await this.buildCrossReferences();

    // Analyze dependency relationships
    await this.dependencyTracker.analyzeDependencies(filePaths);

    return this.crossReferences;
  }

  /**
   * Find all references to a specific symbol
   */
  async findSymbolReferences(
    symbol: string,
    filePaths: string[],
  ): Promise<SymbolReference[]> {
    const references: SymbolReference[] = [];

    for (const filePath of filePaths) {
      const fileReferences = await this.findSymbolInFile(symbol, filePath);
      references.push(...fileReferences);
    }

    return references;
  }

  /**
   * Find all symbols that reference a given symbol
   */
  findSymbolDependents(symbol: string): string[] {
    const dependents: string[] = [];
    const crossRef = this.crossReferences.get(symbol);

    if (crossRef) {
      for (const reference of crossRef.references) {
        if (reference.type === "usage" || reference.type === "call") {
          // Find the symbol that contains this reference
          const containingSymbol = this.findContainingSymbol(reference);
          if (containingSymbol && !dependents.includes(containingSymbol)) {
            dependents.push(containingSymbol);
          }
        }
      }
    }

    return dependents;
  }

  /**
   * Analyze symbol usage patterns and metrics
   */
  analyzeUsageMetrics(): SymbolUsageMetrics {
    const totalSymbols = this.crossReferences.size;
    let totalReferences = 0;
    const symbolUsageCounts: Array<{ symbol: string; count: number }> = [];
    const unusedSymbols: string[] = [];
    const publicAPIUsage = new Map<string, number>();
    const crossFileUsage = new Map<string, number>();

    for (const [symbol, crossRef] of this.crossReferences) {
      const usageCount = crossRef.usageCount;
      totalReferences += usageCount;

      symbolUsageCounts.push({ symbol, count: usageCount });

      if (usageCount === 0) {
        unusedSymbols.push(symbol);
      }

      if (crossRef.isPublicAPI) {
        publicAPIUsage.set(symbol, usageCount);
      }

      if (crossRef.fileCount > 1) {
        crossFileUsage.set(symbol, crossRef.fileCount);
      }
    }

    // Sort by usage count
    symbolUsageCounts.sort((a, b) => b.count - a.count);

    const averageReferencesPerSymbol =
      totalSymbols > 0 ? totalReferences / totalSymbols : 0;
    const mostUsedSymbols = symbolUsageCounts.slice(0, 10);
    const leastUsedSymbols = symbolUsageCounts.slice(-10).reverse();

    return {
      totalSymbols,
      totalReferences,
      averageReferencesPerSymbol,
      mostUsedSymbols,
      leastUsedSymbols,
      unusedSymbols,
      publicAPIUsage,
      crossFileUsage,
    };
  }

  /**
   * Perform dead code analysis
   */
  analyzeDeadCode(): DeadCodeAnalysis {
    const unusedFunctions: string[] = [];
    const unusedClasses: string[] = [];
    const unusedVariables: string[] = [];
    const unusedImports: string[] = [];
    const unreachableCode: Array<{
      file: string;
      line: number;
      reason: string;
    }> = [];
    const potentialDeadCode: Array<{
      symbol: string;
      file: string;
      reason: string;
      confidence: number;
    }> = [];

    for (const [symbol, crossRef] of this.crossReferences) {
      if (crossRef.usageCount === 0) {
        // Categorize unused symbols by type
        const symbolInfo = this.getSymbolInfo(symbol, crossRef.definition.file);

        if (symbolInfo) {
          switch (symbolInfo.type) {
            case "function":
              unusedFunctions.push(symbol);
              break;
            case "class":
              unusedClasses.push(symbol);
              break;
            case "variable":
              unusedVariables.push(symbol);
              break;
          }
        }
      } else if (crossRef.usageCount === 1 && !crossRef.isPublicAPI) {
        // Potentially dead code - only used once and not public
        potentialDeadCode.push({
          symbol,
          file: crossRef.definition.file,
          reason: "Only used once, consider inlining",
          confidence: 0.7,
        });
      }
    }

    // Analyze imports
    for (const [filePath, context] of this.fileContexts) {
      for (const [symbol, relationships] of context.relationships) {
        for (const rel of relationships) {
          if (rel.type === "imports") {
            const crossRef = this.crossReferences.get(symbol);
            if (!crossRef || crossRef.usageCount === 0) {
              unusedImports.push(`${symbol} in ${filePath}`);
            }
          }
        }
      }
    }

    return {
      unusedFunctions,
      unusedClasses,
      unusedVariables,
      unusedImports,
      unreachableCode,
      potentialDeadCode,
    };
  }

  /**
   * Identify refactoring opportunities
   */
  identifyRefactoringOpportunities(): RefactoringOpportunity[] {
    const opportunities: RefactoringOpportunity[] = [];

    for (const [symbol, crossRef] of this.crossReferences) {
      // Extract method opportunities
      if (crossRef.usageCount > 3 && this.isCodeDuplication(symbol)) {
        opportunities.push({
          type: "extract_method",
          symbol,
          file: crossRef.definition.file,
          description: `Extract repeated code pattern into a reusable method`,
          impact: "medium",
          effort: 2,
          benefits: ["Reduces code duplication", "Improves maintainability"],
          risks: ["May introduce additional complexity"],
        });
      }

      // Inline method opportunities
      if (crossRef.usageCount === 1 && this.isSimpleMethod(symbol)) {
        opportunities.push({
          type: "inline_method",
          symbol,
          file: crossRef.definition.file,
          description: `Inline simple method that's only used once`,
          impact: "low",
          effort: 0.5,
          benefits: ["Reduces indirection", "Simplifies code"],
          risks: ["May reduce readability if method name is descriptive"],
        });
      }

      // Remove unused opportunities
      if (crossRef.usageCount === 0 && !crossRef.isPublicAPI) {
        opportunities.push({
          type: "remove_unused",
          symbol,
          file: crossRef.definition.file,
          description: `Remove unused symbol`,
          impact: "low",
          effort: 0.25,
          benefits: ["Reduces code size", "Improves clarity"],
          risks: ["Symbol might be used by external code not analyzed"],
        });
      }

      // Move method opportunities
      if (this.shouldMoveSymbol(symbol, crossRef)) {
        opportunities.push({
          type: "move_method",
          symbol,
          file: crossRef.definition.file,
          description: `Move method to class where it's most used`,
          impact: "medium",
          effort: 1.5,
          benefits: ["Improves cohesion", "Reduces coupling"],
          risks: ["May break existing interfaces"],
        });
      }

      // Rename opportunities
      if (this.hasConfusingName(symbol)) {
        opportunities.push({
          type: "rename_symbol",
          symbol,
          file: crossRef.definition.file,
          description: `Rename symbol to be more descriptive`,
          impact: "low",
          effort: 1,
          benefits: ["Improves code readability", "Reduces confusion"],
          risks: ["Requires updating all references"],
        });
      }
    }

    // Sort by impact and effort
    return opportunities.sort((a, b) => {
      const impactOrder = { high: 3, medium: 2, low: 1 };
      const impactDiff = impactOrder[b.impact] - impactOrder[a.impact];
      if (impactDiff !== 0) return impactDiff;
      return a.effort - b.effort; // Lower effort first for same impact
    });
  }

  /**
   * Identify symbol hotspots that need attention
   */
  identifySymbolHotspots(): SymbolHotspot[] {
    const hotspots: SymbolHotspot[] = [];

    for (const [symbol, crossRef] of this.crossReferences) {
      const usageFrequency = crossRef.usageCount;
      const changeFrequency = this.calculateChangeFrequency(symbol);
      const complexity = this.calculateSymbolComplexity(symbol);

      // Calculate risk score
      const riskScore = this.calculateRiskScore(
        usageFrequency,
        changeFrequency,
        complexity,
      );

      if (riskScore > 0.7) {
        // High risk threshold
        const recommendations = this.generateRecommendations(symbol, crossRef, {
          usageFrequency,
          changeFrequency,
          complexity,
          riskScore,
        });

        hotspots.push({
          symbol,
          file: crossRef.definition.file,
          changeFrequency,
          usageFrequency,
          complexity,
          riskScore,
          recommendations,
        });
      }
    }

    return hotspots.sort((a, b) => b.riskScore - a.riskScore);
  }

  /**
   * Generate a symbol usage report
   */
  generateUsageReport(): {
    summary: SymbolUsageMetrics;
    deadCode: DeadCodeAnalysis;
    refactoringOpportunities: RefactoringOpportunity[];
    hotspots: SymbolHotspot[];
    crossReferences: Map<string, CrossReference>;
  } {
    return {
      summary: this.analyzeUsageMetrics(),
      deadCode: this.analyzeDeadCode(),
      refactoringOpportunities: this.identifyRefactoringOpportunities(),
      hotspots: this.identifySymbolHotspots(),
      crossReferences: this.crossReferences,
    };
  }

  private async analyzeFileReferences(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);

    try {
      const context = await this.semanticAnalyzer.analyzeFile(absolutePath);
      this.fileContexts.set(absolutePath, context);

      // Extract symbol references from the context
      await this.extractSymbolReferences(absolutePath, context);
    } catch (error) {
      console.warn(`Failed to analyze file ${filePath}:`, error);
    }
  }

  private async extractSymbolReferences(
    filePath: string,
    context: SemanticContext,
  ): Promise<void> {
    const references: SymbolReference[] = [];

    // Extract definitions
    for (const [symbol, symbolInfo] of context.symbols) {
      const reference: SymbolReference = {
        symbol,
        file: filePath,
        line: symbolInfo.startLine || 0,
        column: 0, // Would need more detailed AST analysis
        type: "definition",
        context: this.extractCodeContext(filePath, symbolInfo.startLine || 0),
        scope: symbolInfo.scope || "global",
      };

      references.push(reference);
    }

    // Extract relationships (usage, calls, imports, etc.)
    for (const [symbol, relationships] of context.relationships) {
      for (const rel of relationships) {
        const referenceType = this.mapRelationshipToReferenceType(rel.type);

        if (referenceType) {
          const reference: SymbolReference = {
            symbol: rel.target,
            file: filePath,
            line: rel.line || 0,
            column: 0,
            type: referenceType,
            context: this.extractCodeContext(filePath, rel.line || 0),
            scope: rel.scope || "unknown",
          };

          references.push(reference);
        }
      }
    }

    // Store references for this file
    this.symbolReferences.set(filePath, references);
  }

  private async buildCrossReferences(): Promise<void> {
    const symbolDefinitions = new Map<string, SymbolReference>();
    const symbolUsages = new Map<string, SymbolReference[]>();

    // Collect all definitions and usages
    for (const [filePath, references] of this.symbolReferences) {
      for (const reference of references) {
        if (reference.type === "definition") {
          symbolDefinitions.set(reference.symbol, reference);
        } else {
          if (!symbolUsages.has(reference.symbol)) {
            symbolUsages.set(reference.symbol, []);
          }
          symbolUsages.get(reference.symbol)!.push(reference);
        }
      }
    }

    // Build cross-references
    for (const [symbol, definition] of symbolDefinitions) {
      const usages = symbolUsages.get(symbol) || [];
      const fileSet = new Set([definition.file, ...usages.map((u) => u.file)]);

      const crossRef: CrossReference = {
        symbol,
        definition,
        references: usages,
        usageCount: usages.length,
        fileCount: fileSet.size,
        isPublicAPI: this.isPublicAPI(symbol, definition),
        isDeprecated: this.isDeprecated(symbol),
        lastUsed: this.getLastUsageTime(usages),
      };

      this.crossReferences.set(symbol, crossRef);
    }
  }

  private async findSymbolInFile(
    symbol: string,
    filePath: string,
  ): Promise<SymbolReference[]> {
    const references = this.symbolReferences.get(path.resolve(filePath)) || [];
    return references.filter((ref) => ref.symbol === symbol);
  }

  private findContainingSymbol(reference: SymbolReference): string | null {
    const context = this.fileContexts.get(reference.file);
    if (!context) return null;

    // Find the symbol that contains this reference line
    for (const [symbol, symbolInfo] of context.symbols) {
      if (
        symbolInfo.startLine &&
        symbolInfo.endLine &&
        reference.line >= symbolInfo.startLine &&
        reference.line <= symbolInfo.endLine
      ) {
        return symbol;
      }
    }

    return null;
  }

  private getSymbolInfo(symbol: string, filePath: string): SymbolInfo | null {
    const context = this.fileContexts.get(filePath);
    return context?.symbols.get(symbol) || null;
  }

  private extractCodeContext(filePath: string, line: number): string {
    // This would extract surrounding code context
    // For now, return a placeholder
    return `Line ${line} in ${path.basename(filePath)}`;
  }

  private mapRelationshipToReferenceType(
    relType: string,
  ): SymbolReference["type"] | null {
    switch (relType) {
      case "calls":
        return "call";
      case "uses":
        return "usage";
      case "modifies":
        return "modification";
      case "imports":
        return "import";
      case "exports":
        return "export";
      default:
        return null;
    }
  }

  private isPublicAPI(symbol: string, definition: SymbolReference): boolean {
    // Check if symbol is exported or part of public API
    const context = this.fileContexts.get(definition.file);
    if (!context) return false;

    const symbolInfo = context.symbols.get(symbol);
    return symbolInfo?.exports === true;
  }

  private isDeprecated(symbol: string): boolean {
    // Check for deprecation markers in comments or annotations
    // This would require more detailed AST analysis
    return symbol.includes("deprecated") || symbol.includes("legacy");
  }

  private getLastUsageTime(usages: SymbolReference[]): number {
    // In a real implementation, this would track actual usage timestamps
    // For now, return current time if there are usages
    return usages.length > 0 ? Date.now() : 0;
  }

  private isCodeDuplication(symbol: string): boolean {
    // Analyze if the symbol represents duplicated code patterns
    // This would require more sophisticated analysis
    return false; // Placeholder
  }

  private isSimpleMethod(symbol: string): boolean {
    // Check if method is simple enough to inline
    const crossRef = this.crossReferences.get(symbol);
    if (!crossRef) return false;

    const symbolInfo = this.getSymbolInfo(symbol, crossRef.definition.file);
    if (!symbolInfo || symbolInfo.type !== "function") return false;

    // Simple heuristic: methods with few lines
    const lineCount = (symbolInfo.endLine || 0) - (symbolInfo.startLine || 0);
    return lineCount <= 5;
  }

  private shouldMoveSymbol(symbol: string, crossRef: CrossReference): boolean {
    // Analyze if symbol should be moved to a different class/file
    if (crossRef.fileCount <= 1) return false;

    // Check if most usages are in a different file than definition
    const usagesByFile = new Map<string, number>();
    for (const ref of crossRef.references) {
      usagesByFile.set(ref.file, (usagesByFile.get(ref.file) || 0) + 1);
    }

    const maxUsageFile = Array.from(usagesByFile.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];

    return maxUsageFile && maxUsageFile[0] !== crossRef.definition.file;
  }

  private hasConfusingName(symbol: string): boolean {
    // Check for confusing or non-descriptive names
    const confusingPatterns = [
      /^[a-z]$/, // Single letter variables
      /^temp/, // Temporary variables
      /^data/, // Generic data variables
      /^item/, // Generic item variables
      /^obj/, // Generic object variables
      /^val/, // Generic value variables
    ];

    return confusingPatterns.some((pattern) => pattern.test(symbol));
  }

  private calculateChangeFrequency(symbol: string): number {
    // In a real implementation, this would analyze git history
    // For now, return a placeholder value
    return Math.random(); // 0-1
  }

  private calculateSymbolComplexity(symbol: string): number {
    const crossRef = this.crossReferences.get(symbol);
    if (!crossRef) return 0;

    const symbolInfo = this.getSymbolInfo(symbol, crossRef.definition.file);
    if (!symbolInfo) return 0;

    // Simple complexity based on line count and dependencies
    const lineCount = (symbolInfo.endLine || 0) - (symbolInfo.startLine || 0);
    const dependencyCount = symbolInfo.dependencies?.length || 0;

    return Math.min(lineCount / 50 + dependencyCount / 10, 1.0);
  }

  private calculateRiskScore(
    usageFrequency: number,
    changeFrequency: number,
    complexity: number,
  ): number {
    // Weighted risk calculation
    const usageWeight = 0.3;
    const changeWeight = 0.4;
    const complexityWeight = 0.3;

    const normalizedUsage = Math.min(usageFrequency / 100, 1.0);

    return (
      normalizedUsage * usageWeight +
      changeFrequency * changeWeight +
      complexity * complexityWeight
    );
  }

  private generateRecommendations(
    symbol: string,
    crossRef: CrossReference,
    metrics: {
      usageFrequency: number;
      changeFrequency: number;
      complexity: number;
      riskScore: number;
    },
  ): string[] {
    const recommendations: string[] = [];

    if (metrics.complexity > 0.7) {
      recommendations.push("Consider breaking down into smaller functions");
    }

    if (metrics.changeFrequency > 0.8) {
      recommendations.push("High change frequency - ensure good test coverage");
    }

    if (metrics.usageFrequency > 50) {
      recommendations.push(
        "Widely used symbol - changes require careful review",
      );
    }

    if (crossRef.fileCount > 5) {
      recommendations.push(
        "Used across many files - consider interface stability",
      );
    }

    return recommendations;
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.crossReferences.clear();
    this.symbolReferences.clear();
    this.fileContexts.clear();
    this.semanticAnalyzer.clearContexts();
    this.dependencyTracker.clearCache();
  }

  /**
   * Get current cross-references
   */
  getCrossReferences(): Map<string, CrossReference> {
    return this.crossReferences;
  }
}
