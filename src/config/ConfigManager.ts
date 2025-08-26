import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import type {
  OptimizationConfig,
  CacheEvictionPolicy,
  ContextExtractionStrategy,
  LogLevel,
} from "../types/index.js";

export interface CodeReferenceOptimizerConfig {
  // Cache settings
  cache: {
    maxSize: number;
    ttlMs: number;
    evictionPolicy: CacheEvictionPolicy;
    enablePersistence: boolean;
    persistencePath?: string;
  };

  // Context extraction settings
  extraction: {
    strategy: ContextExtractionStrategy;
    maxTokens: number;
    includeComments: boolean;
    includeImports: boolean;
    includeExports: boolean;
    contextLines: number;
    minRelevanceScore: number;
  };

  // Import optimization settings
  imports: {
    enableOptimization: boolean;
    preserveSideEffects: boolean;
    analyzeTransitiveDeps: boolean;
    maxDepthLevel: number;
    excludePatterns: string[];
    includePatterns: string[];
  };

  // Diff settings
  diff: {
    enableContextualDiff: boolean;
    contextLines: number;
    ignoreWhitespace: boolean;
    ignoreComments: boolean;
    enableSymbolTracking: boolean;
  };

  // Performance settings
  performance: {
    maxFileSize: number;
    maxConcurrentOperations: number;
    enableMetrics: boolean;
    timeoutMs: number;
  };

  // Language-specific settings
  languages: {
    [language: string]: {
      enabled: boolean;
      extensions: string[];
      parserOptions?: any;
      customRules?: OptimizationConfig;
    };
  };

  // Logging settings
  logging: {
    level: LogLevel;
    enableFileLogging: boolean;
    logPath?: string;
    enableMetricsLogging: boolean;
  };

  // Security settings
  security: {
    allowedPaths: string[];
    blockedPaths: string[];
    maxFileAccess: number;
    enableSandbox: boolean;
  };
}

export class ConfigManager {
  private config: CodeReferenceOptimizerConfig;
  private configPath?: string;
  private watchers: Map<string, fsSync.FSWatcher> = new Map();
  private changeCallbacks: Array<
    (config: CodeReferenceOptimizerConfig) => void
  > = [];

  constructor(initialConfig?: Partial<CodeReferenceOptimizerConfig>) {
    this.config = this.mergeWithDefaults(initialConfig || {});
  }

  /**
   * Load configuration from file
   */
  async loadFromFile(configPath: string): Promise<void> {
    this.configPath = configPath;

    try {
      const content = await fs.readFile(configPath, "utf-8");
      const fileConfig = JSON.parse(content);
      this.config = this.mergeWithDefaults(fileConfig);

      // Validate configuration
      this.validateConfig();

      // Set up file watching for auto-reload
      await this.setupFileWatcher(configPath);
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        // Config file doesn't exist, create it with defaults
        await this.saveToFile(configPath);
      } else {
        throw new Error(`Failed to load config from ${configPath}: ${error}`);
      }
    }
  }

  /**
   * Save configuration to file
   */
  async saveToFile(configPath?: string): Promise<void> {
    const targetPath = configPath || this.configPath;
    if (!targetPath) {
      throw new Error("No config path specified");
    }

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      // Write config with pretty formatting
      const content = JSON.stringify(this.config, null, 2);
      await fs.writeFile(targetPath, content, "utf-8");

      this.configPath = targetPath;
    } catch (error) {
      throw new Error(`Failed to save config to ${targetPath}: ${error}`);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): CodeReferenceOptimizerConfig {
    return { ...this.config }; // Return a copy to prevent mutations
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<CodeReferenceOptimizerConfig>): void {
    this.config = this.mergeConfigs(this.config, updates);
    this.validateConfig();
    this.notifyConfigChange();
  }

  /**
   * Get configuration for specific language
   */
  getLanguageConfig(
    language: string,
  ): CodeReferenceOptimizerConfig["languages"][string] | null {
    return this.config.languages[language] || null;
  }

  /**
   * Update language-specific configuration
   */
  updateLanguageConfig(
    language: string,
    config: Partial<CodeReferenceOptimizerConfig["languages"][string]>,
  ): void {
    if (!this.config.languages[language]) {
      this.config.languages[language] = {
        enabled: true,
        extensions: [],
        ...config,
      };
    } else {
      this.config.languages[language] = {
        ...this.config.languages[language],
        ...config,
      };
    }

    this.validateConfig();
    this.notifyConfigChange();
  }

  /**
   * Check if a file path is allowed
   */
  isPathAllowed(filePath: string): boolean {
    const { allowedPaths, blockedPaths } = this.config.security;

    // Check blocked paths first
    for (const blockedPattern of blockedPaths) {
      if (this.matchesPattern(filePath, blockedPattern)) {
        return false;
      }
    }

    // If no allowed paths specified, allow all (except blocked)
    if (allowedPaths.length === 0) {
      return true;
    }

    // Check allowed paths
    for (const allowedPattern of allowedPaths) {
      if (this.matchesPattern(filePath, allowedPattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get optimization config for file type
   */
  getOptimizationConfig(fileExtension: string): OptimizationConfig {
    // Find language config by extension
    for (const [_language, langConfig] of Object.entries(
      this.config.languages,
    )) {
      if (langConfig.enabled && langConfig.extensions.includes(fileExtension)) {
        return langConfig.customRules || this.getDefaultOptimizationConfig();
      }
    }

    return this.getDefaultOptimizationConfig();
  }

  /**
   * Register callback for configuration changes
   */
  onConfigChange(
    callback: (config: CodeReferenceOptimizerConfig) => void,
  ): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * Remove configuration change callback
   */
  removeConfigChangeCallback(
    callback: (config: CodeReferenceOptimizerConfig) => void,
  ): void {
    const index = this.changeCallbacks.indexOf(callback);
    if (index > -1) {
      this.changeCallbacks.splice(index, 1);
    }
  }

  /**
   * Reset configuration to defaults
   */
  resetToDefaults(): void {
    this.config = this.getDefaultConfig();
    this.notifyConfigChange();
  }

  /**
   * Validate current configuration
   */
  validateConfig(): void {
    const errors: string[] = [];

    // Validate cache settings
    if (this.config.cache.maxSize <= 0) {
      errors.push("Cache maxSize must be greater than 0");
    }

    if (this.config.cache.ttlMs < 0) {
      errors.push("Cache TTL must be non-negative");
    }

    // Validate extraction settings
    if (this.config.extraction.maxTokens <= 0) {
      errors.push("Extraction maxTokens must be greater than 0");
    }

    if (
      this.config.extraction.minRelevanceScore < 0 ||
      this.config.extraction.minRelevanceScore > 1
    ) {
      errors.push("Extraction minRelevanceScore must be between 0 and 1");
    }

    // Validate performance settings
    if (this.config.performance.maxFileSize <= 0) {
      errors.push("Performance maxFileSize must be greater than 0");
    }

    if (this.config.performance.maxConcurrentOperations <= 0) {
      errors.push("Performance maxConcurrentOperations must be greater than 0");
    }

    // Validate language configurations
    for (const [language, langConfig] of Object.entries(
      this.config.languages,
    )) {
      if (langConfig.extensions.length === 0) {
        errors.push(`Language ${language} must have at least one extension`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join("\n")}`);
    }
  }

  /**
   * Get configuration schema for validation
   */
  getConfigSchema(): any {
    return {
      type: "object",
      properties: {
        cache: {
          type: "object",
          properties: {
            maxSize: { type: "number", minimum: 1 },
            ttlMs: { type: "number", minimum: 0 },
            evictionPolicy: { type: "string", enum: ["lru", "lfu", "fifo"] },
            enablePersistence: { type: "boolean" },
            persistencePath: { type: "string" },
          },
          required: ["maxSize", "ttlMs", "evictionPolicy", "enablePersistence"],
        },
        extraction: {
          type: "object",
          properties: {
            strategy: {
              type: "string",
              enum: ["minimal", "contextual", "full"],
            },
            maxTokens: { type: "number", minimum: 1 },
            includeComments: { type: "boolean" },
            includeImports: { type: "boolean" },
            includeExports: { type: "boolean" },
            contextLines: { type: "number", minimum: 0 },
            minRelevanceScore: { type: "number", minimum: 0, maximum: 1 },
          },
          required: [
            "strategy",
            "maxTokens",
            "includeComments",
            "includeImports",
            "includeExports",
            "contextLines",
            "minRelevanceScore",
          ],
        },
        // ... other schema definitions
      },
      required: [
        "cache",
        "extraction",
        "imports",
        "diff",
        "performance",
        "languages",
        "logging",
        "security",
      ],
    };
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    // Stop file watchers
    for (const [_path, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    // Clear callbacks
    this.changeCallbacks.length = 0;
  }

  private getDefaultConfig(): CodeReferenceOptimizerConfig {
    return {
      cache: {
        maxSize: 1000,
        ttlMs: 3600000, // 1 hour
        evictionPolicy: "lru",
        enablePersistence: false,
      },
      extraction: {
        strategy: "contextual",
        maxTokens: 2000,
        includeComments: false,
        includeImports: true,
        includeExports: true,
        contextLines: 3,
        minRelevanceScore: 0.1,
      },
      imports: {
        enableOptimization: true,
        preserveSideEffects: true,
        analyzeTransitiveDeps: true,
        maxDepthLevel: 5,
        excludePatterns: ["node_modules/**", "**/*.test.*", "**/*.spec.*"],
        includePatterns: ["src/**", "lib/**"],
      },
      diff: {
        enableContextualDiff: true,
        contextLines: 3,
        ignoreWhitespace: false,
        ignoreComments: false,
        enableSymbolTracking: true,
      },
      performance: {
        maxFileSize: 1024 * 1024, // 1MB
        maxConcurrentOperations: 10,
        enableMetrics: true,
        timeoutMs: 30000, // 30 seconds
      },
      languages: {
        typescript: {
          enabled: true,
          extensions: [".ts", ".tsx"],
          parserOptions: {
            jsx: true,
            decorators: true,
          },
        },
        javascript: {
          enabled: true,
          extensions: [".js", ".jsx", ".mjs"],
          parserOptions: {
            jsx: true,
          },
        },
        python: {
          enabled: true,
          extensions: [".py", ".pyi"],
        },
        json: {
          enabled: true,
          extensions: [".json"],
        },
      },
      logging: {
        level: "info",
        enableFileLogging: false,
        enableMetricsLogging: true,
      },
      security: {
        allowedPaths: [],
        blockedPaths: ["node_modules/**", ".git/**", "**/*.log"],
        maxFileAccess: 1000,
        enableSandbox: false,
      },
    };
  }

  private getDefaultOptimizationConfig(): OptimizationConfig {
    return {
      maxCacheSize: 1000,
      maxTokensPerEntry: 2000,
      cacheExpirationMs: 3600000,
      enableImportOptimization: true,
      enableDiffOptimization: true,
      tokenEstimationRatio: 4,
      relevanceThreshold: 0.1,
      enableCaching: true,
      cacheStrategy: "aggressive",
      minificationLevel: "basic",
      preserveFormatting: false,
      enableTreeShaking: true,
      customRules: {},
    };
  }

  private mergeWithDefaults(
    config: Partial<CodeReferenceOptimizerConfig>,
  ): CodeReferenceOptimizerConfig {
    const defaults = this.getDefaultConfig();
    return this.mergeConfigs(defaults, config);
  }

  private mergeConfigs(
    base: CodeReferenceOptimizerConfig,
    override: Partial<CodeReferenceOptimizerConfig>,
  ): CodeReferenceOptimizerConfig {
    const result = { ...base };

    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined) {
        if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          result[key as keyof CodeReferenceOptimizerConfig] = {
            ...result[key as keyof CodeReferenceOptimizerConfig],
            ...value,
          } as any;
        } else {
          result[key as keyof CodeReferenceOptimizerConfig] = value as any;
        }
      }
    }

    return result;
  }

  private async setupFileWatcher(configPath: string): Promise<void> {
    try {
      const watcher = fsSync.watch(configPath, { persistent: false });

      watcher.on("change", async () => {
        try {
          await this.loadFromFile(configPath);
        } catch (error) {
          console.warn(`Failed to reload config from ${configPath}:`, error);
        }
      });

      this.watchers.set(configPath, watcher);
    } catch (error) {
      console.warn(`Failed to set up file watcher for ${configPath}:`, error);
    }
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regexPattern = pattern
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]");

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  private notifyConfigChange(): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(this.getConfig());
      } catch (error) {
        console.warn("Error in config change callback:", error);
      }
    }
  }
}
