# Code Reference Optimizer MCP Server — API

This server exposes MCP tools for extracting minimal code context, diff analysis, import optimization, and runtime configuration.

Transport: stdio via `mcpsaver` (CLI) or `npx -y @fosterg4/mcpsaver`.
Responses are MCP `content` arrays with a single `text` item containing JSON of the result.

Example envelope:
```json
{
  "content": [{ "type": "text", "text": "{\n  \"success\": true\n}" }]
}
```

## Tools

### 1) extract_code_context
Extract minimal, focused code context from source files using AST parsing. Intelligently identifies and extracts only the relevant code sections, imports, and dependencies needed for understanding specific symbols or functions. Optimizes token usage by filtering out unnecessary code while maintaining semantic completeness.

Input schema:
```json
{
  "filePath": "string",
  "targetSymbols": ["string"],
  "includeImports": true,
  "maxTokens": 1000
}
```
- **filePath** (required): Absolute or relative path to the source file to analyze. Supports TypeScript, JavaScript, Python, Go, and other languages with tree-sitter parsers.
- **targetSymbols** (optional): Array of specific symbol names (functions, classes, variables, types) to extract context for. If empty or omitted, extracts context for the entire file.
- **includeImports** (optional, default true): Whether to include import statements and dependencies relevant to the extracted symbols. Recommended for understanding symbol usage.
- **maxTokens** (optional, default 1000): Maximum number of tokens to include in the response. Higher values provide more context but consume more resources. Range: 100-5000.

Example request (MCP):
```json
{
  "method": "tools/call",
  "params": {
    "name": "extract_code_context",
    "arguments": {
      "filePath": "src/utils.ts",
      "targetSymbols": ["formatDate"],
      "includeImports": true,
      "maxTokens": 800
    }
  }
}
```

### 2) get_cached_context
Retrieve previously extracted and cached code context for a file. Provides fast access to analyzed code structures without re-parsing. Useful for repeated queries on the same file or when working with large codebases where re-analysis would be expensive.

Input schema:
```json
{ "filePath": "string", "cacheKey": "string (optional)" }
```
- **filePath** (required): Path to the source file for which to retrieve cached context. Must match the path used in previous extract_code_context calls.
- **cacheKey** (optional): Optional specific cache key to retrieve a particular cached analysis. If omitted, returns the most recent cached context for the file.

### 3) analyze_code_diff
Perform intelligent analysis of code differences between two versions of a file. Identifies semantic changes, structural modifications, and provides minimal update suggestions. Helps understand the impact of changes and suggests optimizations for code evolution.

Input schema:
```json
{
  "filePath": "string",
  "oldContent": "string",
  "newContent": "string"
}
```
- **filePath** (required): Path to the source file being analyzed. Used for context and language detection.
- **oldContent** (required): Complete content of the previous version of the file. Should be the full file content, not just a snippet.
- **newContent** (required): Complete content of the current version of the file. Should be the full file content, not just a snippet.

### 4) optimize_imports
Analyze and optimize import statements to eliminate redundancy and improve code efficiency. Identifies unused imports, suggests consolidation opportunities, and ensures only necessary dependencies are included. Helps reduce bundle size and improve compilation performance.

Input schema:
```json
{ "filePath": "string", "usedSymbols": ["string"] }
```
- **filePath** (required): Path to the source file containing import statements to optimize. File must exist and be readable.
- **usedSymbols** (optional): Array of symbol names that are actually used in the code. If provided, helps identify unused imports more accurately.

### 5) get_config
Retrieve current configuration settings for the Code Reference Optimizer. Access global settings or specific configuration sections including cache behavior, extraction parameters, import analysis rules, diff analysis options, performance tuning, language-specific settings, logging configuration, and security policies.

Input schema:
```json
{ "section": "cache|extraction|imports|diff|performance|languages|logging|security" }
```
- **section** (optional): Specific configuration section to retrieve. Options: cache (caching behavior), extraction (code analysis settings), imports (import optimization rules), diff (difference analysis), performance (resource limits), languages (language-specific settings), logging (debug output), security (access controls). If omitted, returns full config.

### 6) update_config
Update configuration settings with new values. Allows fine-tuning of the optimizer behavior including cache policies, token limits, analysis depth, performance thresholds, and feature toggles. Changes are applied immediately and persist for the current session.

Input schema:
```json
{ "config": { /* partial config */ } }
```
- **config** (required): Partial configuration object with updates to apply. Can include any combination of configuration sections. Changes are merged with existing settings, not replaced entirely.

Example:
```json
{
  "method": "tools/call",
  "params": {
    "name": "update_config",
    "arguments": {
      "config": {
        "extraction": { "maxTokens": 2000 },
        "cache": { "maxEntries": 1000, "ttlMs": 3600000 }
      }
    }
  }
}
```

### 7) reset_config
Reset all configuration settings to their default values. Useful for troubleshooting configuration issues or returning to optimal baseline settings. This action cannot be undone and will clear all custom configuration modifications.

Input schema:
```json
{}
```
- No parameters required. This operation affects all configuration sections.

## Errors
Errors are returned as MCP errors (per `@modelcontextprotocol/sdk`). When successful, tool handlers return a JSON string in `content[0].text`.

## Integration
Minimal Claude Desktop config:
```json
{
  "mcpServers": {
    "mcpsaver": { "command": "npx", "args": ["-y", "@fosterg4/mcpsaver"], "env": { "LOG_LEVEL": "info" } }
  }
}