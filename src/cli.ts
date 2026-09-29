#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { scan, toMarkdown } from './index.js';

const help = `AngularKit Atlas — inventaire statique des routes Angular

Usage: angular-atlas [project-root] [options]

  --tsconfig <file>  Sélectionner le tsconfig de l'application
  --entry <file>     Limiter la découverte des registrations à un fichier
  --json <file>     Écrire l'inventaire JSON
  --md <file>       Écrire le rapport Markdown
  --fail-on-partial Retourner le code 2 si des branches ne sont pas résolues
  --help            Afficher cette aide

Sans fichier de sortie, le JSON est écrit sur stdout.
Codes : 0 = rapport produit, 1 = erreur fatale, 2 = analyse partielle en mode strict.
Les fichiers de sortie existants ne sont jamais écrasés.
`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      tsconfig: { type: 'string' }, entry: { type: 'string' }, json: { type: 'string' }, md: { type: 'string' },
      help: { type: 'boolean' }, 'fail-on-partial': { type: 'boolean' },
    },
  });
  if (values.help) process.stdout.write(help);
  else {
    if (positionals.length > 1) throw new Error('Expected at most one project root. Use --help.');
    const outputs = [values.json, values.md].filter((v): v is string => v !== undefined).map(v => path.resolve(v));
    if (new Set(outputs).size !== outputs.length) throw new Error('JSON and Markdown outputs must have distinct paths.');
    for (const file of outputs) if (fs.existsSync(file)) throw new Error(`Output already exists: ${file}`);
    const result = scan(positionals[0] ?? '.', { tsconfig: values.tsconfig, entry: values.entry });
    const json = JSON.stringify(result, null, 2) + '\n';
    if (values.json) fs.writeFileSync(values.json, json, { flag: 'wx' });
    if (values.md) fs.writeFileSync(values.md, toMarkdown(result), { flag: 'wx' });
    if (!outputs.length) process.stdout.write(json);
    process.stderr.write(`${result.routes.length} routes; ${result.diagnostics.length} diagnostics; ${result.scope.status}.\n`);
    if (values['fail-on-partial'] && result.scope.status === 'partial') process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`Atlas: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
