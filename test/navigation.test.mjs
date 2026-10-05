import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan, toCompactInventory, toMarkdown } from '../dist/index.js';

const core = `export declare function Component(meta:any): ClassDecorator; export declare function inject<T>(type:new (...args:any[])=>T): T;`;
const router = `export declare function provideRouter(routes:any[]):any; export declare class RouterLink {} export declare class RouterModule {}
export declare class ActivatedRoute { parent: ActivatedRoute; }
export declare class Router { navigate(commands:any[],extras?:any):any; navigateByUrl(url:any):any; }`;
function fixture(t, app, extra={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-navigation-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const files={
    'tsconfig.json':JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',noLib:true,types:[],experimentalDecorators:true},include:['*.ts']}),
    'node_modules/@angular/core/package.json':JSON.stringify({name:'@angular/core',types:'index.d.ts'}),
    'node_modules/@angular/core/index.d.ts':core,
    'node_modules/@angular/router/package.json':JSON.stringify({name:'@angular/router',types:'index.d.ts'}),
    'node_modules/@angular/router/index.d.ts':router,
    'app.ts':`import {Component,inject} from '@angular/core'; import {Router,RouterLink,RouterModule,ActivatedRoute,provideRouter} from '@angular/router';\n${app}`,
    ...extra,
  };
  for (const [file,text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true}); fs.writeFileSync(path.join(root,file),text); }
  return root;
}
const refs=r=>r.navigation.references;

test('parses real Angular templates, control flow and literal commands with exact external source evidence',t=>{
  const html=`<!-- <a routerLink="/fake"> -->\n@if (ready) { <a routerLink="/home">Home</a> }\n<a [routerLink]="['/user', 42]">User</a>\n<a [routerLink]="null">Off</a>\n<a [routerLink]="destination()">Dynamic</a>`;
  const root=fixture(t,`@Component({imports:[RouterLink],templateUrl:'./home.html'}) class Home {} provideRouter([{path:'home',component:Home},{path:'user/:id'}]);`,{'home.html':html});
  const result=scan(root);
  assert.deepEqual(refs(result).map(r=>[r.kind,r.target,r.status]),[['routerLink','/home','matched'],['routerLink','/user/42','matched'],['routerLink',null,'disabled'],['routerLink',null,'unresolved']]);
  assert.deepEqual(refs(result)[0].source,{file:'home.html',line:2,column:18});
  assert.equal(refs(result)[0].owner.name,'Home');
  assert.equal(result.navigation.status,'partial');
  for(const file of ['inventory-v1.schema.json','compact-inventory-v1.schema.json']) {
    const validate=new Ajv({allErrors:true}).compile(JSON.parse(fs.readFileSync(new URL('../schema/'+file,import.meta.url))));
    assert.ok(validate(file.startsWith('compact')?toCompactInventory(result):result),JSON.stringify(validate.errors));
  }
  assert.match(toMarkdown(result,{compact:true}),/Navigation déclarée/);
  assert.equal(toCompactInventory(result).navigation.references.length,4);
});

test('keeps contexts for reused components and never assigns shared template links to an invented screen',t=>{
  const root=fixture(t,`@Component({imports:[RouterLink],template:'<a routerLink="detail">Go</a>'}) class Page {}
  @Component({imports:[RouterModule],template:'<a routerLink="/a/detail">Go</a><a routerLink="detail">Relative</a>'}) class Menu {}
  provideRouter([{path:'a',component:Page,children:[{path:'detail'}]},{path:'b',component:Page,children:[{path:'detail'}]}]);`);
  const result=scan(root);
  assert.deepEqual(refs(result).map(r=>r.target),['/a/detail','/b/detail','/a/detail',null]);
  assert.deepEqual(refs(result).map(r=>r.sourceRouteId),['r1','r3',null,null]);
  assert.equal(refs(result)[3].status,'unresolved');
});

test('identifies Router calls by symbols, respects navigate root default and ActivatedRoute context',t=>{
  const root=fixture(t,`class Page {
    private router=inject(Router); private route=inject(ActivatedRoute);
    go(){ this.router.navigate(['detail']); this.router.navigate(['../list'],{relativeTo:this.route});
      this.router.navigateByUrl('/list?q=1#top'); this.router.navigate(['/list'],{relativeTo:this.route.parent});
      this.router.navigate(['detail'],{relativeTo:this.route.parent}); }
  }
  class Service { constructor(private router:Router){} run(){ this.router.navigate(['/list']); } }
  const other={navigate(x:any){},navigateByUrl(x:any){}}; other.navigate(['/fake']); other.navigateByUrl('/fake');
  provideRouter([{path:'section',children:[{path:'page',component:Page},{path:'list'}]},{path:'list'},{path:'detail'}]);`);
  const result=scan(root);
  assert.deepEqual(refs(result).map(r=>r.target),['/detail','/section/list','/list','/list',null,'/list']);
  assert.equal(refs(result).at(-1).sourceRouteId,null);
  assert.equal(refs(result).length,6);
});

test('retains dynamic commands, unknown options and UrlTrees as unresolved without evaluating application code',t=>{
  const root=fixture(t,`class Page { router=inject(Router); go(){
    this.router.navigate(['/item', runtimeId]); this.router.navigate(makeCommands());
    this.router.navigate(['/list'], options); this.router.navigateByUrl(makeUrlTree());
    this.router.navigate([{outlets:{popup:'compose'}}]); }
  } function makeCommands(){ throw new Error('must never execute'); } provideRouter([{path:'p',component:Page}]);`);
  const result=scan(root);
  assert.equal(refs(result).length,5); assert.ok(refs(result).every(r=>r.status==='unresolved'&&r.target===null));
});

test('matches all candidate patterns without claiming first-match behavior, redirects, wildcard fallback or security',t=>{
  const root=fixture(t,`@Component({imports:[RouterLink],template:'<a routerLink="/same">One</a><a routerLink="/missing">Two</a>'}) class Page {}
    provideRouter([{path:'p',component:Page},{path:'same',redirectTo:'/elsewhere'},{path:'same',canMatch:[dynamicGuard]},{path:'**'}]);`);
  const result=scan(root);
  assert.deepEqual(refs(result)[0].targetRouteIds,['r2','r3']);
  assert.equal(refs(result)[1].status,'unmatched'); assert.match(refs(result)[1].reason,/wildcard/);
});

test('tracks external template changes in fingerprint and handles literal imports with their own source location',t=>{
  const root=fixture(t,`import {markup} from './markup'; @Component({imports:[RouterLink],template:markup}) class Page {} provideRouter([{path:'home',component:Page}]);`,{'markup.ts':'export const markup = `<a routerLink="/home">Go</a>`;'});
  const first=scan(root); assert.equal(refs(first)[0].source.file,'markup.ts');
  assert.equal(refs(first)[0].source.line,1); assert.equal(refs(first)[0].source.column,27);
  const external=fixture(t,`@Component({imports:[RouterLink],templateUrl:'./page.html'}) class Page {} provideRouter([{path:'home',component:Page}]);`,{'page.html':'<a routerLink="/home">Go</a>'});
  const before=scan(external); fs.writeFileSync(path.join(external,'page.html'),'<a routerLink="/other">Go</a>');
  const after=scan(external); assert.notEqual(before.project.fingerprint,after.project.fingerprint);
  assert.deepEqual(scan(external),after);
});

test('reports unavailable and invalid templates, unknown directive scope, explicit relativeTo and JS escaped templates',t=>{
  const root=fixture(t,String.raw`@Component({imports:[RouterLink],templateUrl:'./missing.html'}) class Missing {}
    @Component({template:'<a routerLink="/home">Go</a>'}) class Unknown {}
    @Component({imports:[RouterLink],template:'<a [routerLink]="[\'/home\']" [relativeTo]="route">Go</a>'}) class Override {}
    @Component({imports:[RouterLink],templateUrl:'./bad.html'}) class Bad {}
    provideRouter([{path:'home',component:Unknown}]);`,{'bad.html':'<div><a></div>'});
  // Inline JS escapes are deliberately not mapped approximately.
  const result=scan(root); assert.equal(result.navigation.status,'partial');
  assert.ok(result.navigation.diagnostics.some(d=>d.code==='NAVIGATION_TEMPLATE'));
  assert.ok(refs(result).every(r=>r.status==='unresolved'));
});

test('ngNonBindable markup and commented links are not navigation references',t=>{
  const root=fixture(t,`@Component({imports:[RouterLink],templateUrl:'./page.html'}) class Page {} provideRouter([{path:'p',component:Page}]);`,{'page.html':'<div ngNonBindable><a routerLink="/fake">literal</a></div><!-- <a routerLink="/fake"> -->'});
  assert.deepEqual(refs(scan(root)),[]);
});

test('ignores attribute-only bindings, keeps structural-template links once, and does not invent explicit relative contexts',t=>{
  const root=fixture(t,`@Component({imports:[RouterLink],templateUrl:'./page.html'}) class Page {} provideRouter([{path:'page',component:Page},{path:'home'}]);`,{'page.html':`<a [attr.routerLink]="'/fake'">Attribute only</a><a *ngIf="ready" routerLink="/home">Go</a><a [routerLink]="['/home']" [relativeTo]="route">Override</a>`});
  const result=scan(root);
  assert.deepEqual(refs(result).map(r=>[r.target,r.status]),[['/home','matched'],[null,'unresolved']]);
});

test('constructor ActivatedRoute injection works while unsafe command forms stay unresolved',t=>{
  const root=fixture(t,`class Page { constructor(private router:Router,private route:ActivatedRoute){} go(){
    this.router.navigate(['../list'],{relativeTo:this.route});
    this.router.navigate(['/x','..']); this.router.navigate(['/x','a/b']);
    this.router.navigateByUrl('/x%2Fy'); this.router.navigateByUrl('/x(aux:y)');
  }} provideRouter([{path:'section',children:[{path:'page',component:Page},{path:'list'}]}]);`);
  const result=scan(root); assert.equal(refs(result)[0].target,'/section/list');
  assert.ok(refs(result).slice(1).every(r=>r.status==='unresolved'));
});

test('does not read templates through a symlink outside the project',t=>{
  const root=fixture(t,`@Component({imports:[RouterLink],templateUrl:'./escape.html'}) class Page {} provideRouter([{path:'page',component:Page}]);`);
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-outside-'));
  t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  fs.writeFileSync(path.join(outside,'secret.html'),'<a routerLink="/private">Secret</a>');
  fs.symlinkSync(path.join(outside,'secret.html'),path.join(root,'escape.html'));
  const result=scan(root); assert.equal(refs(result).length,0);
  assert.equal(result.navigation.diagnostics[0].code,'NAVIGATION_TEMPLATE');
});


test('strict CLI writes outputs then returns partial for unresolved navigation alone',t=>{
  const root=fixture(t,`@Component({imports:[RouterLink],template:'<a [routerLink]="destination">Go</a>'}) class Page {} provideRouter([{path:'p',component:Page}]);`);
  const output=path.join(root,'report.json');
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('../dist/cli.js',import.meta.url)),root,'--fail-on-partial','--json',output],{encoding:'utf8'});
  assert.equal(run.status,2,run.stderr);
  const result=JSON.parse(fs.readFileSync(output));
  assert.equal(result.scope.status,'static'); assert.equal(result.navigation.status,'partial');
});
