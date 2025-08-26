import { TreeSitterParser } from '../src/parsers/tree_sitter/Parser.js';

async function main() {
  process.env.TREE_SITTER_LOCAL_DIR = process.env.TREE_SITTER_LOCAL_DIR || 'D:/project/tree-sitter';

  const parser = new TreeSitterParser();
  const { root } = await parser.parse('function x(a){ return a + 1 }', 'javascript');
  console.log('Root type:', root.type);
  console.log('Child count:', root.childCount);
}

main().catch((e) => {
  console.error('Smoke test failed:', e);
  process.exit(1);
});
