import test from 'node:test';
import assert from 'node:assert/strict';
import {handleWidgetLayout,normalizeLayoutSize,LAYOUT_WIDGETS,withWidgetLayouts} from '../widget-layout-api.mjs';
const instance='w_layout_test_instance_12345678';
const size={scale:1,contentW:850,frameH:460,widthLocked:true,heightLocked:true,scaleLocked:true};
function db() {
  const rows=new Map([[`instance-meta:${instance}`,{value:'{}'}]]),calls=[];
  return {rows,calls,DB:{prepare(sql){return{bind(...params){
    calls.push({sql,params});
    return {async first(){return rows.has(params[0])?{key:params[0]}:null;},
      async all(){return{results:params.filter(k=>rows.has(k)).map(key=>({key,...rows.get(key)}))};},
      async run(){rows.set(params[0],{value:params[1],updatedAt:params[2]});return{success:true};}};
  }}}}};
}
function req(body,key=instance,method=body?'POST':'GET') {return new Request(`https://example.test/api/widget-layout?w=${key}`,{method,...(body?{body:JSON.stringify(body)}:{})});}
test('wrapper preserves existing APIs and scheduled handler without calling them for sizes',async()=>{
  const existing={scheduled(){},fetch(request,env,ctx){assert.equal(this,existing);return new Response('legacy');}};
  const wrapped=withWidgetLayouts(existing);
  assert.equal(wrapped.scheduled,existing.scheduled);
  assert.equal(await(await wrapped.fetch(new Request('https://example.test/'),{},{})).text(),'legacy');
  assert.equal((await wrapped.fetch(req(),db(),{})).status,200);
});
test('layout API uses only registered-instance indexed settings and preserves other widget rows',async()=>{
  const env=db(); env.rows.set(`instance:${instance}:worklog`,{value:'private fixture'});
  for(const widget of LAYOUT_WIDGETS) assert.equal((await handleWidgetLayout(req({widget,size}),env)).status,200);
  const result=await(await handleWidgetLayout(req(),env)).json();
  assert.equal(Object.keys(result.data.layouts).length,6);
  assert.deepEqual(result.data.layouts.notes.size,size);
  assert.equal(env.rows.get(`instance:${instance}:worklog`).value,'private fixture');
  assert.ok(env.calls.every(c=>/widget_settings/.test(c.sql)&&!/DELETE|worklog_tasks|ALTER|CREATE TABLE/.test(c.sql)));
  assert.equal((await handleWidgetLayout(req(null,'w_other_instance_123456789012'),env)).status,404);
  assert.equal(env.rows.size,8);
});
test('invalid keys, fields, sizes and non-layout requests cannot write data',async()=>{
  const env=db();
  for(const body of [{widget:'tasks',size},{widget:'notes',size:{...size,tasks:[]}},{widget:'notes',size:{...size,frameH:-1}},{widget:'notes',size:{...size,scale:'2'}},{widget:'notes',size,extra:true}]) {
    assert.equal((await handleWidgetLayout(req(body),env)).status,400);
  }
  assert.equal((await handleWidgetLayout(req(null,''),env)).status,400);
  assert.equal((await handleWidgetLayout(req(null,instance,'DELETE'),env)).status,405);
  assert.equal(await handleWidgetLayout(new Request('https://example.test/api/worklog/state'),env),null);
  assert.equal(env.calls.length,0);
  assert.equal((await handleWidgetLayout(req(null,instance,'OPTIONS'),env)).status,204);
});
test('corrupt records and D1 failures remain errors, not empty layouts',async()=>{
  const env=db();
  env.rows.set(`instance:${instance}:widgetLayout:v1:notes`,{value:'broken'});
  assert.equal((await handleWidgetLayout(req(),env)).status,503);
  const unavailable={DB:{prepare(){throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit");}}};
  const response=await handleWidgetLayout(req(),unavailable);
  assert.equal(response.status,503);assert.match((await response.json()).error,/D1_ERROR/);
  assert.throws(()=>normalizeLayoutSize({scale:NaN}),/invalid/);
});
