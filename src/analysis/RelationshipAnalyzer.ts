import type { ASTNode, SymbolInfo } from '../types/index.js';
import type { SymbolRelationship, SemanticContext } from './SemanticAnalyzer.js';

export interface InheritanceChain {
  symbol: string;
  ancestors: string[];
  descendants: string[];
  depth: number;
}

export interface CompositionRelation {
  container: string;
  contained: string;
  relationship: 'has-a' | 'uses' | 'aggregates' | 'composes';
  strength: number; // 0-1, how tightly coupled
}

export interface DependencyCluster {
  id: string;
  symbols: string[];
  cohesion: number; // How related symbols are within cluster
  coupling: number; // How dependent cluster is on other clusters
  relationships: SymbolRelationship[];
}

export interface ArchitecturalPattern {
  type: 'singleton' | 'factory' | 'observer' | 'strategy' | 'decorator' | 'adapter' | 'mvc' | 'repository';
  symbols: string[];
  confidence: number;
  description: string;
}

export class RelationshipAnalyzer {
  /**
   * Analyze inheritance hierarchies in the codebase
   */
  analyzeInheritanceHierarchy(context: SemanticContext): Map<string, InheritanceChain> {
    const inheritanceChains = new Map<string, InheritanceChain>();
    const inheritanceMap = new Map<string, string[]>(); // child -> parents
    const childrenMap = new Map<string, string[]>(); // parent -> children

    // Build inheritance maps from relationships
    for (const [symbol, relationships] of context.relationships) {
      const parents: string[] = [];
      
      for (const rel of relationships) {
        if (rel.type === 'inherits' || rel.type === 'implements') {
          parents.push(rel.target);
          
          // Update children map
          const children = childrenMap.get(rel.target) || [];
          children.push(symbol);
          childrenMap.set(rel.target, children);
        }
      }
      
      if (parents.length > 0) {
        inheritanceMap.set(symbol, parents);
      }
    }

    // Build inheritance chains for each symbol
    for (const [symbol] of context.symbols) {
      const ancestors = this.getAncestors(symbol, inheritanceMap);
      const descendants = this.getDescendants(symbol, childrenMap);
      const depth = this.calculateInheritanceDepth(symbol, inheritanceMap);

      inheritanceChains.set(symbol, {
        symbol,
        ancestors,
        descendants,
        depth
      });
    }

    return inheritanceChains;
  }

  /**
   * Analyze composition relationships
   */
  analyzeComposition(context: SemanticContext): CompositionRelation[] {
    const compositions: CompositionRelation[] = [];
    
    for (const [symbol, relationships] of context.relationships) {
      for (const rel of relationships) {
        let compositionType: CompositionRelation['relationship'];
        let strength: number;

        switch (rel.type) {
          case 'contains':
            compositionType = 'composes';
            strength = 0.9;
            break;
          case 'uses':
            compositionType = 'uses';
            strength = 0.6;
            break;
          case 'calls':
            compositionType = 'uses';
            strength = 0.4;
            break;
          default:
            continue;
        }

        // Analyze the strength based on frequency and context
        const adjustedStrength = this.calculateCompositionStrength(
          symbol, 
          rel.target, 
          context, 
          strength
        );

        compositions.push({
          container: symbol,
          contained: rel.target,
          relationship: compositionType,
          strength: adjustedStrength
        });
      }
    }

    return compositions;
  }

  /**
   * Identify dependency clusters using graph analysis
   */
  identifyDependencyClusters(context: SemanticContext): DependencyCluster[] {
    const clusters: DependencyCluster[] = [];
    const visited = new Set<string>();
    const adjacencyList = this.buildAdjacencyList(context);

    let clusterId = 0;
    for (const [symbol] of context.symbols) {
      if (!visited.has(symbol)) {
        const clusterSymbols = this.findConnectedComponent(symbol, adjacencyList, visited);
        
        if (clusterSymbols.length > 1) {
          const clusterRelationships = this.getClusterRelationships(clusterSymbols, context);
          const cohesion = this.calculateCohesion(clusterSymbols, clusterRelationships);
          const coupling = this.calculateCoupling(clusterSymbols, context);

          clusters.push({
            id: `cluster_${clusterId++}`,
            symbols: clusterSymbols,
            cohesion,
            coupling,
            relationships: clusterRelationships
          });
        }
      }
    }

    return clusters;
  }

  /**
   * Detect architectural patterns in the codebase
   */
  detectArchitecturalPatterns(context: SemanticContext): ArchitecturalPattern[] {
    const patterns: ArchitecturalPattern[] = [];

    // Detect Singleton pattern
    patterns.push(...this.detectSingletonPattern(context));
    
    // Detect Factory pattern
    patterns.push(...this.detectFactoryPattern(context));
    
    // Detect Observer pattern
    patterns.push(...this.detectObserverPattern(context));
    
    // Detect Strategy pattern
    patterns.push(...this.detectStrategyPattern(context));
    
    // Detect MVC pattern
    patterns.push(...this.detectMVCPattern(context));

    return patterns.filter(p => p.confidence > 0.6);
  }

  /**
   * Calculate coupling between two symbols
   */
  calculateCoupling(symbol1: string, symbol2: string, context: SemanticContext): number {
    const relationships1 = context.relationships.get(symbol1) || [];
    const relationships2 = context.relationships.get(symbol2) || [];
    
    let couplingScore = 0;
    
    // Direct relationships
    for (const rel of relationships1) {
      if (rel.target === symbol2) {
        switch (rel.type) {
          case 'inherits':
          case 'implements':
            couplingScore += 0.9;
            break;
          case 'contains':
            couplingScore += 0.8;
            break;
          case 'uses':
          case 'calls':
            couplingScore += 0.6;
            break;
          case 'imports':
            couplingScore += 0.4;
            break;
        }
      }
    }
    
    // Bidirectional relationships
    for (const rel of relationships2) {
      if (rel.target === symbol1) {
        couplingScore += 0.3; // Lower weight for reverse relationships
      }
    }
    
    return Math.min(couplingScore, 1.0);
  }

  /**
   * Analyze symbol stability (how often it changes vs how much it's depended upon)
   */
  analyzeSymbolStability(symbol: string, context: SemanticContext): {
    afferentCoupling: number; // How many symbols depend on this one
    efferentCoupling: number; // How many symbols this one depends on
    instability: number; // 0 = stable, 1 = unstable
    abstractness: number; // 0 = concrete, 1 = abstract
  } {
    let afferentCoupling = 0;
    let efferentCoupling = 0;
    
    // Count incoming dependencies (afferent)
    for (const [, relationships] of context.relationships) {
      for (const rel of relationships) {
        if (rel.target === symbol) {
          afferentCoupling++;
        }
      }
    }
    
    // Count outgoing dependencies (efferent)
    const symbolRelationships = context.relationships.get(symbol) || [];
    efferentCoupling = symbolRelationships.length;
    
    // Calculate instability: I = Ce / (Ca + Ce)
    const totalCoupling = afferentCoupling + efferentCoupling;
    const instability = totalCoupling > 0 ? efferentCoupling / totalCoupling : 0;
    
    // Calculate abstractness based on symbol type
    const symbolInfo = context.symbols.get(symbol);
    let abstractness = 0;
    if (symbolInfo) {
      switch (symbolInfo.type) {
        case 'interface':
        case 'trait':
          abstractness = 1.0;
          break;
        case 'class':
          // Check if it has abstract methods or is a base class
          abstractness = this.calculateClassAbstractness(symbol, context);
          break;
        case 'function':
          abstractness = 0.2; // Functions are mostly concrete
          break;
        default:
          abstractness = 0.1;
      }
    }
    
    return {
      afferentCoupling,
      efferentCoupling,
      instability,
      abstractness
    };
  }

  private getAncestors(symbol: string, inheritanceMap: Map<string, string[]>): string[] {
    const ancestors: string[] = [];
    const visited = new Set<string>();
    
    const traverse = (current: string) => {
      if (visited.has(current)) return;
      visited.add(current);
      
      const parents = inheritanceMap.get(current) || [];
      for (const parent of parents) {
        ancestors.push(parent);
        traverse(parent);
      }
    };
    
    traverse(symbol);
    return [...new Set(ancestors)];
  }

  private getDescendants(symbol: string, childrenMap: Map<string, string[]>): string[] {
    const descendants: string[] = [];
    const visited = new Set<string>();
    
    const traverse = (current: string) => {
      if (visited.has(current)) return;
      visited.add(current);
      
      const children = childrenMap.get(current) || [];
      for (const child of children) {
        descendants.push(child);
        traverse(child);
      }
    };
    
    traverse(symbol);
    return [...new Set(descendants)];
  }

  private calculateInheritanceDepth(symbol: string, inheritanceMap: Map<string, string[]>): number {
    const visited = new Set<string>();
    
    const traverse = (current: string): number => {
      if (visited.has(current)) return 0;
      visited.add(current);
      
      const parents = inheritanceMap.get(current) || [];
      if (parents.length === 0) return 0;
      
      return 1 + Math.max(...parents.map(parent => traverse(parent)));
    };
    
    return traverse(symbol);
  }

  private calculateCompositionStrength(
    container: string, 
    contained: string, 
    context: SemanticContext, 
    baseStrength: number
  ): number {
    // Count how many times the contained symbol is referenced
    const references = context.crossReferences.get(contained) || [];
    const containerReferences = references.filter(ref => ref.referencedBy === container);
    
    // Adjust strength based on reference frequency
    const frequencyMultiplier = Math.min(containerReferences.length / 5, 1.5);
    
    return Math.min(baseStrength * frequencyMultiplier, 1.0);
  }

  private buildAdjacencyList(context: SemanticContext): Map<string, Set<string>> {
    const adjacencyList = new Map<string, Set<string>>();
    
    // Initialize with all symbols
    for (const [symbol] of context.symbols) {
      adjacencyList.set(symbol, new Set());
    }
    
    // Add edges based on relationships
    for (const [symbol, relationships] of context.relationships) {
      const neighbors = adjacencyList.get(symbol) || new Set();
      
      for (const rel of relationships) {
        if (rel.type === 'uses' || rel.type === 'calls' || rel.type === 'contains') {
          neighbors.add(rel.target);
          
          // Add bidirectional edge for clustering
          const targetNeighbors = adjacencyList.get(rel.target) || new Set();
          targetNeighbors.add(symbol);
          adjacencyList.set(rel.target, targetNeighbors);
        }
      }
      
      adjacencyList.set(symbol, neighbors);
    }
    
    return adjacencyList;
  }

  private findConnectedComponent(
    startSymbol: string, 
    adjacencyList: Map<string, Set<string>>, 
    visited: Set<string>
  ): string[] {
    const component: string[] = [];
    const queue: string[] = [startSymbol];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      
      visited.add(current);
      component.push(current);
      
      const neighbors = adjacencyList.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
    
    return component;
  }

  private getClusterRelationships(symbols: string[], context: SemanticContext): SymbolRelationship[] {
    const clusterRelationships: SymbolRelationship[] = [];
    const symbolSet = new Set(symbols);
    
    for (const symbol of symbols) {
      const relationships = context.relationships.get(symbol) || [];
      for (const rel of relationships) {
        if (symbolSet.has(rel.target)) {
          clusterRelationships.push(rel);
        }
      }
    }
    
    return clusterRelationships;
  }

  private calculateCohesion(symbols: string[], relationships: SymbolRelationship[]): number {
    if (symbols.length <= 1) return 1.0;
    
    const maxPossibleRelationships = symbols.length * (symbols.length - 1);
    const actualRelationships = relationships.length;
    
    return actualRelationships / maxPossibleRelationships;
  }

  private calculateCoupling(clusterSymbols: string[], context: SemanticContext): number {
    const symbolSet = new Set(clusterSymbols);
    let externalRelationships = 0;
    let totalRelationships = 0;
    
    for (const symbol of clusterSymbols) {
      const relationships = context.relationships.get(symbol) || [];
      totalRelationships += relationships.length;
      
      for (const rel of relationships) {
        if (!symbolSet.has(rel.target)) {
          externalRelationships++;
        }
      }
    }
    
    return totalRelationships > 0 ? externalRelationships / totalRelationships : 0;
  }

  private detectSingletonPattern(context: SemanticContext): ArchitecturalPattern[] {
    const patterns: ArchitecturalPattern[] = [];
    
    for (const [symbol, symbolInfo] of context.symbols) {
      if (symbolInfo.type === 'class') {
        // Look for singleton indicators
        const relationships = context.relationships.get(symbol) || [];
        let hasPrivateConstructor = false;
        let hasStaticInstance = false;
        
        // This is a simplified detection - in practice, you'd analyze the AST more deeply
        if (symbol.toLowerCase().includes('singleton') || 
            relationships.some(r => r.type === 'contains' && r.target.includes('instance'))) {
          patterns.push({
            type: 'singleton',
            symbols: [symbol],
            confidence: 0.7,
            description: `${symbol} appears to implement the Singleton pattern`
          });
        }
      }
    }
    
    return patterns;
  }

  private detectFactoryPattern(context: SemanticContext): ArchitecturalPattern[] {
    const patterns: ArchitecturalPattern[] = [];
    
    for (const [symbol, symbolInfo] of context.symbols) {
      if (symbolInfo.type === 'class' || symbolInfo.type === 'function') {
        if (symbol.toLowerCase().includes('factory') || 
            symbol.toLowerCase().includes('create') ||
            symbol.toLowerCase().includes('builder')) {
          
          const relationships = context.relationships.get(symbol) || [];
          const createsObjects = relationships.some(r => r.type === 'calls' && r.target.includes('new'));
          
          if (createsObjects || relationships.length > 2) {
            patterns.push({
              type: 'factory',
              symbols: [symbol],
              confidence: 0.6,
              description: `${symbol} appears to implement the Factory pattern`
            });
          }
        }
      }
    }
    
    return patterns;
  }

  private detectObserverPattern(context: SemanticContext): ArchitecturalPattern[] {
    const patterns: ArchitecturalPattern[] = [];
    
    // Look for observer-like relationships
    const observerSymbols: string[] = [];
    
    for (const [symbol, relationships] of context.relationships) {
      const hasNotifyPattern = relationships.some(r => 
        r.target.toLowerCase().includes('notify') ||
        r.target.toLowerCase().includes('update') ||
        r.target.toLowerCase().includes('observer')
      );
      
      if (hasNotifyPattern) {
        observerSymbols.push(symbol);
      }
    }
    
    if (observerSymbols.length > 0) {
      patterns.push({
        type: 'observer',
        symbols: observerSymbols,
        confidence: 0.7,
        description: 'Observer pattern detected based on notify/update relationships'
      });
    }
    
    return patterns;
  }

  private detectStrategyPattern(context: SemanticContext): ArchitecturalPattern[] {
    const patterns: ArchitecturalPattern[] = [];
    
    // Look for strategy-like inheritance hierarchies
    const inheritanceChains = this.analyzeInheritanceHierarchy(context);
    
    for (const [symbol, chain] of inheritanceChains) {
      if (chain.descendants.length > 2 && 
          (symbol.toLowerCase().includes('strategy') ||
           symbol.toLowerCase().includes('algorithm') ||
           symbol.toLowerCase().includes('policy'))) {
        
        patterns.push({
          type: 'strategy',
          symbols: [symbol, ...chain.descendants],
          confidence: 0.8,
          description: `Strategy pattern detected with ${symbol} as base strategy`
        });
      }
    }
    
    return patterns;
  }

  private detectMVCPattern(context: SemanticContext): ArchitecturalPattern[] {
    const patterns: ArchitecturalPattern[] = [];
    
    const models: string[] = [];
    const views: string[] = [];
    const controllers: string[] = [];
    
    for (const [symbol] of context.symbols) {
      const lowerSymbol = symbol.toLowerCase();
      if (lowerSymbol.includes('model')) {
        models.push(symbol);
      } else if (lowerSymbol.includes('view') || lowerSymbol.includes('ui')) {
        views.push(symbol);
      } else if (lowerSymbol.includes('controller') || lowerSymbol.includes('handler')) {
        controllers.push(symbol);
      }
    }
    
    if (models.length > 0 && views.length > 0 && controllers.length > 0) {
      patterns.push({
        type: 'mvc',
        symbols: [...models, ...views, ...controllers],
        confidence: 0.8,
        description: 'MVC pattern detected based on naming conventions'
      });
    }
    
    return patterns;
  }

  private calculateClassAbstractness(symbol: string, context: SemanticContext): number {
    const relationships = context.relationships.get(symbol) || [];
    const descendants = relationships.filter(r => r.type === 'inherits').length;
    
    // Classes with many descendants are likely more abstract
    return Math.min(descendants / 5, 1.0);
  }
}