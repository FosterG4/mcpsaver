# Code Reference Optimizer MCP Server — Examples

Practical tool call examples aligned with the implemented schemas.

## 1) Extract code context
```json
{
  "method": "tools/call",
  "params": {
    "name": "extract_code_context",
    "arguments": {
      "filePath": "src/utils/date.ts",
      "targetSymbols": ["formatDate"],
      "includeImports": true,
      "maxTokens": 600
    }
  }
}
```

## 2) Get cached context
```json
{
  "method": "tools/call",
  "params": {
    "name": "get_cached_context",
    "arguments": {
      "filePath": "src/utils/date.ts",
      "cacheKey": "optional-key"
    }
  }
}
```

## 3) Analyze code diff
```json
{
  "method": "tools/call",
  "params": {
    "name": "analyze_code_diff",
    "arguments": {
      "filePath": "src/utils/calc.ts",
      "oldContent": "export function sum(a:number,b:number){return a+b}",
      "newContent": "export function sum(a:number,b:number){return a + b}"
    }
  }
}
```

## 4) Optimize imports
```json
{
  "method": "tools/call",
  "params": {
    "name": "optimize_imports",
    "arguments": {
      "filePath": "src/components/App.tsx",
      "usedSymbols": ["useEffect", "useMemo"]
    }
  }
}
```

## 5) Configuration management
- Get full config
```json
{ "method": "tools/call", "params": { "name": "get_config", "arguments": {} } }
```

- Get a section
```json
{ "method": "tools/call", "params": { "name": "get_config", "arguments": { "section": "extraction" } } }
```

- Update config
```json
{
  "method": "tools/call",
  "params": {
    "name": "update_config",
    "arguments": {
      "config": {
        "extraction": { "maxTokens": 1200 },
        "cache": { "maxEntries": 2000, "ttlMs": 3600000 }
      }
    }
  }
}
```

- Reset config
```json
{ "method": "tools/call", "params": { "name": "reset_config", "arguments": {} } }
```

## 6) MCP client configuration
Use `npx` with the scoped package:
```json
{
  "mcpServers": {
    "mcpsaver": {
      "command": "npx",
      "args": ["-y", "@fosterg4/mcpsaver"],
      "env": { "LOG_LEVEL": "info" }
    }
  }
}
```

Notes:
- Each tool returns JSON as a string in `content[0].text`.
- File paths must be accessible to the server process.
- See `README.md` and `docs/API.md` for more details.