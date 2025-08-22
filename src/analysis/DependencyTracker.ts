import * as fs from 'fs/promises';
import * as path from 'path';
import type { SymbolInfo } from '../types/index.js';
import type { SymbolRelationship, SemanticContext } from './SemanticAnalyzer.js';
import { SemanticAnalyzer } from './SemanticAnalyzer.js';

export interface FileDependency {
  sourceFile: string;
  targetFile: string;
  symbols: string[];
  type: 'import' | 'export' | 'reference';
  strength: number; // 0-1, how critical this dependency is
}

export interface DependencyGraph {
  files: Map<string, FileNode>;
  dependencies: FileDependency[];
  cycles: string[][]; // Circular dependency chains
  layers: string[][]; // Dependency layers (topological sort)
}

export interface FileNode {
  path: string;
  symbols: Map<string, SymbolInfo>;
  imports: string[];
  exports: string[];
  dependencies: string[]; // Files this file depends on
  dependents: string[]; // Files that depend on this file
  lastModified: number;
}

export interface DependencyMetrics {
  totalFiles: number;
  totalDependencies: number;
  averageDependenciesPerFile: number;
  maxDependencyDepth: number;
  circularDependencies: number;
  instabilityIndex: number; // Overall codebase instability
  couplingMetrics: {
    afferentCoupling: Map<string, number>;
    efferentCoupling: Map<string, number>;
    instability: Map<string, number>;
  };
}

export interface ImpactAnalysis {
  changedFile: string;
  directlyAffected: string[];
  indirectlyAffected: string[];
  testFilesAffected: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  estimatedEffort: number; // Hours
}

export class DependencyTracker {
  private semanticAnalyzer: SemanticAnalyzer;
  private dependencyGraph: DependencyGraph;
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();
  private analysisCache: Map<string, { context: SemanticContext; timestamp: number }> = new Map();

  constructor() {
    this.semanticAnalyzer = new SemanticAnalyzer();
    this.dependencyGraph = {
      files: new Map(),
      dependencies: [],
      cycles: [],
      layers: []
    };
  }

  /**
   * Analyze dependencies across multiple files
   */
  async analyzeDependencies(filePaths: string[]): Promise<DependencyGraph> {
    // Reset the graph
    this.dependencyGraph = {
      files: new Map(),
      dependencies: [],
      cycles: [],
      layers: []
    };

    // Analyze each file
    for (const filePath of filePaths) {
      await this.analyzeFile(filePath);
    }

    // Build cross-file dependencies
    await this.buildCrossFileDependencies(filePaths);

    // Detect circular dependencies
    this.dependencyGraph.cycles = this.detectCircularDependencies();

    // Calculate dependency layers
    this.dependencyGraph.layers = this.calculateDependencyLayers();

    return this.dependencyGraph;
  }

  /**
   * Analyze a single file and add it to the dependency graph
   */
  async analyzeFile(filePath: string): Promise<FileNode> {
    const absolutePath = path.resolve(filePath);
    
    // Check cache first
    const stats = await fs.stat(absolutePath);
    const lastModified = stats.mtime.getTime();
    const cached = this.analysisCache.get(absolutePath);
    
    let context: SemanticContext;
    if (cached && cached.timestamp >= lastModified) {
      context = cached.context;
    } else {
      context = await this.semanticAnalyzer.analyzeFile(absolutePath);
      this.analysisCache.set(absolutePath, { context, timestamp: lastModified });
    }

    const fileNode: FileNode = {
      path: absolutePath,
      symbols: context.symbols,
      imports: this.extractImportPaths(context),
      exports: this.extractExportedSymbols(context),
      dependencies: [],
      dependents: [],
      lastModified
    };

    this.dependencyGraph.files.set(absolutePath, fileNode);
    return fileNode;
  }

  /**
   * Track dependencies in real-time by watching file changes
   */
  async startWatching(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      const absolutePath = path.resolve(filePath);
      
      if (!this.fileWatchers.has(absolutePath)) {
        try {
          const watcher = fs.watch(absolutePath, async (eventType) => {
            if (eventType === 'change') {
              await this.handleFileChange(absolutePath);
            }
          });
          
          this.fileWatchers.set(absolutePath, watcher);
        } catch (error) {
          console.warn(`Failed to watch file ${absolutePath}:`, error);
        }
      }
    }
  }

  /**
   * Stop watching all files
   */
  stopWatching(): void {
    for (const [filePath, watcher] of this.fileWatchers) {
      watcher.close();
    }
    this.fileWatchers.clear();
  }

  /**
   * Analyze the impact of changing a specific file
   */
  analyzeChangeImpact(filePath: string): ImpactAnalysis {
    const absolutePath = path.resolve(filePath);
    const fileNode = this.dependencyGraph.files.get(absolutePath);
    
    if (!fileNode) {
      throw new Error(`File ${filePath} not found in dependency graph`);
    }

    const directlyAffected = [...fileNode.dependents];
    const indirectlyAffected = this.findIndirectDependents(absolutePath, new Set(directlyAffected));
    const testFilesAffected = this.findAffectedTestFiles([absolutePath, ...directlyAffected, ...indirectlyAffected]);
    
    const totalAffected = directlyAffected.length + indirectlyAffected.length;
    const riskLevel = this.calculateRiskLevel(totalAffected, fileNode);
    const estimatedEffort = this.estimateChangeEffort(totalAffected, fileNode);

    return {
      changedFile: absolutePath,
      directlyAffected,
      indirectlyAffected,
      testFilesAffected,
      riskLevel,
      estimatedEffort
    };
  }

  /**
   * Calculate dependency metrics for the codebase
   */
  calculateMetrics(): DependencyMetrics {
    const totalFiles = this.dependencyGraph.files.size;
    const totalDependencies = this.dependencyGraph.dependencies.length;
    const averageDependenciesPerFile = totalFiles > 0 ? totalDependencies / totalFiles : 0;
    
    const maxDependencyDepth = this.calculateMaxDependencyDepth();
    const circularDependencies = this.dependencyGraph.cycles.length;
    
    const couplingMetrics = this.calculateCouplingMetrics();
    const instabilityIndex = this.calculateOverallInstability(couplingMetrics);

    return {
      totalFiles,
      totalDependencies,
      averageDependenciesPerFile,
      maxDependencyDepth,
      circularDependencies,
      instabilityIndex,
      couplingMetrics
    };
  }

  /**
   * Find files that are good candidates for refactoring
   */
  findRefactoringCandidates(): Array<{
    file: string;
    issues: string[];
    priority: 'low' | 'medium' | 'high';
    metrics: {
      dependencyCount: number;
      dependentCount: number;
      instability: number;
      complexity: number;
    };
  }> {
    const candidates: Array<{
      file: string;
      issues: string[];
      priority: 'low' | 'medium' | 'high';
      metrics: {
        dependencyCount: number;
        dependentCount: number;
        instability: number;
        complexity: number;
      };
    }> = [];

    for (const [filePath, fileNode] of this.dependencyGraph.files) {
      const issues: string[] = [];
      const dependencyCount = fileNode.dependencies.length;
      const dependentCount = fileNode.dependents.length;
      
      // Calculate instability for this file
      const totalCoupling = dependencyCount + dependentCount;
      const instability = totalCoupling > 0 ? dependencyCount / totalCoupling : 0;
      
      // Calculate complexity based on symbol count and relationships
      const symbolCount = fileNode.symbols.size;
      const complexity = symbolCount / 10; // Simplified complexity metric

      // Identify issues
      if (dependencyCount > 10) {
        issues.push(`High dependency count: ${dependencyCount}`);
      }
      if (dependentCount > 15) {
        issues.push(`Too many dependents: ${dependentCount}`);
      }
      if (instability > 0.8) {
        issues.push(`High instability: ${instability.toFixed(2)}`);
      }
      if (symbolCount > 50) {
        issues.push(`Large file: ${symbolCount} symbols`);
      }
      
      // Check for circular dependencies
      const isInCycle = this.dependencyGraph.cycles.some(cycle => cycle.includes(filePath));
      if (isInCycle) {
        issues.push('Part of circular dependency');
      }

      if (issues.length > 0) {
        let priority: 'low' | 'medium' | 'high' = 'low';
        if (issues.length >= 3 || isInCycle) {
          priority = 'high';
        } else if (issues.length >= 2) {
          priority = 'medium';
        }

        candidates.push({
          file: filePath,
          issues,
          priority,
          metrics: {
            dependencyCount,
            dependentCount,
            instability,
            complexity
          }
        });
      }
    }

    return candidates.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  private async buildCrossFileDependencies(filePaths: string[]): Promise<void> {
    const dependencies: FileDependency[] = [];

    for (const filePath of filePaths) {
      const absolutePath = path.resolve(filePath);
      const fileNode = this.dependencyGraph.files.get(absolutePath);
      
      if (!fileNode) continue;

      // Analyze imports to find file dependencies
      for (const importPath of fileNode.imports) {
        const resolvedImport = this.resolveImportPath(importPath, absolutePath);
        
        if (resolvedImport && this.dependencyGraph.files.has(resolvedImport)) {
          const targetNode = this.dependencyGraph.files.get(resolvedImport)!;
          
          // Find which symbols are imported
          const importedSymbols = this.findImportedSymbols(absolutePath, resolvedImport);
          
          const dependency: FileDependency = {
            sourceFile: absolutePath,
            targetFile: resolvedImport,
            symbols: importedSymbols,
            type: 'import',
            strength: this.calculateDependencyStrength(importedSymbols, targetNode)
          };
          
          dependencies.push(dependency);
          
          // Update file node dependencies
          fileNode.dependencies.push(resolvedImport);
          targetNode.dependents.push(absolutePath);
        }
      }
    }

    this.dependencyGraph.dependencies = dependencies;
  }

  private extractImportPaths(context: SemanticContext): string[] {
    const importPaths: string[] = [];
    
    for (const [, relationships] of context.relationships) {
      for (const rel of relationships) {
        if (rel.type === 'imports') {
          importPaths.push(rel.target);
        }
      }
    }
    
    return [...new Set(importPaths)];
  }

  private extractExportedSymbols(context: SemanticContext): string[] {
    const exportedSymbols: string[] = [];
    
    for (const [symbol, symbolInfo] of context.symbols) {
      if (symbolInfo.exports) {
        exportedSymbols.push(symbol);
      }
    }
    
    return exportedSymbols;
  }

  private resolveImportPath(importPath: string, fromFile: string): string | null {
    try {
      // Handle relative imports
      if (importPath.startsWith('.')) {
        const resolved = path.resolve(path.dirname(fromFile), importPath);
        
        // Try different extensions
        const extensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs'];
        for (const ext of extensions) {
          const withExt = resolved + ext;
          if (this.dependencyGraph.files.has(withExt)) {
            return withExt;
          }
        }
        
        // Try index files
        for (const ext of extensions) {
          const indexFile = path.join(resolved, 'index' + ext);
          if (this.dependencyGraph.files.has(indexFile)) {
            return indexFile;
          }
        }
      }
      
      // For absolute imports, we'd need more sophisticated resolution
      // This is a simplified version
      return null;
    } catch {
      return null;
    }
  }

  private findImportedSymbols(sourceFile: string, targetFile: string): string[] {
    const sourceNode = this.dependencyGraph.files.get(sourceFile);
    const targetNode = this.dependencyGraph.files.get(targetFile);
    
    if (!sourceNode || !targetNode) return [];
    
    // This is simplified - in practice, you'd analyze the actual import statements
    const importedSymbols: string[] = [];
    const targetExports = new Set(targetNode.exports);
    
    // Find symbols in source that might be imported from target
    for (const [symbol] of sourceNode.symbols) {
      if (targetExports.has(symbol)) {
        importedSymbols.push(symbol);
      }
    }
    
    return importedSymbols;
  }

  private calculateDependencyStrength(symbols: string[], targetNode: FileNode): number {
    if (symbols.length === 0) return 0;
    
    const totalExports = targetNode.exports.length;
    if (totalExports === 0) return 0;
    
    // Strength based on how much of the target file is used
    return Math.min(symbols.length / totalExports, 1.0);
  }

  private detectCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const dfs = (file: string, path: string[]): void => {
      if (recursionStack.has(file)) {
        // Found a cycle
        const cycleStart = path.indexOf(file);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }
      
      if (visited.has(file)) return;
      
      visited.add(file);
      recursionStack.add(file);
      
      const fileNode = this.dependencyGraph.files.get(file);
      if (fileNode) {
        for (const dependency of fileNode.dependencies) {
          dfs(dependency, [...path, file]);
        }
      }
      
      recursionStack.delete(file);
    };
    
    for (const [file] of this.dependencyGraph.files) {
      if (!visited.has(file)) {
        dfs(file, []);
      }
    }
    
    return cycles;
  }

  private calculateDependencyLayers(): string[][] {
    const layers: string[][] = [];
    const inDegree = new Map<string, number>();
    const queue: string[] = [];
    
    // Calculate in-degrees
    for (const [file] of this.dependencyGraph.files) {
      inDegree.set(file, 0);
    }
    
    for (const dependency of this.dependencyGraph.dependencies) {
      const current = inDegree.get(dependency.targetFile) || 0;
      inDegree.set(dependency.targetFile, current + 1);
    }
    
    // Find files with no dependencies (layer 0)
    for (const [file, degree] of inDegree) {
      if (degree === 0) {
        queue.push(file);
      }
    }
    
    // Process layers
    while (queue.length > 0) {
      const currentLayer: string[] = [];
      const layerSize = queue.length;
      
      for (let i = 0; i < layerSize; i++) {
        const file = queue.shift()!;
        currentLayer.push(file);
        
        const fileNode = this.dependencyGraph.files.get(file);
        if (fileNode) {
          for (const dependent of fileNode.dependents) {
            const currentDegree = inDegree.get(dependent) || 0;
            inDegree.set(dependent, currentDegree - 1);
            
            if (currentDegree - 1 === 0) {
              queue.push(dependent);
            }
          }
        }
      }
      
      if (currentLayer.length > 0) {
        layers.push(currentLayer);
      }
    }
    
    return layers;
  }

  private async handleFileChange(filePath: string): Promise<void> {
    try {
      // Re-analyze the changed file
      await this.analyzeFile(filePath);
      
      // Update dependencies for this file
      const fileNode = this.dependencyGraph.files.get(filePath);
      if (fileNode) {
        // Clear old dependencies
        this.dependencyGraph.dependencies = this.dependencyGraph.dependencies.filter(
          dep => dep.sourceFile !== filePath
        );
        
        // Rebuild dependencies for this file
        await this.buildCrossFileDependencies([filePath]);
      }
    } catch (error) {
      console.error(`Error handling file change for ${filePath}:`, error);
    }
  }

  private findIndirectDependents(filePath: string, visited: Set<string>): string[] {
    const indirectDependents: string[] = [];
    const fileNode = this.dependencyGraph.files.get(filePath);
    
    if (!fileNode) return indirectDependents;
    
    for (const dependent of fileNode.dependents) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        indirectDependents.push(dependent);
        
        // Recursively find dependents of dependents
        const nestedDependents = this.findIndirectDependents(dependent, visited);
        indirectDependents.push(...nestedDependents);
      }
    }
    
    return indirectDependents;
  }

  private findAffectedTestFiles(affectedFiles: string[]): string[] {
    const testFiles: string[] = [];
    
    for (const [filePath] of this.dependencyGraph.files) {
      const isTestFile = filePath.includes('.test.') || 
                        filePath.includes('.spec.') || 
                        filePath.includes('/test/') ||
                        filePath.includes('\\test\\');
      
      if (isTestFile) {
        const fileNode = this.dependencyGraph.files.get(filePath);
        if (fileNode) {
          // Check if test file depends on any affected files
          const hasAffectedDependency = fileNode.dependencies.some(dep => 
            affectedFiles.includes(dep)
          );
          
          if (hasAffectedDependency) {
            testFiles.push(filePath);
          }
        }
      }
    }
    
    return testFiles;
  }

  private calculateRiskLevel(totalAffected: number, fileNode: FileNode): ImpactAnalysis['riskLevel'] {
    const symbolCount = fileNode.symbols.size;
    const dependentCount = fileNode.dependents.length;
    
    if (totalAffected > 20 || symbolCount > 100 || dependentCount > 10) {
      return 'critical';
    } else if (totalAffected > 10 || symbolCount > 50 || dependentCount > 5) {
      return 'high';
    } else if (totalAffected > 5 || symbolCount > 20 || dependentCount > 2) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  private estimateChangeEffort(totalAffected: number, fileNode: FileNode): number {
    const baseEffort = 1; // 1 hour for the original change
    const affectedEffort = totalAffected * 0.5; // 30 minutes per affected file
    const complexityEffort = fileNode.symbols.size * 0.02; // 1.2 minutes per symbol
    
    return Math.round((baseEffort + affectedEffort + complexityEffort) * 10) / 10;
  }

  private calculateMaxDependencyDepth(): number {
    let maxDepth = 0;
    
    const calculateDepth = (file: string, visited: Set<string>): number => {
      if (visited.has(file)) return 0;
      visited.add(file);
      
      const fileNode = this.dependencyGraph.files.get(file);
      if (!fileNode || fileNode.dependencies.length === 0) {
        return 0;
      }
      
      let maxChildDepth = 0;
      for (const dependency of fileNode.dependencies) {
        const depth = calculateDepth(dependency, new Set(visited));
        maxChildDepth = Math.max(maxChildDepth, depth);
      }
      
      return 1 + maxChildDepth;
    };
    
    for (const [file] of this.dependencyGraph.files) {
      const depth = calculateDepth(file, new Set());
      maxDepth = Math.max(maxDepth, depth);
    }
    
    return maxDepth;
  }

  private calculateCouplingMetrics(): DependencyMetrics['couplingMetrics'] {
    const afferentCoupling = new Map<string, number>();
    const efferentCoupling = new Map<string, number>();
    const instability = new Map<string, number>();
    
    for (const [file, fileNode] of this.dependencyGraph.files) {
      const ca = fileNode.dependents.length; // Afferent coupling
      const ce = fileNode.dependencies.length; // Efferent coupling
      const i = (ca + ce) > 0 ? ce / (ca + ce) : 0; // Instability
      
      afferentCoupling.set(file, ca);
      efferentCoupling.set(file, ce);
      instability.set(file, i);
    }
    
    return { afferentCoupling, efferentCoupling, instability };
  }

  private calculateOverallInstability(couplingMetrics: DependencyMetrics['couplingMetrics']): number {
    const instabilityValues = Array.from(couplingMetrics.instability.values());
    
    if (instabilityValues.length === 0) return 0;
    
    const sum = instabilityValues.reduce((acc, val) => acc + val, 0);
    return sum / instabilityValues.length;
  }

  /**
   * Get the current dependency graph
   */
  getDependencyGraph(): DependencyGraph {
    return this.dependencyGraph;
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.analysisCache.clear();
    this.semanticAnalyzer.clearContexts();
  }
}