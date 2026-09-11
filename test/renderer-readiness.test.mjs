import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { waitForRenderer } from '../scripts/renderer-readiness.mjs';

function harness(discover, confirm) {
  let time = 0;
  const logs = [], closed = [];
  return { logs, closed, now: () => time,
    run: () => waitForRenderer({
      now: () => time, sleep: async ms => { time += ms; },
      discover: async () => discover(time),
      confirm: async target => confirm(target, time) ? { target, session: { close: () => closed.push(target.id) } } : null,
      log: (event, details) => logs.push({event,...details}),
    }),
  };
}
test('slow UI at 45 seconds passes without relaxing confirmation', async () => {
  const h = harness(() => [{id:'initial'},{id:'ui'}], (t,ms) => t.id === 'ui' && ms >= 45000);
  assert.equal((await h.run()).target.id,'ui');
  assert.equal(h.now(),45000);
  assert.equal(h.logs.filter(x=>x.event==='renderer-wait-stage').length,2);
});
test('initial target never appears: fails at 15 seconds', async () => {
  const h=harness(()=>[],()=>false);
  await assert.rejects(h.run(),/initial-app-target/);
  assert.equal(h.now(),15000);
});
test('initial target without semantic UI fails at fixed 60 seconds', async () => {
  const h=harness(()=>[{id:'initial'}],()=>false);
  await assert.rejects(h.run(),/semantic-shell-and-stable-attach/);
  assert.equal(h.now(),60000);
});
test('late initial target receives a separate 60 second budget', async () => {
  const h=harness(ms=>ms<12000?[]:[{id:'initial'}],()=>false);
  await assert.rejects(h.run(),/semantic-shell/);
  assert.equal(h.now(),72000);
});
test('replacement can become stable without restarting the budget', async () => {
  const h=harness(ms=>[{id:ms<40000?'initial':'replacement'}],(t,ms)=>t.id==='replacement'&&ms>=42000);
  assert.equal((await h.run()).target.id,'replacement');
  assert.ok(h.logs.some(x=>x.targetSetChanged));
});
test('endless replacements cannot extend deadline', async () => {
  const h=harness(ms=>[{id:String(ms)}],()=>false);
  await assert.rejects(h.run(),/semantic-shell/);
  assert.equal(h.now(),60000);
});
test('multiple stable candidates remain rejected and sessions close', async () => {
  const h=harness(()=>[{id:'a'},{id:'b'}],()=>true);
  await assert.rejects(h.run(),/semantic-shell/);
  assert.ok(h.closed.includes('a')&&h.closed.includes('b'));
});
test('single stable candidate succeeds immediately and is not closed', async () => {
  const h=harness(()=>[{id:'ui'}],()=>true);
  assert.equal((await h.run()).target.id,'ui');
  assert.deepEqual(h.closed,[]);
});
test('real timer bounds stalled discovery', async () => {
  await assert.rejects(waitForRenderer({initialMs:20,discover:()=>new Promise(()=>{}),confirm:()=>null}),/initial-app-target/);
});
test('expired confirmation cannot become an install candidate', async () => {
  let closed=false;
  await assert.rejects(waitForRenderer({initialMs:100,uiMs:20,discover:async()=>[{id:'ui'}],
    confirm:async(_t,signal)=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({session:{close:()=>{closed=true;}}}),{once:true})),
  }),/semantic-shell/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(closed,true);
});
test('injector retains strict semantic and stable probe requirements; launcher has headroom', async () => {
  const source=await fs.readFile(new URL('../scripts/injector.mjs',import.meta.url),'utf8');
  const launcher=await fs.readFile(new URL('../scripts/Start-ForestScholarSkin.ps1',import.meta.url),'utf8');
  assert.match(source,/RENDERER_PROBE_COUNT = 2/);
  assert.match(source,/RENDERER_PROBE_INTERVAL_MS = 250/);
  assert.match(source,/const accepted = rendererIsCodex\(probe\)/);
  assert.match(source,/if \(!accepted\) \{ session.close\(\); return null; \}/);
  assert.match(source,/const confirmed = await waitForRenderer/);
  assert.match(launcher,/AddSeconds\(120\)/);
  assert.match(launcher,/renderer-wait-\*/);
});
