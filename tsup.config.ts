import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  platform: 'node',
  target: 'node18',
  splitting: false,
  sourcemap: true,
  minify: true,
  dts: true,
  clean: true,
  // Keep native deps and grammars external (resolved at runtime)
  external: [
    'tree-sitter',
    'tree-sitter-javascript',
    'tree-sitter-typescript',
    'tree-sitter-json',
    '@fosterg4/tree-sitter-javascript-mcpsaver',
    '@fosterg4/tree-sitter-typescript-mcpsaver',
    '@fosterg4/tree-sitter-json-mcpsaver',
  ],
  // Force-bundle these so we get a single-file output for the CLI
  noExternal: ['@modelcontextprotocol/sdk', 'fast-diff', 'lru-cache'],
});
