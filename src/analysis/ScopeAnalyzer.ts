import * as path from 'path';
import type { SymbolInfo } from '../types/index.js';
import type { SemanticContext } from './SemanticAnalyzer.js';
import { SemanticAnalyzer } from './SemanticAnalyzer.js';

export interface ScopeNode {
  id: string;
  name: string;
  type: 'global' | 'module' | 'class' | 'function' | 'block' | 'namespace' | 'closure';
  startLine: number;
  endLine: number;
  parent: ScopeNode | null;
  children: ScopeNode[];
  symbols: Map<string, SymbolInfo>;
  variables: Map<string, VariableInfo>;
  accessibleSymbols: Set<string>; // All symbols accessible in this scope
  file: string;
}

export interface VariableInfo {
  name: string;
  type: string;
  declarationLine: number;
  scope: string;
  isParameter: boolean;
  isConstant: boolean;
  isHoisted: boolean;
  shadowedBy: string[]; // Variables that shadow this one
  shadows: string | null; // Variable this one shadows
  usages: Array<{
    line: number;
    type: 'read' | 'write' | 'readwrite';
    context: string;
  }>;
}

export interface ScopeHierarchy {
  root: ScopeNode;
  allScopes: Map<string, ScopeNode>;
  scopesByType: Map<ScopeNode['type'], ScopeNode[]>;
  variableResolution: Map<string, VariableInfo[]>;
}

export interface ScopeAnalysisResult {
  hierarchy: ScopeHierarchy;
  shadowingIssues: ShadowingIssue[];
  unusedVariables: UnusedVariable[];
  scopeViolations: ScopeViolation[];
  closureAnalysis: ClosureAnalysis[];
  variableLifetime: Map<string, VariableLifetime>;
}

export interface ShadowingIssue {
  shadowingVariable: string;
  shadowedVariable: string;
  shadowingScope: string;
  shadowedScope: string;
  line: number;
  severity: 'warning' | 'error';
  suggestion: string;
}

export interface UnusedVariable {
  name: string;
  scope: string;
  declarationLine: number;
  type: string;
  reason: 'never_used' | 'write_only' | 'dead_after_assignment';
}

export interface ScopeViolation {
  type: 'undefined_variable' | 'out_of_scope_access' | 'temporal_dead_zone' | 'const_reassignment';
  variable: string;
  line: number;
  scope: string;
  description: string;
  severity: 'error' | 'warning';
}

export interface ClosureAnalysis {
  functionName: string;
  scope: string;
  capturedVariables: Array<{
    name: string;
    fromScope: string;
    captureType: 'value' | 'reference';
  }>;
  potentialMemoryLeaks: string[];
  recommendations: string[];
}

export interface VariableLifetime {
  name: string;
  scope: string;
  declarationLine: number;
  firstUsage: number;
  lastUsage: number;
  totalUsages: number;
  lifespan: number; // Lines between declaration and last usage
  isLongLived: boolean;
}

export interface ScopeMetrics {
  totalScopes: number;
  averageScopeDepth: number;
  maxScopeDepth: number;
  scopeComplexity: Map<string, number>;
  variableDensity: Map<string, number>; // Variables per scope
  shadowingRate: number;
  unusedVariableRate: number;
}

export class ScopeAnalyzer {
  private semanticAnalyzer: SemanticAnalyzer;
  private scopeHierarchies: Map<string, ScopeHierarchy> = new Map();
  private globalScopeId = 0;

  constructor() {
    this.semanticAnalyzer = new SemanticAnalyzer();
  }

  /**
   * Analyze scope hierarchy for a single file
   */
  async analyzeFileScopes(filePath: string): Promise<ScopeAnalysisResult> {
    const absolutePath = path.resolve(filePath);
    const context = await this.semanticAnalyzer.analyzeFile(absolutePath);
    
    const hierarchy = await this.buildScopeHierarchy(absolutePath, context);
    this.scopeHierarchies.set(absolutePath, hierarchy);
    
    const shadowingIssues = this.detectShadowingIssues(hierarchy);
    const unusedVariables = this.findUnusedVariables(hierarchy);
    const scopeViolations = this.detectScopeViolations(hierarchy);
    const closureAnalysis = this.analyzeClosures(hierarchy);
    const variableLifetime = this.analyzeVariableLifetime(hierarchy);
    
    return {
      hierarchy,
      shadowingIssues,
      unusedVariables,
      scopeViolations,
      closureAnalysis,
      variableLifetime
    };
  }

  /**
   * Analyze scopes across multiple files
   */
  async analyzeProjectScopes(filePaths: string[]): Promise<Map<string, ScopeAnalysisResult>> {
    const results = new Map<string, ScopeAnalysisResult>();
    
    for (const filePath of filePaths) {
      try {
        const result = await this.analyzeFileScopes(filePath);
        results.set(path.resolve(filePath), result);
      } catch (error) {
        console.warn(`Failed to analyze scopes for ${filePath}:`, error);
      }
    }
    
    return results;
  }

  /**
   * Resolve a symbol in a specific scope
   */
  resolveSymbolInScope(symbol: string, scopeId: string, filePath: string): SymbolInfo | null {
    const hierarchy = this.scopeHierarchies.get(path.resolve(filePath));
    if (!hierarchy) return null;
    
    const scope = hierarchy.allScopes.get(scopeId);
    if (!scope) return null;
    
    // Search in current scope and parent scopes
    let currentScope: ScopeNode | null = scope;
    while (currentScope) {
      if (currentScope.symbols.has(symbol)) {
        return currentScope.symbols.get(symbol)!;
      }
      currentScope = currentScope.parent;
    }
    
    return null;
  }

  /**
   * Find all symbols accessible in a given scope
   */
  getAccessibleSymbols(scopeId: string, filePath: string): Set<string> {
    const hierarchy = this.scopeHierarchies.get(path.resolve(filePath));
    if (!hierarchy) return new Set();
    
    const scope = hierarchy.allScopes.get(scopeId);
    if (!scope) return new Set();
    
    return scope.accessibleSymbols;
  }

  /**
   * Find the scope containing a specific line
   */
  findScopeAtLine(line: number, filePath: string): ScopeNode | null {
    const hierarchy = this.scopeHierarchies.get(path.resolve(filePath));
    if (!hierarchy) return null;
    
    const findInScope = (scope: ScopeNode): ScopeNode | null => {
      if (line >= scope.startLine && line <= scope.endLine) {
        // Check children first (more specific scopes)
        for (const child of scope.children) {
          const found = findInScope(child);
          if (found) return found;
        }
        return scope;
      }
      return null;
    };
    
    return findInScope(hierarchy.root);
  }

  /**
   * Calculate scope metrics
   */
  calculateScopeMetrics(filePath: string): ScopeMetrics {
    const hierarchy = this.scopeHierarchies.get(path.resolve(filePath));
    if (!hierarchy) {
      return {
        totalScopes: 0,
        averageScopeDepth: 0,
        maxScopeDepth: 0,
        scopeComplexity: new Map(),
        variableDensity: new Map(),
        shadowingRate: 0,
        unusedVariableRate: 0
      };
    }
    
    const totalScopes = hierarchy.allScopes.size;
    const depths: number[] = [];
    const scopeComplexity = new Map<string, number>();
    const variableDensity = new Map<string, number>();
    
    let totalVariables = 0;
    let shadowingCount = 0;
    let unusedCount = 0;
    
    for (const [scopeId, scope] of hierarchy.allScopes) {
      const depth = this.calculateScopeDepth(scope);
      depths.push(depth);
      
      const complexity = this.calculateScopeComplexity(scope);
      scopeComplexity.set(scopeId, complexity);
      
      const density = scope.variables.size;
      variableDensity.set(scopeId, density);
      totalVariables += density;
      
      // Count shadowing and unused variables
      for (const [, variable] of scope.variables) {
        if (variable.shadows) shadowingCount++;
        if (variable.usages.length === 0) unusedCount++;
      }
    }
    
    const averageScopeDepth = depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
    const maxScopeDepth = depths.length > 0 ? Math.max(...depths) : 0;
    const shadowingRate = totalVariables > 0 ? shadowingCount / totalVariables : 0;
    const unusedVariableRate = totalVariables > 0 ? unusedCount / totalVariables : 0;
    
    return {
      totalScopes,
      averageScopeDepth,
      maxScopeDepth,
      scopeComplexity,
      variableDensity,
      shadowingRate,
      unusedVariableRate
    };
  }

  /**
   * Generate scope analysis report
   */
  generateScopeReport(filePath: string): {
    metrics: ScopeMetrics;
    analysis: ScopeAnalysisResult | null;
    recommendations: string[];
  } {
    const absolutePath = path.resolve(filePath);
    const metrics = this.calculateScopeMetrics(absolutePath);
    const analysis = this.scopeHierarchies.has(absolutePath) ? 
      this.getAnalysisResult(absolutePath) : null;
    
    const recommendations = this.generateRecommendations(metrics, analysis);
    
    return { metrics, analysis, recommendations };
  }

  private async buildScopeHierarchy(filePath: string, context: SemanticContext): Promise<ScopeHierarchy> {
    const root = this.createScopeNode('global', 'global', 0, Number.MAX_SAFE_INTEGER, null, filePath);
    const allScopes = new Map<string, ScopeNode>();
    const scopesByType = new Map<ScopeNode['type'], ScopeNode[]>();
    const variableResolution = new Map<string, VariableInfo[]>();
    
    allScopes.set(root.id, root);
    this.addToScopesByType(scopesByType, root);
    
    // Build scope hierarchy from semantic context
    await this.buildScopeTree(context, root, allScopes, scopesByType);
    
    // Resolve variable accessibility
    this.resolveVariableAccessibility(root);
    
    // Build variable resolution map
    this.buildVariableResolution(allScopes, variableResolution);
    
    return { root, allScopes, scopesByType, variableResolution };
  }

  private async buildScopeTree(
    context: SemanticContext,
    parentScope: ScopeNode,
    allScopes: Map<string, ScopeNode>,
    scopesByType: Map<ScopeNode['type'], ScopeNode[]>
  ): Promise<void> {
    // Create scopes for each symbol that defines a scope
    for (const [symbol, symbolInfo] of context.symbols) {
      const scopeType = this.getScopeTypeFromSymbol(symbolInfo);
      
      if (scopeType && symbolInfo.startLine && symbolInfo.endLine) {
        const scope = this.createScopeNode(
          symbol,
          scopeType,
          symbolInfo.startLine,
          symbolInfo.endLine,
          parentScope,
          parentScope.file
        );
        
        // Add symbol to the scope
        scope.symbols.set(symbol, symbolInfo);
        
        // Create variable info if it's a variable-like symbol
        if (this.isVariableSymbol(symbolInfo)) {
          const variableInfo = this.createVariableInfo(symbol, symbolInfo, scope.id);
          scope.variables.set(symbol, variableInfo);
        }
        
        parentScope.children.push(scope);
        allScopes.set(scope.id, scope);
        this.addToScopesByType(scopesByType, scope);
        
        // Recursively build child scopes
        await this.buildScopeTree(context, scope, allScopes, scopesByType);
      } else {
        // Add symbol to parent scope
        parentScope.symbols.set(symbol, symbolInfo);
        
        if (this.isVariableSymbol(symbolInfo)) {
          const variableInfo = this.createVariableInfo(symbol, symbolInfo, parentScope.id);
          parentScope.variables.set(symbol, variableInfo);
        }
      }
    }
  }

  private createScopeNode(
    name: string,
    type: ScopeNode['type'],
    startLine: number,
    endLine: number,
    parent: ScopeNode | null,
    file: string
  ): ScopeNode {
    return {
      id: `${file}:${type}:${name}:${++this.globalScopeId}`,
      name,
      type,
      startLine,
      endLine,
      parent,
      children: [],
      symbols: new Map(),
      variables: new Map(),
      accessibleSymbols: new Set(),
      file
    };
  }

  private createVariableInfo(symbol: string, symbolInfo: SymbolInfo, scopeId: string): VariableInfo {
    return {
      name: symbol,
      type: symbolInfo.type,
      declarationLine: symbolInfo.startLine || 0,
      scope: scopeId,
      isParameter: this.isParameter(symbolInfo),
      isConstant: this.isConstant(symbolInfo),
      isHoisted: this.isHoisted(symbolInfo),
      shadowedBy: [],
      shadows: null,
      usages: []
    };
  }

  private getScopeTypeFromSymbol(symbolInfo: SymbolInfo): ScopeNode['type'] | null {
    switch (symbolInfo.type) {
      case 'function':
        return 'function';
      case 'class':
        return 'class';
      case 'module':
        return 'module';
      default:
        return null;
    }
  }

  private isVariableSymbol(symbolInfo: SymbolInfo): boolean {
    return ['variable', 'parameter', 'constant'].includes(symbolInfo.type);
  }

  private isParameter(symbolInfo: SymbolInfo): boolean {
    return symbolInfo.type === 'parameter';
  }

  private isConstant(symbolInfo: SymbolInfo): boolean {
    return symbolInfo.type === 'constant' || symbolInfo.name?.includes('const') === true;
  }

  private isHoisted(symbolInfo: SymbolInfo): boolean {
    // In JavaScript, var declarations and function declarations are hoisted
    return symbolInfo.type === 'function' || symbolInfo.name?.includes('var') === true;
  }

  private addToScopesByType(scopesByType: Map<ScopeNode['type'], ScopeNode[]>, scope: ScopeNode): void {
    if (!scopesByType.has(scope.type)) {
      scopesByType.set(scope.type, []);
    }
    scopesByType.get(scope.type)!.push(scope);
  }

  private resolveVariableAccessibility(scope: ScopeNode): void {
    // Add all symbols from current scope
    for (const symbol of scope.symbols.keys()) {
      scope.accessibleSymbols.add(symbol);
    }
    
    // Add symbols from parent scopes
    let parentScope = scope.parent;
    while (parentScope) {
      for (const symbol of parentScope.symbols.keys()) {
        scope.accessibleSymbols.add(symbol);
      }
      parentScope = parentScope.parent;
    }
    
    // Recursively resolve for children
    for (const child of scope.children) {
      this.resolveVariableAccessibility(child);
    }
  }

  private buildVariableResolution(
    allScopes: Map<string, ScopeNode>,
    variableResolution: Map<string, VariableInfo[]>
  ): void {
    for (const [, scope] of allScopes) {
      for (const [variableName, variableInfo] of scope.variables) {
        if (!variableResolution.has(variableName)) {
          variableResolution.set(variableName, []);
        }
        variableResolution.get(variableName)!.push(variableInfo);
      }
    }
    
    // Detect shadowing
    for (const [variableName, variables] of variableResolution) {
      if (variables.length > 1) {
        // Sort by scope depth (deeper scopes shadow shallower ones)
        variables.sort((a, b) => {
          const scopeA = allScopes.get(a.scope)!;
          const scopeB = allScopes.get(b.scope)!;
          return this.calculateScopeDepth(scopeB) - this.calculateScopeDepth(scopeA);
        });
        
        // Set up shadowing relationships
        for (let i = 0; i < variables.length - 1; i++) {
          const shadowing = variables[i];
          const shadowed = variables[i + 1];
          
          shadowing.shadows = shadowed.name;
          shadowed.shadowedBy.push(shadowing.name);
        }
      }
    }
  }

  private detectShadowingIssues(hierarchy: ScopeHierarchy): ShadowingIssue[] {
    const issues: ShadowingIssue[] = [];
    
    for (const [, variables] of hierarchy.variableResolution) {
      if (variables.length > 1) {
        for (const variable of variables) {
          if (variable.shadows) {
            const shadowedVariable = variables.find(v => v.name === variable.shadows);
            if (shadowedVariable) {
              issues.push({
                shadowingVariable: variable.name,
                shadowedVariable: shadowedVariable.name,
                shadowingScope: variable.scope,
                shadowedScope: shadowedVariable.scope,
                line: variable.declarationLine,
                severity: this.getShadowingSeverity(variable, shadowedVariable),
                suggestion: this.getShadowingSuggestion(variable, shadowedVariable)
              });
            }
          }
        }
      }
    }
    
    return issues;
  }

  private findUnusedVariables(hierarchy: ScopeHierarchy): UnusedVariable[] {
    const unused: UnusedVariable[] = [];
    
    for (const [, scope] of hierarchy.allScopes) {
      for (const [, variable] of scope.variables) {
        const reason = this.getUnusedReason(variable);
        if (reason) {
          unused.push({
            name: variable.name,
            scope: variable.scope,
            declarationLine: variable.declarationLine,
            type: variable.type,
            reason
          });
        }
      }
    }
    
    return unused;
  }

  private detectScopeViolations(hierarchy: ScopeHierarchy): ScopeViolation[] {
    const violations: ScopeViolation[] = [];
    
    // This would require more detailed AST analysis to detect actual violations
    // For now, return empty array as placeholder
    
    return violations;
  }

  private analyzeClosures(hierarchy: ScopeHierarchy): ClosureAnalysis[] {
    const closures: ClosureAnalysis[] = [];
    
    const functionScopes = hierarchy.scopesByType.get('function') || [];
    
    for (const functionScope of functionScopes) {
      const capturedVariables: ClosureAnalysis['capturedVariables'] = [];
      const potentialMemoryLeaks: string[] = [];
      
      // Find variables captured from outer scopes
      for (const symbol of functionScope.accessibleSymbols) {
        if (!functionScope.symbols.has(symbol)) {
          // This symbol is from an outer scope
          const outerScope = this.findSymbolScope(symbol, functionScope.parent);
          if (outerScope) {
            capturedVariables.push({
              name: symbol,
              fromScope: outerScope.id,
              captureType: 'reference' // Simplified - would need more analysis
            });
            
            // Check for potential memory leaks
            if (this.isPotentialMemoryLeak(symbol, outerScope)) {
              potentialMemoryLeaks.push(symbol);
            }
          }
        }
      }
      
      if (capturedVariables.length > 0) {
        closures.push({
          functionName: functionScope.name,
          scope: functionScope.id,
          capturedVariables,
          potentialMemoryLeaks,
          recommendations: this.generateClosureRecommendations(capturedVariables, potentialMemoryLeaks)
        });
      }
    }
    
    return closures;
  }

  private analyzeVariableLifetime(hierarchy: ScopeHierarchy): Map<string, VariableLifetime> {
    const lifetimes = new Map<string, VariableLifetime>();
    
    for (const [, scope] of hierarchy.allScopes) {
      for (const [, variable] of scope.variables) {
        const firstUsage = variable.usages.length > 0 ? 
          Math.min(...variable.usages.map(u => u.line)) : variable.declarationLine;
        const lastUsage = variable.usages.length > 0 ? 
          Math.max(...variable.usages.map(u => u.line)) : variable.declarationLine;
        
        const lifespan = lastUsage - variable.declarationLine;
        const isLongLived = lifespan > 50; // Arbitrary threshold
        
        lifetimes.set(`${variable.scope}:${variable.name}`, {
          name: variable.name,
          scope: variable.scope,
          declarationLine: variable.declarationLine,
          firstUsage,
          lastUsage,
          totalUsages: variable.usages.length,
          lifespan,
          isLongLived
        });
      }
    }
    
    return lifetimes;
  }

  private calculateScopeDepth(scope: ScopeNode): number {
    let depth = 0;
    let current = scope.parent;
    while (current) {
      depth++;
      current = current.parent;
    }
    return depth;
  }

  private calculateScopeComplexity(scope: ScopeNode): number {
    // Simple complexity based on number of symbols and child scopes
    const symbolCount = scope.symbols.size;
    const childCount = scope.children.length;
    const lineCount = scope.endLine - scope.startLine;
    
    return (symbolCount * 0.3) + (childCount * 0.4) + (lineCount * 0.001);
  }

  private getShadowingSeverity(shadowing: VariableInfo, shadowed: VariableInfo): ShadowingIssue['severity'] {
    // Parameters shadowing outer variables are usually warnings
    if (shadowing.isParameter) return 'warning';
    
    // Constants shadowing variables might be errors
    if (shadowing.isConstant && !shadowed.isConstant) return 'error';
    
    return 'warning';
  }

  private getShadowingSuggestion(shadowing: VariableInfo, shadowed: VariableInfo): string {
    if (shadowing.isParameter) {
      return `Consider renaming parameter '${shadowing.name}' to avoid shadowing outer variable`;
    }
    return `Consider renaming '${shadowing.name}' to avoid confusion with outer scope variable`;
  }

  private getUnusedReason(variable: VariableInfo): UnusedVariable['reason'] | null {
    if (variable.usages.length === 0) {
      return 'never_used';
    }
    
    const hasReads = variable.usages.some(u => u.type === 'read' || u.type === 'readwrite');
    if (!hasReads) {
      return 'write_only';
    }
    
    // Could add more sophisticated analysis for dead_after_assignment
    
    return null;
  }

  private findSymbolScope(symbol: string, startScope: ScopeNode | null): ScopeNode | null {
    let current = startScope;
    while (current) {
      if (current.symbols.has(symbol)) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  private isPotentialMemoryLeak(symbol: string, scope: ScopeNode): boolean {
    // Simplified check - in practice would need more sophisticated analysis
    return scope.type === 'global' || symbol.includes('cache') || symbol.includes('store');
  }

  private generateClosureRecommendations(
    capturedVariables: ClosureAnalysis['capturedVariables'],
    potentialMemoryLeaks: string[]
  ): string[] {
    const recommendations: string[] = [];
    
    if (capturedVariables.length > 5) {
      recommendations.push('Consider reducing the number of captured variables');
    }
    
    if (potentialMemoryLeaks.length > 0) {
      recommendations.push('Review captured variables for potential memory leaks');
    }
    
    return recommendations;
  }

  private generateRecommendations(metrics: ScopeMetrics, analysis: ScopeAnalysisResult | null): string[] {
    const recommendations: string[] = [];
    
    if (metrics.maxScopeDepth > 6) {
      recommendations.push('Consider reducing scope nesting depth for better readability');
    }
    
    if (metrics.shadowingRate > 0.1) {
      recommendations.push('High variable shadowing rate - consider renaming variables');
    }
    
    if (metrics.unusedVariableRate > 0.2) {
      recommendations.push('High unused variable rate - consider cleanup');
    }
    
    if (analysis) {
      if (analysis.closureAnalysis.length > 0) {
        recommendations.push('Review closures for potential memory leaks');
      }
      
      if (analysis.scopeViolations.length > 0) {
        recommendations.push('Fix scope violations to prevent runtime errors');
      }
    }
    
    return recommendations;
  }

  private getAnalysisResult(filePath: string): ScopeAnalysisResult | null {
    // This would return the cached analysis result
    // For now, return null as placeholder
    return null;
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.scopeHierarchies.clear();
    this.semanticAnalyzer.clearContexts();
  }

  /**
   * Get scope hierarchy for a file
   */
  getScopeHierarchy(filePath: string): ScopeHierarchy | null {
    return this.scopeHierarchies.get(path.resolve(filePath)) || null;
  }
}