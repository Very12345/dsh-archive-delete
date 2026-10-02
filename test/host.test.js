import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { apply } from '../index.js';

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
  apply({ effect: (callback) => callback(), webServer: { register: (route) => { routes.set(route.path, route); return () => {}; } }, ...context(home) });
  return { home, routes };
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

test('an existing session lock is protected when no lock probe is available', async (t) => {
  const { home, routes } = fixture(t);
  fs.writeFileSync(path.join(home, 'sessions', 'project', 'archived', 'session.lock'), '');
  const previousPath = process.env.PATH;
  process.env.PATH = '';
  t.after(() => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; });
  const response = await remove(routes, 'archived');
  assert.equal(response.body.ok, false);
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

test('native live sessions are protected even when there is no lock file',async t=>{
 const {home,routes}=fixture(t,()=>({get:name=>name==='sessions'?{get:id=>id==='archived'?{}:undefined}:undefined}));assert.equal((await remove(routes,'archived')).body.ok,false);assert.equal(fs.existsSync(path.join(home,'sessions','project','archived')),true);
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

test('failed native cleanup remains retryable after disk deletion and publishes removal only after successful cleanup',async t=>{
 let fail=true,events=0;const registry={archivedSessionIds:['archived'],list:()=>[],async unarchiveSession(id){if(fail)throw new Error('Disk metadata failure');this.archivedSessionIds=this.archivedSessionIds.filter(x=>x!==id);}};
 const {home,routes}=fixture(t,()=>({get:name=>name==='workspaceRegistry'?registry:undefined,emit:()=>events++}));assert.equal((await remove(routes,'archived')).body.ok,false);assert.equal(fs.existsSync(path.join(home,'sessions','project','archived')),false);assert.equal(events,0);assert.deepEqual(registry.archivedSessionIds,['archived']);fail=false;assert.equal((await remove(routes,'archived')).body.ok,true);assert.equal(events,1);assert.deepEqual(registry.archivedSessionIds,[]);
});
