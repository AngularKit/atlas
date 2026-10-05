import { build } from 'esbuild';
import fs from 'node:fs';
// Bundle only the parser used by Atlas: consumers do not install Angular's compiler.
await build({ entryPoints: ['src/navigation-template.ts'], outfile: 'dist/navigation-template.js',
  bundle: true, platform: 'node', format: 'esm', target: 'es2022', minify: true,
  legalComments: 'inline', banner: { js: '/*! Includes Angular compiler code, Copyright Google LLC, MIT License. */' } });
fs.copyFileSync('node_modules/@angular/compiler/LICENSE', 'dist/angular-compiler-LICENSE');
