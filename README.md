# Code Reference Optimizer MCP Server

[![npm version](https://img.shields.io/npm/v/%40fosterg4%2Fmcpsaver.svg)](https://www.npmjs.com/package/@fosterg4/mcpsaver)
![node version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

An advanced MCP (Model Context Protocol) server that intelligently extracts minimal, relevant code context using AST parsing, analyzes code differences, and optimizes imports to dramatically reduce token usage for AI assistants.

## Key Features

- **Smart Context Extraction**: Uses AST parsing to identify and extract only relevant code sections
- **Multi-language Support**: TypeScript/JavaScript, Python, Go, Rust, Java, C++, and more
- **Intelligent Caching**: LRU cache with configurable persistence and customizable storage paths
- **Token Optimization**: Filters unnecessary code while maintaining semantic completeness
- **Diff Analysis**: Provides minimal, focused code differences with semantic understanding
- **Import Optimization**: Eliminates unused imports and suggests consolidation opportunities
- **Configurable**: Runtime configuration via tools with persistent settings
- **Simple Integration**: stdio-based server, easy to integrate with any MCP client

## Quick Start

- One-off (recommended):
```bash
npx -y @fosterg4/mcpsaver
```
You should see: `Code Reference Optimizer MCP server running on stdio`.

- Global (optional):
```bash
npm i -g @fosterg4/mcpsaver
mcpsaver
```

## Use with an MCP client

Add to your MCP client config (example `mcpServers.json`):
```json
{
  "mcpServers": {
    "mcpsaver": {
      "command": "npx",
      "args": ["-y", "@fosterg4/mcpsaver"],
      "env": {}
    }
  }
}
```

## Available Tools

The server provides 7 powerful tools for code analysis and optimization:

### 🔍 `extract_code_context`
Extracts minimal, focused code context using AST parsing. Intelligently identifies relevant code sections, imports, and dependencies for specific symbols.

```json
{
  "filePath": "path/to/file.ts",
  "targetSymbols": ["myFunc", "MyClass"],
  "includeImports": true,
  "maxTokens": 1000
}
```
**Required**: `filePath` | **Optional**: `targetSymbols`, `includeImports`, `maxTokens`

### 💾 `get_cached_context`
Retrieves previously extracted and cached code context for fast access without re-parsing.

```json
{ "filePath": "path/to/file.ts", "cacheKey": "optional-key" }
```
**Required**: `filePath` | **Optional**: `cacheKey`

### 📊 `analyze_code_diff`
Performs intelligent analysis of code differences with semantic understanding and minimal update suggestions.

```json
{
  "filePath": "path/to/file.ts",
  "oldContent": "export function a() { return 1 }",
  "newContent": "export function a() { return 2 }"
}
```
**Required**: `filePath`, `oldContent`, `newContent`

### 🧹 `optimize_imports`
Analyzes and optimizes import statements to eliminate redundancy and improve code efficiency.

```json
{ "filePath": "path/to/file.ts", "usedSymbols": ["useEffect", "useMemo"] }
```
**Required**: `filePath` | **Optional**: `usedSymbols`

### ⚙️ `get_config`
Retrieves current configuration settings for cache behavior, extraction parameters, and more.

```json
{ "section": "cache" }
```
**Optional**: `section` (cache, extraction, imports, diff, performance, languages, logging, security)

### 🔧 `update_config`
Updates configuration settings including cache policies, token limits, and performance thresholds.

```json
{
  "config": {
    "cache": { "enablePersistence": true, "persistencePath": "/custom/cache/path" },
    "extraction": { "maxTokens": 2000 }
  }
}
```
**Required**: `config`

### 🔄 `reset_config`
Resets all configuration settings to default values.

```json
{}
```
**No parameters required**

Note: Tool results are returned as MCP content with a single `text` item containing JSON of the result, e.g.
```json
{
  "content": [{ "type": "text", "text": "{\n  \"...\": true\n}" }]
}
```

## Examples

See `docs/EXAMPLES.md` for end‑to‑end request examples of each tool.

## Configuration

- Call `get_config`, `update_config`, `reset_config` to manage runtime settings.
- You may also set environment variables via your MCP client if supported (e.g., `LOG_LEVEL`).

## Development

```bash
npm ci
npm run build
npm start     # run built server (stdio)
npm run dev   # tsc --watch
npm test
npm run lint
npm run type-check
```

## Publishing (maintainers)

```bash
npm login
npm run clean && npm run build
npm version patch
npm publish --access public
```

## License

MIT — see `LICENSE`.