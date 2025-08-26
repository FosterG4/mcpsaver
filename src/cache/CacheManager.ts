import { LRUCache } from "lru-cache";
import type {
  CodeContext,
  CacheEntry,
  CacheStats,
  CacheEvictionPolicy,
  OptimizationConfig,
} from "../types/index.js";

export class CacheManager {
  private cache: LRUCache<string, CodeContext>;
  private stats: CacheStats;
  private config: OptimizationConfig;
  private evictionPolicy: CacheEvictionPolicy;
  private accessCounts: Map<string, number>;
  private lastAccessed: Map<string, number>;

  constructor(config?: Partial<OptimizationConfig>) {
    this.config = {
      maxCacheSize: 100 * 1024 * 1024, // 100MB
      maxTokensPerEntry: 10000,
      cacheExpirationMs: 24 * 60 * 60 * 1000, // 24 hours
      enableImportOptimization: true,
      enableDiffOptimization: true,
      tokenEstimationRatio: 4,
      relevanceThreshold: 0.5,
      ...config,
    };

    this.cache = new LRUCache<string, CodeContext>({
      max: 1000, // Maximum number of entries
      maxSize: this.config.maxCacheSize,
      sizeCalculation: (value) => this.calculateEntrySize(value),
      dispose: (value, key) => this.onEviction(key, value),
      ttl: this.config.cacheExpirationMs,
    });

    this.stats = {
      totalEntries: 0,
      totalSize: 0,
      hitRate: 0,
      missRate: 0,
      evictionCount: 0,
    };

    this.accessCounts = new Map();
    this.lastAccessed = new Map();
    this.evictionPolicy = "lru";
  }

  /**
   * Get cached context by key
   */
  async get(key: string): Promise<CodeContext | null> {
    const context = this.cache.get(key);

    if (context) {
      this.recordHit(key);
      this.updateAccessStats(key);
      return context;
    }

    this.recordMiss(key);
    return null;
  }

  /**
   * Set cached context
   */
  async set(key: string, context: CodeContext): Promise<void> {
    // Check if entry exceeds token limit
    if (context.tokenCount > this.config.maxTokensPerEntry) {
      context = this.truncateContext(context);
    }

    // Apply relevance-based filtering
    if (context.relevanceScore < this.config.relevanceThreshold) {
      return; // Don't cache low-relevance content
    }

    // Check if we need to evict entries before adding
    await this.ensureCapacity(this.calculateEntrySize(context));

    this.cache.set(key, context);
    this.updateAccessStats(key);
    this.updateStats();
  }

  /**
   * Get all cached contexts for a specific file path
   */
  async getByFilePath(filePath: string): Promise<CodeContext[]> {
    const results: CodeContext[] = [];

    for (const [key, context] of this.cache.entries()) {
      if (context.filePath === filePath) {
        results.push(context);
        this.updateAccessStats(key);
      }
    }

    return results.sort((a, b) => {
      // Sort by relevance score and recency
      const scoreA = a.relevanceScore * this.getRecencyWeight(a.timestamp);
      const scoreB = b.relevanceScore * this.getRecencyWeight(b.timestamp);
      return scoreB - scoreA;
    });
  }

  /**
   * Invalidate cache entries for a specific file
   */
  async invalidateFile(filePath: string): Promise<void> {
    const keysToDelete: string[] = [];

    for (const [key, context] of this.cache.entries()) {
      if (context.filePath === filePath) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
      this.accessCounts.delete(key);
      this.lastAccessed.delete(key);
    }

    this.updateStats();
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.cache.clear();
    this.accessCounts.clear();
    this.lastAccessed.clear();
    this.updateStats();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get cache entries sorted by various criteria
   */
  getEntriesByRelevance(): Array<{
    key: string;
    context: CodeContext;
    score: number;
  }> {
    const entries: Array<{ key: string; context: CodeContext; score: number }> =
      [];

    for (const [key, context] of this.cache.entries()) {
      const accessCount = this.accessCounts.get(key) || 0;
      const lastAccess = this.lastAccessed.get(key) || 0;
      const recencyWeight = this.getRecencyWeight(lastAccess);
      const accessWeight = Math.log(accessCount + 1) / 10; // Logarithmic scaling

      const score =
        context.relevanceScore * 0.4 + recencyWeight * 0.3 + accessWeight * 0.3;
      entries.push({ key, context, score });
    }

    return entries.sort((a, b) => b.score - a.score);
  }

  /**
   * Optimize cache by removing low-value entries
   */
  async optimizeCache(): Promise<{
    removedEntries: number;
    spaceSaved: number;
    newHitRate: number;
  }> {
    const initialSize = this.cache.size;
    const initialEntries = this.stats.totalEntries;

    // Get entries sorted by relevance
    const entries = this.getEntriesByRelevance();

    // Remove bottom 20% of entries if cache is getting full
    const cacheUtilization = this.stats.totalSize / this.config.maxCacheSize;
    if (cacheUtilization > 0.8) {
      const entriesToRemove = Math.floor(entries.length * 0.2);
      const lowValueEntries = entries.slice(-entriesToRemove);

      for (const entry of lowValueEntries) {
        this.cache.delete(entry.key);
        this.accessCounts.delete(entry.key);
        this.lastAccessed.delete(entry.key);
      }
    }

    // Apply custom eviction policies based on current policy
    for (const [key, context] of this.cache.entries()) {
      if (this.shouldEvictEntry(key, context)) {
        this.cache.delete(key);
        this.accessCounts.delete(key);
        this.lastAccessed.delete(key);
      }
    }

    this.updateStats();

    return {
      removedEntries: initialEntries - this.stats.totalEntries,
      spaceSaved: initialSize - this.cache.size,
      newHitRate: this.stats.hitRate,
    };
  }

  private async ensureCapacity(requiredSize: number): Promise<void> {
    const availableSpace = this.config.maxCacheSize - this.stats.totalSize;

    if (availableSpace < requiredSize) {
      // Need to free up space
      const spaceToFree =
        requiredSize - availableSpace + this.config.maxCacheSize * 0.1; // Free 10% extra
      await this.freeSpace(spaceToFree);
    }
  }

  private async freeSpace(targetSize: number): Promise<void> {
    let freedSpace = 0;
    const entries = this.getEntriesByRelevance();

    // Remove lowest scoring entries first
    for (let i = entries.length - 1; i >= 0 && freedSpace < targetSize; i--) {
      const entry = entries[i];
      if (!entry) continue;

      const entrySize = this.calculateEntrySize(entry.context);

      this.cache.delete(entry.key);
      this.accessCounts.delete(entry.key);
      this.lastAccessed.delete(entry.key);

      freedSpace += entrySize;
      this.stats.evictionCount++;
    }
  }

  private calculateEntrySize(context: CodeContext): number {
    const codeSize = context.extractedCode.length;
    const importsSize = context.imports.join("").length;
    const metadataSize = JSON.stringify({
      symbols: context.symbols,
      dependencies: context.dependencies,
    }).length;

    return codeSize + importsSize + metadataSize;
  }

  private truncateContext(context: CodeContext): CodeContext {
    const maxChars =
      this.config.maxTokensPerEntry * this.config.tokenEstimationRatio;

    if (context.extractedCode.length <= maxChars) {
      return context;
    }

    // Truncate while preserving structure
    const lines = context.extractedCode.split("\n");
    const truncatedLines: string[] = [];
    let currentLength = 0;

    for (const line of lines) {
      if (currentLength + line.length > maxChars) {
        break;
      }
      truncatedLines.push(line);
      currentLength += line.length + 1; // +1 for newline
    }

    return {
      ...context,
      extractedCode: truncatedLines.join("\n"),
      tokenCount: Math.ceil(currentLength / this.config.tokenEstimationRatio),
    };
  }

  private recordHit(_key: string): void {
    // Update hit rate calculation
    const totalRequests = this.stats.hitRate + this.stats.missRate;
    this.stats.hitRate =
      (this.stats.hitRate * totalRequests + 1) / (totalRequests + 1);
  }

  private recordMiss(_key: string): void {
    // Update miss rate calculation
    const totalRequests = this.stats.hitRate + this.stats.missRate;
    this.stats.missRate =
      (this.stats.missRate * totalRequests + 1) / (totalRequests + 1);
  }

  private updateAccessStats(key: string): void {
    const currentCount = this.accessCounts.get(key) || 0;
    this.accessCounts.set(key, currentCount + 1);
    this.lastAccessed.set(key, Date.now());
  }

  private updateStats(): void {
    this.stats.totalEntries = this.cache.size;
    this.stats.totalSize = this.cache.calculatedSize || 0;
  }

  private getRecencyWeight(timestamp: number): number {
    const ageMs = Date.now() - timestamp;
    const maxAge = this.config.cacheExpirationMs;
    return Math.max(0, 1 - ageMs / maxAge);
  }

  private onEviction(_key: string, _context: CodeContext): void {
    // Eviction cleanup is handled elsewhere
    this.stats.evictionCount++;
  }

  private shouldEvictEntry(key: string, context: CodeContext): boolean {
    const entry = this.createCacheEntry(key, context);
    const stats = this.getStats();

    switch (this.evictionPolicy) {
      case "lru":
        return entry.lastAccessed < Date.now() - this.config.cacheExpirationMs;
      case "lfu":
        const avgAccess =
          stats.totalEntries > 0
            ? Array.from(this.accessCounts.values()).reduce(
                (a, b) => a + b,
                0,
              ) / stats.totalEntries
            : 0;
        return entry.accessCount < avgAccess * 0.1;
      case "ttl":
        const age = Date.now() - entry.lastAccessed;
        return age > this.config.cacheExpirationMs * 2;
      case "fifo":
      default:
        return context.relevanceScore < this.config.relevanceThreshold * 0.5;
    }
  }

  private createCacheEntry(key: string, context: CodeContext): CacheEntry {
    return {
      key,
      value: context,
      accessCount: this.accessCounts.get(key) || 0,
      lastAccessed: this.lastAccessed.get(key) || Date.now(),
      size: this.calculateEntrySize(context),
    };
  }
}
