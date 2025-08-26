export interface CodeContext {
  filePath: string;
  extractedCode: string;
  imports: string[];
  symbols: string[];
  dependencies: string[];
  tokenCount: number;
  timestamp: number;
  relevanceScore: number;
}

export interface ExtractContextOptions {
  filePath: string;
  targetSymbols?: string[];
  includeImports?: boolean;
  maxTokens?: number;
}

export interface DiffAnalysisOptions {
  filePath: string;
  oldContent: string;
  newContent: string;
}

export interface ImportOptimizationOptions {
  filePath: string;
  usedSymbols?: string[];
}

export interface ASTNode {
  type: string;
  name?: string;
  start: number;
  end: number;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  children?: ASTNode[];
  value?: string;
  metadata?: {
    // Python-specific metadata
    decorators?: string[];
    parameters?: Array<{name: string, type?: string, default?: any}>;
    returnType?: string;
    baseClasses?: string[];
    targets?: string[];
    value?: any;
    annotation?: string;
    target?: string;
    
    // General metadata for language-specific features
    modifiers?: string[];
    generics?: string[];
    annotations?: Record<string, any>;
    [key: string]: any;
  };
}

export interface ExtractedContext {
  code: string;
  symbols: string[];
  dependencies: string[];
  imports: string[];
  exports: string[];
}

export interface DiffChange {
  type: 'added' | 'removed' | 'modified';
  oldStart?: number;
  oldEnd?: number;
  newStart?: number;
  newEnd?: number;
  content: string;
}

export interface SymbolChange {
  type: 'added' | 'removed' | 'modified';
  symbol: string;
  code: string;
  lineNumber: number;
  oldCode?: string;
}

export interface ImportStatement {
  source: string;
  imports: Array<{
    name: string;
    alias?: string;
    isDefault?: boolean;
    isNamespace?: boolean;
  }>;
  raw: string;
}

export interface CacheEntry {
  key: string;
  value: CodeContext;
  accessCount: number;
  lastAccessed: number;
  size: number;
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  missRate: number;
  evictionCount: number;
}

export interface OptimizationConfig {
  maxCacheSize: number;
  maxTokensPerEntry: number;
  cacheExpirationMs: number;
  enableImportOptimization: boolean;
  enableDiffOptimization: boolean;
  tokenEstimationRatio: number;
  relevanceThreshold: number;
  enableCaching?: boolean;
  cacheStrategy?: string;
  minificationLevel?: string;
  preserveFormatting?: boolean;
  enableTreeShaking?: boolean;
  customRules?: any;
}

export interface FileLanguage {
  extension: string;
  parser: 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'go' | 'rust' | 'bash' | 'c' | 'cpp' | 'css' | 'embedded_template' | 'haskell' | 'html' | 'ruby' | 'php' | 'scala' | 'julia' | 'ocaml' | 'json' | 'ql' | 'regex';
  astParser?: string;
}

export interface ParserResult {
  ast: ASTNode;
  errors: Array<{
    message: string;
    line: number;
    column: number;
  }>;
  language: string;
}

export interface SymbolInfo {
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'enum' | 'constant' | 'method' | 'struct' | 'package' | 'trait' | 'impl' | 'module' | 'static' | 'macro' | 'lifetime';
  startLine: number;
  endLine: number;
  dependencies: string[];
  exports: boolean;
  scope: 'global' | 'module' | 'local';
  metadata?: {
    // Python-specific metadata
    isAsync?: boolean;
    decorators?: string[];
    parameters?: Array<{name: string, type?: string, default?: any}>;
    returnType?: string;
    baseClasses?: string[];
    typeAnnotation?: string;
    value?: any;
    targets?: string[];
    
    // General metadata for future language support
    modifiers?: string[];
    generics?: string[];
    annotations?: Record<string, any>;
  };
}

export interface DependencyGraph {
  nodes: Map<string, SymbolInfo>;
  edges: Map<string, Set<string>>;
}

export interface OptimizationResult {
  originalTokens: number;
  optimizedTokens: number;
  tokenSavings: number;
  compressionRatio: number;
  optimizations: Array<{
    type: string;
    description: string;
    tokensSaved: number;
  }>;
}

export type ContextExtractionStrategy = 'contextual' | 'minimal' | 'full' | 'smart';

export type CacheEvictionPolicy = 'lru' | 'lfu' | 'fifo' | 'ttl';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

export interface MetricsCollector {
  recordCacheHit: (key: string) => void;
  recordCacheMiss: (key: string) => void;
  recordTokenSavings: (savings: number) => void;
  recordOptimizationTime: (operation: string, timeMs: number) => void;
  getMetrics: () => Record<string, number>;
}