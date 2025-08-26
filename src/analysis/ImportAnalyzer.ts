import * as fs from "fs/promises";
import * as path from "path";
import type { SyntaxNode } from "tree-sitter";
import {
  TreeSitterParser,
  type SupportedLanguageKey,
} from "../parsers/tree_sitter/Parser.js";
import type { ImportStatement, DependencyGraph } from "../types/index.js";

export class ImportAnalyzer {
  private importCache: Map<string, ImportStatement[]> = new Map();
  private dependencyGraph: Map<string, DependencyGraph> = new Map();
  private packageJsonCache: Map<string, any> = new Map();
  private tsParser = new TreeSitterParser();

  /**
   * Extract all import statements from a file
   */
  async extractImports(filePath: string): Promise<string[]> {
    const cached = this.importCache.get(filePath);
    if (cached) {
      return cached.map((imp) => imp.raw);
    }

    const content = await fs.readFile(filePath, "utf-8");
    const imports = await this.parseImports(content, filePath);

    this.importCache.set(filePath, imports);
    return imports.map((imp) => imp.raw);
  }

  /**
   * Get minimal imports needed for specific symbols
   */
  async getMinimalImports(
    filePath: string,
    usedSymbols: string[],
  ): Promise<string[]> {
    await this.extractImports(filePath);
    const importStatements = this.importCache.get(filePath) || [];

    if (usedSymbols.length === 0) {
      return [];
    }

    const minimalImports: string[] = [];
    const usedSymbolSet = new Set(usedSymbols);

    for (const importStmt of importStatements) {
      const relevantImports = this.filterRelevantImports(
        importStmt,
        usedSymbolSet,
      );
      if (relevantImports) {
        minimalImports.push(relevantImports);
      }
    }

    // Add transitive dependencies
    const transitiveDeps = await this.getTransitiveDependencies(
      filePath,
      usedSymbols,
    );
    for (const dep of transitiveDeps) {
      if (!minimalImports.some((imp) => imp.includes(dep))) {
        minimalImports.push(`import '${dep}';`);
      }
    }

    return this.deduplicateImports(minimalImports);
  }

  /**
   * Analyze dependency relationships between files
   */
  async analyzeDependencies(rootPath: string): Promise<DependencyGraph> {
    const cached = this.dependencyGraph.get(rootPath);
    if (cached) {
      return cached;
    }

    const graph: DependencyGraph = {
      nodes: new Map(),
      edges: new Map(),
    };

    await this.buildDependencyGraph(rootPath, graph);
    this.dependencyGraph.set(rootPath, graph);

    return graph;
  }

  /**
   * Optimize imports by removing unused dependencies
   */
  async optimizeImports(
    filePath: string,
    actuallyUsedSymbols: string[],
  ): Promise<{
    optimizedImports: string[];
    removedImports: string[];
    addedImports: string[];
    warnings: string[];
  }> {
    const originalImports = await this.extractImports(filePath);
    const minimalImports = await this.getMinimalImports(
      filePath,
      actuallyUsedSymbols,
    );

    const removedImports = originalImports.filter(
      (imp) => !minimalImports.includes(imp),
    );
    const addedImports = minimalImports.filter(
      (imp) => !originalImports.includes(imp),
    );
    const warnings: string[] = [];

    // Check for potential issues
    const sideEffectImports = this.detectSideEffectImports(originalImports);
    for (const sideEffect of sideEffectImports) {
      if (removedImports.includes(sideEffect)) {
        warnings.push(`Removed side-effect import: ${sideEffect}`);
      }
    }

    // Check for circular dependencies
    const circularDeps = await this.detectCircularDependencies(filePath);
    if (circularDeps.length > 0) {
      warnings.push(
        `Circular dependencies detected: ${circularDeps.join(", ")}`,
      );
    }

    return {
      optimizedImports: minimalImports,
      removedImports,
      addedImports,
      warnings,
    };
  }

  /**
   * Get import suggestions based on usage patterns
   */
  async getImportSuggestions(
    filePath: string,
    undefinedSymbols: string[],
  ): Promise<
    Array<{
      symbol: string;
      suggestions: Array<{
        importStatement: string;
        confidence: number;
        source: string;
      }>;
    }>
  > {
    const suggestions: Array<{
      symbol: string;
      suggestions: Array<{
        importStatement: string;
        confidence: number;
        source: string;
      }>;
    }> = [];

    for (const symbol of undefinedSymbols) {
      const symbolSuggestions = await this.findImportSuggestions(
        symbol,
        filePath,
      );
      suggestions.push({
        symbol,
        suggestions: symbolSuggestions,
      });
    }

    return suggestions;
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    this.importCache.clear();
    this.dependencyGraph.clear();
    this.packageJsonCache.clear();
  }

  private async parseImports(
    content: string,
    filePath: string,
  ): Promise<ImportStatement[]> {
    const imports: ImportStatement[] = [];

    try {
      // Use Tree-sitter to find ESM import statements in JS/TS/TSX files
      const langKey: SupportedLanguageKey =
        this.tsParser.detectLanguageFromPath(filePath);
      if (
        (
          ["javascript", "typescript", "tsx"] as SupportedLanguageKey[]
        ).includes(langKey)
      ) {
        const { root } = await this.tsParser.parse(content, langKey);

        const collect = (node: SyntaxNode) => {
          if (node.type === "import_statement") {
            const raw = content.slice(node.startIndex, node.endIndex);
            const parsed = this.parseImportFromRaw(raw);
            if (parsed) imports.push(parsed);
          }
          for (const child of node.namedChildren) collect(child);
        };
        collect(root);
      }

      // Also detect dynamic imports via regex (language-agnostic)
      const dynRe = /import\s*\(\s*['"]([^'"\\]+)['"]\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = dynRe.exec(content))) {
        const mod = m[1];
        const raw = m[0];
        imports.push({ source: mod, imports: [], raw });
      }
    } catch (error) {
      console.warn(`Failed to parse imports from ${filePath}:`, error);
    }

    return imports;
  }

  private parseImportFromRaw(raw: string): ImportStatement | null {
    const text = raw.trim().replace(/;\s*$/, "");
    if (!text.startsWith("import")) return null;

    // Side-effect import: import 'module';
    const sideEffect = text.match(/^import\s+['"]([^'"\\]+)['"]/);
    if (sideEffect) {
      return { source: sideEffect[1]!, imports: [], raw };
    }

    // Structured import: import <spec> from 'module'; (may include 'type')
    const m = text.match(/^import\s+(.*?)\s+from\s+['"]([^'"\\]+)['"]/);
    if (!m) return null;

    let spec = m[1]!.trim();
    const source = m[2]!;

    // Handle TS type-only imports: 'type { Foo }'
    if (spec.startsWith("type ")) spec = spec.slice(5).trim();

    const imports: ImportStatement["imports"] = [];

    const addDefault = (name: string) => {
      if (!name) return;
      imports.push({ name, isDefault: true });
    };
    const addNamespace = (name: string) => {
      if (!name) return;
      imports.push({ name, isNamespace: true });
    };
    const addNamed = (name: string, alias?: string) => {
      if (!name) return;
      imports.push(alias && alias !== name ? { name, alias } : { name });
    };

    const parseNamedBlock = (block: string) => {
      // block like: { a, b as c }
      const inner = block.slice(1, -1).trim();
      if (!inner) return;
      for (const part of inner.split(",")) {
        const p = part.trim();
        if (!p) continue;
        const asMatch = p.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) addNamed(asMatch[1]!, asMatch[2]!);
        else addNamed(p);
      }
    };

    if (spec.startsWith("* as ")) {
      addNamespace(spec.slice(5).trim());
    } else if (spec.startsWith("{")) {
      parseNamedBlock(spec);
    } else if (spec.includes(",")) {
      // default plus named/namespace
      const [left, rightRaw] = [
        spec.split(",")[0]!.trim(),
        spec.slice(spec.indexOf(",") + 1).trim(),
      ];
      addDefault(left);
      const right = rightRaw.trim();
      if (right.startsWith("* as ")) addNamespace(right.slice(5).trim());
      else if (right.startsWith("{")) parseNamedBlock(right);
    } else {
      // default only
      addDefault(spec);
    }

    return { source, imports, raw };
  }

  private filterRelevantImports(
    importStmt: ImportStatement,
    usedSymbols: Set<string>,
  ): string | null {
    const relevantImports = importStmt.imports.filter((imp) => {
      const symbolName = imp.alias || imp.name;
      return usedSymbols.has(symbolName);
    });

    if (relevantImports.length === 0) {
      // Check if it's a side-effect import
      if (importStmt.imports.length === 0) {
        return importStmt.raw; // Keep side-effect imports
      }
      return null;
    }

    // Reconstruct import statement with only relevant imports
    return this.reconstructImportStatement(importStmt.source, relevantImports);
  }

  private reconstructImportStatement(
    source: string,
    imports: ImportStatement["imports"],
  ): string {
    if (imports.length === 0) {
      return `import '${source}';`;
    }

    const parts: string[] = [];
    const namedImports: string[] = [];

    for (const imp of imports) {
      if (imp.isDefault) {
        parts.push(imp.name);
      } else if (imp.isNamespace) {
        parts.push(`* as ${imp.name}`);
      } else {
        const importName = imp.alias ? `${imp.name} as ${imp.alias}` : imp.name;
        namedImports.push(importName);
      }
    }

    if (namedImports.length > 0) {
      parts.push(`{ ${namedImports.join(", ")} }`);
    }

    return `import ${parts.join(", ")} from '${source}';`;
  }

  private async getTransitiveDependencies(
    filePath: string,
    symbols: string[],
  ): Promise<string[]> {
    const dependencies: Set<string> = new Set();
    const visited: Set<string> = new Set();

    const traverse = async (currentFile: string, currentSymbols: string[]) => {
      if (visited.has(currentFile)) {
        return;
      }
      visited.add(currentFile);

      try {
        await this.extractImports(currentFile);
        const importStatements = this.importCache.get(currentFile) || [];

        for (const importStmt of importStatements) {
          const resolvedPath = await this.resolveImportPath(
            importStmt.source,
            currentFile,
          );
          if (resolvedPath && !this.isNodeModule(importStmt.source)) {
            dependencies.add(importStmt.source);

            // Check if any of the imported symbols are used
            const usedFromThisImport = importStmt.imports.filter((imp) =>
              currentSymbols.includes(imp.alias || imp.name),
            );

            if (usedFromThisImport.length > 0) {
              await traverse(
                resolvedPath,
                usedFromThisImport.map((imp) => imp.name),
              );
            }
          }
        }
      } catch (error) {
        // Ignore errors for files that can't be read
      }
    };

    await traverse(filePath, symbols);
    return Array.from(dependencies);
  }

  private async buildDependencyGraph(
    rootPath: string,
    graph: DependencyGraph,
  ): Promise<void> {
    const visited: Set<string> = new Set();

    const traverse = async (filePath: string) => {
      if (visited.has(filePath)) {
        return;
      }
      visited.add(filePath);

      try {
        await this.extractImports(filePath);
        const importStatements = this.importCache.get(filePath) || [];

        if (!graph.edges.has(filePath)) {
          graph.edges.set(filePath, new Set());
        }

        for (const importStmt of importStatements) {
          const resolvedPath = await this.resolveImportPath(
            importStmt.source,
            filePath,
          );
          if (resolvedPath && !this.isNodeModule(importStmt.source)) {
            graph.edges.get(filePath)?.add(resolvedPath);
            await traverse(resolvedPath);
          }
        }
      } catch (error) {
        // Ignore errors for files that can't be read
      }
    };

    await traverse(rootPath);
  }

  private deduplicateImports(imports: string[]): string[] {
    const seen = new Set<string>();
    const deduplicated: string[] = [];

    for (const imp of imports) {
      const normalized = imp.trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        deduplicated.push(imp);
      }
    }

    return deduplicated;
  }

  private detectSideEffectImports(imports: string[]): string[] {
    return imports.filter((imp) => {
      // Side-effect imports typically don't have named imports
      return imp.match(/^import\s+['"][^'"]+['"];?$/);
    });
  }

  private async detectCircularDependencies(
    filePath: string,
  ): Promise<string[]> {
    const graph = await this.analyzeDependencies(filePath);
    const cycles: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (node: string, path: string[]): void => {
      if (recursionStack.has(node)) {
        const cycleStart = path.indexOf(node);
        cycles.push(path.slice(cycleStart).join(" -> "));
        return;
      }

      if (visited.has(node)) {
        return;
      }

      visited.add(node);
      recursionStack.add(node);

      const neighbors = graph.edges.get(node) || new Set();
      for (const neighbor of neighbors) {
        dfs(neighbor, [...path, neighbor]);
      }

      recursionStack.delete(node);
    };

    dfs(filePath, [filePath]);
    return cycles;
  }

  private async findImportSuggestions(
    symbol: string,
    filePath: string,
  ): Promise<
    Array<{
      importStatement: string;
      confidence: number;
      source: string;
    }>
  > {
    const suggestions: Array<{
      importStatement: string;
      confidence: number;
      source: string;
    }> = [];

    // Check package.json dependencies
    const packageJson = await this.getPackageJson(filePath);
    if (packageJson) {
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      };

      for (const [pkg, _version] of Object.entries(allDeps)) {
        // Simple heuristic: if symbol name matches or is similar to package name
        const similarity = this.calculateSimilarity(
          symbol.toLowerCase(),
          pkg.toLowerCase(),
        );
        if (similarity > 0.6) {
          suggestions.push({
            importStatement: `import { ${symbol} } from '${pkg}';`,
            confidence: similarity,
            source: pkg,
          });
        }
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  private async resolveImportPath(
    importPath: string,
    fromFile: string,
  ): Promise<string | null> {
    if (this.isNodeModule(importPath)) {
      return null; // Don't resolve node modules
    }

    const dir = path.dirname(fromFile);
    const resolved = path.resolve(dir, importPath);

    // Try different extensions
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".json"];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      try {
        await fs.access(withExt);
        return withExt;
      } catch {
        // Continue to next extension
      }
    }

    // Try index files
    for (const ext of extensions) {
      const indexFile = path.join(resolved, `index${ext}`);
      try {
        await fs.access(indexFile);
        return indexFile;
      } catch {
        // Continue to next extension
      }
    }

    return null;
  }

  private isNodeModule(importPath: string): boolean {
    return !importPath.startsWith(".") && !importPath.startsWith("/");
  }

  private async getPackageJson(filePath: string): Promise<any | null> {
    let dir = path.dirname(filePath);

    while (dir !== path.dirname(dir)) {
      const packageJsonPath = path.join(dir, "package.json");

      if (this.packageJsonCache.has(packageJsonPath)) {
        return this.packageJsonCache.get(packageJsonPath);
      }

      try {
        const content = await fs.readFile(packageJsonPath, "utf-8");
        const packageJson = JSON.parse(content);
        this.packageJsonCache.set(packageJsonPath, packageJson);
        return packageJson;
      } catch {
        // Continue to parent directory
      }

      dir = path.dirname(dir);
    }

    return null;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(0));

    for (let i = 0; i <= str1.length; i++) {
      matrix[0]![i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j]![0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j]![i] = Math.min(
          matrix[j]![i - 1]! + 1, // deletion
          matrix[j - 1]![i]! + 1, // insertion
          matrix[j - 1]![i - 1]! + indicator, // substitution
        );
      }
    }

    return matrix[str2.length]![str1.length]!;
  }
}
