import ts from 'typescript';
import { Project, excluded } from './project.js';
import type { Reference } from './model.js';

export function unwrap(node: ts.Node): ts.Node {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}

type Primitive = string | number | boolean | null;
type Bindings = ReadonlyMap<ts.Symbol, Primitive | undefined>;
export interface StaticElement { node: ts.Node; bindings: Bindings; }

export class StaticReader {
  private bindings: Bindings = new Map();

  withElement<T>(element: StaticElement, read: (node: ts.Node) => T): T {
    const previous = this.bindings;
    this.bindings = element.bindings;
    try { return read(element.node); } finally { this.bindings = previous; }
  }

  readonly incompleteObjects = new WeakSet<Map<string, ts.Node>>();
  private operations = 0;
  private failures = 0;
  readonly report: (code: string, message: string, node: ts.Node) => void;
  constructor(readonly project: Project, report: (code: string, message: string, node: ts.Node) => void) {
    this.report = (code, message, node) => { this.failures++; report(code, message, node); };
  }

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

  private primitive(input: ts.Node, ancestors = new Set<ts.Node>()): Primitive | undefined {
    const node = this.resolve(input);
    if (!node || ancestors.has(node) || ancestors.size >= 100) return undefined;
    const next = new Set(ancestors).add(node);
    if (ts.isIdentifier(node)) {
      const symbol = this.symbol(node);
      return symbol ? this.bindings.get(symbol) : undefined;
    }
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node)) {
      const value = this.primitive(node.operand, next);
      if (typeof value !== 'number') return undefined;
      if (node.operator === ts.SyntaxKind.MinusToken) return -value;
      if (node.operator === ts.SyntaxKind.PlusToken) return value;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.primitive(node.left, next);
      const right = this.primitive(node.right, next);
      if (left === undefined || right === undefined) return undefined;
      if (typeof left === 'string' || typeof right === 'string') return String(left) + String(right);
      const sum = Number(left) + Number(right);
      return Number.isFinite(sum) ? sum : undefined;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const part = this.primitive(span.expression, next);
        if (part === undefined) return undefined;
        value += String(part) + span.literal.text;
      }
      return value;
    }
    return undefined;
  }

  string(input: ts.Node): string | undefined {
    const value = this.primitive(input);
    return typeof value === 'string' ? value : undefined;
  }

  /** Original AST nodes plus lexical bindings preserve both evidence and symbol identity. */
  array(input: ts.Node, ancestors = new Set<ts.Node>()): StaticElement[] {
    const node = this.resolve(input);
    if (!node) return [];
    if (ancestors.has(node) || ancestors.size >= 100) {
      this.report('CYCLIC_REFERENCE', 'Cyclic or excessively deep array expression.', input);
      return [];
    }
    const next = new Set(ancestors).add(node);
    if (ts.isArrayLiteralExpression(node)) {
      const result: StaticElement[] = [];
      for (const element of node.elements) {
        if (ts.isSpreadElement(element)) result.push(...this.array(element.expression, next));
        else if (ts.isOmittedExpression(element)) {
          this.report('UNRESOLVED_ARRAY', 'Sparse arrays are not expanded.', node);
          return [];
        } else result.push({ node: element, bindings: this.bindings });
        if (result.length > 10_000) {
          this.report('ANALYSIS_LIMIT', 'Static array expansion exceeds 10000 elements.', input);
          return [];
        }
      }
      return result;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      if (method === 'map' && node.arguments.length === 1) {
        // Unknown portions must not shift the indices of the known portions.
        const before = this.failures;
        const elements = this.array(receiver, next);
        if (this.failures !== before) return [];
        const values = elements.map(element => this.withElement(element, value => this.primitive(value)));
        if (values.every(value => value !== undefined)) return this.mapCallback(node.arguments[0]!, values, node);
      }
      if (method === 'from' && node.arguments.length === 2 && ts.isIdentifier(receiver)
        && receiver.text === 'Array' && this.isBuiltinArray(receiver)) {
        const properties = this.object(node.arguments[0]!);
        const lengthNode = properties?.get('length');
        const length = lengthNode ? this.primitive(lengthNode) : undefined;
        if (properties && !this.incompleteObjects.has(properties) && properties.size === 1
          && typeof length === 'number' && Number.isSafeInteger(length) && length >= 0) {
          if (length > 10_000) {
            this.report('ANALYSIS_LIMIT', 'Array.from length exceeds 10000 elements.', input);
            return [];
          }
          return this.mapCallback(node.arguments[1]!, Array<undefined>(length).fill(undefined), node);
        }
      }
    }
    this.report('UNRESOLVED_ARRAY', 'Expected a static array, primitive-array map, or bounded Array.from; this branch is incomplete.', input);
    return [];
  }

  private isBuiltinArray(node: ts.Identifier): boolean {
    const declarations = this.symbol(node)?.declarations;
    return !!declarations?.length && declarations.every(declaration =>
      this.project.program.isSourceFileDefaultLibrary(declaration.getSourceFile()));
  }

  private mapCallback(input: ts.Node, values: (Primitive | undefined)[], call: ts.Node): StaticElement[] {
    const fn = this.resolve(input);
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && !fn.asteriskToken
      && !fn.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      && fn.parameters.length <= 2
      && fn.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.initializer && !parameter.dotDotDotToken)) {
      const statement = ts.isBlock(fn.body) && fn.body.statements.length === 1 ? fn.body.statements[0] : undefined;
      const body = ts.isBlock(fn.body) ? statement && ts.isReturnStatement(statement) ? statement.expression : undefined : fn.body;
      if (body) return values.map((value, index) => {
        const bindings = new Map(this.bindings);
        for (const [position, parameter] of fn.parameters.entries()) {
          const symbol = this.symbol(parameter.name);
          if (symbol) bindings.set(symbol, position === 0 ? value : index);
        }
        return { node: body, bindings };
      });
    }
    this.report('UNRESOLVED_ARRAY', 'Array callback requires at most two simple parameters and a single synchronous return expression.', call);
    return [];
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
  angularExport(node: ts.Node, name: string, packageName = '@angular/router'): boolean {
    const symbol = this.project.checker.getSymbolAtLocation(node);
    for (const decl of symbol?.declarations ?? []) {
      if (ts.isImportSpecifier(decl) && (decl.propertyName ?? decl.name).text === name) {
        const statement = decl.parent.parent.parent;
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === packageName) return true;
      }
    }
    const resolved = this.symbol(node);
    if (resolved?.getName() !== name) return false;
    return (resolved.declarations ?? []).some(decl => {
      if (decl.getSourceFile().fileName.replaceAll('\\', '/').includes(`/node_modules/${packageName}/`)) return true;
      for (let parent: ts.Node | undefined = decl.parent; parent; parent = parent.parent) {
        if (ts.isModuleDeclaration(parent) && ts.isStringLiteral(parent.name) && parent.name.text === packageName) return true;
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
      let selectedExport: string | undefined;
      if (parameter && !callback.parameters[0]?.initializer && !callback.parameters[0]?.dotDotDotToken) {
        if (ts.isPropertyAccessExpression(selection) && ts.isIdentifier(selection.expression)
          && ts.isIdentifier(parameter) && selection.expression.text === parameter.text) {
          selectedExport = selection.name.text;
        } else if (ts.isObjectBindingPattern(parameter) && ts.isIdentifier(selection)
          && parameter.elements.every(binding => !binding.initializer && !binding.dotDotDotToken && ts.isIdentifier(binding.name))) {
          const binding = parameter.elements.find(binding => ts.isIdentifier(binding.name) && binding.name.text === selection.text);
          const property = binding?.propertyName ?? binding?.name;
          if (property && (ts.isIdentifier(property) || ts.isStringLiteral(property))) selectedExport = property.text;
        }
      }
      if (selectedExport === undefined) {
        this.report('UNRESOLVED_LAZY', 'Expected a direct module export selection or a simple destructured export without defaults.', input);
        return undefined;
      }
      exported = selectedExport;
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
    let decl = target?.valueDeclaration ?? target?.declarations?.[0];
    // Angular unwraps a default export when a lazy loader returns a module
    // namespace, including `export * as routes from './routes'` barrels.
    if (decl && ts.isSourceFile(decl) && this.project.isLocal(decl.fileName)
      && !excluded(this.project.relative(decl.fileName))) {
      const namespace = this.project.checker.getSymbolAtLocation(decl);
      const defaultExport = namespace ? this.project.checker.getExportsOfModule(namespace).find(s => s.getName() === 'default') : undefined;
      const resolvedDefault = defaultExport && defaultExport.flags & ts.SymbolFlags.Alias
        ? this.project.checker.getAliasedSymbol(defaultExport) : defaultExport;
      decl = resolvedDefault?.valueDeclaration ?? resolvedDefault?.declarations?.[0];
    }
    if (!decl) {
      this.report('UNRESOLVED_LAZY', `Cannot resolve lazy export ${exported} in ${specifier ?? 'dynamic module'}.`, input);
      return undefined;
    }
    if (ts.isVariableDeclaration(decl) && decl.initializer) return this.resolve(decl.name);
    if (ts.isExportAssignment(decl)) return this.resolve(decl.expression);
    return decl;
  }
}
