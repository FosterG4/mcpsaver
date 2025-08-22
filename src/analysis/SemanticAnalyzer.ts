import type { ASTNode, SymbolInfo, DependencyGraph } from '../types/index.js';
import { ASTParser } from '../parsers/ASTParser.js';

export interface SemanticContext {
  symbols: Map<string, SymbolInfo>;
  relationships: Map<string, SymbolRelationship[]>;
  scopes: Map<string, ScopeInfo>;
  typeInferences: Map<string, TypeInfo>;
  crossReferences: Map<string, ReferenceInfo[]>;
}

export interface SymbolRelationship {
  type: 'inherits' | 'implements' | 'uses' | 'calls' | 'imports' | 'exports' | 'contains' | 'overrides';
  source: string;
  target: string;
  confidence: number;
  location: {
    file: string;
    line: number;
    column: number;
  };
}

export interface ScopeInfo {
  id: string;
  type: 'global' | 'module' | 'class' | 'function' | 'block';
  parent?: string;
  children: string[];
  symbols: string[];
  startLine: number;
  endLine: number;
}

export interface TypeInfo {
  symbol: string;
  inferredType: string;
  confidence: number;
  sources: Array<{
    type: 'annotation' | 'assignment' | 'return' | 'parameter' | 'inference';
    value: string;
    confidence: number;
  }>;
}

export interface ReferenceInfo {
  symbol: string;
  referencedBy: string;
  type: 'read' | 'write' | 'call' | 'instantiation';
  location: {
    file: string;
    line: number;
    column: number;
  };
}

export class SemanticAnalyzer {
  private astParser: ASTParser;
  private contexts: Map<string, SemanticContext> = new Map();

  constructor() {
    this.astParser = new ASTParser();
  }

  /**
   * Analyze a file and build semantic context
   */
  async analyzeFile(filePath: string): Promise<SemanticContext> {
    const ast = await this.astParser.parseFile(filePath);
    return this.analyzeAST(ast, filePath);
  }

  /**
   * Analyze AST and build semantic context
   */
  analyzeAST(ast: ASTNode, filePath: string): SemanticContext {
    const symbols = this.extractSymbols(ast);
    const scopes = this.buildScopeHierarchy(ast);
    const relationships = this.analyzeSymbolRelationships(ast, symbols);
    const typeInferences = this.performTypeInference(ast, symbols);
    const crossReferences = this.analyzeCrossReferences(ast, symbols);

    const context: SemanticContext = {
      symbols: new Map(symbols.map(s => [s.name, s])),
      relationships,
      scopes,
      typeInferences,
      crossReferences
    };

    this.contexts.set(filePath, context);
    return context;
  }

  /**
   * Resolve symbol references across multiple files
   */
  async resolveSymbolReferences(filePaths: string[]): Promise<Map<string, SymbolRelationship[]>> {
    const allRelationships = new Map<string, SymbolRelationship[]>();

    // Analyze each file
    for (const filePath of filePaths) {
      await this.analyzeFile(filePath);
    }

    // Build cross-file relationships
    for (const [filePath, context] of this.contexts) {
      for (const [symbol, relationships] of context.relationships) {
        const existing = allRelationships.get(symbol) || [];
        allRelationships.set(symbol, [...existing, ...relationships]);
      }
    }

    return allRelationships;
  }

  /**
   * Build dependency graph for symbols
   */
  buildDependencyGraph(context: SemanticContext): DependencyGraph {
    const nodes = new Map<string, SymbolInfo>();
    const edges = new Map<string, Set<string>>();

    // Add all symbols as nodes
    for (const [name, symbol] of context.symbols) {
      nodes.set(name, symbol);
      edges.set(name, new Set());
    }

    // Add edges based on relationships
    for (const [symbol, relationships] of context.relationships) {
      const symbolEdges = edges.get(symbol) || new Set();
      
      for (const rel of relationships) {
        if (rel.type === 'uses' || rel.type === 'calls' || rel.type === 'inherits' || rel.type === 'implements') {
          symbolEdges.add(rel.target);
        }
      }
      
      edges.set(symbol, symbolEdges);
    }

    return { nodes, edges };
  }

  /**
   * Find symbols that match a query with semantic understanding
   */
  findSymbols(query: string, context: SemanticContext): Array<{
    symbol: SymbolInfo;
    relevance: number;
    reason: string;
  }> {
    const results: Array<{ symbol: SymbolInfo; relevance: number; reason: string }> = [];
    const queryLower = query.toLowerCase();

    for (const [name, symbol] of context.symbols) {
      let relevance = 0;
      const reasons: string[] = [];

      // Exact name match
      if (name.toLowerCase() === queryLower) {
        relevance += 100;
        reasons.push('exact name match');
      }
      // Partial name match
      else if (name.toLowerCase().includes(queryLower)) {
        relevance += 50;
        reasons.push('partial name match');
      }

      // Type-based relevance
      if (symbol.type === 'function' && queryLower.includes('function')) {
        relevance += 20;
        reasons.push('type match');
      }
      if (symbol.type === 'class' && queryLower.includes('class')) {
        relevance += 20;
        reasons.push('type match');
      }

      // Relationship-based relevance
      const relationships = context.relationships.get(name) || [];
      for (const rel of relationships) {
        if (rel.target.toLowerCase().includes(queryLower)) {
          relevance += 10;
          reasons.push(`related to ${rel.target}`);
        }
      }

      if (relevance > 0) {
        results.push({
          symbol,
          relevance,
          reason: reasons.join(', ')
        });
      }
    }

    return results.sort((a, b) => b.relevance - a.relevance);
  }

  private extractSymbols(ast: ASTNode): SymbolInfo[] {
    return this.astParser.extractSymbols(ast);
  }

  private buildScopeHierarchy(ast: ASTNode): Map<string, ScopeInfo> {
    const scopes = new Map<string, ScopeInfo>();
    let scopeCounter = 0;

    const traverse = (node: ASTNode, parentScopeId?: string): string => {
      const scopeId = `scope_${scopeCounter++}`;
      let scopeType: ScopeInfo['type'] = 'block';

      // Determine scope type based on node type
      switch (node.type) {
        case 'Program':
        case 'Module':
          scopeType = 'global';
          break;
        case 'ClassDeclaration':
        case 'ClassExpression':
        case 'StructItem':
        case 'TraitItem':
          scopeType = 'class';
          break;
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        case 'MethodDefinition':
        case 'FunctionItem':
          scopeType = 'function';
          break;
        case 'ImportDeclaration':
        case 'ExportDeclaration':
          scopeType = 'module';
          break;
      }

      const scope: ScopeInfo = {
        id: scopeId,
        type: scopeType,
        parent: parentScopeId,
        children: [],
        symbols: [],
        startLine: node.loc?.start.line || 0,
        endLine: node.loc?.end.line || 0
      };

      // Add to parent's children
      if (parentScopeId) {
        const parentScope = scopes.get(parentScopeId);
        if (parentScope) {
          parentScope.children.push(scopeId);
        }
      }

      // Process children
      if (node.children) {
        for (const child of node.children) {
          traverse(child, scopeId);
        }
      }

      scopes.set(scopeId, scope);
      return scopeId;
    };

    traverse(ast);
    return scopes;
  }

  private analyzeSymbolRelationships(ast: ASTNode, symbols: SymbolInfo[]): Map<string, SymbolRelationship[]> {
    const relationships = new Map<string, SymbolRelationship[]>();
    const symbolMap = new Map(symbols.map(s => [s.name, s]));

    const traverse = (node: ASTNode, currentFile: string = 'unknown') => {
      // Analyze inheritance relationships
      if (node.type === 'ClassDeclaration' && node.metadata?.baseClasses) {
        const className = node.name || 'unknown';
        const classRelationships: SymbolRelationship[] = [];

        for (const baseClass of node.metadata.baseClasses) {
          classRelationships.push({
            type: 'inherits',
            source: className,
            target: baseClass,
            confidence: 0.9,
            location: {
              file: currentFile,
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column || 0
            }
          });
        }

        relationships.set(className, classRelationships);
      }

      // Analyze function calls
      if (node.type === 'CallExpression' && node.name) {
        const callerSymbol = this.findContainingSymbol(node, symbols);
        if (callerSymbol) {
          const existing = relationships.get(callerSymbol.name) || [];
          existing.push({
            type: 'calls',
            source: callerSymbol.name,
            target: node.name,
            confidence: 0.8,
            location: {
              file: currentFile,
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column || 0
            }
          });
          relationships.set(callerSymbol.name, existing);
        }
      }

      // Analyze imports
      if (node.type === 'ImportDeclaration' && node.children) {
        for (const child of node.children) {
          if (child.name) {
            const existing = relationships.get(child.name) || [];
            existing.push({
              type: 'imports',
              source: child.name,
              target: node.value || 'unknown',
              confidence: 1.0,
              location: {
                file: currentFile,
                line: node.loc?.start.line || 0,
                column: node.loc?.start.column || 0
              }
            });
            relationships.set(child.name, existing);
          }
        }
      }

      // Recursively process children
      if (node.children) {
        for (const child of node.children) {
          traverse(child, currentFile);
        }
      }
    };

    traverse(ast);
    return relationships;
  }

  private performTypeInference(ast: ASTNode, symbols: SymbolInfo[]): Map<string, TypeInfo> {
    const typeInferences = new Map<string, TypeInfo>();

    for (const symbol of symbols) {
      const sources: TypeInfo['sources'] = [];
      let inferredType = 'unknown';
      let confidence = 0;

      // Check for explicit type annotations
      if (symbol.metadata?.typeAnnotation) {
        sources.push({
          type: 'annotation',
          value: symbol.metadata.typeAnnotation,
          confidence: 1.0
        });
        inferredType = symbol.metadata.typeAnnotation;
        confidence = 1.0;
      }
      // Check for return type annotations
      else if (symbol.metadata?.returnType) {
        sources.push({
          type: 'return',
          value: symbol.metadata.returnType,
          confidence: 0.9
        });
        inferredType = symbol.metadata.returnType;
        confidence = 0.9;
      }
      // Infer from symbol type
      else {
        switch (symbol.type) {
          case 'function':
            inferredType = 'function';
            confidence = 0.8;
            break;
          case 'class':
            inferredType = 'class';
            confidence = 0.8;
            break;
          case 'variable':
            inferredType = 'any';
            confidence = 0.3;
            break;
        }
        sources.push({
          type: 'inference',
          value: inferredType,
          confidence
        });
      }

      typeInferences.set(symbol.name, {
        symbol: symbol.name,
        inferredType,
        confidence,
        sources
      });
    }

    return typeInferences;
  }

  private analyzeCrossReferences(ast: ASTNode, symbols: SymbolInfo[]): Map<string, ReferenceInfo[]> {
    const crossReferences = new Map<string, ReferenceInfo[]>();
    const symbolNames = new Set(symbols.map(s => s.name));

    const traverse = (node: ASTNode, currentFile: string = 'unknown') => {
      // Check if this node references a symbol
      if (node.name && symbolNames.has(node.name)) {
        const existing = crossReferences.get(node.name) || [];
        
        let referenceType: ReferenceInfo['type'] = 'read';
        if (node.type === 'CallExpression') {
          referenceType = 'call';
        } else if (node.type === 'NewExpression') {
          referenceType = 'instantiation';
        } else if (node.type === 'AssignmentExpression') {
          referenceType = 'write';
        }

        const containingSymbol = this.findContainingSymbol(node, symbols);
        if (containingSymbol) {
          existing.push({
            symbol: node.name,
            referencedBy: containingSymbol.name,
            type: referenceType,
            location: {
              file: currentFile,
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column || 0
            }
          });
          crossReferences.set(node.name, existing);
        }
      }

      // Recursively process children
      if (node.children) {
        for (const child of node.children) {
          traverse(child, currentFile);
        }
      }
    };

    traverse(ast);
    return crossReferences;
  }

  private findContainingSymbol(node: ASTNode, symbols: SymbolInfo[]): SymbolInfo | null {
    const nodeLine = node.loc?.start.line || 0;
    
    // Find the symbol that contains this node
    for (const symbol of symbols) {
      if (nodeLine >= symbol.startLine && nodeLine <= symbol.endLine) {
        return symbol;
      }
    }
    
    return null;
  }

  /**
   * Get semantic context for a file
   */
  getContext(filePath: string): SemanticContext | undefined {
    return this.contexts.get(filePath);
  }

  /**
   * Clear all cached contexts
   */
  clearContexts(): void {
    this.contexts.clear();
  }
}