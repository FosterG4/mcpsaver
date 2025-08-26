import * as fs from "fs/promises";
import * as path from "path";
import type { SymbolInfo } from "../types/index.js";
import type { SemanticContext } from "../analysis/SemanticAnalyzer.js";
import type { CrossReference } from "../analysis/CrossReferenceAnalyzer.js";

export interface TextFeatures {
  // Basic text features
  tokenCount: number;
  uniqueTokenCount: number;
  averageTokenLength: number;
  characterCount: number;

  // Linguistic features
  camelCaseTokens: string[];
  snakeCaseTokens: string[];
  abbreviations: string[];
  technicalTerms: string[];

  // Semantic features
  nounPhrases: string[];
  verbPhrases: string[];
  domainTerms: string[];

  // Code-specific features
  hasNumbers: boolean;
  hasSpecialChars: boolean;
  isAcronym: boolean;
  followsNamingConvention: boolean;
}

export interface CodeFeatures {
  // Structural features
  nestingLevel: number;
  cyclomaticComplexity: number;
  linesOfCode: number;
  commentDensity: number;

  // Dependency features
  fanIn: number; // Number of incoming dependencies
  fanOut: number; // Number of outgoing dependencies
  instability: number; // fanOut / (fanIn + fanOut)

  // Usage features
  callFrequency: number;
  modificationFrequency: number;
  testCoverage: number;
  documentationCoverage: number;

  // Quality metrics
  maintainabilityIndex: number;
  technicalDebt: number;
  codeSmells: string[];

  // Pattern features
  designPatterns: string[];
  antiPatterns: string[];
  architecturalRole: string; // 'controller', 'model', 'view', 'service', etc.
}

export interface ContextFeatures {
  // File context
  fileName: string;
  fileExtension: string;
  directoryPath: string;
  moduleType: string; // 'core', 'util', 'test', 'config', etc.

  // Project context
  packageName: string;
  namespace: string;
  projectType: string; // 'library', 'application', 'framework', etc.

  // Temporal context
  creationTime: number;
  lastModified: number;
  commitFrequency: number;
  authorCount: number;

  // Relationship context
  siblingSymbols: string[];
  parentSymbols: string[];
  childSymbols: string[];
  relatedFiles: string[];
}

export interface UsageFeatures {
  // Frequency metrics
  totalUsageCount: number;
  recentUsageCount: number;
  peakUsageCount: number;
  usageTrend: "increasing" | "decreasing" | "stable";

  // Distribution metrics
  usageSpread: number; // How widely used across files
  usageConcentration: number; // How concentrated usage is
  crossModuleUsage: number;

  // Temporal patterns
  usagePatterns: {
    hourly: number[];
    daily: number[];
    weekly: number[];
  };

  // User patterns
  userCount: number;
  powerUserUsage: number; // Usage by top 20% of users
  casualUserUsage: number; // Usage by bottom 80% of users
}

export interface SemanticFeatures {
  // Concept features
  abstractionLevel: number; // 0 = concrete, 1 = abstract
  domainSpecificity: number; // 0 = generic, 1 = domain-specific
  businessRelevance: number; // 0 = technical, 1 = business

  // Relationship features
  semanticCohesion: number;
  conceptualCoupling: number;
  interfaceStability: number;

  // Intent features
  purposeClarity: number;
  responsibilityFocus: number;
  sideEffectRisk: number;

  // Evolution features
  apiStability: number;
  backwardCompatibility: number;
  deprecationRisk: number;
}

export interface CombinedFeatures {
  text: TextFeatures;
  code: CodeFeatures;
  context: ContextFeatures;
  usage: UsageFeatures;
  semantic: SemanticFeatures;

  // Composite scores
  relevanceScore: number;
  qualityScore: number;
  maintainabilityScore: number;
  riskScore: number;
}

export class FeatureExtractor {
  private technicalTerms: Set<string>;
  private domainTerms: Map<string, string[]>;
  private namingPatterns: Map<string, RegExp>;
  private designPatterns: Map<string, RegExp[]>;
  private codeSmellPatterns: Map<string, RegExp[]>;

  constructor() {
    this.technicalTerms = new Set([
      "api",
      "http",
      "json",
      "xml",
      "sql",
      "database",
      "cache",
      "queue",
      "thread",
      "async",
      "sync",
      "promise",
      "callback",
      "event",
      "stream",
      "buffer",
      "socket",
      "connection",
      "session",
      "token",
      "auth",
      "oauth",
      "encryption",
      "hash",
      "algorithm",
      "data",
      "model",
      "view",
      "controller",
      "service",
      "repository",
      "factory",
      "builder",
      "adapter",
      "proxy",
      "decorator",
      "observer",
      "strategy",
      "command",
      "state",
      "visitor",
    ]);

    this.domainTerms = new Map([
      [
        "web",
        [
          "html",
          "css",
          "dom",
          "browser",
          "client",
          "server",
          "request",
          "response",
        ],
      ],
      [
        "database",
        ["table", "column", "row", "index", "query", "transaction", "schema"],
      ],
      [
        "security",
        [
          "authentication",
          "authorization",
          "permission",
          "role",
          "user",
          "password",
        ],
      ],
      [
        "business",
        ["order", "customer", "product", "invoice", "payment", "account"],
      ],
      [
        "ui",
        ["button", "form", "input", "dialog", "menu", "layout", "component"],
      ],
    ]);

    this.initializePatterns();
  }

  /**
   * Extract all features for a symbol
   */
  async extractFeatures(
    symbol: string,
    symbolInfo: SymbolInfo,
    context: SemanticContext,
    filePath: string,
  ): Promise<CombinedFeatures> {
    const text = await this.extractTextFeatures(symbol, symbolInfo);
    const code = await this.extractCodeFeatures(symbolInfo, context);
    const contextFeatures = await this.extractContextFeatures(
      filePath,
      symbol,
      context,
    );
    const usage = await this.extractUsageFeatures(symbol, context);
    const semantic = await this.extractSemanticFeatures(
      symbol,
      symbolInfo,
      context,
    );

    // Calculate composite scores
    const relevanceScore = this.calculateRelevanceScore(
      text,
      code,
      contextFeatures,
      usage,
      semantic,
    );
    const qualityScore = this.calculateQualityScore(code, semantic);
    const maintainabilityScore = this.calculateMaintainabilityScore(
      code,
      semantic,
    );
    const riskScore = this.calculateRiskScore(code, usage, semantic);

    return {
      text,
      code,
      context: contextFeatures,
      usage,
      semantic,
      relevanceScore,
      qualityScore,
      maintainabilityScore,
      riskScore,
    };
  }

  /**
   * Extract text-based features from symbol name and comments
   */
  async extractTextFeatures(
    symbol: string,
    symbolInfo: SymbolInfo,
  ): Promise<TextFeatures> {
    const tokens = this.tokenizeSymbolName(symbol);
    const uniqueTokens = [...new Set(tokens)];

    return {
      tokenCount: tokens.length,
      uniqueTokenCount: uniqueTokens.length,
      averageTokenLength:
        tokens.reduce((sum, token) => sum + token.length, 0) / tokens.length,
      characterCount: symbol.length,

      camelCaseTokens: this.extractCamelCaseTokens(symbol),
      snakeCaseTokens: this.extractSnakeCaseTokens(symbol),
      abbreviations: this.extractAbbreviations(tokens),
      technicalTerms: this.extractTechnicalTerms(tokens),

      nounPhrases: this.extractNounPhrases(tokens),
      verbPhrases: this.extractVerbPhrases(tokens),
      domainTerms: this.extractDomainTerms(tokens),

      hasNumbers: /\d/.test(symbol),
      hasSpecialChars: /[^a-zA-Z0-9_]/.test(symbol),
      isAcronym: this.isAcronym(symbol),
      followsNamingConvention: this.followsNamingConvention(
        symbol,
        symbolInfo.type,
      ),
    };
  }

  /**
   * Extract code structure and quality features
   */
  async extractCodeFeatures(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): Promise<CodeFeatures> {
    const linesOfCode = (symbolInfo.endLine || 0) - (symbolInfo.startLine || 0);
    const dependencies = symbolInfo.dependencies || [];

    return {
      nestingLevel: this.calculateNestingLevel(symbolInfo),
      cyclomaticComplexity: this.calculateCyclomaticComplexity(symbolInfo),
      linesOfCode,
      commentDensity: this.calculateCommentDensity(symbolInfo),

      fanIn: this.calculateFanIn(symbolInfo, context),
      fanOut: dependencies.length,
      instability: this.calculateInstability(symbolInfo, context),

      callFrequency: this.calculateCallFrequency(symbolInfo, context),
      modificationFrequency: 0, // Would be calculated from git history
      testCoverage: 0, // Would be calculated from test analysis
      documentationCoverage: this.calculateDocumentationCoverage(symbolInfo),

      maintainabilityIndex: this.calculateMaintainabilityIndex(symbolInfo),
      technicalDebt: this.calculateTechnicalDebt(symbolInfo),
      codeSmells: this.detectCodeSmells(symbolInfo),

      designPatterns: this.detectDesignPatterns(symbolInfo, context),
      antiPatterns: this.detectAntiPatterns(symbolInfo, context),
      architecturalRole: this.determineArchitecturalRole(symbolInfo, context),
    };
  }

  /**
   * Extract contextual features from file and project
   */
  async extractContextFeatures(
    filePath: string,
    symbol: string,
    context: SemanticContext,
  ): Promise<ContextFeatures> {
    const fileName = path.basename(filePath);
    const fileExtension = path.extname(filePath);
    const directoryPath = path.dirname(filePath);

    return {
      fileName,
      fileExtension,
      directoryPath,
      moduleType: this.determineModuleType(filePath),

      packageName: this.extractPackageName(filePath),
      namespace: this.extractNamespace(filePath, context),
      projectType: this.determineProjectType(filePath),

      creationTime: 0, // Would be extracted from git history
      lastModified: 0, // Would be extracted from git history
      commitFrequency: 0, // Would be calculated from git history
      authorCount: 0, // Would be calculated from git history

      siblingSymbols: this.findSiblingSymbols(symbol, context),
      parentSymbols: this.findParentSymbols(symbol, context),
      childSymbols: this.findChildSymbols(symbol, context),
      relatedFiles: this.findRelatedFiles(filePath, context),
    };
  }

  /**
   * Extract usage pattern features
   */
  async extractUsageFeatures(
    symbol: string,
    context: SemanticContext,
  ): Promise<UsageFeatures> {
    // This would be populated from actual usage tracking
    return {
      totalUsageCount: 0,
      recentUsageCount: 0,
      peakUsageCount: 0,
      usageTrend: "stable",

      usageSpread: 0,
      usageConcentration: 0,
      crossModuleUsage: 0,

      usagePatterns: {
        hourly: new Array(24).fill(0),
        daily: new Array(7).fill(0),
        weekly: new Array(52).fill(0),
      },

      userCount: 0,
      powerUserUsage: 0,
      casualUserUsage: 0,
    };
  }

  /**
   * Extract semantic and conceptual features
   */
  async extractSemanticFeatures(
    symbol: string,
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): Promise<SemanticFeatures> {
    return {
      abstractionLevel: this.calculateAbstractionLevel(symbolInfo, context),
      domainSpecificity: this.calculateDomainSpecificity(symbol, symbolInfo),
      businessRelevance: this.calculateBusinessRelevance(symbol, symbolInfo),

      semanticCohesion: this.calculateSemanticCohesion(symbolInfo, context),
      conceptualCoupling: this.calculateConceptualCoupling(symbolInfo, context),
      interfaceStability: this.calculateInterfaceStability(symbolInfo),

      purposeClarity: this.calculatePurposeClarity(symbol, symbolInfo),
      responsibilityFocus: this.calculateResponsibilityFocus(
        symbolInfo,
        context,
      ),
      sideEffectRisk: this.calculateSideEffectRisk(symbolInfo),

      apiStability: this.calculateApiStability(symbolInfo),
      backwardCompatibility: this.calculateBackwardCompatibility(symbolInfo),
      deprecationRisk: this.calculateDeprecationRisk(symbol, symbolInfo),
    };
  }

  // Text processing methods
  private tokenizeSymbolName(symbol: string): string[] {
    // Handle camelCase, PascalCase, snake_case, kebab-case
    return symbol
      .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase
      .replace(/[_-]/g, " ") // snake_case, kebab-case
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 0);
  }

  private extractCamelCaseTokens(symbol: string): string[] {
    const matches = symbol.match(/[a-z]+|[A-Z][a-z]*/g);
    return matches || [];
  }

  private extractSnakeCaseTokens(symbol: string): string[] {
    return symbol.split("_").filter((token) => token.length > 0);
  }

  private extractAbbreviations(tokens: string[]): string[] {
    return tokens.filter((token) => {
      return token.length <= 4 && token.toUpperCase() === token;
    });
  }

  private extractTechnicalTerms(tokens: string[]): string[] {
    return tokens.filter((token) =>
      this.technicalTerms.has(token.toLowerCase()),
    );
  }

  private extractNounPhrases(tokens: string[]): string[] {
    // Simplified noun phrase extraction
    const nounIndicators = [
      "data",
      "info",
      "list",
      "map",
      "set",
      "array",
      "object",
      "item",
    ];
    return tokens.filter((token) =>
      nounIndicators.some((indicator) => token.includes(indicator)),
    );
  }

  private extractVerbPhrases(tokens: string[]): string[] {
    // Simplified verb phrase extraction
    const verbIndicators = [
      "get",
      "set",
      "create",
      "delete",
      "update",
      "find",
      "search",
      "process",
      "handle",
    ];
    return tokens.filter((token) =>
      verbIndicators.some((indicator) => token.startsWith(indicator)),
    );
  }

  private extractDomainTerms(tokens: string[]): string[] {
    const domainTerms: string[] = [];

    for (const [domain, terms] of this.domainTerms) {
      for (const token of tokens) {
        if (terms.includes(token.toLowerCase())) {
          domainTerms.push(token);
        }
      }
    }

    return domainTerms;
  }

  private isAcronym(symbol: string): boolean {
    return (
      symbol.length <= 5 &&
      symbol === symbol.toUpperCase() &&
      /^[A-Z]+$/.test(symbol)
    );
  }

  private followsNamingConvention(symbol: string, type: string): boolean {
    const pattern = this.namingPatterns.get(type);
    return pattern ? pattern.test(symbol) : true;
  }

  // Code analysis methods
  private calculateNestingLevel(symbolInfo: SymbolInfo): number {
    // Would analyze actual code structure
    return 1;
  }

  private calculateCyclomaticComplexity(symbolInfo: SymbolInfo): number {
    // Simplified complexity calculation based on line count
    const lines = (symbolInfo.endLine || 0) - (symbolInfo.startLine || 0);
    return Math.max(1, Math.floor(lines / 10));
  }

  private calculateCommentDensity(symbolInfo: SymbolInfo): number {
    // Would analyze actual comments in code
    return 0.1; // Default 10% comment density
  }

  private calculateFanIn(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): number {
    // Count how many symbols depend on this one
    let fanIn = 0;
    for (const [, otherSymbol] of context.symbols) {
      if (otherSymbol.dependencies?.includes(symbolInfo.name || "")) {
        fanIn++;
      }
    }
    return fanIn;
  }

  private calculateInstability(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): number {
    const fanIn = this.calculateFanIn(symbolInfo, context);
    const fanOut = symbolInfo.dependencies?.length || 0;
    const total = fanIn + fanOut;
    return total > 0 ? fanOut / total : 0;
  }

  private calculateCallFrequency(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): number {
    // Would be calculated from actual usage analysis
    return 0;
  }

  private calculateDocumentationCoverage(symbolInfo: SymbolInfo): number {
    // Would analyze actual documentation
    return symbolInfo.exports ? 0.8 : 0.3; // Public symbols assumed to have better docs
  }

  private calculateMaintainabilityIndex(symbolInfo: SymbolInfo): number {
    const lines = (symbolInfo.endLine || 0) - (symbolInfo.startLine || 0);
    const complexity = this.calculateCyclomaticComplexity(symbolInfo);

    // Simplified maintainability index
    return Math.max(0, 100 - lines * 0.5 - complexity * 2);
  }

  private calculateTechnicalDebt(symbolInfo: SymbolInfo): number {
    // Would analyze code quality issues
    const lines = (symbolInfo.endLine || 0) - (symbolInfo.startLine || 0);
    return lines > 100 ? 0.3 : 0.1; // Larger functions have more debt
  }

  private detectCodeSmells(symbolInfo: SymbolInfo): string[] {
    const smells: string[] = [];
    const lines = (symbolInfo.endLine || 0) - (symbolInfo.startLine || 0);

    if (lines > 100) smells.push("long-method");
    if ((symbolInfo.dependencies?.length || 0) > 10)
      smells.push("feature-envy");

    return smells;
  }

  private detectDesignPatterns(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): string[] {
    const patterns: string[] = [];
    const name = symbolInfo.name || "";

    if (name.includes("Factory")) patterns.push("factory");
    if (name.includes("Builder")) patterns.push("builder");
    if (name.includes("Observer")) patterns.push("observer");
    if (name.includes("Strategy")) patterns.push("strategy");

    return patterns;
  }

  private detectAntiPatterns(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): string[] {
    const antiPatterns: string[] = [];
    const name = symbolInfo.name || "";

    if (name.includes("God") || name.includes("Manager"))
      antiPatterns.push("god-object");
    if (name.includes("Util") || name.includes("Helper"))
      antiPatterns.push("utility-class");

    return antiPatterns;
  }

  private determineArchitecturalRole(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): string {
    const name = (symbolInfo.name || "").toLowerCase();

    if (name.includes("controller")) return "controller";
    if (name.includes("service")) return "service";
    if (name.includes("repository") || name.includes("dao"))
      return "repository";
    if (name.includes("model") || name.includes("entity")) return "model";
    if (name.includes("view") || name.includes("component")) return "view";
    if (name.includes("util") || name.includes("helper")) return "utility";

    return "unknown";
  }

  // Context analysis methods
  private determineModuleType(filePath: string): string {
    const pathLower = filePath.toLowerCase();

    if (pathLower.includes("test")) return "test";
    if (pathLower.includes("config")) return "config";
    if (pathLower.includes("util")) return "utility";
    if (pathLower.includes("core")) return "core";
    if (pathLower.includes("lib")) return "library";

    return "application";
  }

  private extractPackageName(filePath: string): string {
    // Would extract from package.json or similar
    return "unknown";
  }

  private extractNamespace(filePath: string, context: SemanticContext): string {
    // Would extract from imports/exports
    return path.dirname(filePath).split(path.sep).pop() || "global";
  }

  private determineProjectType(filePath: string): string {
    // Would analyze project structure
    return "application";
  }

  private findSiblingSymbols(
    symbol: string,
    context: SemanticContext,
  ): string[] {
    // Would find symbols in the same scope/file
    return [];
  }

  private findParentSymbols(
    symbol: string,
    context: SemanticContext,
  ): string[] {
    const parents: string[] = [];
    const relationships = context.relationships.get(symbol) || [];

    for (const rel of relationships) {
      if (rel.type === "extends" || rel.type === "implements") {
        parents.push(rel.target);
      }
    }

    return parents;
  }

  private findChildSymbols(symbol: string, context: SemanticContext): string[] {
    const children: string[] = [];

    for (const [otherSymbol, relationships] of context.relationships) {
      for (const rel of relationships) {
        if (
          (rel.type === "extends" || rel.type === "implements") &&
          rel.target === symbol
        ) {
          children.push(otherSymbol);
        }
      }
    }

    return children;
  }

  private findRelatedFiles(
    filePath: string,
    context: SemanticContext,
  ): string[] {
    // Would find files with related symbols
    return [];
  }

  // Semantic analysis methods
  private calculateAbstractionLevel(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): number {
    const type = symbolInfo.type;

    if (type === "interface" || type === "abstract") return 0.9;
    if (type === "class") return 0.6;
    if (type === "function") return 0.4;
    if (type === "variable") return 0.1;

    return 0.5;
  }

  private calculateDomainSpecificity(
    symbol: string,
    symbolInfo: SymbolInfo,
  ): number {
    const tokens = this.tokenizeSymbolName(symbol);
    const domainTermCount = this.extractDomainTerms(tokens).length;
    const technicalTermCount = this.extractTechnicalTerms(tokens).length;

    return domainTermCount > technicalTermCount ? 0.8 : 0.3;
  }

  private calculateBusinessRelevance(
    symbol: string,
    symbolInfo: SymbolInfo,
  ): number {
    const tokens = this.tokenizeSymbolName(symbol);
    const businessTerms = [
      "order",
      "customer",
      "product",
      "payment",
      "account",
      "user",
    ];
    const hasBusinessTerms = tokens.some((token) =>
      businessTerms.includes(token.toLowerCase()),
    );

    return hasBusinessTerms ? 0.8 : 0.2;
  }

  private calculateSemanticCohesion(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): number {
    // Would analyze how well the symbol's responsibilities are related
    return 0.7;
  }

  private calculateConceptualCoupling(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): number {
    const dependencies = symbolInfo.dependencies?.length || 0;
    return Math.min(1, dependencies / 10); // Normalize to 0-1
  }

  private calculateInterfaceStability(symbolInfo: SymbolInfo): number {
    // Public APIs are assumed to be more stable
    return symbolInfo.exports ? 0.8 : 0.4;
  }

  private calculatePurposeClarity(
    symbol: string,
    symbolInfo: SymbolInfo,
  ): number {
    const tokens = this.tokenizeSymbolName(symbol);
    const verbTokens = this.extractVerbPhrases(tokens);

    // Clear verbs indicate clear purpose
    return verbTokens.length > 0 ? 0.8 : 0.4;
  }

  private calculateResponsibilityFocus(
    symbolInfo: SymbolInfo,
    context: SemanticContext,
  ): number {
    const dependencies = symbolInfo.dependencies?.length || 0;
    const lines = (symbolInfo.endLine || 0) - (symbolInfo.startLine || 0);

    // Fewer dependencies and shorter length indicate better focus
    return Math.max(0, 1 - dependencies / 20 - lines / 200);
  }

  private calculateSideEffectRisk(symbolInfo: SymbolInfo): number {
    const name = (symbolInfo.name || "").toLowerCase();
    const riskKeywords = [
      "delete",
      "remove",
      "clear",
      "reset",
      "modify",
      "update",
    ];

    return riskKeywords.some((keyword) => name.includes(keyword)) ? 0.7 : 0.2;
  }

  private calculateApiStability(symbolInfo: SymbolInfo): number {
    // Would analyze API change history
    return symbolInfo.exports ? 0.7 : 0.9; // Public APIs change more often
  }

  private calculateBackwardCompatibility(symbolInfo: SymbolInfo): number {
    // Would analyze breaking changes
    return 0.8;
  }

  private calculateDeprecationRisk(
    symbol: string,
    symbolInfo: SymbolInfo,
  ): number {
    const name = symbol.toLowerCase();
    const deprecationIndicators = ["legacy", "old", "deprecated", "obsolete"];

    return deprecationIndicators.some((indicator) => name.includes(indicator))
      ? 0.9
      : 0.1;
  }

  // Composite score calculations
  private calculateRelevanceScore(
    text: TextFeatures,
    code: CodeFeatures,
    context: ContextFeatures,
    usage: UsageFeatures,
    semantic: SemanticFeatures,
  ): number {
    const weights = {
      text: 0.3,
      code: 0.2,
      context: 0.2,
      usage: 0.15,
      semantic: 0.15,
    };

    const textScore = this.calculateTextRelevance(text);
    const codeScore = code.maintainabilityIndex / 100;
    const contextScore = context.moduleType === "core" ? 0.8 : 0.5;
    const usageScore = Math.min(1, usage.totalUsageCount / 100);
    const semanticScore = semantic.purposeClarity;

    return (
      textScore * weights.text +
      codeScore * weights.code +
      contextScore * weights.context +
      usageScore * weights.usage +
      semanticScore * weights.semantic
    );
  }

  private calculateQualityScore(
    code: CodeFeatures,
    semantic: SemanticFeatures,
  ): number {
    const maintainability = code.maintainabilityIndex / 100;
    const testCoverage = code.testCoverage;
    const documentation = code.documentationCoverage;
    const cohesion = semantic.semanticCohesion;
    const focus = semantic.responsibilityFocus;

    return (
      (maintainability + testCoverage + documentation + cohesion + focus) / 5
    );
  }

  private calculateMaintainabilityScore(
    code: CodeFeatures,
    semantic: SemanticFeatures,
  ): number {
    const complexity = 1 - code.cyclomaticComplexity / 20; // Normalize complexity
    const coupling = 1 - code.instability;
    const cohesion = semantic.semanticCohesion;
    const clarity = semantic.purposeClarity;

    return (complexity + coupling + cohesion + clarity) / 4;
  }

  private calculateRiskScore(
    code: CodeFeatures,
    usage: UsageFeatures,
    semantic: SemanticFeatures,
  ): number {
    const technicalDebt = code.technicalDebt;
    const sideEffectRisk = semantic.sideEffectRisk;
    const deprecationRisk = semantic.deprecationRisk;
    const instability = code.instability;

    return (technicalDebt + sideEffectRisk + deprecationRisk + instability) / 4;
  }

  private calculateTextRelevance(text: TextFeatures): number {
    let score = 0;

    // Prefer meaningful names
    if (text.tokenCount > 1) score += 0.3;
    if (text.technicalTerms.length > 0) score += 0.2;
    if (text.verbPhrases.length > 0) score += 0.2;
    if (text.followsNamingConvention) score += 0.2;
    if (!text.isAcronym) score += 0.1;

    return Math.min(1, score);
  }

  private initializePatterns(): void {
    this.namingPatterns = new Map([
      ["function", /^[a-z][a-zA-Z0-9]*$/], // camelCase for functions
      ["class", /^[A-Z][a-zA-Z0-9]*$/], // PascalCase for classes
      ["variable", /^[a-z][a-zA-Z0-9]*$/], // camelCase for variables
      ["constant", /^[A-Z][A-Z0-9_]*$/], // UPPER_CASE for constants
    ]);

    this.designPatterns = new Map([
      ["factory", [/Factory$/, /create/i]],
      ["builder", [/Builder$/, /build/i]],
      ["observer", [/Observer$/, /notify/i, /subscribe/i]],
      ["strategy", [/Strategy$/, /execute/i]],
      ["adapter", [/Adapter$/, /adapt/i]],
      ["decorator", [/Decorator$/, /decorate/i]],
    ]);

    this.codeSmellPatterns = new Map([
      ["god-object", [/Manager$/, /God/, /Util$/]],
      ["feature-envy", [/get.*From/, /set.*To/]],
      ["data-class", [/Data$/, /Info$/, /Bean$/]],
    ]);
  }

  /**
   * Batch extract features for multiple symbols
   */
  async extractBatchFeatures(
    symbols: Array<{
      symbol: string;
      symbolInfo: SymbolInfo;
      filePath: string;
    }>,
    context: SemanticContext,
  ): Promise<Map<string, CombinedFeatures>> {
    const features = new Map<string, CombinedFeatures>();

    for (const { symbol, symbolInfo, filePath } of symbols) {
      const symbolFeatures = await this.extractFeatures(
        symbol,
        symbolInfo,
        context,
        filePath,
      );
      features.set(symbol, symbolFeatures);
    }

    return features;
  }

  /**
   * Get feature importance weights for ML training
   */
  getFeatureWeights(): Record<string, number> {
    return {
      // Text features
      "text.tokenCount": 0.05,
      "text.technicalTerms": 0.15,
      "text.verbPhrases": 0.1,
      "text.followsNamingConvention": 0.08,

      // Code features
      "code.cyclomaticComplexity": 0.12,
      "code.maintainabilityIndex": 0.15,
      "code.instability": 0.1,
      "code.designPatterns": 0.08,

      // Context features
      "context.moduleType": 0.07,
      "context.architecturalRole": 0.1,

      // Usage features
      "usage.totalUsageCount": 0.12,
      "usage.usageSpread": 0.08,

      // Semantic features
      "semantic.purposeClarity": 0.15,
      "semantic.responsibilityFocus": 0.12,
      "semantic.businessRelevance": 0.1,
    };
  }

  /**
   * Normalize features for ML training
   */
  normalizeFeatures(features: CombinedFeatures): number[] {
    return [
      // Text features (normalized)
      Math.min(1, features.text.tokenCount / 10),
      features.text.technicalTerms.length / 5,
      features.text.verbPhrases.length / 3,
      features.text.followsNamingConvention ? 1 : 0,

      // Code features (normalized)
      Math.min(1, features.code.cyclomaticComplexity / 20),
      features.code.maintainabilityIndex / 100,
      features.code.instability,
      features.code.designPatterns.length / 3,

      // Usage features (normalized)
      Math.min(1, features.usage.totalUsageCount / 100),
      Math.min(1, features.usage.usageSpread / 10),

      // Semantic features (already 0-1)
      features.semantic.purposeClarity,
      features.semantic.responsibilityFocus,
      features.semantic.businessRelevance,

      // Composite scores
      features.relevanceScore,
      features.qualityScore,
      features.maintainabilityScore,
      1 - features.riskScore, // Invert risk for positive correlation
    ];
  }
}
