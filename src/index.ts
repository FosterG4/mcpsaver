#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { CodeReferenceOptimizer } from './core/CodeReferenceOptimizer.js';
import { ASTParser } from './parsers/ASTParser.js';
import { CacheManager } from './cache/CacheManager.js';
import { DiffManager } from './diff/DiffManager.js';
import { ImportAnalyzer } from './analysis/ImportAnalyzer.js';
import { ConfigManager } from './config/ConfigManager.js';

class CodeReferenceOptimizerServer {
  private server: Server;
  private optimizer: CodeReferenceOptimizer;
  private configManager: ConfigManager;

  constructor() {
    this.server = new Server(
      {
        name: 'code-reference-optimizer',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize configuration manager
    this.configManager = new ConfigManager();
    
    // Initialize core components with configuration
    const astParser = new ASTParser();
    const cacheManager = new CacheManager(this.configManager.getOptimizationConfig('.ts'));
    const diffManager = new DiffManager();
    const importAnalyzer = new ImportAnalyzer();
    
    this.optimizer = new CodeReferenceOptimizer(
      astParser,
      cacheManager,
      diffManager,
      importAnalyzer
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'extract_code_context',
            description: 'Extract minimal, focused code context from source files using AST parsing. Intelligently identifies and extracts only the relevant code sections, imports, and dependencies needed for understanding specific symbols or functions. Optimizes token usage by filtering out unnecessary code while maintaining semantic completeness.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Absolute or relative path to the source file to analyze. Supports TypeScript, JavaScript, Python, Go, and other languages with tree-sitter parsers.',
                },
                targetSymbols: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of specific symbol names (functions, classes, variables, types) to extract context for. If empty or omitted, extracts context for the entire file.',
                },
                includeImports: {
                  type: 'boolean',
                  description: 'Whether to include import statements and dependencies relevant to the extracted symbols. Recommended for understanding symbol usage.',
                  default: true,
                },
                maxTokens: {
                  type: 'number',
                  description: 'Maximum number of tokens to include in the response. Higher values provide more context but consume more resources. Range: 100-5000.',
                  default: 1000,
                },
              },
              required: ['filePath'],
            },
          },
          {
            name: 'get_cached_context',
            description: 'Retrieve previously extracted and cached code context for a file. Provides fast access to analyzed code structures without re-parsing. Useful for repeated queries on the same file or when working with large codebases where re-analysis would be expensive.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Path to the source file for which to retrieve cached context. Must match the path used in previous extract_code_context calls.',
                },
                cacheKey: {
                  type: 'string',
                  description: 'Optional specific cache key to retrieve a particular cached analysis. If omitted, returns the most recent cached context for the file.',
                },
              },
              required: ['filePath'],
            },
          },
          {
            name: 'analyze_code_diff',
            description: 'Perform intelligent analysis of code differences between two versions of a file. Identifies semantic changes, structural modifications, and provides minimal update suggestions. Helps understand the impact of changes and suggests optimizations for code evolution.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Path to the source file being analyzed. Used for context and language detection.',
                },
                oldContent: {
                  type: 'string',
                  description: 'Complete content of the previous version of the file. Should be the full file content, not just a snippet.',
                },
                newContent: {
                  type: 'string',
                  description: 'Complete content of the current version of the file. Should be the full file content, not just a snippet.',
                },
              },
              required: ['filePath', 'oldContent', 'newContent'],
            },
          },
          {
            name: 'optimize_imports',
            description: 'Analyze and optimize import statements to eliminate redundancy and improve code efficiency. Identifies unused imports, suggests consolidation opportunities, and ensures only necessary dependencies are included. Helps reduce bundle size and improve compilation performance.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Path to the source file containing import statements to optimize. File must exist and be readable.',
                },
                usedSymbols: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of symbol names that are actually used in the code. If provided, helps identify unused imports more accurately.',
                },
              },
              required: ['filePath'],
            },
          },
          {
            name: 'get_config',
            description: 'Retrieve current configuration settings for the Code Reference Optimizer. Access global settings or specific configuration sections including cache behavior, extraction parameters, import analysis rules, diff analysis options, performance tuning, language-specific settings, logging configuration, and security policies.',
            inputSchema: {
              type: 'object',
              properties: {
                section: {
                  type: 'string',
                  description: 'Specific configuration section to retrieve. Options: cache (caching behavior), extraction (code analysis settings), imports (import optimization rules), diff (difference analysis), performance (resource limits), languages (language-specific settings), logging (debug output), security (access controls).',
                  enum: ['cache', 'extraction', 'imports', 'diff', 'performance', 'languages', 'logging', 'security'],
                },
              },
            },
          },
          {
            name: 'update_config',
            description: 'Update configuration settings with new values. Allows fine-tuning of the optimizer behavior including cache policies, token limits, analysis depth, performance thresholds, and feature toggles. Changes are applied immediately and persist for the current session.',
            inputSchema: {
              type: 'object',
              properties: {
                config: {
                  type: 'object',
                  description: 'Partial configuration object with updates to apply. Can include any combination of configuration sections. Changes are merged with existing settings, not replaced entirely.',
                },
              },
              required: ['config'],
            },
          },
          {
            name: 'reset_config',
            description: 'Reset all configuration settings to their default values. Useful for troubleshooting configuration issues or returning to optimal baseline settings. This action cannot be undone and will clear all custom configuration modifications.',
            inputSchema: {
              type: 'object',
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
          case 'extract_code_context':
            return await this.handleExtractCodeContext(args);
          case 'get_cached_context':
            return await this.handleGetCachedContext(args);
          case 'analyze_code_diff':
            return await this.handleAnalyzeCodeDiff(args);
          case 'optimize_imports':
            return await this.handleOptimizeImports(args);
          case 'get_config':
            return await this.handleGetConfig(args);
          case 'update_config':
            return await this.handleUpdateConfig(args);
          case 'reset_config':
            return await this.handleResetConfig(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private async handleExtractCodeContext(args: any) {
    const { filePath, targetSymbols, includeImports = true, maxTokens = 1000 } = args;
    
    const result = await this.optimizer.extractCodeContext({
      filePath,
      targetSymbols,
      includeImports,
      maxTokens,
    });

    return {
      content: [
        {
          type: 'text',
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
          type: 'text',
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
          type: 'text',
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
          type: 'text',
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
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleUpdateConfig(args: any) {
    const { config } = args;
    
    if (!config) {
      throw new McpError(ErrorCode.InvalidParams, 'config is required');
    }
    
    try {
      this.configManager.updateConfig(config);
      
      return {
        content: [{
          type: 'text',
          text: 'Configuration updated successfully',
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleResetConfig(_args: any) {
    try {
      this.configManager.resetToDefaults();
      
      return {
        content: [{
          type: 'text',
          text: 'Configuration reset to defaults successfully',
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to reset configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Code Reference Optimizer MCP server running on stdio');
  }
}

const server = new CodeReferenceOptimizerServer();
server.run().catch(console.error);