import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/main.js',import.meta.url),'utf8');
test('admin navigation reuses fresh data, preserves history and refreshes stale data',()=>{
 const start=source.indexOf('  function navigateAdmin('),end=source.indexOf('  app.addEventListener',start);
 let loads=0,renders=0,pushes=0;
 const context={URL,Date,data:{orders:[]},lastAdminLoad:Date.now(),page:'dashboard',history:{pushState:()=>pushes++},render:()=>renders++,localizeAdmin:()=>{},reload:()=>{loads++;return Promise.resolve();},message:()=>{}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 assert.equal(context.navigateAdmin(new URL('https://shop.example/admin.html?view=products')),true);
 assert.equal(context.page,'products');assert.equal(loads,0);assert.equal(renders,1);assert.equal(pushes,1);
 context.navigateAdmin(new URL('https://shop.example/admin.html?view=orders'),false);assert.equal(pushes,1);
 context.lastAdminLoad=0;context.navigateAdmin(new URL('https://shop.example/admin.html?view=dashboard'));assert.equal(loads,1);
 assert.equal(context.navigateAdmin(new URL('https://shop.example/admin.html')),false);
 context.data=null;assert.equal(context.navigateAdmin(new URL('https://shop.example/admin.html?view=products')),false);
});
test('simultaneous admin reloads share one request',async()=>{
 const start=source.indexOf('  async function reload()'),end=source.indexOf('  function navigateAdmin(',start);
 let loads=0,release;
 const context={Date,adminReload:null,data:null,lastAdminLoad:0,api:()=>{loads++;return new Promise(resolve=>release=resolve);},render:()=>{},localizeAdmin:()=>{}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const first=context.reload(),second=context.reload();assert.equal(loads,1);
 release({orders:[]});await Promise.all([first,second]);assert.equal(context.adminReload,null);assert.ok(context.lastAdminLoad>0);
});
