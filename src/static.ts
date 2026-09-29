import ts from 'typescript';
import { Project, excluded } from './project.js';
import type { Reference } from './model.js';

export function unwrap(node: ts.Node): ts.Node {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}

export class StaticReader {
  readonly incompleteObjects = new WeakSet<Map<string, ts.Node>>();
  private operations = 0;
  constructor(readonly project: Project, readonly report: (code: string, message: string, node: ts.Node) => void) {}

  symbol(node: ts.Node): ts.Symbol | undefined {
    let symbol = ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
      ? this.project.checker.getShorthandAssignmentValueSymbol(node.parent)
      : this.project.checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = this.project.checker.getAliasedSymbol(symbol);
    return symbol;
  }

  declaration(node: ts.Node): ts.Declaration | undefined {
    const symbol = this.symbol(node);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }

  resolve(input: ts.Node, seen = new Set<ts.Node>()): ts.Node | undefined {
    if (++this.operations > 50_000) {
      if (this.operations === 50_001) this.report('ANALYSIS_LIMIT', 'Static evaluation budget exceeded; remaining branches are incomplete.', input);
      return undefined;
    }
    const node = unwrap(input);
    if (seen.has(node) || seen.size >= 100) {
      this.report('CYCLIC_REFERENCE', 'Cyclic or excessively deep static reference.', node);
      return undefined;
    }
    seen.add(node);
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const decl = this.declaration(node);
      if (!decl) return node;
      if (!this.project.isLocal(decl.getSourceFile().fileName) || excluded(this.project.relative(decl.getSourceFile().fileName))) return node;
      if (ts.isVariableDeclaration(decl) && decl.initializer) {
        if (!ts.isVariableDeclarationList(decl.parent) || !(decl.parent.flags & ts.NodeFlags.Const)) {
          this.report('MUTABLE_REFERENCE', 'Mutable bindings are not statically evaluated.', node);
          return undefined;
        }
        return this.resolve(decl.initializer, seen);
      }
      if (ts.isExportAssignment(decl)) return this.resolve(decl.expression, seen);
      if (ts.isFunctionDeclaration(decl) || ts.isClassDeclaration(decl)) return decl;
      if (ts.isPropertyAssignment(decl) && ts.isPropertyAccessExpression(node)) {
        const properties = this.object(node.expression);
        const value = properties?.get(node.name.text);
        if (value) return this.resolve(value, seen);
      }
    }
    return node;
  }

  string(input: ts.Node): string | undefined {
    const node = this.resolve(input);
    return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  }

  array(input: ts.Node, ancestors = new Set<ts.Node>()): ts.Node[] {
    const node = this.resolve(input);
    if (!node) return [];
    if (!ts.isArrayLiteralExpression(node)) {
      this.report('UNRESOLVED_ARRAY', 'Expected a statically resolvable array; this branch is incomplete.', input);
      return [];
    }
    if (ancestors.has(node) || ancestors.size >= 100) {
      this.report('CYCLIC_REFERENCE', 'Cyclic or excessively deep array spread.', input);
      return [];
    }
    const next = new Set(ancestors).add(node);
    return node.elements.flatMap(element => ts.isSpreadElement(element) ? this.array(element.expression, next) : [element]);
  }

  object(input: ts.Node, ancestors = new Set<ts.Node>()): Map<string, ts.Node> | undefined {
    const node = this.resolve(input);
    if (!node) return undefined;
    if (!ts.isObjectLiteralExpression(node)) {
      this.report('UNRESOLVED_OBJECT', 'Expected a statically resolvable object.', input);
      return undefined;
    }
    if (ancestors.has(node) || ancestors.size >= 100) {
      this.report('CYCLIC_REFERENCE', 'Cyclic or excessively deep object spread.', input);
      return undefined;
    }
    const next = new Set(ancestors).add(node);
    const values = new Map<string, ts.Node>();
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = this.object(property.expression, next);
        // An unknown spread could override any previously extracted property.
        if (!spread || this.incompleteObjects.has(spread)) {
          values.clear();
          this.incompleteObjects.add(values);
        }
        if (spread) for (const [name, value] of spread) values.set(name, value);
      } else {
        const name = ts.isComputedPropertyName(property.name) ? this.string(property.name.expression)
          : ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : undefined;
        if (name === undefined) {
          this.report('UNRESOLVED_PROPERTY', 'Computed property could override other fields.', property);
          values.clear();
          this.incompleteObjects.add(values);
        } else if (ts.isPropertyAssignment(property)) values.set(name, property.initializer);
        else if (ts.isShorthandPropertyAssignment(property)) {
          values.set(name, property.name);
        } else {
          values.set(name, property);
        }
      }
    }
    return values;
  }

  reference(node: ts.Node): Reference {
    const declaration = this.declaration(node);
    const symbol = this.symbol(node);
    return {
      expression: node.getText(),
      name: symbol?.getName() ?? (ts.isIdentifier(node) ? node.text : null),
      source: this.project.source(node),
      declaration: declaration ? this.project.source(declaration) : null,
    };
  }

  /** Recognize actual Angular imports, including local import aliases, not just call names. */
  angularExport(node: ts.Node, name: string): boolean {
    const symbol = this.project.checker.getSymbolAtLocation(node);
    for (const decl of symbol?.declarations ?? []) {
      if (ts.isImportSpecifier(decl) && (decl.propertyName ?? decl.name).text === name) {
        const statement = decl.parent.parent.parent;
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === '@angular/router') return true;
      }
    }
    const resolved = this.symbol(node);
    if (resolved?.getName() !== name) return false;
    return (resolved.declarations ?? []).some(decl => {
      if (decl.getSourceFile().fileName.replaceAll('\\', '/').includes('/node_modules/@angular/router/')) return true;
      for (let parent: ts.Node | undefined = decl.parent; parent; parent = parent.parent) {
        if (ts.isModuleDeclaration(parent) && ts.isStringLiteral(parent.name) && parent.name.text === '@angular/router') return true;
      }
      return false;
    });
  }

  lazy(input: ts.Node): ts.Node | undefined {
    const fn = this.resolve(input);
    if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn)) || !fn.body) {
      this.report('UNRESOLVED_LAZY', 'Lazy loader is not a supported static function.', input);
      return undefined;
    }
    let body: ts.Node = fn.body;
    if (ts.isBlock(body)) {
      const statement = body.statements.length === 1 ? body.statements[0] : undefined;
      if (!statement || !ts.isReturnStatement(statement) || !statement.expression) {
        this.report('UNRESOLVED_LAZY', 'Lazy function must contain a single static return.', input);
        return undefined;
      }
      body = statement.expression;
    }
    body = unwrap(body);
    let exported = 'default';
    if (ts.isCallExpression(body) && ts.isPropertyAccessExpression(body.expression) && body.expression.name.text === 'then') {
      const callback = body.arguments[0];
      if (!callback || !ts.isArrowFunction(callback) || callback.parameters.length !== 1) {
        this.report('UNRESOLVED_LAZY', 'Unsupported import selection callback.', input);
        return undefined;
      }
      const selection = unwrap(callback.body);
      const parameter = callback.parameters[0]?.name;
      if (!ts.isPropertyAccessExpression(selection) || !ts.isIdentifier(selection.expression)
        || !parameter || !ts.isIdentifier(parameter) || selection.expression.text !== parameter.text) {
        this.report('UNRESOLVED_LAZY', 'Expected import(...).then(module => module.export).', input);
        return undefined;
      }
      exported = selection.name.text;
      body = unwrap(body.expression.expression);
    }
    if (!ts.isCallExpression(body) || body.expression.kind !== ts.SyntaxKind.ImportKeyword || !body.arguments[0]) {
      this.report('UNRESOLVED_LAZY', 'Lazy loader must return a literal dynamic import.', input);
      return undefined;
    }
    const specifier = this.string(body.arguments[0]);
    const module = specifier ? this.project.module(specifier, body.getSourceFile().fileName) : undefined;
    const symbol = module ? this.project.checker.getSymbolAtLocation(module) : undefined;
    const found = symbol ? this.project.checker.getExportsOfModule(symbol).find(s => s.getName() === exported) : undefined;
    const target = found && found.flags & ts.SymbolFlags.Alias ? this.project.checker.getAliasedSymbol(found) : found;
    const decl = target?.valueDeclaration ?? target?.declarations?.[0];
    if (!decl) {
      this.report('UNRESOLVED_LAZY', `Cannot resolve lazy export ${exported} in ${specifier ?? 'dynamic module'}.`, input);
      return undefined;
    }
    if (ts.isVariableDeclaration(decl) && decl.initializer) return this.resolve(decl.name);
    if (ts.isExportAssignment(decl)) return this.resolve(decl.expression);
    return decl;
  }
}
