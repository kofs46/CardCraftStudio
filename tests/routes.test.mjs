import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {startServer} from '../server/local.mjs';
test('clean page routes work and old links preserve checkout/tracking parameters',async()=>{
 const {server,url}=await startServer({port:0});
 try {
  for(const page of ['homepage','services','tracking','about','order','order-list','admin','privacy']) {
   const response=await fetch(url+'/'+page);assert.equal(response.status,200,page);assert.match(response.headers.get('content-type'),/text\/html/);
  }
  for(const [old,clean] of [['/index.html','/homepage'],['/order.html?product=premium-nfc','/order?product=premium-nfc'],['/track.html?code=CC-123456ABCDEF','/tracking?code=CC-123456ABCDEF'],['/admin.html?view=orders','/admin?view=orders']]){
   const response=await fetch(url+old,{redirect:'manual'});assert.equal(response.status,308);assert.equal(response.headers.get('location'),clean);
  }
  const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.ok(config.rewrites.some(r=>r.source==='/services'&&r.destination==='/index.html'));
  assert.ok(config.rewrites.some(r=>r.source==='/tracking'&&r.destination==='/track.html'));
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/href="\/services"/);assert.match(html,/google-site-verification/);
 } finally {await new Promise(resolve=>server.close(resolve));}
});
