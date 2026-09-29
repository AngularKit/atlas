import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import type { ScanOptions, Source } from './model.js';

const slash = (value: string) => value.split(path.sep).join('/');

export function excluded(file: string): boolean {
  return /(?:^|\/)(?:node_modules|dist|build|out-tsc|coverage|\.angular|\.git|__tests__|testing|tests?)(?:\/|$)/.test(slash(file))
    || /(?:\.(?:spec|test|stories)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$|(?:^|\/)test-setup\.[cm]?[jt]s$)/.test(slash(file));
}

function configPath(root: string, requested?: string): string {
  if (requested) return path.resolve(root, requested);
  const angularJson = path.join(root, 'angular.json');
  if (fs.existsSync(angularJson)) {
    const result = ts.readConfigFile(angularJson, ts.sys.readFile);
    if (result.error) throw new Error(ts.flattenDiagnosticMessageText(result.error.messageText, '\n'));
    const projects = Object.values(result.config.projects ?? {}) as Array<{
      targets?: { build?: { options?: { tsConfig?: string } } };
      architect?: { build?: { options?: { tsConfig?: string } } };
    }>;
    const candidates = [...new Set(projects.flatMap(p => {
      const config = (p.targets ?? p.architect)?.build?.options?.tsConfig;
      return config ? [config] : [];
    }))];
    if (candidates.length > 1) throw new Error(`Several applications found. Select --tsconfig: ${candidates.join(', ')}`);
    if (candidates[0]) return path.resolve(root, candidates[0]);
  }
  const app = path.join(root, 'tsconfig.app.json');
  return fs.existsSync(app) ? app : path.join(root, 'tsconfig.json');
}

export class Project {
  readonly root: string;
  readonly config: string;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly files: ts.SourceFile[];
  readonly excludedFiles: string[];
  readonly fingerprint: string;
  readonly options: ts.CompilerOptions;

  constructor(root: string, options: ScanOptions) {
    this.root = path.resolve(root);
    this.config = configPath(this.root, options.tsconfig);
    const configs = new Map<string, string>();
    const readFile = (file: string) => {
      const text = ts.sys.readFile(file);
      if (text !== undefined) configs.set(path.resolve(file), text);
      return text;
    };
    const raw = ts.readConfigFile(this.config, readFile);
    if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(raw.config, { ...ts.sys, readFile }, path.dirname(this.config), undefined, this.config);
    if (parsed.errors.length) throw new Error(parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    if (parsed.projectReferences?.length) {
      throw new Error(`Solution tsconfig: select an application --tsconfig instead of project references (${parsed.projectReferences.map(r => this.relative(r.path)).join(', ')}).`);
    }
    this.options = parsed.options;
    const roots = parsed.fileNames.filter(f => !excluded(this.relative(f)));
    // Type declarations stay available to the checker but never become scan targets.
    const declarations = parsed.fileNames.filter(f => /\.d\.[cm]?ts$/.test(f));
    this.program = ts.createProgram({ rootNames: [...roots, ...declarations], options: { ...parsed.options, noEmit: true } });
    this.checker = this.program.getTypeChecker();
    const localFiles = this.program.getSourceFiles().filter(f => this.isLocal(f.fileName));
    this.files = localFiles.filter(f => !excluded(this.relative(f.fileName))).sort((a, b) => this.relative(a.fileName).localeCompare(this.relative(b.fileName), 'en'));
    this.excludedFiles = [...new Set([...parsed.fileNames, ...localFiles.map(f => f.fileName)]
      .filter(f => excluded(this.relative(f))).map(f => this.relative(f)))].sort();
    const errors = this.files.flatMap(f => this.program.getSyntacticDiagnostics(f));
    if (errors.length) throw new Error(errors.map(d => `${d.file ? this.relative(d.file.fileName) : ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`).join('\n'));
    const hash = createHash('sha256');
    for (const [file, text] of [...configs].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
      hash.update(this.relative(file)).update('\0').update(text).update('\0');
    }
    // Include declaration/dependency inputs too: they influence symbol resolution.
    const compilerInputs = [...this.program.getSourceFiles()].sort((a, b) => a.fileName.localeCompare(b.fileName, 'en'));
    for (const source of compilerInputs) hash.update(this.relative(source.fileName)).update('\0').update(source.text).update('\0');
    hash.update(ts.version).update('\0').update(options.entry ?? '');
    this.fingerprint = `sha256:${hash.digest('hex')}`;
  }

  relative(file: string): string { return slash(path.relative(this.root, file)); }

  isLocal(file: string): boolean {
    const relative = this.relative(file);
    return relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative);
  }

  source(node: ts.Node): Source {
    const file = node.getSourceFile();
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    return { file: this.relative(file.fileName), line: position.line + 1, column: position.character + 1 };
  }

  module(specifier: string, containingFile: string): ts.SourceFile | undefined {
    const resolved = ts.resolveModuleName(specifier, containingFile, this.options, ts.sys).resolvedModule;
    if (!resolved || !this.isLocal(resolved.resolvedFileName) || excluded(this.relative(resolved.resolvedFileName))) return undefined;
    return this.program.getSourceFile(resolved.resolvedFileName);
  }
}
