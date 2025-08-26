#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { CodeReferenceOptimizer } from "./core/CodeReferenceOptimizer.js";
import { ASTParser } from "./parsers/ASTParser.js";
import { CacheManager } from "./cache/CacheManager.js";
import { DiffManager } from "./diff/DiffManager.js";
import { ImportAnalyzer } from "./analysis/ImportAnalyzer.js";
import { ConfigManager } from "./config/ConfigManager.js";

class CodeReferenceOptimizerServer {
  private server: Server;
  private optimizer: CodeReferenceOptimizer;
  private configManager: ConfigManager;

  constructor() {
    this.server = new Server(
      {
        name: "code-reference-optimizer",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    // Initialize configuration manager
    this.configManager = new ConfigManager();

    // Initialize core components with configuration
    const astParser = new ASTParser();
    const cacheManager = new CacheManager(
      this.configManager.getOptimizationConfig(".ts"),
    );
    const diffManager = new DiffManager();
    const importAnalyzer = new ImportAnalyzer();

    this.optimizer = new CodeReferenceOptimizer(
      astParser,
      cacheManager,
      diffManager,
      importAnalyzer,
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "extract_code_context",
            description:
              "Extract minimal code context from files using AST parsing",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Path to the source file",
                },
                targetSymbols: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Specific symbols/functions to extract context for",
                },
                includeImports: {
                  type: "boolean",
                  description: "Whether to include relevant imports",
                  default: true,
                },
                maxTokens: {
                  type: "number",
                  description: "Maximum tokens to return",
                  default: 1000,
                },
              },
              required: ["filePath"],
            },
          },
          {
            name: "get_cached_context",
            description: "Retrieve cached code context for a file",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Path to the source file",
                },
                cacheKey: {
                  type: "string",
                  description: "Optional cache key for specific context",
                },
              },
              required: ["filePath"],
            },
          },
          {
            name: "monitor_cached",
            description: "Monitor cache statistics and top cached entries",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Optional file path to filter entries",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of entries to return",
                  default: 10,
                },
              },
            },
          },
          {
            name: "analyze_code_diff",
            description:
              "Analyze differences between code versions and provide minimal updates",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Path to the source file",
                },
                oldContent: {
                  type: "string",
                  description: "Previous version of the code",
                },
                newContent: {
                  type: "string",
                  description: "Current version of the code",
                },
              },
              required: ["filePath", "oldContent", "newContent"],
            },
          },
          {
            name: "optimize_imports",
            description:
              "Analyze and optimize import statements to reduce redundancy",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Path to the source file",
                },
                usedSymbols: {
                  type: "array",
                  items: { type: "string" },
                  description: "Symbols actually used in the context",
                },
              },
              required: ["filePath"],
            },
          },
          {
            name: "get_config",
            description: "Get current configuration settings",
            inputSchema: {
              type: "object",
              properties: {
                section: {
                  type: "string",
                  description:
                    "Specific configuration section to retrieve (optional)",
                  enum: [
                    "cache",
                    "extraction",
                    "imports",
                    "diff",
                    "performance",
                    "languages",
                    "logging",
                    "security",
                  ],
                },
              },
            },
          },
          {
            name: "update_config",
            description: "Update configuration settings",
            inputSchema: {
              type: "object",
              properties: {
                config: {
                  type: "object",
                  description: "Configuration updates to apply",
                },
              },
              required: ["config"],
            },
          },
          {
            name: "reset_config",
            description: "Reset configuration to default values",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "extract_code_context":
            return await this.handleExtractCodeContext(args);
          case "get_cached_context":
            return await this.handleGetCachedContext(args);
          case "monitor_cached":
            return await this.handleMonitorCached(args);
          case "analyze_code_diff":
            return await this.handleAnalyzeCodeDiff(args);
          case "optimize_imports":
            return await this.handleOptimizeImports(args);
          case "get_config":
            return await this.handleGetConfig(args);
          case "update_config":
            return await this.handleUpdateConfig(args);
          case "reset_config":
            return await this.handleResetConfig(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`,
            );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  private async handleExtractCodeContext(args: any) {
    const {
      filePath,
      targetSymbols,
      includeImports = true,
      maxTokens = 1000,
    } = args;

    const result = await this.optimizer.extractCodeContext({
      filePath,
      targetSymbols,
      includeImports,
      maxTokens,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleGetCachedContext(args: any) {
    const { filePath, cacheKey } = args;

    const result = await this.optimizer.getCachedContext(filePath, cacheKey);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleMonitorCached(args: any) {
    const { filePath, limit = 10 } = args || {};

    const result = await this.optimizer.monitorCached({ filePath, limit });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleAnalyzeCodeDiff(args: any) {
    const { filePath, oldContent, newContent } = args;

    const result = await this.optimizer.analyzeCodeDiff({
      filePath,
      oldContent,
      newContent,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleOptimizeImports(args: any) {
    const { filePath, usedSymbols } = args;

    const result = await this.optimizer.optimizeImports({
      filePath,
      usedSymbols,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleGetConfig(args: any) {
    const { section } = args;

    try {
      const config = this.configManager.getConfig();
      const result = section ? config[section as keyof typeof config] : config;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleUpdateConfig(args: any) {
    const { config } = args;

    if (!config) {
      throw new McpError(ErrorCode.InvalidParams, "config is required");
    }

    try {
      this.configManager.updateConfig(config);

      return {
        content: [
          {
            type: "text",
            text: "Configuration updated successfully",
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleResetConfig(_args: any) {
    try {
      this.configManager.resetToDefaults();

      return {
        content: [
          {
            type: "text",
            text: "Configuration reset to defaults successfully",
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to reset configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Code Reference Optimizer MCP server running on stdio");
  }
}

const server = new CodeReferenceOptimizerServer();
server.run().catch(console.error);
