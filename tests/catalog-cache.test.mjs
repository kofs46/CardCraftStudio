import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
test('public page reuses the loaded catalog instead of making duplicate network requests',async()=>{
 const source=fs.readFileSync(new URL('../js/main.js',import.meta.url),'utf8');
 const start=source.indexOf('  async function catalog() {');
 const end=source.indexOf('  function cardPreview(',start);
 let calls=0;
 const context={liveCatalog:{products:[]},apiFetch:async()=>{calls++;throw Error('duplicate fetch');}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 await context.catalog();await context.catalog();
 assert.equal(calls,0);
});
