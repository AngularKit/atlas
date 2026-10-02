# AngularKit Atlas

[Français](https://github.com/AngularKit/atlas/blob/main/README.md) · **English**

Map and review Angular navigation: routes, screens and evidence in source code, for developers and AI agents.

Use the interactive HTML map to explore routes, or full and compact JSON to feed tools and AI agents. Markdown reports are also available. Atlas does not measure actual user journeys and is not a security audit.

## Install and run

Requirements: **Node.js 22 or later** (CI runs on 22 and 24), the Angular project's source files and its installed dependencies. You do not need to modify the application, start an Angular server or install an automated browser.

From your application's directory, generate your first map:

```sh
npx --package=@angularkit/atlas@0.1.0 angular-atlas . --html map.html
```

Open `map.html` in a browser. To scan another directory:

```sh
npx --package=@angularkit/atlas@0.1.0 angular-atlas /path/to/application --html map.html
```

To use the API from a Node.js ESM tool:

```sh
npm install --save-dev @angularkit/atlas@0.1.0
```

```js
import { scan, toHtml } from '@angularkit/atlas';
import { writeFileSync } from 'node:fs';

writeFileSync('map.html', toHtml(scan('/path/to/application')));
```

Atlas runs in Node.js, outside the Angular runtime. TypeScript types are included. The package is ESM and has no dedicated CommonJS entry point.

### Size and sharing TypeScript

The published npm version **0.1.0** depends on TypeScript `^6.0.3`. If your project uses TypeScript 5, it may install a second compiler (approximately 20–25 MB on disk). This affects development tooling, without adding to the Angular bundle.

**Next version, not yet published:** TypeScript becomes a shared dependency (`peerDependency`) compatible with `>=5.4.2 <6.1`. Installing Atlas locally uses the project's existing compatible compiler without adding a private copy. CI covers 5.4.2, 5.4.5, 5.5.4, 5.6.3, 5.7.3, 5.8.3, 5.9.3 and 6.0.3.

Once that version is published, prefer installing Atlas in the project to share its compiler:

```sh
npm install --save-dev @angularkit/atlas
npx angular-atlas . --html map.html
```

Sharing depends on where Atlas is installed, not just the directory being analyzed. A one-off `npx --package=…` invocation from a project without Atlas installed may create an environment in the npm cache and download TypeScript there. Modern npm with its standard settings installs missing peer dependencies automatically; resolve incompatible versions according to your Angular project's constraints instead of forcing a TypeScript upgrade for Atlas. [How npm peer dependencies work](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#peerdependencies).

The report's `tool.typescriptVersion` identifies the compiler actually used. The JSON contract remains the same; different compilers may produce different diagnostics and project fingerprints. TypeScript compatibility is not a certification of every Angular version.

## Select an application

For a monorepo or an explicit configuration:

```sh
npx --package=@angularkit/atlas@0.1.0 angular-atlas /path/to/workspace --tsconfig apps/shop/tsconfig.app.json
```

Atlas looks for the build projects' `tsConfig` options in `angular.json`, then `tsconfig.app.json`, then `tsconfig.json`. If it finds multiple applications, you must pass `--tsconfig`. For solution configs with project references, select an application's tsconfig. Specify the path explicitly for Nx and other nonstandard layouts.

`--entry src/app/app.config.ts` restricts discovery of router registration calls to that file. The compilation context remains the full project; warnings about runtime modifications remain visible.

Without `--json`, `--md` or `--html`, JSON goes to stdout and the summary goes to stderr. Output directories must already exist. Existing files are never overwritten.

## CLI reference

`angular-atlas [project-root] [options]` defaults to the current directory. `--tsconfig` and `--entry` paths are relative to the project root; output paths are relative to the directory where you run the command.

| Option | Purpose |
|---|---|
| `--tsconfig <file>` | Select an application's tsconfig, especially for Nx and monorepos. |
| `--entry <file>` | Restrict discovery of router registrations to one source file. |
| `--html <file>` | Write a standalone HTML map. |
| `--json <file>` | Write the JSON inventory. |
| `--md <file>` | Write a Markdown report. |
| `--compact` | Reduce JSON and Markdown detail; the map retains its details. |
| `--fail-on-partial` | Return exit code `2` for a partial analysis, after writing reports. |
| `--help` | Display help. |

To include an inventory in your own CI:

```sh
npx --package=@angularkit/atlas@0.1.0 angular-atlas . --compact --fail-on-partial --json routes.json
```

This command also fails when a known limitation, such as SSG, makes the report partial. Use `--fail-on-partial` only if that behavior is intended.

Documentation is available in French and English. In the current version, CLI help, the map and Markdown reports are mostly in French; there is no language option yet. JSON keys are the same in both guides.

## Interactive map

```sh
npx --package=@angularkit/atlas@0.1.0 angular-atlas /path/to/application --html map.html
```

Open `map.html` in a browser. It works offline, without a server or external dependencies. It contains the full inventory and source references: sharing the file also shares that information.

- Root routes appear initially. The + / − buttons expand and collapse branches and show descendant counts.
- Search matches paths and component names, revealing the ancestors of matching routes. Selecting a result keeps the filter. “Vue d’ensemble” resets the map.
- Selecting a path opens its components, guards, resolvers, redirects and sources. Guards remain associated with the route where they are declared.
- Connections represent parent–child relationships, not navigation links or permissions.
- The map supports zoom and pan. Branches appear vertically on mobile, and controls are keyboard accessible.
- Diagnostics remain visible, including SSG limitations. Duplicate paths keep distinct identities.

Combine `--html`, `--json` and `--md` using distinct output files. `--compact` applies to JSON and Markdown; the map retains details available on selection. `--fail-on-partial` behaves the same for every output format.

```js
import { scan, toHtml } from '@angularkit/atlas';
import { writeFileSync } from 'node:fs';

writeFileSync('map.html', toHtml(scan('/path/to/application')));
```

## Compact reports

For an initial review or to send less context to an AI agent, create the output directory first:

```sh
mkdir -p reports
npx --package=@angularkit/atlas@0.1.0 angular-atlas /path/to/application --compact --json reports/summary.json --md reports/summary.md
```

Compact Markdown starts with items to review, then groups routes by parent in small tables of relative paths, components and markers. Shared components appear once above a table; lazy loading, guards and resolver keys are grouped beneath the corresponding routes. Two declarations with the same path stay distinct. File lists and detailed evidence are omitted.

Compact JSON retains route occurrences, parents, order, entry points, paths, route source references and guard/resolver names or expressions. It removes detailed evidence for individual references, empty fields and default values (`outlet: primary`, `pathMatch: prefix`, `lazyChildren: false`). Unknown values remain `null`.

**Both formats preserve diagnostics, partial status and limitations.** Routes are never merged or removed. Without `--compact`, output remains detailed. `--fail-on-partial` also works with compact reports.

Compact JSON has `format: "compact"` and a [dedicated schema](schema/compact-inventory-v1.schema.json). It does not replace the full contract returned by `scan()`.

```js
import { scan, toCompactInventory, toMarkdown } from '@angularkit/atlas';

const inventory = scan('/path/to/application');
const summary = toCompactInventory(inventory);
const markdown = toMarkdown(inventory, { compact: true });
```

## What Atlas reports

- `provideRouter` and `RouterModule.forRoot` registrations, including renamed imports.
- Detected route order, parents, full path patterns, parameters, empty paths, wildcards and textual redirects.
- Direct components, static lazy imports and lazy child arrays, with default or named exports.
- Guards by type and declaring route, resolvers and references to their declarations when resolved.
- Source files, lines and columns as evidence, with localized diagnostics for unsupported expressions.
- Analyzed files, encountered exclusions and a SHA-256 fingerprint of configuration and compiler inputs, including declarations used during analysis.

The evaluator follows constants, imports, tsconfig aliases, `satisfies`, type assertions and static spreads. It does not execute application code or modify the analyzed project. Tests use the real TypeScript compiler, files and route graphs without mocking the internal analyzer.

## Interpret the results

`schemaVersion: "1.0"` is described by the [JSON schema](schema/inventory-v1.schema.json). IDs identify occurrences within a report; they are not persistent identifiers across commits. Routes sharing a component or path remain distinct.

- `scope.status: "static"`: no limitations were detected in the static forms analyzed. This does not guarantee runtime completeness.
- `scope.status: "partial"`: some elements could not be resolved, or no supported registration entry point was found. Diagnostics show where to continue reviewing.
- `fullPath: null`: Atlas cannot infer a reliable linear pattern. `/users/:id` is still a pattern, not a visitable URL without parameter values.
- `guards` contains guards declared on that route. Follow `parentId` for context; Atlas does not reconstruct execution conditions or effective permissions.
- `redirect.target` retains the declared relative or absolute text. Functional redirects remain unevaluated expressions.
- `order` follows detected siblings. An unresolved spread may contain additional routes whose count and effective position are unknown.
- Registration calls are found in project sources; Atlas does not prove they run at startup. Arrays without a supported registration are not presented as active routes.

Read, syntax and configuration errors are fatal: no successful report is returned. Angular type errors are not checked; Atlas does not replace your project build.

| Exit code | Meaning |
|---|---|
| `0` | Report generated; inspect `scope.status` and diagnostics. |
| `1` | Fatal error or output problem. |
| `2` | Partial report when using `--fail-on-partial`. |

## Current limitations

Custom matchers, named outlets, lazy NgModules, `RouterModule.forChild`/`ROUTES` composition, `resetConfig` and arbitrary factories produce diagnostics. Supported lazy loaders directly return `import('...')`, `import('...').then(m => m.Export)` or a simple destructured selection such as `.then(({ routes: selected }) => selected)`. Namespace re-exports with a default export are unwrapped as Angular would. Destructuring defaults, rest selections and multi-statement loader functions are not evaluated.

Static primitive arrays can be expanded through `.map((value, index) => …)`. `Array.from({ length: N }, (_, index) => …)` is supported for integer lengths from 0 to 10,000 using the real global `Array`. Callbacks must be synchronous, have no destructured, default, rest or third parameters, and consist of an expression or a single `return`. Primitive concatenation, templates and addition are read statically; business functions are never executed. Sparse arrays, dynamic sources, arrays of objects and other factories produce diagnostics.

Each generated occurrence has its own ID, path, parent and order. Its source points to the callback template, so multiple occurrences can share a file, line and column. Guard and resolver expressions retain their original source text. The two validation applications reached **31/31 and 105/105 client entries**; those counts do not include SSG-generated URLs.

Calls to `withRoutes` or `provideServerRouting` from `@angular/ssr` produce `SERVER_RENDERING_NOT_ANALYZED`. Atlas does not reconstruct `RenderMode` policies, `getPrerenderParams` or build-generated URLs. `/blog/:slug` does not enumerate prerendered pages. Object/array mutations after initialization and conditional execution paths are not interpreted.

Tests, stories, declaration files and known generated directories are excluded from scan targets. `excludedFiles` lists exclusions encountered by the compiler and tsconfig, not every ignored file on disk. Imports outside the selected root are not expanded as application routes.

`routerLink`, `navigate`, `navigateByUrl`, screenshots of the analyzed application and an MCP integration are future work. Atlas does not calculate a security score or label routes as unused.

## Troubleshooting

| Situation | Action |
|---|---|
| `Several applications found` or `Solution tsconfig` | Pass `--tsconfig` for an application rather than a solution configuration. |
| No routes or a `partial` report | Read `diagnostics`; check project selection, installed dependencies and a `provideRouter` or `RouterModule.forRoot` registration. An isolated array is not enough. |
| `Output already exists` | Choose another filename or explicitly remove the old report. There is no `--force` option. |
| TypeScript missing after installation (next version) | Check `legacy-peer-deps` and `--omit=peer`, which can prevent peer installation. Explicitly install a TypeScript version compatible with your project, then rerun Atlas. |
| TypeScript peer conflict (next version) | The supported range is `>=5.4.2 <6.1`. Preserve your Angular project’s constraints; do not use `--force` to hide the conflict. |
| Output directory missing | Create it before running the command. |
| `SERVER_RENDERING_NOT_ANALYZED` | Client routes remain in the report; Atlas does not enumerate prerendered pages. |
| Read or syntax error | Fix the file or tsconfig mentioned in the error; no valid report is returned after a fatal error. |

Displayed component names come from declarations or expressions in your source code. Atlas does not invent screen names. To report a problem, open an [issue](https://github.com/AngularKit/atlas/issues) with Node/Atlas versions, the command, diagnostic and a small reproducible route example, with private source material removed.

## API and development

The API is synchronous. `scan(root, { tsconfig, entry })` returns a full inventory and throws on fatal errors. Renderers take that inventory; they do not write files themselves.

| Export | Result |
|---|---|
| `scan(root, options?)` | Full `Inventory` with routes, diagnostics and evidence. |
| `toHtml(inventory)` | Standalone HTML string. |
| `toMarkdown(inventory, { compact: true }?)` | Markdown string; detailed by default. |
| `toCompactInventory(inventory)` | Compact JSON object, distinct from the full contract. |

```js
import { scan, toMarkdown } from '@angularkit/atlas';

const inventory = scan('/path/to/application', { tsconfig: 'tsconfig.app.json' });
console.log(toMarkdown(inventory));
```

To contribute from source:

```sh
git clone https://github.com/AngularKit/atlas.git
cd atlas
npm ci
npm run quality
npx playwright install chromium
npm run test:browser
```

Checks cover typing, fixture/CLI tests, JSON schema validation and offline installation into a separate consumer directory. The installed package is tested through its CLI and API, with a strict TypeScript consumer. CI runs these checks on Node.js 22 and 24, then Chromium tests on Node.js 24: branches, search, details, mobile, diagnostics and hostile source content. Playwright is a development dependency; package users do not need a browser installation to generate reports.

Atlas development uses TypeScript 6.0.3; CI also checks the shared compilers listed above. [Validation results](https://github.com/AngularKit/atlas/blob/main/docs/validation.md) (French) describe its first real-project checks; they are not a compatibility matrix for every Angular version.

See the [architecture](https://github.com/AngularKit/atlas/blob/main/docs/architecture.md) (French), [changelog](CHANGELOG.md) (French), [release procedure](https://github.com/AngularKit/atlas/blob/main/docs/releasing.en.md) and [initial project issue](https://github.com/AngularKit/atlas/issues/1).
