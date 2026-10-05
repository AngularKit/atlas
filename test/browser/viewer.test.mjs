import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { scan, toHtml } from '../../dist/index.js';

let browser;
let directory;
let inventory;
let url;
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-browser-'));
  fs.writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({compilerOptions:{noLib:true,types:[]},files:['app.ts']}));
  fs.writeFileSync(path.join(directory, 'app.ts'), `import {provideRouter,RouterLink} from '@angular/router'; import {Component} from '@angular/core';
    @Component({imports:[RouterLink],template:'<a routerLink="/old">Go</a><a [routerLink]="destination">Dynamic</a>'}) export class LessonPage {}
    const authGuard=()=>true; const resolver=(id:number)=>()=>id;
    provideRouter([
      {path:'',canActivate:[authGuard],children:[{path:'lessons',children:[1,2,3,4,5,6,7,8,9].map(id=>({path:'lesson-'+id,component:LessonPage,resolve:{item:resolver(id)}}))},{path:'same'},{path:'same'}]},
      {path:'old',redirectTo:'/lessons'},{path:'unknown',children:dynamicRoutes()}
    ]);
    provideRouter([{path:'other'}]);`);
  inventory = scan(directory);
  const html = path.join(directory, 'map.html');
  fs.writeFileSync(html, toHtml(inventory)); url = pathToFileURL(html).href;
  browser = await chromium.launch({headless:true});
});
after(async () => { await browser?.close(); if(directory) fs.rmSync(directory,{recursive:true,force:true}); });

async function open(t, options={}) {
  const page = await browser.newPage(options);
  const errors = [];
  const requests = [];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith('file:')) requests.push(request.url());});
  t.after(async()=>{await page.close(); assert.deepEqual(errors,[]); assert.deepEqual(requests,[]);});
  await page.goto(url);
  await page.locator('.node').first().waitFor();
  return page;
}
const route = fullPath=>inventory.routes.find(route=>route.fullPath===fullPath);

test('offline graph unfolds real branches, searches hidden routes and displays source evidence',async t=>{
  const page=await open(t,{viewport:{width:1440,height:950}});
  assert.equal(await page.locator('.node[data-route-id]').count(),4);
  assert.match(await page.locator('#status').innerText(),/analyse partielle/);
  const diagnosticRoute = route('/unknown');
  assert.equal(await page.locator('.node.problem').count(), 1);
  assert.equal(await page.locator('.node.problem').getAttribute('data-route-id'), diagnosticRoute.id);
  await page.locator(`[data-route-id="${diagnosticRoute.id}"] .node-main`).click();
  assert.match(await page.locator('#inspector').innerText(), /UNRESOLVED_ARRAY/);
  const root=route('/');
  const rootToggle=page.locator(`[data-route-id="${root.id}"] .toggle`);
  await rootToggle.focus(); await page.keyboard.press('Enter');
  assert.equal(await rootToggle.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('.node[data-route-id]').count(),7);
  await page.locator(`[data-route-id="${root.id}"] .node-main`).click();
  assert.match(await page.locator('#inspector').innerText(), /authGuard/);
  const lesson=route('/lessons/lesson-9');
  await page.locator('#search').fill('lesson-9');
  assert.match(await page.locator('#results').innerText(),/1 résultat/);
  assert.equal(await page.locator(`[data-route-id="${lesson.id}"]`).count(),1);
  await page.locator('#results button').click();
  assert.equal(await page.locator('#search').inputValue(),'lesson-9');
  assert.equal(await page.locator(`[data-route-id="${lesson.id}"] .node-main`).getAttribute('aria-pressed'),'true');
  const details=await page.locator('#inspector').innerText();
  assert.match(details,/LessonPage/); assert.match(details,/resolver\(id\)/); assert.match(details,/app.ts:/);
  assert.match(details,/Aucun guard déclaré sur cette route/);
  assert.ok(!details.includes('authGuard'));
  await page.locator('#zoom-in').click(); assert.equal(await page.locator('#zoom-value').innerText(),'100 %');
  await page.locator('#reset').click(); assert.equal(await page.locator('.node[data-route-id]').count(),4);
  assert.equal(await page.locator('.node.selected').count(),0);
  await page.locator('#search').fill('no-such-route');
  assert.match(await page.locator('#map-count').innerText(),/0 résultats/);
  assert.match(await page.locator('.empty').innerText(),/Aucune route/);
  await page.locator('#search').fill('same');
  assert.equal(await page.locator('#results button').count(),2);
  await page.locator('#warnings').click();
  assert.match(await page.locator('#inspector').innerText(),/UNRESOLVED_ARRAY/);
  await page.locator('#inspector .notice button').click();
  assert.equal(await page.locator('#inspector h2').innerText(),'/unknown');
});

test('mobile graph stays within the screen and opens a readable inspector',async t=>{
  const page=await open(t,{viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const dimensions=await page.evaluate(()=>({screen:innerWidth,page:document.documentElement.scrollWidth}));
  assert.ok(dimensions.page<=dimensions.screen);
  await page.locator('#search').fill('LessonPage');
  assert.equal(await page.locator('#results button').count(),9);
  await page.locator('#results button').last().click();
  assert.equal(await page.locator('#inspector h2').innerText(),'/lessons/lesson-9');
  const box=await page.locator('#inspector h2').boundingBox();
  assert.ok(box.y>=0 && box.y<844);
  await page.locator('.close-details').click();
  const viewport=await page.locator('#viewport').boundingBox();
  assert.ok(viewport.y>=0 && viewport.y<844);
});

test('source-controlled HTML remains text and the viewer makes no network requests',async t=>{
  const hostile=structuredClone(inventory);
  const payload='</script><img src="https://example.invalid/leak" onerror="window.atlasInjected=true"><script>window.atlasInjected=true</script>';
  hostile.routes[0].path=payload; hostile.routes[0].fullPath=payload;
  hostile.diagnostics[0].message=payload;
  hostile.routes[0].source.file=payload;
  const filename=path.join(directory,'hostile.html');fs.writeFileSync(filename,toHtml(hostile));
  const page=await browser.newPage(); t.after(()=>page.close());
  const requests=[];page.on('request',request=>{if(!request.url().startsWith('file:'))requests.push(request.url());});
  await page.goto(pathToFileURL(filename).href);
  await page.locator(`[data-route-id="${hostile.routes[0].id}"] .node-main`).click();
  assert.ok((await page.locator('#inspector').innerText()).includes(payload));
  assert.equal(await page.evaluate(()=>window.atlasInjected),undefined);
  assert.equal(await page.locator('img').count(),0);
  await page.locator('#warnings').click();
  assert.ok((await page.locator('#inspector').innerText()).includes(payload));
  assert.deepEqual(requests,[]);
});

test('empty inventory is explained without graph errors',async t=>{
  const empty={...inventory,entryPoints:[],routes:[]};
  const filename=path.join(directory,'empty.html');fs.writeFileSync(filename,toHtml(empty));
  const page=await browser.newPage(); t.after(()=>page.close());
  await page.goto(pathToFileURL(filename).href);
  assert.match(await page.locator('.empty').innerText(),/Aucune route détectée/);
  assert.match(await page.locator('#map-count').innerText(),/0 \/ 0/);
});


test('navigation references expose evidence, candidate targets and selected edges without confusing hierarchy',async t=>{
  const page=await open(t,{viewport:{width:1440,height:950}});
  await page.locator('#navigation').click();
  assert.match(await page.locator('#inspector').innerText(),/Non résolu/);
  assert.match(await page.locator('#inspector').innerText(),/app.ts:/);
  await page.locator('#search').fill('lesson-1');
  await page.locator('#results button').click();
  assert.match(await page.locator('#inspector').innerText(),/Navigation sortante/);
  await page.locator('#navigation-edges').click();
  assert.equal(await page.locator('#navigation-edges').getAttribute('aria-pressed'),'true');
  // Destinations outside the current search remain accessible through the inspector.
  await page.getByRole('button',{name:`Voir /old · ${route('/old').id}`,exact:true}).click();
  assert.equal(await page.locator('#search').inputValue(),'');
  assert.equal(await page.locator('#inspector h2').innerText(),'/old');
  assert.match(await page.locator('#inspector').innerText(),/Navigation entrante candidate/);
  await page.getByRole('button',{name:'Depuis /lessons/lesson-1',exact:true}).click();
  assert.equal(await page.locator('.navigation-edge').count(),1);
  assert.ok(await page.locator('.edge').count()>0);
  await page.locator('#navigation-edges').click();
  assert.equal(await page.locator('.navigation-edge').count(),0);
});
