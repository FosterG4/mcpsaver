# Code Reference Optimizer MCP Server

[![npm version](https://img.shields.io/npm/v/%40fosterg4%2Fmcpsaver.svg)](https://www.npmjs.com/package/@fosterg4/mcpsaver)
![node version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

An MCP (Model Context Protocol) server that extracts minimal, relevant code context, analyzes diffs, and optimizes imports to reduce token usage for AI assistants.

- Multi-language parsing (TypeScript/JavaScript, Python, Go, Rust)
- Token-aware caching and minimal diffs
- Simple stdio server, easy to integrate with MCP clients

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

## Available Tools (exact schemas)

These map 1:1 to the server in `src/index.ts`.

- `extract_code_context`
  - Input:
    ```json
    {
      "filePath": "path/to/file.ts",
      "targetSymbols": ["myFunc", "MyClass"],
      "includeImports": true,
      "maxTokens": 1000
    }
    ```
    Required: `filePath`. Optional: `targetSymbols`, `includeImports` (default true), `maxTokens` (default 1000).

- `get_cached_context`
  - Input:
    ```json
    { "filePath": "path/to/file.ts", "cacheKey": "optional-key" }
    ```
    Required: `filePath`. Optional: `cacheKey`.

- `analyze_code_diff`
  - Input:
    ```json
    {
      "filePath": "path/to/file.ts",
      "oldContent": "export function a() { return 1 }",
      "newContent": "export function a() { return 2 }"
    }
    ```

- `optimize_imports`
  - Input:
    ```json
    { "filePath": "path/to/file.ts", "usedSymbols": ["useEffect", "useMemo"] }
    ```

- `get_config`
  - Input (optional section):
    ```json
    { "section": "extraction" }
    ```
    Allowed sections: `cache`, `extraction`, `imports`, `diff`, `performance`, `languages`, `logging`, `security`.

- `update_config`
  - Input:
    ```json
    {
      "config": {
        "extraction": { "maxTokens": 2000 },
        "cache": { "maxEntries": 1000, "ttlMs": 3600000 }
      }
    }
    ```

- `reset_config`
  - No input.

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