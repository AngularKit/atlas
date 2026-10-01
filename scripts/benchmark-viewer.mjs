import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {chromium} from '@playwright/test';
import {scan,toHtml} from '../dist/index.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-benchmark-'));
const browser=await chromium.launch({headless:true});
try {
  fs.writeFileSync(path.join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{noLib:true,types:[]},files:['app.ts']}));
  fs.writeFileSync(path.join(directory,'app.ts'),`import {provideRouter} from '@angular/router'; provideRouter([{path:'base'}]);`);
  const base=scan(directory);
  const results=[];
  for(const shape of ['grouped','flat']) {
    const inventory=structuredClone(base);
    const template=inventory.routes[0];
    inventory.routes=[];
    for(let i=0;i<10000;i++) {
      const parentIndex=Math.floor(i/100)*100;
      const child=shape==='grouped' && i%100!==0;
      const routePath=child?`item-${i%100}`:`group-${i}`;
      inventory.routes.push({...structuredClone(template),id:`r${i+1}`,path:routePath,fullPath:child?`/group-${parentIndex}/${routePath}`:`/${routePath}`,parentId:child?`r${parentIndex+1}`:null,order:child?i%100-1:shape==='grouped'?i/100:i});
    }
    inventory.diagnostics=inventory.routes.map(route=>({code:'BENCHMARK_DIAGNOSTIC',message:'Synthetic diagnostic for viewer measurement.',routeId:route.id,source:route.source}));
    inventory.scope.status='partial';
    const html=path.join(directory,shape+'.html');
    const content=toHtml(inventory);
    fs.writeFileSync(html,content);
    for(let sample=1;sample<=3;sample++) {
      const page=await browser.newPage({viewport:{width:1440,height:950}});
      const errors=[], requests=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('request',r=>{if(!r.url().startsWith('file:'))requests.push(r.url());});
      const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      let start=performance.now();
      await page.goto(pathToFileURL(html).href);await frame();
      const loadMs=performance.now()-start;
      assert.equal(await page.locator('.node[data-route-id]').count(),shape==='grouped'?100:10000);
      assert.equal(await page.locator('.node.problem').count(),shape==='grouped'?100:10000);
      start=performance.now();
      await page.locator('#search').fill(inventory.routes.at(-1).fullPath);await frame();
      const searchMs=performance.now()-start;
      assert.equal(await page.locator('#results button').count(),1);
      start=performance.now();
      await page.locator('#results button').click();await frame();
      const selectMs=performance.now()-start;
      assert.match(await page.locator('#inspector').innerText(),/BENCHMARK_DIAGNOSTIC/);
      assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
      results.push({shape,sample,routes:10000,diagnostics:10000,htmlBytes:Buffer.byteLength(content),loadMs:Math.round(loadMs),searchMs:Math.round(searchMs),selectMs:Math.round(selectMs)});
      await page.close();
    }
  }
  fs.mkdirSync('reports', {recursive:true});
  fs.writeFileSync('reports/benchmark-viewer-10000.json',JSON.stringify({node:process.version,chromium:browser.version(),platform:process.platform,arch:process.arch,results},null,2));
  console.log(JSON.stringify(results,null,2));
} finally {await browser.close();fs.rmSync(directory,{recursive:true,force:true});}
