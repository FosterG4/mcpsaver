#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListRootsRequestSchema,
  CreateMessageRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { CodeReferenceOptimizer } from './core/CodeReferenceOptimizer.js';
import { ASTParser } from './parsers/ASTParser.js';
import { CacheManager } from './cache/CacheManager.js';
import { DiffManager } from './diff/DiffManager.js';
import { ImportAnalyzer } from './analysis/ImportAnalyzer.js';
import { ConfigManager } from './config/ConfigManager.js';
import { Logger } from './utils/Logger.js';

export class CodeReferenceOptimizerServer {
  private server: Server;
  private optimizer: CodeReferenceOptimizer;
  private configManager: ConfigManager;
  private logger: Logger;

  constructor() {
    this.server = new Server(
      {
        name: 'code-reference-optimizer',
        version: '1.2.3',
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
            notifyChanged: true,
          },
          prompts: {
            listChanged: true,
            notifyChanged: true,
          },
          resources: {
            listChanged: true,
            notifyChanged: true,
          },
          sampling: {
            listChanged: true,
            notifyChanged: true,
          },
          roots: {
            listChanged: true,
            notifyChanged: true,
          },
        },
      }
    );

    // Initialize configuration manager
    this.configManager = new ConfigManager();
    // Initialize logger using config
    const logConfig = this.configManager.getConfig().logging;
    this.logger = new Logger({ level: logConfig.level, toFile: logConfig.enableFileLogging, filePath: logConfig.logPath });
    
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
    this.setupPromptHandlers();
    this.setupResourceHandlers();
    this.setupRootsHandlers();
    this.setupSamplingHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.debug('ListTools requested');
      return {
        tools: [
          {
            name: 'extract_code_context',
            description: 'Extract minimal, focused code context from source files using AST parsing. Intelligently identifies and extracts only the relevant code sections, imports, and dependencies needed for understanding specific symbols or functions. Optimizes token usage by filtering out unnecessary code while maintaining semantic completeness.',
            inputSchema: JSON.stringify({
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
            }),
          },
          {
            name: 'get_cached_context',
            description: 'Retrieve previously extracted and cached code context for a file. Provides fast access to analyzed code structures without re-parsing. Useful for repeated queries on the same file or when working with large codebases where re-analysis would be expensive.',
            inputSchema: JSON.stringify({
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
            }),
          },
          {
            name: 'analyze_code_diff',
            description: 'Perform intelligent analysis of code differences between two versions of a file. Identifies semantic changes, structural modifications, and provides minimal update suggestions. Helps understand the impact of changes and suggests optimizations for code evolution.',
            inputSchema: JSON.stringify({
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
            }),
          },
          {
            name: 'optimize_imports',
            description: 'Analyze and optimize import statements to eliminate redundancy and improve code efficiency. Identifies unused imports, suggests consolidation opportunities, and ensures only necessary dependencies are included. Helps reduce bundle size and improve compilation performance.',
            inputSchema: JSON.stringify({
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
            }),
          },
          {
            name: 'get_config',
            description: 'Retrieve current configuration settings for the Code Reference Optimizer. Access global settings or specific configuration sections including cache behavior, extraction parameters, import analysis rules, diff analysis options, performance tuning, language-specific settings, logging configuration, and security policies.',
            inputSchema: JSON.stringify({
              type: 'object',
              properties: {
                section: {
                  type: 'string',
                  description: 'Specific configuration section to retrieve. Options: cache (caching behavior), extraction (code analysis settings), imports (import optimization rules), diff (difference analysis), performance (resource limits), languages (language-specific settings), logging (debug output), security (access controls).',
                  enum: ['cache', 'extraction', 'imports', 'diff', 'performance', 'languages', 'logging', 'security'],
                },
              },
            }),
          },
          {
            name: 'update_config',
            description: 'Update configuration settings with new values. Allows fine-tuning of the optimizer behavior including cache policies, token limits, analysis depth, performance thresholds, and feature toggles. Changes are applied immediately and persist for the current session.',
            inputSchema: JSON.stringify({
              type: 'object',
              properties: {
                config: {
                  type: 'object',
                  description: 'Partial configuration object with updates to apply. Can include any combination of configuration sections. Changes are merged with existing settings, not replaced entirely.',
                },
              },
              required: ['config'],
            }),
          },
          {
            name: 'reset_config',
            description: 'Reset all configuration settings to their default values. Useful for troubleshooting configuration issues or returning to optimal baseline settings. This action cannot be undone and will clear all custom configuration modifications.',
            inputSchema: JSON.stringify({
              type: 'object',
              properties: {},
            }),
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
        this.logger.error(`Tool error for ${name}: ${error instanceof Error ? error.message : String(error)}`);
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private setupPromptHandlers(): void {
    // Advertise empty prompt set; extend later
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      this.logger.debug('ListPrompts requested');
      return { prompts: [] };
    });
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name } = request.params;
      this.logger.debug(`GetPrompt requested for ${name}`);
      throw new McpError(ErrorCode.MethodNotFound, `Prompt not found: ${name}`);
    });
  }

  private setupResourceHandlers(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      this.logger.debug('ListResources requested');
      return { resources: [] };
    });
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      this.logger.debug(`ReadResource requested for ${uri}`);
      throw new McpError(ErrorCode.MethodNotFound, `Resource not available: ${uri}`);
    });
  }

  private setupRootsHandlers(): void {
    this.server.setRequestHandler(ListRootsRequestSchema, async () => {
      this.logger.debug('ListRoots requested');
      // Provide current working directory as a single root by default
      const cwd = process.cwd();
      return { roots: [{ uri: `file://${cwd.replace(/\\/g, '/')}`, name: 'workspace' }] };
    });
  }

  private setupSamplingHandlers(): void {
    // Stub sampling: return not implemented to be explicit
    this.server.setRequestHandler(CreateMessageRequestSchema, async () => {
      this.logger.debug('Sampling requested');
      throw new McpError(ErrorCode.MethodNotFound, 'Sampling is not implemented yet');
    });
  }

  private async handleExtractCodeContext(args: any) {
    const { filePath, targetSymbols, includeImports = true, maxTokens = 1000 } = args;
    
    this.logger.info(`extract_code_context: filePath=${filePath}`);
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
    
    this.logger.info(`get_cached_context: filePath=${filePath} cacheKey=${cacheKey ?? ''}`);
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
    
    this.logger.info(`analyze_code_diff: filePath=${filePath}`);
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
    
    this.logger.info(`optimize_imports: filePath=${filePath}`);
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
      this.logger.debug(`get_config: section=${section ?? 'all'}`);
      const config = this.configManager.getConfig();
      const result = section ? config[section as keyof typeof config] : config;
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (error) {
      this.logger.error(`get_config failed: ${error instanceof Error ? error.message : String(error)}`);
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
      // Refresh logger configuration when logging section changes
      if (config.logging) {
        const logCfg = this.configManager.getConfig().logging;
        this.logger.updateConfig({ level: logCfg.level, toFile: logCfg.enableFileLogging, filePath: logCfg.logPath });
      }
      
      return {
        content: [{
          type: 'text',
          text: 'Configuration updated successfully',
        }],
      };
    } catch (error) {
      this.logger.error(`update_config failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new McpError(ErrorCode.InternalError, `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleResetConfig(_args: any) {
    try {
      this.configManager.resetToDefaults();
      const logCfg = this.configManager.getConfig().logging;
      this.logger.updateConfig({ level: logCfg.level, toFile: logCfg.enableFileLogging, filePath: logCfg.logPath });
      
      return {
        content: [{
          type: 'text',
          text: 'Configuration reset to defaults successfully',
        }],
      };
    } catch (error) {
      this.logger.error(`reset_config failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new McpError(ErrorCode.InternalError, `Failed to reset configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('Code Reference Optimizer MCP server running on stdio');
  }

  async runHttp(port: number = Number(process.env.PORT) || 8081): Promise<void> {
    // Create Streamable HTTP transport and connect server
    const transport = new StreamableHTTPServerTransport({
      // Stateless mode: no session management enforced
      sessionIdGenerator: undefined,
      // default options; can enable JSON responses if desired
      enableJsonResponse: false,
    });
    await this.server.connect(transport);

    // Lazy-load express to avoid a hard type dependency
    const expressMod: any = await import('express');
    const app = expressMod.default();

    // Optionally accept JSON body for POST (transport can also parse raw body)
    app.use(expressMod.json({ type: 'application/json' }));

    // Helper: parse base64-encoded JSON from ?config and apply to ConfigManager
    const applySessionConfig = (req: any) => {
      try {
        const url = new URL(req.protocol + '://' + req.get('host') + req.originalUrl);
        const cfgParam = url.searchParams.get('config');
        if (!cfgParam) return;
        const decoded = Buffer.from(cfgParam, 'base64').toString('utf-8');
        const sessionCfg = JSON.parse(decoded);
        if (sessionCfg && typeof sessionCfg === 'object') {
          this.configManager.updateConfig(sessionCfg);
          // Sync logger config after updates
          const logCfg = this.configManager.getConfig().logging;
          this.logger.updateConfig({ level: logCfg.level, toFile: logCfg.enableFileLogging, filePath: logCfg.logPath });
        }
      } catch (e) {
        this.logger.warn?.(`Failed to apply session config: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    // Wire MCP endpoint (GET for SSE, POST for JSON-RPC messages, DELETE to close session)
    app.get('/mcp', (req: any, res: any) => {
      applySessionConfig(req);
      return transport.handleRequest(req, res);
    });
    app.post('/mcp', (req: any, res: any) => {
      applySessionConfig(req);
      return transport.handleRequest(req, res, req.body);
    });
    app.delete('/mcp', (req: any, res: any) => {
      applySessionConfig(req);
      return transport.handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      app.listen(port, () => resolve());
    });
    this.logger.info(`Code Reference Optimizer MCP server running on http://localhost:${port}/mcp`);
  }
}

export default CodeReferenceOptimizerServer;