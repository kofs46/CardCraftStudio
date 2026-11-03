import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/main.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('async function readApiJson('),source.indexOf('let liveCatalog'));
test('Forbidden text and static HTML responses show useful messages rather than JSON syntax errors',async()=>{
 const context={location:{hostname:'localhost'}};vm.createContext(context);vm.runInContext(helper,context);
 for(const body of ['Forbidden','<html>Not found</html>'])await assert.rejects(context.readApiJson(new Response(body,{status:403})),/npm.cmd start/);
 context.location.hostname='shop.example.com';await assert.rejects(context.readApiJson(new Response('Forbidden',{status:403})),/deployment access protection/);
 const parsed=await context.readApiJson(new Response(JSON.stringify({error:'Backend setup incomplete.'}),{status:503}));assert.equal(parsed.error,'Backend setup incomplete.');
 await assert.rejects(context.readApiJson(new Response('null')),/API/);
});
test('file URLs are rejected before any API or upload request',async()=>{
 const code=source.slice(source.indexOf('async function apiFetch('),source.indexOf('async function loadLiveCatalog('));
 const context={location:{protocol:'file:'},fetch:()=>{throw Error('Network must not be called');}};
 vm.createContext(context);vm.runInContext(code,context);
 await assert.rejects(context.apiFetch('/api/auth'),/HTML ফাইল সরাসরি/);
});
