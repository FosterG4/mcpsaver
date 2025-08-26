import * as fs from 'fs/promises';
import * as path from 'path';
import { parse } from '@babel/parser';
import Parser from 'tree-sitter';
import Bash from 'tree-sitter-bash-mcpsaver';
import C from 'tree-sitter-c-mcpsaver';
import CSharp from 'tree-sitter-c-sharp-mcpsaver';
import CPP from 'tree-sitter-cpp-mcpsaver';
import CSS from 'tree-sitter-css-mcpsaver';
import EmbeddedTemplate from 'tree-sitter-embedded-template-mcpsaver';
import Go from 'tree-sitter-go-mcpsaver';
import Haskell from 'tree-sitter-haskell-mcpsaver';
import HTML from 'tree-sitter-html-mcpsaver';
import Java from 'tree-sitter-java-mcpsaver';
import Python from 'tree-sitter-python-mcpsaver';
import Ruby from 'tree-sitter-ruby-mcpsaver';
import PHP from 'tree-sitter-php-mcpsaver';
import Scala from 'tree-sitter-scala-mcpsaver';
import Julia from 'tree-sitter-julia-mcpsaver';
import OCaml from 'tree-sitter-ocaml-mcpsaver';
import JSON from 'tree-sitter-json-mcpsaver';

import QL from 'tree-sitter-ql-mcpsaver';
import Regex from 'tree-sitter-regex-mcpsaver';
import Rust from 'tree-sitter-rust-mcpsaver';
import type { ASTNode, ExtractedContext, SymbolInfo, FileLanguage } from '../types/index.js';

export class ASTParser {
  private supportedLanguages: FileLanguage[] = [
    // Core Programming Languages
    { extension: '.ts', parser: 'typescript' },
    { extension: '.tsx', parser: 'typescript' },
    { extension: '.js', parser: 'javascript' },
    { extension: '.jsx', parser: 'javascript' },
    { extension: '.mjs', parser: 'javascript' },
    { extension: '.py', parser: 'python' },
    { extension: '.go', parser: 'go' },
    { extension: '.rs', parser: 'rust' },
    { extension: '.c', parser: 'c' },
    { extension: '.h', parser: 'c' },
    { extension: '.cpp', parser: 'cpp' },
    { extension: '.cc', parser: 'cpp' },
    { extension: '.cxx', parser: 'cpp' },
    { extension: '.hpp', parser: 'cpp' },
    { extension: '.java', parser: 'java' },
    { extension: '.cs', parser: 'csharp' },
    { extension: '.rb', parser: 'ruby' },
    { extension: '.php', parser: 'php' },
    { extension: '.scala', parser: 'scala' },
    { extension: '.sc', parser: 'scala' },

    { extension: '.jl', parser: 'julia' },
    { extension: '.ml', parser: 'ocaml' },
    { extension: '.mli', parser: 'ocaml' },
    // Scripting & Shell
    { extension: '.sh', parser: 'bash' },
    { extension: '.bash', parser: 'bash' },
    { extension: '.zsh', parser: 'bash' },
    { extension: '.hs', parser: 'haskell' },
    // Web Technologies
    { extension: '.html', parser: 'html' },
    { extension: '.htm', parser: 'html' },
    { extension: '.css', parser: 'css' },
    { extension: '.ejs', parser: 'embedded_template' },
    { extension: '.eta', parser: 'embedded_template' },
    { extension: '.erb', parser: 'embedded_template' },
    // Data Formats
    { extension: '.json', parser: 'json' },
    // Other
    { extension: '.ql', parser: 'ql' },
    { extension: '.regex', parser: 'regex' },
  ];

  /**
   * Parse a file and return its AST
   */
  async parseFile(filePath: string): Promise<ASTNode> {
    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseContent(content, filePath);
  }

  /**
   * Parse content string and return its AST
   */
  async parseContent(content: string, filePath: string): Promise<ASTNode> {
    const language = this.detectLanguage(filePath);
    
    switch (language.parser) {
      // Core Programming Languages
      case 'typescript':
      case 'javascript':
        return this.parseJavaScriptTypeScript(content, language.parser === 'typescript');
      case 'python':
        return this.parsePython(content);
      case 'go':
        return this.parseGo(content);
      case 'rust':
        return this.parseRust(content);
      case 'c':
        return this.parseWithTreeSitter(content, C);
      case 'cpp':
        return this.parseWithTreeSitter(content, CPP);
      case 'java':
        return this.parseWithTreeSitter(content, Java);
      case 'csharp':
        return this.parseWithTreeSitter(content, CSharp);

      // Core Programming Languages
      case 'ruby':
        return this.parseWithTreeSitter(content, Ruby);
      case 'php':
        return this.parseWithTreeSitter(content, PHP);
      case 'scala':
        return this.parseWithTreeSitter(content, Scala);

      case 'julia':
        return this.parseWithTreeSitter(content, Julia);
      case 'ocaml':
        return this.parseWithTreeSitter(content, OCaml);
      // Scripting & Shell
      case 'bash':
        return this.parseWithTreeSitter(content, Bash);
      case 'haskell':
        return this.parseWithTreeSitter(content, Haskell);
      // Web Technologies
      case 'html':
        return this.parseWithTreeSitter(content, HTML);
      case 'css':
        return this.parseWithTreeSitter(content, CSS);
      case 'embedded_template':
        return this.parseWithTreeSitter(content, EmbeddedTemplate);
      // Data Formats
      case 'json':
        return this.parseWithTreeSitter(content, JSON);
      // Other
      case 'ql':
        return this.parseWithTreeSitter(content, QL);
      case 'regex':
        return this.parseWithTreeSitter(content, Regex);
      default:
        throw new Error(`Unsupported language: ${language.parser}`);
    }
  }

  /**
   * Extract minimal context for specific symbols
   */
  async extractContext(ast: ASTNode, targetSymbols?: string[]): Promise<ExtractedContext> {
    const symbols = this.extractSymbols(ast);
    const dependencies = this.extractDependencies(ast, symbols);
    const imports = this.extractImports(ast);
    const exports = this.extractExports(ast);
    
    let relevantSymbols = symbols;
    if (targetSymbols && targetSymbols.length > 0) {
      relevantSymbols = this.filterRelevantSymbols(symbols, targetSymbols, dependencies);
    }
    
    const code = this.generateMinimalCode(ast, relevantSymbols);
    
    return {
      code,
      symbols: relevantSymbols.map(s => s.name),
      dependencies: Array.from(new Set(relevantSymbols.flatMap(s => s.dependencies))),
      imports,
      exports,
    };
  }

  private detectLanguage(filePath: string): FileLanguage {
    const ext = path.extname(filePath).toLowerCase();
    const language = this.supportedLanguages.find(lang => lang.extension === ext);
    
    if (!language) {
      throw new Error(`Unsupported file extension: ${ext}`);
    }
    
    return language;
  }

  private parseJavaScriptTypeScript(content: string, isTypeScript: boolean): ASTNode {
    try {
      const ast = parse(content, {
        sourceType: 'module',
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        plugins: [
          'jsx',
          ['decorators', { decoratorsBeforeExport: false }],
          'classProperties',
          'objectRestSpread',
          'functionBind',
          'exportDefaultFrom',
          'exportNamespaceFrom',
          'dynamicImport',
          'nullishCoalescingOperator',
          'optionalChaining',
          ...(isTypeScript ? ['typescript' as const] : []),
        ],
      });
      
      return this.convertBabelASTToGeneric(ast);
    } catch (error) {
      throw new Error(`Failed to parse JavaScript/TypeScript: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private parsePython(content: string): ASTNode {
    try {
      const parser = new Parser();
      parser.setLanguage(Python as any);
      const tree = parser.parse(content);
      return this.convertTreeSitterASTToGeneric(tree.rootNode, content);
    } catch (error) {
      throw new Error(`Failed to parse Python code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseGo(content: string): ASTNode {
    try {
      const parser = new Parser();
      parser.setLanguage(Go);
      const tree = parser.parse(content);
      return this.convertGoASTToGeneric(tree.rootNode, content);
    } catch (error) {
      throw new Error(`Failed to parse Go code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseRust(content: string): ASTNode {
    try {
      const parser = new Parser();
      parser.setLanguage(Rust as any);
      const tree = parser.parse(content);
      return this.convertRustASTToGeneric(tree.rootNode, content);
    } catch (error) {
      throw new Error(`Failed to parse Rust code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseWithTreeSitter(content: string, language: any): ASTNode {
    try {
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(content);
      return this.convertTreeSitterASTToGeneric(tree.rootNode, content);
    } catch (error) {
      throw new Error(`Failed to parse code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private convertTreeSitterASTToGeneric(node: any, sourceCode: string): ASTNode {
    const convertNode = (tsNode: any): ASTNode => {
      const genericNode: ASTNode = {
        type: tsNode.type,
        start: tsNode.startIndex,
        end: tsNode.endIndex,
        loc: {
          start: {
            line: tsNode.startPosition.row + 1,
            column: tsNode.startPosition.column
          },
          end: {
            line: tsNode.endPosition.row + 1,
            column: tsNode.endPosition.column
          }
        },
        children: [],
        value: tsNode.text || sourceCode.slice(tsNode.startIndex, tsNode.endIndex)
      };

      if (tsNode.type === 'identifier' && tsNode.text) {
        genericNode.name = tsNode.text;
      }

      if (tsNode.children && tsNode.children.length > 0) {
        genericNode.children = tsNode.children.map((child: any) => convertNode(child));
      }

      return genericNode;
    };

    return convertNode(node);
  }

  private convertPythonASTToGeneric(pythonAst: any): ASTNode {
    const convertNode = (node: any): ASTNode => {
      if (!node || typeof node !== 'object') {
        return {
          type: 'Unknown',
          start: 0,
          end: 0,
          loc: {
            start: { line: 0, column: 0 },
            end: { line: 0, column: 0 }
          },
          children: [],
          metadata: { raw: String(node) }
        };
      }

      // Get node type from constructor name or other properties
      const nodeType = node.constructor?.name || node._type || node.type || 'Unknown';
      
      const genericNode: ASTNode = {
        type: nodeType,
        start: node._start?.start || 0,
        end: node._stop?.stop || 0,
        loc: {
          start: { 
            line: node._start?.line || 0, 
            column: node._start?.column || 0 
          },
          end: { 
            line: node._stop?.line || node._start?.line || 0, 
            column: node._stop?.column || node._start?.column || 0 
          }
        },
        children: [],
        metadata: {
          line: node._start?.line,
          column: node._start?.column,
          raw: node.getText ? node.getText() : ''
        }
      };

      // Process children if they exist
      if (node.children && Array.isArray(node.children)) {
        genericNode.children = node.children.map(convertNode);
      }

      // Handle specific ANTLR node types for Python parsing
      switch (nodeType) {
        case 'StmtContext':
          // StmtContext is a wrapper, look at its children for actual statements
          if (node.children && node.children.length > 0) {
            const firstChild = node.children[0];
            const childType = firstChild.constructor?.name || 'Unknown';
            
            if (childType === 'Compound_stmtContext') {
              // Look deeper into compound statements
              const compoundChild = firstChild.children?.[0];
              const compoundType = compoundChild?.constructor?.name || 'Unknown';
              
              switch (compoundType) {
                case 'FuncdefContext':
                  genericNode.type = 'FunctionDef';
                  const funcName = this.extractPythonName(compoundChild);
                  if (funcName) genericNode.name = funcName;
                  break;
                case 'Async_stmtContext':
                  // Look for async function definition
                  const asyncChild = compoundChild.children?.find((c: any) => c.constructor?.name === 'FuncdefContext');
                  if (asyncChild) {
                    genericNode.type = 'AsyncFunctionDef';
                    const asyncFuncName = this.extractPythonName(asyncChild);
                    if (asyncFuncName) genericNode.name = asyncFuncName;
                    if (!genericNode.metadata) genericNode.metadata = {};
                    genericNode.metadata['isAsync'] = true;
                  }
                  break;
                case 'ClassdefContext':
                  genericNode.type = 'ClassDef';
                  const className = this.extractPythonName(compoundChild);
                  if (className) genericNode.name = className;
                  break;
                case 'DecoratedContext':
                  // Handle decorated functions/classes
                  const decoratedChild = compoundChild.children?.find((c: any) => 
                    c.constructor?.name === 'FuncdefContext' || c.constructor?.name === 'ClassdefContext'
                  );
                  if (decoratedChild) {
                    const decoratedType = decoratedChild.constructor?.name;
                    if (decoratedType === 'FuncdefContext') {
                      genericNode.type = 'FunctionDef';
                      const decoratedFuncName = this.extractPythonName(decoratedChild);
                      if (decoratedFuncName) genericNode.name = decoratedFuncName;
                      if (!genericNode.metadata) genericNode.metadata = {};
                      genericNode.metadata['hasDecorators'] = true;
                    } else if (decoratedType === 'ClassdefContext') {
                      genericNode.type = 'ClassDef';
                      const decoratedClassName = this.extractPythonName(decoratedChild);
                      if (decoratedClassName) genericNode.name = decoratedClassName;
                      if (!genericNode.metadata) genericNode.metadata = {};
                      genericNode.metadata['hasDecorators'] = true;
                    }
                  }
                  break;
                case 'If_stmtContext':
                  genericNode.type = 'If';
                  break;
                case 'For_stmtContext':
                  genericNode.type = 'For';
                  break;
                case 'While_stmtContext':
                  genericNode.type = 'While';
                  break;
                default:
                  genericNode.type = compoundType;
              }
            } else if (childType === 'Simple_stmtContext') {
              // Handle simple statements like assignments, imports
              const simpleChild = firstChild.children?.[0];
              const simpleType = simpleChild?.constructor?.name || 'Unknown';
              
              switch (simpleType) {
                case 'Import_nameContext':
                case 'Import_fromContext':
                  genericNode.type = 'Import';
                  if (!genericNode.metadata) genericNode.metadata = {};
                  genericNode.metadata['isImport'] = true;
                  break;
                case 'Expr_stmtContext':
                  genericNode.type = 'Assignment';
                  break;
                default:
                  genericNode.type = simpleType;
              }
            }
          }
          break;
          
        case 'TerminalNode':
          // Terminal nodes contain actual text tokens
          genericNode.type = 'Terminal';
          break;
          
        default:
          // For other context types, try to extract meaningful type names
          if (nodeType.endsWith('Context')) {
            const baseType = nodeType.replace('Context', '');
            if (baseType.includes('Funcdef')) {
              genericNode.type = 'FunctionDef';
            } else if (baseType.includes('Classdef')) {
              genericNode.type = 'ClassDef';
            } else if (baseType.includes('Import')) {
              genericNode.type = 'Import';
            } else {
              genericNode.type = baseType || 'Unknown';
            }
          }
          break;
      }

      return genericNode;
    };

    return convertNode(pythonAst);
  }

  private extractPythonName(node: any): string | undefined {
     if (!node || !node.children) return undefined;
     
     // Look for NAME tokens in the children
     for (const child of node.children) {
       if (child.constructor?.name === 'TerminalNode' && child.symbol?.text) {
         const text = child.symbol.text;
         if (text && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text) && text !== 'def' && text !== 'class' && text !== 'async') {
           return text;
         }
       }
     }
     
     return undefined;
   }

  private extractPythonTypeAnnotation(annotation: any): string {
    if (!annotation) return 'Any';
    
    switch (annotation._type || annotation.type) {
      case 'Name':
        return annotation.id;
      case 'Constant':
        return String(annotation.value);
      case 'Attribute':
        return `${this.extractPythonTypeAnnotation(annotation.value)}.${annotation.attr}`;
      case 'Subscript':
        const base = this.extractPythonTypeAnnotation(annotation.value);
        const slice = this.extractPythonTypeAnnotation(annotation.slice);
        return `${base}[${slice}]`;
      case 'Tuple':
        if (annotation.elts) {
          const types = annotation.elts.map((elt: any) => this.extractPythonTypeAnnotation(elt));
          return `Tuple[${types.join(', ')}]`;
        }
        return 'Tuple';
      case 'List':
        if (annotation.elts && annotation.elts.length > 0) {
          const elementType = this.extractPythonTypeAnnotation(annotation.elts[0]);
          return `List[${elementType}]`;
        }
        return 'List';
      default:
        return 'Any';
    }
  }

  private convertGoASTToGeneric(node: any, sourceCode: string): ASTNode {
    const convertNode = (tsNode: any): ASTNode => {
      const genericNode: ASTNode = {
        type: tsNode.type,
        start: tsNode.startIndex,
        end: tsNode.endIndex,
        loc: {
          start: {
            line: tsNode.startPosition.row + 1,
            column: tsNode.startPosition.column
          },
          end: {
            line: tsNode.endPosition.row + 1,
            column: tsNode.endPosition.column
          }
        },
        children: [],
        value: tsNode.text || sourceCode.slice(tsNode.startIndex, tsNode.endIndex)
      };

      // Map Go-specific node types to generic types
      switch (tsNode.type) {
        case 'function_declaration':
          genericNode.type = 'FunctionDef';
          genericNode.name = this.extractGoIdentifier(tsNode, 'identifier') || 'anonymous';
          break;
        case 'method_declaration':
          genericNode.type = 'MethodDef';
          genericNode.name = this.extractGoIdentifier(tsNode, 'field_identifier') || 'anonymous';
          break;
        case 'type_declaration':
          genericNode.type = 'TypeDef';
          genericNode.name = this.extractGoIdentifier(tsNode, 'type_identifier') || 'anonymous';
          break;
        case 'interface_type':
          genericNode.type = 'InterfaceDef';
          break;
        case 'struct_type':
          genericNode.type = 'StructDef';
          break;
        case 'import_declaration':
          genericNode.type = 'Import';
          break;
        case 'package_clause':
          genericNode.type = 'Package';
          genericNode.name = this.extractGoIdentifier(tsNode, 'package_identifier') || 'main';
          break;
        case 'var_declaration':
          genericNode.type = 'VarDef';
          break;
        case 'const_declaration':
          genericNode.type = 'ConstDef';
          break;
        case 'go_statement':
          genericNode.type = 'GoStatement';
          break;
        case 'channel_type':
          genericNode.type = 'ChannelType';
          break;
        default:
          // Keep original type for other nodes
          break;
      }

      // Convert children recursively
      if (tsNode.children && tsNode.children.length > 0) {
        genericNode.children = tsNode.children.map((child: any) => convertNode(child));
      }

      return genericNode;
    };

    return convertNode(node);
  }

  private extractGoIdentifier(node: any, identifierType: string): string | undefined {
    if (!node.children) return undefined;
    
    for (const child of node.children) {
      if (child.type === identifierType) {
        return child.text;
      }
      // Recursively search in children
      const found = this.extractGoIdentifier(child, identifierType);
      if (found) return found;
    }
    
    return undefined;
  }

  private convertRustASTToGeneric(node: any, sourceCode: string): ASTNode {
    const convertNode = (tsNode: any): ASTNode => {
      const genericNode: ASTNode = {
        type: tsNode.type,
        start: tsNode.startIndex,
        end: tsNode.endIndex,
        loc: {
          start: {
            line: tsNode.startPosition.row + 1,
            column: tsNode.startPosition.column
          },
          end: {
            line: tsNode.endPosition.row + 1,
            column: tsNode.endPosition.column
          }
        },
        children: [],
        value: tsNode.text || sourceCode.slice(tsNode.startIndex, tsNode.endIndex)
      };

      // Map Rust-specific node types to generic types
      switch (tsNode.type) {
        case 'function_item':
          genericNode.type = 'FunctionItem';
          genericNode.name = this.extractRustIdentifier(tsNode, 'identifier', sourceCode) || 'anonymous';
          break;
        case 'impl_item':
          genericNode.type = 'ImplItem';
          genericNode.name = this.extractRustIdentifier(tsNode, 'type_identifier', sourceCode) || 'anonymous';
          break;
        case 'trait_item':
          genericNode.type = 'TraitItem';
          genericNode.name = this.extractRustIdentifier(tsNode, 'type_identifier', sourceCode) || 'anonymous';
          break;
        case 'struct_item':
          genericNode.type = 'StructItem';
          genericNode.name = this.extractRustIdentifier(tsNode, 'type_identifier', sourceCode) || 'anonymous';
          break;
        case 'enum_item':
          genericNode.type = 'EnumItem';
          genericNode.name = this.extractRustIdentifier(tsNode, 'type_identifier', sourceCode) || 'anonymous';
          break;
        case 'mod_item':
          genericNode.type = 'ModItem';
          genericNode.name = this.extractRustIdentifier(tsNode, 'identifier', sourceCode) || 'anonymous';
          break;
        case 'use_declaration':
          genericNode.type = 'UseDeclaration';
          break;
        case 'const_item':
          genericNode.type = 'ConstItem';
          genericNode.name = this.extractRustIdentifier(tsNode, 'identifier', sourceCode) || 'anonymous';
          break;
        case 'static_item':
          genericNode.type = 'StaticItem';
          genericNode.name = this.extractRustIdentifier(tsNode, 'identifier', sourceCode) || 'anonymous';
          break;
        case 'type_item':
          genericNode.type = 'TypeItem';
          genericNode.name = this.extractRustIdentifier(tsNode, 'type_identifier', sourceCode) || 'anonymous';
          break;
        case 'macro_definition':
          genericNode.type = 'MacroDefinition';
          genericNode.name = this.extractRustIdentifier(tsNode, 'identifier', sourceCode) || 'anonymous';
          break;
        case 'let_declaration':
          genericNode.type = 'LetDeclaration';
          break;
        case 'lifetime':
          genericNode.type = 'Lifetime';
          break;
        default:
          // Keep original type for other nodes
          break;
      }

      // Convert children recursively
      if (tsNode.children && tsNode.children.length > 0) {
        genericNode.children = tsNode.children.map((child: any) => convertNode(child));
      }

      return genericNode;
    };

    return convertNode(node);
  }

  private extractRustIdentifier(node: any, identifierType: string, sourceCode?: string): string | undefined {
    if (!node.children) return undefined;
    
    for (const child of node.children) {
      if (child.type === identifierType) {
        return child.text || (sourceCode ? sourceCode.slice(child.startIndex, child.endIndex) : undefined);
      }
      // Recursively search in children
      const found = this.extractRustIdentifier(child, identifierType, sourceCode);
      if (found) return found;
    }
    
    return undefined;
  }

  private convertBabelASTToGeneric(babelAst: any): ASTNode {
    const convert = (node: any): ASTNode => {
      const genericNode: ASTNode = {
        type: node.type,
        start: node.start || 0,
        end: node.end || 0,
        loc: node.loc,
      };
      
      if (node.name) {
        genericNode.name = node.name;
      }
      
      if (node.id && node.id.name) {
        genericNode.name = node.id.name;
      }
      
      if (node.key && node.key.name) {
        genericNode.name = node.key.name;
      }
      
      // Convert children
      const children: ASTNode[] = [];
      for (const key in node) {
        const value = node[key];
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object' && item.type) {
              children.push(convert(item));
            }
          }
        } else if (value && typeof value === 'object' && value.type) {
          children.push(convert(value));
        }
      }
      
      if (children.length > 0) {
        genericNode.children = children;
      }
      
      return genericNode;
    };
    
    return convert(babelAst);
  }

  public extractSymbols(ast: ASTNode): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    
    const traverse = (node: ASTNode, scope: 'global' | 'module' | 'local' = 'global') => {
      switch (node.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'function',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'ClassDeclaration':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'class',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'VariableDeclarator':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'variable',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'TSInterfaceDeclaration':
        case 'TSTypeAliasDeclaration':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: node.type === 'TSInterfaceDeclaration' ? 'interface' : 'type',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        // Python-specific node types
        case 'FunctionDef':
        case 'AsyncFunctionDef':
          if (node.name) {
            const isAsync = node.type === 'AsyncFunctionDef';
            const decorators = node.metadata?.decorators || [];
            const metadata: any = {
              isAsync,
              decorators
            };
            if (node.metadata?.parameters) {
              metadata.parameters = node.metadata.parameters;
            }
            if (node.metadata?.returnType) {
              metadata.returnType = node.metadata.returnType;
            }
            symbols.push({
              name: node.name,
              type: 'function',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
              metadata
            });
          }
          break;
          
        case 'ClassDef':
          if (node.name) {
            const decorators = node.metadata?.['decorators'] || [];
            const baseClasses = node.metadata?.['baseClasses'] || [];
            const metadata: any = {};
            if (decorators.length > 0) {
              metadata.decorators = decorators;
            }
            if (baseClasses.length > 0) {
              metadata.baseClasses = baseClasses;
            }
            symbols.push({
              name: node.name,
              type: 'class',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
              ...(Object.keys(metadata).length > 0 ? { metadata } : {})
            });
          }
          break;
          
        case 'Assign':
          // Handle Python variable assignments
          if (node.metadata?.['targets']) {
            for (const target of node.metadata['targets']) {
              if (typeof target === 'string') {
                const metadata: any = {};
                if (node.metadata['value'] !== undefined) {
                  metadata.value = node.metadata['value'];
                }
                symbols.push({
                  name: target,
                  type: 'variable',
                  startLine: node.loc?.start.line || 0,
                  endLine: node.loc?.end.line || 0,
                  dependencies: this.extractNodeDependencies(node),
                  exports: this.isExported(node),
                  scope,
                  ...(Object.keys(metadata).length > 0 ? { metadata } : {})
                });
              }
            }
          }
          break;
          
        case 'AnnAssign':
          // Handle Python annotated assignments (type hints)
          if (node.metadata?.['target'] && node.metadata?.['annotation']) {
            const metadata: any = {
              typeAnnotation: node.metadata['annotation']
            };
            if (node.metadata['value'] !== undefined) {
              metadata.value = node.metadata['value'];
            }
            symbols.push({
              name: node.metadata['target'],
              type: 'variable',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
              metadata
            });
          }
          break;
          
        // Go-specific node types
        case 'FunctionDef':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'function',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'MethodDef':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'method',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'TypeDef':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'type',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'InterfaceDef':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'interface',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'StructDef':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'struct',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'VarDef':
        case 'ConstDef':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: node.type === 'ConstDef' ? 'constant' : 'variable',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'Package':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'package',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope: 'module',
            });
          }
          break;
          
        // Rust-specific node types
        case 'FunctionItem':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'function',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'StructItem':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'struct',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'TraitItem':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'trait',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'ImplItem':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'impl',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'EnumItem':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'enum',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'ModItem':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'module',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope: 'module',
            });
          }
          break;
          
        case 'ConstItem':
        case 'StaticItem':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: node.type === 'StaticItem' ? 'static' : 'constant',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'TypeItem':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'type',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'MacroDefinition':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'macro',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'LetDeclaration':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'variable',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
          
        case 'Lifetime':
          if (node.name) {
            symbols.push({
              name: node.name,
              type: 'lifetime',
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              dependencies: this.extractNodeDependencies(node),
              exports: this.isExported(node),
              scope,
            });
          }
          break;
      }
      
      // Recursively traverse children
      if (node.children) {
        for (const child of node.children) {
          traverse(child, scope);
        }
      }
    };
    
    traverse(ast);
    return symbols;
  }

  private extractDependencies(ast: ASTNode, symbols: SymbolInfo[]): Map<string, Set<string>> {
    const dependencies = new Map<string, Set<string>>();
    
    // Initialize dependency sets for all symbols
    for (const symbol of symbols) {
      dependencies.set(symbol.name, new Set());
    }
    
    // Analyze dependencies between symbols
    const symbolNames = new Set(symbols.map(s => s.name));
    
    const findDependencies = (node: ASTNode, currentSymbol?: string) => {
      if (node.type === 'Identifier' && node.name && symbolNames.has(node.name) && currentSymbol && node.name !== currentSymbol) {
        dependencies.get(currentSymbol)?.add(node.name);
      }
      
      if (node.children) {
        for (const child of node.children) {
          findDependencies(child, currentSymbol);
        }
      }
    };
    
    // Find dependencies for each symbol
    for (const symbol of symbols) {
      const symbolNode = this.findSymbolNode(ast, symbol.name);
      if (symbolNode) {
        findDependencies(symbolNode, symbol.name);
      }
    }
    
    return dependencies;
  }

  private extractImports(ast: ASTNode): string[] {
    const imports: string[] = [];
    
    const traverse = (node: ASTNode) => {
      if (node.type === 'ImportDeclaration') {
        // Extract import statement
        imports.push(this.reconstructImportStatement(node));
      }
      
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };
    
    traverse(ast);
    return imports;
  }

  private extractExports(ast: ASTNode): string[] {
    const exports: string[] = [];
    
    const traverse = (node: ASTNode) => {
      if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
        exports.push(this.reconstructExportStatement(node));
      }
      
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };
    
    traverse(ast);
    return exports;
  }

  private filterRelevantSymbols(symbols: SymbolInfo[], targetSymbols: string[], dependencies: Map<string, Set<string>>): SymbolInfo[] {
    const relevant = new Set<string>();
    const toProcess = [...targetSymbols];
    
    // Add target symbols and their dependencies
    while (toProcess.length > 0) {
      const symbol = toProcess.pop()!;
      if (relevant.has(symbol)) continue;
      
      relevant.add(symbol);
      const deps = dependencies.get(symbol);
      if (deps) {
        toProcess.push(...Array.from(deps));
      }
    }
    
    return symbols.filter(symbol => relevant.has(symbol.name));
  }

  private generateMinimalCode(ast: ASTNode, relevantSymbols: SymbolInfo[]): string {
    // const relevantNames = new Set(relevantSymbols.map(s => s.name));
    const codeLines: string[] = [];
    
    // Extract code for relevant symbols
    for (const symbol of relevantSymbols) {
      const symbolNode = this.findSymbolNode(ast, symbol.name);
      if (symbolNode) {
        const code = this.extractNodeCode(symbolNode);
        codeLines.push(code);
      }
    }
    
    return codeLines.join('\n\n');
  }

  private extractNodeDependencies(node: ASTNode): string[] {
    const dependencies: string[] = [];
    
    const traverse = (n: ASTNode) => {
      if (n.type === 'Identifier' && n.name) {
        dependencies.push(n.name);
      }
      
      if (n.children) {
        for (const child of n.children) {
          traverse(child);
        }
      }
    };
    
    traverse(node);
    return Array.from(new Set(dependencies));
  }

  private isExported(_node: ASTNode): boolean {
    // Check if node is part of an export statement
    // This is a simplified check
    return false; // Would need parent traversal to determine
  }

  private findSymbolNode(ast: ASTNode, symbolName: string): ASTNode | null {
    const traverse = (node: ASTNode): ASTNode | null => {
      if (node.name === symbolName) {
        return node;
      }
      
      if (node.children) {
        for (const child of node.children) {
          const result = traverse(child);
          if (result) return result;
        }
      }
      
      return null;
    };
    
    return traverse(ast);
  }

  private reconstructImportStatement(node: ASTNode): string {
    // Reconstruct import statement from AST node
    // This is a simplified implementation
    return `// Import statement for ${node.name || 'unknown'}`;
  }

  private reconstructExportStatement(node: ASTNode): string {
    // Reconstruct export statement from AST node
    // This is a simplified implementation
    return `// Export statement for ${node.name || 'unknown'}`;
  }

  private extractNodeCode(node: ASTNode): string {
    // Extract the actual code for a node
    // This would need access to the original source code
    return `// Code for ${node.name || 'unknown'} (${node.type})`;
  }
}