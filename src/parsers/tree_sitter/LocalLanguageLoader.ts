import * as fs from "fs/promises";
import * as path from "path";
import Parser from "tree-sitter";
import { createRequire } from "module";
import { fileURLToPath } from "url";

// Cache to avoid reloading languages
const languageCache = new Map<string, Parser.Language>();

// Base directory for vendored grammars inside this package (published)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VENDOR_BASE = path.resolve(__dirname, "../../../vendor/grammars");

// Base directory for local grammars (developer machine). Override with env TREE_SITTER_LOCAL_DIR
const BASE_DIR = process.env.TREE_SITTER_LOCAL_DIR || "D:/project/tree-sitter";
// If set to '1' or 'true', do not attempt npm package fallbacks
const LOCAL_ONLY =
  (process.env.TREE_SITTER_LOCAL_ONLY || "").toLowerCase() === "1" ||
  (process.env.TREE_SITTER_LOCAL_ONLY || "").toLowerCase() === "true";

// Map language keys to repo folder(s) to try. We import the package directory
// which resolves via its package.json (usually to bindings/node), which in turn
// loads the correct native binding (e.g., *_binding.node).
const languageMap: Record<
  string,
  { repo: string; pkg?: string | string[]; subkey?: string }[]
> = {
  javascript: [
    {
      repo: "tree-sitter-javascript",
      pkg: [
        "@fosterg4/tree-sitter-javascript-mcpsaver",
        "@fosterg4/tree-sitter-javascript",
        "tree-sitter-javascript",
      ],
    },
  ],
  typescript: [
    {
      repo: "tree-sitter-typescript/typescript",
      pkg: [
        "@fosterg4/tree-sitter-typescript-mcpsaver",
        "@fosterg4/tree-sitter-typescript",
        "tree-sitter-typescript",
      ],
      subkey: "typescript",
    },
  ],
  tsx: [
    {
      repo: "tree-sitter-typescript/tsx",
      pkg: [
        "@fosterg4/tree-sitter-typescript-mcpsaver",
        "@fosterg4/tree-sitter-typescript",
        "tree-sitter-typescript",
      ],
      subkey: "tsx",
    },
  ],
  // Prefer custom mcpsaver JSON grammar name first, then fall back
  json: [
    {
      repo: "tree-sitter-json",
      pkg: [
        "@fosterg4/tree-sitter-json-mcpsaver",
        "@fosterg4/tree-sitter-json",
        "tree-sitter-json",
      ],
    },
  ],
  python: [
    {
      repo: "tree-sitter-python",
      pkg: [
        "@fosterg4/tree-sitter-python-mcpsaver",
        "@fosterg4/tree-sitter-python",
        "tree-sitter-python",
      ],
    },
  ],
  go: [
    {
      repo: "tree-sitter-go",
      pkg: [
        "@fosterg4/tree-sitter-go-mcpsaver",
        "@fosterg4/tree-sitter-go",
        "tree-sitter-go",
      ],
    },
  ],
  rust: [
    {
      repo: "tree-sitter-rust",
      pkg: [
        "@fosterg4/tree-sitter-rust-mcpsaver",
        "@fosterg4/tree-sitter-rust",
        "tree-sitter-rust",
      ],
    },
  ],
  cpp: [
    {
      repo: "tree-sitter-cpp",
      pkg: [
        "@fosterg4/tree-sitter-cpp-mcpsaver",
        "@fosterg4/tree-sitter-cpp",
        "tree-sitter-cpp",
      ],
    },
  ],
  c: [
    {
      repo: "tree-sitter-c",
      pkg: [
        "@fosterg4/tree-sitter-c-mcpsaver",
        "@fosterg4/tree-sitter-c",
        "tree-sitter-c",
      ],
    },
  ],
  csharp: [
    {
      repo: "tree-sitter-c-sharp",
      pkg: [
        "@fosterg4/tree-sitter-c-sharp-mcpsaver",
        "@fosterg4/tree-sitter-c-sharp",
        "tree-sitter-c-sharp",
      ],
    },
  ],
  java: [
    {
      repo: "tree-sitter-java",
      pkg: [
        "@fosterg4/tree-sitter-java-mcpsaver",
        "@fosterg4/tree-sitter-java",
        "tree-sitter-java",
      ],
    },
  ],
  html: [
    {
      repo: "tree-sitter-html",
      pkg: [
        "@fosterg4/tree-sitter-html-mcpsaver",
        "@fosterg4/tree-sitter-html",
        "tree-sitter-html",
      ],
    },
  ],
  css: [
    {
      repo: "tree-sitter-css",
      pkg: [
        "@fosterg4/tree-sitter-css-mcpsaver",
        "@fosterg4/tree-sitter-css",
        "tree-sitter-css",
      ],
    },
  ],
  bash: [
    {
      repo: "tree-sitter-bash",
      pkg: [
        "@fosterg4/tree-sitter-bash-mcpsaver",
        "@fosterg4/tree-sitter-bash",
        "tree-sitter-bash",
      ],
    },
  ],
  php: [
    {
      repo: "tree-sitter-php",
      pkg: [
        "@fosterg4/tree-sitter-php-mcpsaver",
        "@fosterg4/tree-sitter-php",
        "tree-sitter-php",
      ],
    },
  ],
  ruby: [
    {
      repo: "tree-sitter-ruby",
      pkg: [
        "@fosterg4/tree-sitter-ruby-mcpsaver",
        "@fosterg4/tree-sitter-ruby",
        "tree-sitter-ruby",
      ],
    },
  ],
  swift: [
    {
      repo: "tree-sitter-swift",
      pkg: [
        "@fosterg4/tree-sitter-swift-mcpsaver",
        "@fosterg4/tree-sitter-swift",
        "tree-sitter-swift",
      ],
    },
  ],
  toml: [
    {
      repo: "tree-sitter-toml",
      pkg: [
        "@fosterg4/tree-sitter-toml-mcpsaver",
        "@fosterg4/tree-sitter-toml",
        "tree-sitter-toml",
      ],
    },
  ],
  regex: [
    {
      repo: "tree-sitter-regex",
      pkg: [
        "@fosterg4/tree-sitter-regex-mcpsaver",
        "@fosterg4/tree-sitter-regex",
        "tree-sitter-regex",
      ],
    },
  ],
  scala: [
    {
      repo: "tree-sitter-scala",
      pkg: [
        "@fosterg4/tree-sitter-scala-mcpsaver",
        "@fosterg4/tree-sitter-scala",
        "tree-sitter-scala",
      ],
    },
  ],
  haskell: [
    {
      repo: "tree-sitter-haskell",
      pkg: [
        "@fosterg4/tree-sitter-haskell-mcpsaver",
        "@fosterg4/tree-sitter-haskell",
        "tree-sitter-haskell",
      ],
    },
  ],
  ocaml: [
    {
      repo: "tree-sitter-ocaml",
      pkg: [
        "@fosterg4/tree-sitter-ocaml-mcpsaver",
        "@fosterg4/tree-sitter-ocaml",
        "tree-sitter-ocaml",
      ],
    },
  ],
  ql: [
    {
      repo: "tree-sitter-ql",
      pkg: [
        "@fosterg4/tree-sitter-ql-mcpsaver",
        "@fosterg4/tree-sitter-ql",
        "tree-sitter-ql",
      ],
    },
  ],
  julia: [
    {
      repo: "tree-sitter-julia",
      pkg: [
        "@fosterg4/tree-sitter-julia-mcpsaver",
        "@fosterg4/tree-sitter-julia",
        "tree-sitter-julia",
      ],
    },
  ],
};

export async function loadLocalLanguage(key: string): Promise<Parser.Language> {
  const normalized = key.toLowerCase();
  if (languageCache.has(normalized)) return languageCache.get(normalized)!;

  const entries = languageMap[normalized];
  if (!entries || entries.length === 0) {
    throw new Error(`No local Tree-sitter mapping found for language: ${key}`);
  }

  const errors: string[] = [];
  for (const { repo, pkg, subkey } of entries) {
    // 1) Try vendored inside package
    const vendoredPath = path.join(VENDOR_BASE, repo);
    try {
      await fs.access(vendoredPath);
      const requireFromVendor = createRequire(
        path.join(vendoredPath, "package.json"),
      );
      const modVendored: any = requireFromVendor(vendoredPath);
      const candidateVendored =
        modVendored && (modVendored.default ?? modVendored);
      const langVendored = (
        subkey ? candidateVendored?.[subkey] : candidateVendored
      ) as Parser.Language;
      if (!langVendored)
        throw new Error("Vendored module did not export a Language");
      const sanity = new Parser();
      sanity.setLanguage(langVendored);
      // eslint-disable-next-line no-console
      console.log(
        `[LocalLanguageLoader] Loaded '${normalized}' from vendored repo: ${vendoredPath}`,
      );
      languageCache.set(normalized, langVendored);
      return langVendored;
    } catch (e) {
      errors.push(`${vendoredPath}: ${(e as Error).message}`);
    }

    // 2) Try developer local repo
    const fullRepoPath = path.join(BASE_DIR, repo);
    try {
      await fs.access(fullRepoPath);
      const requireFromRepo = createRequire(
        path.join(fullRepoPath, "package.json"),
      );
      const mod: any = requireFromRepo(fullRepoPath);
      const candidate = mod && (mod.default ?? mod);
      const lang = (
        subkey ? candidate?.[subkey] : candidate
      ) as Parser.Language;
      if (!lang) throw new Error("Module did not export a Language");
      const sanity = new Parser();
      sanity.setLanguage(lang);
      // eslint-disable-next-line no-console
      console.log(
        `[LocalLanguageLoader] Loaded '${normalized}' from local repo: ${fullRepoPath}`,
      );
      languageCache.set(normalized, lang);
      return lang;
    } catch (e) {
      errors.push(`${fullRepoPath}: ${(e as Error).message}`);
    }

    // 3) Fallback: try resolving from node_modules by package name (unless local-only mode)
    if (!LOCAL_ONLY && pkg) {
      const pkgs = Array.isArray(pkg) ? pkg : [pkg];
      for (const name of pkgs) {
        try {
          const projectRequire = createRequire(import.meta.url);
          const modFromPkg: any = projectRequire(name);
          const base = modFromPkg && (modFromPkg.default ?? modFromPkg);
          const selected = subkey ? base?.[subkey] : base;
          const langFromPkg = selected as Parser.Language;
          if (!langFromPkg) throw new Error("Module did not export a Language");
          const sanity = new Parser();
          sanity.setLanguage(langFromPkg);
          // eslint-disable-next-line no-console
          console.log(
            `[LocalLanguageLoader] Loaded '${normalized}' from node_modules package: ${name}${subkey ? " (" + subkey + ")" : ""}`,
          );
          languageCache.set(normalized, langFromPkg);
          return langFromPkg;
        } catch (e) {
          errors.push(
            `node_modules:${name}${subkey ? " (" + subkey + ")" : ""}: ${(e as Error).message}`,
          );
        }
      }
    }
  }

  throw new Error(
    `Failed to load local Tree-sitter language '${key}'.\n` +
      `Base dir: ${BASE_DIR}\n` +
      `Attempted importing sources (local and fallbacks):\n- ${errors.join("\n- ")}\n` +
      `Hint: run 'npm install' and 'npm run build' in the grammar repo so bindings are available, or set TREE_SITTER_LOCAL_DIR.`,
  );
}

export function clearLanguageCache() {
  languageCache.clear();
}
