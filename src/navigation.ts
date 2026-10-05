import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { Project, excluded } from './project.js';
import { StaticReader, unwrap } from './static.js';
import { templateLinks } from './navigation-template.js';
import { navigationTarget } from './navigation-target.js';
import type { NavigationInventory, NavigationReference, RouteRecord, Source } from './model.js';

/** Static references only. A class used by several routes has one occurrence per route context. */
export function scanNavigation(project: Project, routes: RouteRecord[]): NavigationInventory {
  const result: NavigationInventory = { status: 'static', references: [], diagnostics: [] };
  const report = (code: string, message: string, node: ts.Node) => {
    const source = project.source(node);
    if (!result.diagnostics.some(d => d.code === code && JSON.stringify(d.source) === JSON.stringify(source))) {
      result.diagnostics.push({ code, message, source, routeId: null });
    }
  };
  const reader = new StaticReader(project, report);
  const sourceKey = (source: Source) => `${source.file}:${source.line}:${source.column}`;
  const routesByClass = new Map<string, RouteRecord[]>();
  for (const route of routes) {
    if (!route.component?.declaration) continue;
    const key = sourceKey(route.component.declaration);
    routesByClass.set(key, [...(routesByClass.get(key) ?? []), route]);
  }
  function emit(kind: NavigationReference['kind'], node: ts.Node, owner: ts.ClassDeclaration | null,
    source: Source, expression: string, commands: (string | number)[] | null,
    url: string | null, relative: 'owner' | 'root' | 'unknown', reason: string | null = null, disabled = false): void {
    const declaration = owner ? project.source(owner) : null;
    const origins = declaration ? routesByClass.get(sourceKey(declaration)) ?? [] : [];
    for (const origin of origins.length ? origins : [null]) {
      if (result.references.length >= 10_000) {
        report('NAVIGATION_LIMIT', 'Navigation reference limit reached; remaining references were not expanded.', node); return;
      }
      const base = relative === 'root' ? '/' : relative === 'owner' ? origin?.fullPath ?? null : null;
      result.references.push({ id: `n${result.references.length + 1}`, kind, source, expression,
        owner: owner && declaration ? { name: owner.name?.text ?? 'default', declaration } : null,
        sourceRouteId: origin?.id ?? null,
        ...navigationTarget(commands, url, base, reason, disabled, routes, origin?.entryPointId) });
    }
  }
  function commands(node: ts.Node | undefined): (string | number)[] | null {
    if (!node) return null;
    const resolved = reader.resolve(node);
    if (!resolved || !ts.isArrayLiteralExpression(resolved)) return null;
    const values: (string | number)[] = [];
    for (const part of resolved.elements) {
      const value = reader.resolve(part);
      if (value && ts.isNumericLiteral(value)) values.push(Number(value.text));
      else { const text = reader.string(part); if (text === undefined) return null; values.push(text); }
    }
    return values;
  }
  function isRouter(receiver: ts.Expression): boolean {
    const type = project.checker.getTypeAtLocation(receiver);
    return (type.getProperty('navigate')?.declarations ?? []).some(decl =>
      decl.getSourceFile().fileName.replaceAll('\\', '/').includes('/node_modules/@angular/router/'));
  }
  function isOwnerRoute(node: ts.Node, owner: ts.ClassDeclaration | null): boolean {
    if (!owner) return false;
    const declaration = reader.declaration(unwrap(node));
    if (!declaration || declaration.parent !== owner && declaration.parent.parent !== owner) return false;
    if (ts.isParameter(declaration) && declaration.type && ts.isTypeReferenceNode(declaration.type)) {
      return reader.angularExport(declaration.type.typeName, 'ActivatedRoute');
    }
    if (ts.isPropertyDeclaration(declaration) && declaration.initializer) {
      const init = unwrap(declaration.initializer);
      return ts.isCallExpression(init) && reader.angularExport(init.expression, 'inject', '@angular/core')
        && !!init.arguments[0] && reader.angularExport(init.arguments[0], 'ActivatedRoute');
    }
    return false;
  }
  function call(node: ts.CallExpression, owner: ts.ClassDeclaration | null): void {
    if (!ts.isPropertyAccessExpression(node.expression)) return;
    const kind = node.expression.name.text;
    if ((kind !== 'navigate' && kind !== 'navigateByUrl') || !isRouter(node.expression.expression)) return;
    const argument = node.arguments[0];
    let relative: 'root' | 'owner' | 'unknown' = 'root';
    let reason: string | null = null;
    if (kind === 'navigate' && node.arguments[1]) {
      const extras = reader.object(node.arguments[1]);
      if (!extras || reader.incompleteObjects.has(extras)) reason = 'Navigation options are dynamic; relativeTo may change the destination.';
      const context = extras?.get('relativeTo');
      if (context) {
        const resolved = reader.resolve(context);
        if (resolved?.kind === ts.SyntaxKind.NullKeyword) relative = 'root';
        else relative = isOwnerRoute(context, owner) ? 'owner' : 'unknown';
      }
    }
    emit(kind, node, owner, project.source(node), argument?.getText() ?? '',
      kind === 'navigate' ? commands(argument) : null,
      kind === 'navigateByUrl' && argument ? reader.string(argument) ?? null : null,
      relative, reason);
  }
  function template(owner: ts.ClassDeclaration): void {
    for (const decorator of ts.getDecorators(owner) ?? []) {
      const call = decorator.expression;
      if (!ts.isCallExpression(call) || !reader.angularExport(call.expression, 'Component', '@angular/core') || !call.arguments[0]) continue;
      const metadata = reader.object(call.arguments[0]);
      if (!metadata) { report('NAVIGATION_TEMPLATE', 'Component metadata could not be read.', decorator); continue; }
      const inline = metadata.get('template'), external = metadata.get('templateUrl');
      if (!inline && !external) continue;
      const node = (inline ?? external)!;
      let text: string, file: string, offset = 0;
      let inlineSource: ts.SourceFile | undefined;
      if (inline) {
        const literal = reader.resolve(inline);
        if (!literal || !ts.isStringLiteralLike(literal) || literal.text !== literal.getText().slice(1, -1).replace(/\r\n?/g, '\n')) {
          report('NAVIGATION_TEMPLATE', 'Inline templates must be literal, without JavaScript escape sequences; use templateUrl for exact source locations.', inline); continue;
        }
        text = literal.getText().slice(1, -1); inlineSource = literal.getSourceFile(); file = inlineSource.fileName; offset = literal.getStart() + 1;
      } else {
        const name = reader.string(external!);
        if (name === undefined) { report('NAVIGATION_TEMPLATE', 'Dynamic templateUrl cannot be read.', external!); continue; }
        file = path.resolve(path.dirname(owner.getSourceFile().fileName), name);
        if (!project.isLocal(file) || excluded(project.relative(file))) {
          report('NAVIGATION_TEMPLATE', 'Template is outside the analyzed project or excluded.', external!); continue;
        }
        try {
          const realRelative = path.relative(fs.realpathSync(project.root), fs.realpathSync(file));
          if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error('Template symlink leaves the project');
          const stat = fs.statSync(file);
          if (!stat.isFile() || stat.size > 8_000_000) throw new Error('Template exceeds the analysis limit or is not a regular file');
          text = fs.readFileSync(file, 'utf8');
          if (text.length > 2_000_000) throw new Error('Template exceeds the analysis limit');
        } catch { report('NAVIGATION_TEMPLATE', 'Template could not be read inside the project or exceeds the analysis limit.', external!); continue; }
        project.recordTemplate(file, text);
      }
      if (text.length > 2_000_000) { report('NAVIGATION_TEMPLATE', 'Template exceeds the analysis limit.', node); continue; }
      const imports = metadata.get('imports');
      const knownDirective = !!imports && reader.array(imports).some(element => reader.withElement(element, item =>
        reader.angularExport(item, 'RouterLink') || reader.angularExport(item, 'RouterModule')));
      const parsed = templateLinks(text, project.relative(file));
      if (parsed.errors.length) report('NAVIGATION_TEMPLATE', `Template parsing failed: ${parsed.errors.join('; ')}`, node);
      const sourceText = inlineSource?.text ?? text;
      const lineStarts = [0];
      for (let index = sourceText.indexOf('\n'); index !== -1; index = sourceText.indexOf('\n', index + 1)) lineStarts.push(index + 1);
      for (const link of parsed.links) {
        const position = offset + link.offset;
        let low = 0, high = lineStarts.length;
        while (low + 1 < high) { const middle = (low + high) >>> 1; if (lineStarts[middle]! <= position) low = middle; else high = middle; }
        const source = { file: project.relative(file), line: low + 1, column: position - lineStarts[low]! + 1 };
        emit('routerLink', node, owner, source, link.expression, link.commands, null, 'owner',
          !knownDirective ? 'RouterLink directive scope is not proven by a standalone RouterLink or RouterModule import.'
            : link.relativeOverride ? 'Explicit template relativeTo is not resolved.' : null, link.disabled);
      }
    }
  }
  function visit(node: ts.Node, owner: ts.ClassDeclaration | null): void {
    if (ts.isClassDeclaration(node)) { owner = node; template(node); }
    if (ts.isCallExpression(node)) call(node, owner);
    ts.forEachChild(node, child => visit(child, owner));
  }
  for (const file of project.files) visit(file, null);
  result.status = result.diagnostics.length || result.references.some(ref => ref.status === 'unresolved') ? 'partial' : 'static';
  return result;
}
