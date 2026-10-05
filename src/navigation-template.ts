import {
  parseTemplate, TmplAstRecursiveVisitor, tmplAstVisitAll,
  ASTWithSource, LiteralArray, LiteralPrimitive, BindingType,
  type AST, type TmplAstElement, type TmplAstTemplate,
} from '@angular/compiler';

export interface TemplateLink {
  offset: number;
  expression: string;
  commands: (string | number)[] | null;
  disabled: boolean;
  relativeOverride: boolean;
}

/** Only literal commands are interpreted; Angular expressions are never executed. */
function literalCommands(value: AST): (string | number)[] | null | false {
  if (value instanceof ASTWithSource) return literalCommands(value.ast);
  if (value instanceof LiteralPrimitive) {
    if (value.value == null) return false;
    if (typeof value.value === 'string') return [value.value];
  }
  if (value instanceof LiteralArray && value.expressions.every(item => item instanceof LiteralPrimitive
    && (typeof item.value === 'string' || typeof item.value === 'number'))) {
    return value.expressions.map(item => (item as LiteralPrimitive).value as string | number);
  }
  return null;
}

export function templateLinks(text: string, file: string): { links: TemplateLink[]; errors: string[] } {
  const parsed = parseTemplate(text, file, { preserveWhitespaces: true });
  const errors = (parsed.errors ?? []).map(error => error.toString());
  const links: TemplateLink[] = [];
  if (errors.length) return { links, errors };
  class Visitor extends TmplAstRecursiveVisitor {
    private read(node: TmplAstElement | TmplAstTemplate): boolean {
      if (node.attributes.some(attr => attr.name === 'ngNonBindable')) return false;
      const relativeOverride = node.inputs.some(input => input.name === 'relativeTo')
        || node.attributes.some(attr => attr.name === 'relativeTo');
      for (const attr of node.attributes) {
        if (attr.name === 'routerLink') links.push({ offset: attr.sourceSpan.start.offset,
          expression: attr.value, commands: [attr.value], disabled: false, relativeOverride });
      }
      for (const input of node.inputs) {
        if (input.name !== 'routerLink' || input.type !== BindingType.Property) continue;
        const commands = literalCommands(input.value);
        links.push({ offset: input.sourceSpan.start.offset,
          expression: text.slice(input.valueSpan?.start.offset ?? input.sourceSpan.start.offset,
            input.valueSpan?.end.offset ?? input.sourceSpan.end.offset),
          commands: commands === false ? null : commands, disabled: commands === false, relativeOverride });
      }
      return true;
    }
    override visitElement(node: TmplAstElement): void { if (this.read(node)) super.visitElement(node); }
    override visitTemplate(node: TmplAstTemplate): void { if (this.read(node)) super.visitTemplate(node); }
  }
  tmplAstVisitAll(new Visitor(), parsed.nodes);
  // Structural directives mirror element attributes onto a synthetic template node.
  const seen = new Set<string>();
  return { links: links.sort((a, b) => a.offset - b.offset).filter(link => {
    const key = `${link.offset}:${link.expression}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }), errors };
}
