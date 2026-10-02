import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { apply, probeSessionLock } from '../index.js';
import { deletionBook } from '../deletion-book.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function fixture(t, context = () => ({})) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-archive-plugin-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; fs.rmSync(home, { recursive: true, force: true }); });
  for (const id of ['archived', 'ordinary']) {
    fs.mkdirSync(path.join(home, 'sessions', 'project', id), { recursive: true });
    fs.writeFileSync(path.join(home, 'sessions', 'project', id, 'session.v4.jsonl.zstd'), 'fixture');
  }
  fs.mkdirSync(path.join(home, 'storages'));
  fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), JSON.stringify({ global: { archivedSessionIds: ['archived'] } }));
  const routes = new Map();
  const cleanup=[],events=new Map();
  apply({ effect: (callback) => {const dispose=callback();if(typeof dispose==='function')cleanup.push(dispose);}, on:(name,callback)=>events.set(name,callback), webServer: { register: (route) => { routes.set(route.path, route); return () => {}; } }, ...context(home) });
  t.after(async()=>{for(const dispose of cleanup.reverse())await dispose();});
  return { home, routes, events };
}

async function remove(routes, id) {
  const req = Readable.from([JSON.stringify({ sessionId: id })]);
  req.method = 'POST';
  let status, body;
  await routes.get('/plugins/dsh-archive-delete/delete').handler(req, { writeHead: (value) => { status = value; }, end: (value) => { body = JSON.parse(value); } });
  return { status, body };
}

test('deleting an archived session updates both storage and its archive gate', async (t) => {
  const { home, routes } = fixture(t);
  const response = await remove(routes, 'archived');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(fs.existsSync(path.join(home, 'sessions', 'project', 'archived')), false);
  assert.equal(fs.existsSync(path.join(home, 'sessions', 'project', 'ordinary')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'storages', 'workspace.json'))).global.archivedSessionIds, []);
});

test('the host refuses ordinary sessions even when called outside the GUI', async (t) => {
  const { home, routes } = fixture(t);
  const response = await remove(routes, 'ordinary');
  assert.equal(response.body.ok, false);
  assert.equal(fs.existsSync(path.join(home, 'sessions', 'project', 'ordinary')), true);
});

test('unknown lock ownership remains protected when the OS probe is unavailable', async (t) => {
  const { home, routes } = fixture(t);
  fs.writeFileSync(path.join(home, 'sessions', 'project', 'archived', 'session.lock'), '');
  assert.equal(probeSessionLock(path.join(home,'sessions','project','archived'),'linux',()=>{throw Object.assign(new Error('Unavailable'),{code:'ENOENT'});}),true);
  assert.equal(fs.existsSync(path.join(home, 'sessions', 'project', 'archived')), true);
});

test('native registry is authoritative over stale disk data and deletion publishes metadata and Session removal',async t=>{
 let registry,members=['archived','ordinary'],pins=['archived','other'],events=[];
 const {home,routes}=fixture(t,home=>{
  fs.writeFileSync(path.join(home,'storages','workspace.json'),JSON.stringify({global:{archivedSessionIds:[]}}));
  const workspace={get sessionIds(){return members;},async detachSession(id){members=members.filter(x=>x!==id);}};
  registry={archivedSessionIds:['archived'],list:()=>[workspace],async unpinSession(id){pins=pins.filter(x=>x!==id);},async unarchiveSession(id){this.archivedSessionIds=this.archivedSessionIds.filter(x=>x!==id);}};
  return {get:name=>name==='workspaceRegistry'?registry:undefined,emit:(event,id)=>{assert.equal(fs.existsSync(path.join(home,'sessions','project',id)),false);assert.deepEqual(members,['ordinary']);assert.deepEqual(registry.archivedSessionIds,[]);events.push([event,id]);}};
 });
 const response=await remove(routes,'archived');assert.equal(response.body.ok,true);assert.deepEqual(pins,['other']);assert.deepEqual(events,[['api-session/removed','archived']]);assert.equal(fs.existsSync(path.join(home,'sessions','project','ordinary')),true);
});

test('legacy cleanup removes only the deleted identity from all registry records',async t=>{
 const {home,routes}=fixture(t);const file=path.join(home,'storages','workspace.json');const original={unit:2,global:{archivedSessionIds:['archived','other'],pinnedSessionIds:['archived','ordinary'],setting:'keep'},tables:{workspaces:{one:{title:'keep',sessionIds:['archived','ordinary']},two:{sessionIds:['other']}}}};fs.writeFileSync(file,JSON.stringify(original));
 assert.equal((await remove(routes,'archived')).body.ok,true);const state=JSON.parse(fs.readFileSync(file));assert.deepEqual(state.global.archivedSessionIds,['other']);assert.deepEqual(state.global.pinnedSessionIds,['ordinary']);assert.deepEqual(state.tables.workspaces.one.sessionIds,['ordinary']);assert.deepEqual(state.tables.workspaces.two,original.tables.workspaces.two);assert.equal(state.global.setting,'keep');assert.equal(state.unit,2);
});

test('unsupported native membership removal refuses before deleting the session directory',async t=>{
 const {home,routes}=fixture(t,()=>({get:name=>name==='workspaceRegistry'?{archivedSessionIds:['archived'],list:()=>[{sessionIds:['archived']}],unarchiveSession:async()=>{}}:undefined}));
 assert.equal((await remove(routes,'archived')).body.ok,false);assert.equal(fs.existsSync(path.join(home,'sessions','project','archived')),true);
});

test('running native agents are protected even when there is no lock file',async t=>{
 const {home,routes}=fixture(t,()=>({get:name=>name==='agents'?{get:id=>id==='archived'?{status:'running'}:undefined}:undefined}));assert.equal((await remove(routes,'archived')).body.ok,false);assert.equal(fs.existsSync(path.join(home,'sessions','project','archived')),true);
});

test('encoded DSH identities use four-digit escapes and other run identities remain protected',async t=>{
 const {home,routes}=fixture(t),first='lark:chat:abcdefgh:0#1',second='lark:chat:ijklmnop:1#2';
 for(const id of [first,second]){const encoded=id.replace(/[^A-Za-z0-9._-]/g,c=>'~'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'));fs.mkdirSync(path.join(home,'sessions','project',encoded));fs.writeFileSync(path.join(home,'sessions','project',encoded,'session.v4.jsonl.zstd'),'test');}
 fs.writeFileSync(path.join(home,'storages','workspace.json'),JSON.stringify({global:{archivedSessionIds:[first]}}));assert.equal((await remove(routes,second)).body.ok,false);assert.equal((await remove(routes,first)).body.ok,true);
});

test('an absent log still loses its durable membership even if the public workspace view filtered it out',async t=>{
 let durable=['ghost','ordinary'],notified=false;
 const registry={archivedSessionIds:['ghost'],list:()=>[{sessionIds:['ordinary'],async detachSession(id){durable=durable.filter(x=>x!==id);}}],async unarchiveSession(id){this.archivedSessionIds=this.archivedSessionIds.filter(x=>x!==id);}};
 const {routes}=fixture(t,()=>({get:name=>name==='workspaceRegistry'?registry:undefined,emit:()=>{notified=true;}}));assert.equal((await remove(routes,'ghost')).body.ok,true);assert.deepEqual(durable,['ordinary']);assert.deepEqual(registry.archivedSessionIds,[]);assert.equal(notified,true);
});

test('failed native cleanup is queued after disk deletion and is retryable',async t=>{
 let fail=true,events=0;const registry={archivedSessionIds:['archived'],list:()=>[],async unarchiveSession(id){if(fail)throw new Error('Disk metadata failure');this.archivedSessionIds=this.archivedSessionIds.filter(x=>x!==id);}};
 const {home,routes}=fixture(t,()=>({get:name=>name==='workspaceRegistry'?registry:undefined,emit:()=>events++}));const first=await remove(routes,'archived');assert.equal(first.body.ok,true);assert.equal(first.body.results[0].pending,true);assert.equal(fs.existsSync(path.join(home,'sessions','project','archived')),false);assert.deepEqual(registry.archivedSessionIds,['archived']);fail=false;assert.equal((await remove(routes,'archived')).body.ok,true);assert.deepEqual(registry.archivedSessionIds,[]);
});

test('idle resident sessions disappear immediately and finish cleanup after owner release',async t=>{
 let resident=true;const {home,routes,events}=fixture(t,()=>({get:name=>name==='sessions'?{get:()=>resident?{}:undefined}:name==='agents'?{get:()=>({status:'idle'})}:undefined}));
 const response=await remove(routes,'archived');assert.equal(response.body.ok,true);assert.equal(response.body.results[0].pending,true);assert.equal(fs.existsSync(path.join(home,'sessions','project','archived')),true);
 let listed;routes.get('/plugins/dsh-archive-delete/list').handler({}, {writeHead(){},end:v=>listed=JSON.parse(v)});assert.deepEqual(listed.rows,[]);assert.deepEqual(listed.pendingCleanup,['archived']);
 resident=false;events.get('session/disposed')({id:'archived'});for(let i=0;i<20&&fs.existsSync(path.join(home,'sessions','project','archived'));i++)await new Promise(r=>setTimeout(r,5));assert.equal(fs.existsSync(path.join(home,'sessions','project','archived')),false);
 const book=deletionBook(home);book.refresh();assert.equal(book.entries.get('archived').state,'deleted');
});

test('deletion markers block deleted session IDs from being recreated or driven',async t=>{
 let resident=true;const {home,routes,events}=fixture(t,()=>({get:name=>name==='sessions'?{get:()=>resident?{}:undefined}:undefined}));await remove(routes,'archived');
 assert.deepEqual(await events.get('agent/pre-step')({agent:{id:'archived'}},()=>Promise.resolve('allowed')),{kind:'reject'});
 assert.throws(()=>events.get('session/created')({id:'archived'}),/已删除/);assert.equal(await events.get('agent/pre-step')({agent:{id:'ordinary'}},()=>Promise.resolve('allowed')),'allowed');
});

test('Windows probes real handle ownership and deletes a stopped session with a stale lock file', {skip:process.platform!=='win32'},async t=>{
 const {home,routes}=fixture(t),directory=path.join(home,'sessions','project','archived'),lock=path.join(directory,'session.lock');fs.writeFileSync(lock,'');
 const script="$f=[IO.File]::Open('"+lock.replaceAll("'","''")+"',[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);[Console]::WriteLine('ready');[Console]::Out.Flush();[Console]::ReadLine()|Out-Null;$f.Dispose()";
 const child=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());
 await once(child.stdout,'data');assert.equal(probeSessionLock(directory),true);child.stdin.end('\n');await once(child,'exit');assert.equal(probeSessionLock(directory),false);
 assert.equal((await remove(routes,'archived')).body.ok,true);assert.equal(fs.existsSync(directory),false);
});

test('pending cleanup survives reload and completes after an idle resident cache has gone',async t=>{
 const {home,routes}=fixture(t,()=>({get:name=>name==='sessions'?{get:()=>({})}:undefined}));assert.equal((await remove(routes,'archived')).body.results[0].pending,true);
 const effects=[];apply({effect:callback=>{const close=callback();if(typeof close==='function')effects.push(close);},webServer:{register:()=>()=>{}}});t.after(async()=>{for(const close of effects)await close();});
 for(let i=0;i<20&&fs.existsSync(path.join(home,'sessions','project','archived'));i++)await new Promise(r=>setTimeout(r,5));assert.equal(fs.existsSync(path.join(home,'sessions','project','archived')),false);const book=deletionBook(home);book.refresh();assert.equal(book.entries.get('archived').state,'deleted');
});
