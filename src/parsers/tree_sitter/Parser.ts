import * as fs from "fs/promises";
import * as path from "path";
import Parser from "tree-sitter";
import type { Language as TSLanguage, Tree, SyntaxNode } from "tree-sitter";
import { loadLocalLanguage } from "./LocalLanguageLoader.js";

export type SupportedLanguageKey =
  | "javascript"
  | "typescript"
  | "tsx"
  | "json"
  | "python"
  | "go"
  | "rust"
  | "cpp"
  | "c"
  | "csharp"
  | "java"
  | "html"
  | "css"
  | "bash"
  | "php"
  | "ruby"
  | "swift"
  | "toml"
  | "regex"
  | "scala"
  | "haskell"
  | "ocaml"
  | "ql"
  | "julia";

export interface ParseResult {
  tree: Tree;
  root: SyntaxNode;
  language: string;
}

export class TreeSitterParser {
  private parser: Parser;
  private loadedLangs = new Map<string, TSLanguage>();

  constructor() {
    this.parser = new Parser();
  }

  async ensureLanguage(langKey: SupportedLanguageKey): Promise<TSLanguage> {
    const key = langKey.toLowerCase();
    const cached = this.loadedLangs.get(key);
    if (cached) return cached;

    const lang = await loadLocalLanguage(key);
    this.loadedLangs.set(key, lang);
    return lang;
  }

  async parse(
    source: string,
    langKey: SupportedLanguageKey,
  ): Promise<ParseResult> {
    const lang = await this.ensureLanguage(langKey);
    this.parser.setLanguage(lang);
    const tree = this.parser.parse(source);
    return { tree, root: tree.rootNode, language: langKey };
  }

  async parseFile(
    filePath: string,
    langKey?: SupportedLanguageKey,
  ): Promise<ParseResult> {
    const content = await fs.readFile(filePath, "utf-8");
    const key = langKey ?? this.detectLanguageFromPath(filePath);
    return this.parse(content, key);
  }

  detectLanguageFromPath(filePath: string): SupportedLanguageKey {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case ".ts":
        return "typescript";
      case ".tsx":
        return "tsx";
      case ".js":
      case ".mjs":
      case ".cjs":
      case ".jsx":
        return "javascript";
      case ".json":
        return "json";
      case ".py":
        return "python";
      case ".go":
        return "go";
      case ".rs":
        return "rust";
      case ".c":
        return "c";
      case ".cc":
      case ".cpp":
      case ".cxx":
      case ".hpp":
      case ".hh":
        return "cpp";
      case ".cs":
        return "csharp";
      case ".java":
        return "java";
      case ".html":
      case ".htm":
        return "html";
      case ".css":
        return "css";
      case ".sh":
        return "bash";
      case ".php":
        return "php";
      case ".rb":
        return "ruby";
      case ".swift":
        return "swift";
      case ".toml":
        return "toml";
      case ".re":
      case ".regex":
        return "regex";
      case ".scala":
        return "scala";
      case ".hs":
        return "haskell";
      case ".ml":
      case ".mli":
        return "ocaml";
      case ".ql":
        return "ql";
      case ".jl":
        return "julia";
      default:
        throw new Error(`Unsupported or undetected extension: ${ext}`);
    }
  }
}
