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
Extract minimal code context from a file.

Input schema (from `src/index.ts`):
```json
{
  "filePath": "string",
  "targetSymbols": ["string"],
  "includeImports": true,
  "maxTokens": 1000
}
```
- Required: `filePath`
- Optional: `targetSymbols`, `includeImports` (default true), `maxTokens` (default 1000)

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
Return cached context for a file.

Input schema:
```json
{ "filePath": "string", "cacheKey": "string (optional)" }
```

### 3) analyze_code_diff
Analyze differences between two versions and provide minimal updates.

Input schema:
```json
{
  "filePath": "string",
  "oldContent": "string",
  "newContent": "string"
}
```
- Required: all three fields

### 4) optimize_imports
Analyze and optimize import statements.

Input schema:
```json
{ "filePath": "string", "usedSymbols": ["string"] }
```
- Required: `filePath`
- Optional: `usedSymbols`

### 5) get_config
Get current configuration or a specific section.

Input schema:
```json
{ "section": "cache|extraction|imports|diff|performance|languages|logging|security" }
```
- `section` optional; if omitted, returns full config

### 6) update_config
Update configuration with a partial object.

Input schema:
```json
{ "config": { /* partial config */ } }
```
- Required: `config`

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
Reset to default configuration.

Input schema:
```json
{}
```

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