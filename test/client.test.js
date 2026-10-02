import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture(t, ids = [], fetchList = async () => ({ ok: true, rows: ids, orphans: 0 }), options = {}) {
  let loaded;
  let snapshot = { state: 'ready', archivedSessionIds: [...ids] };
  const workspaceListeners = new Set();
  const effects = [];
  const events = new Map();
  const seats = new Map();
  let renders = 0;
  const react = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => { renders += 1; }],
    useEffect: (callback) => { const dispose = callback(); if (typeof dispose === 'function') effects.push(dispose); },
    useSyncExternalStore: (subscribe, getSnapshot) => { effects.push(subscribe(() => { renders += 1; })); return getSnapshot(); }
  };
  let requests = 0;
  let refreshes = 0;
  const styles = new Map();
  const document = { head: { appendChild: style => styles.set(style.id, style) }, getElementById: id => styles.get(id), createElement: () => ({ remove() { styles.delete(this.id); } }) };
  const sandbox = {
    console,
    confirm: () => !!options.confirm,
    document,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name) => events.delete(name),
    fetch: async (_url, init) => { requests += 1; return { ok: true, json: init?.method === 'POST' ? async () => options.remove(JSON.parse(init.body)) : fetchList }; },
    __ModuleLoader__: { load: (value) => { loaded = value; } }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), sandbox);
  const face = loaded.factory((name) => { assert.equal(name, 'react'); return react; });
  face.apply({
    get: name => name === 'sessions' ? { refresh: async () => { refreshes++; } } : undefined,
    workspaces: { list: {
      getSnapshot: () => snapshot,
      subscribe: (callback) => { workspaceListeners.add(callback); return () => workspaceListeners.delete(callback); }
    } },
    effect: (callback) => { const dispose = callback(); if (typeof dispose === 'function') effects.push(dispose); },
    slots: { inject: (_name, callback) => callback(), register: (meta, component) => seats.set(meta.name, component) }
  });
  const dispose = () => { for (const cleanup of effects.splice(0).reverse()) cleanup(); };
  t.after(dispose);
  return {
    row: (id) => seats.get('sidebar.workspaces.session.row.action')({ sessionId: id, displayTitle: id }),
    bar: () => seats.get('shell.overlay')({}),
    archived: (next) => { snapshot = { ...snapshot, archivedSessionIds: [...next] }; for (const callback of workspaceListeners) callback(); },
    get requests() { return requests; },
    get refreshes() { return refreshes; },
    get stylesheet() { return styles.get('dsh-archive-delete-hide')?.textContent ?? ''; },
    get renders() { return renders; },
    get subscriptions() { return workspaceListeners.size; },
    dispose
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('newly archived conversations gain delete controls without focus or reload', async (t) => {
  const client = fixture(t);
  await flush();
  assert.equal(client.row('new-chat'), null);
  const renders = client.renders;
  client.archived(['new-chat']);
  const row = client.row('new-chat');
  assert.ok(row, 'the confirmed archive must immediately become deletable');
  assert.equal(row.children[1].type, 'button');
  assert.ok(client.renders > renders, 'mounted rows must receive a state notification');
  assert.equal(client.row('ordinary-chat'), null);
});

test('a delayed list response cannot overwrite a newer DSH archive snapshot', async (t) => {
  let resolveList;
  const pending = new Promise((resolve) => { resolveList = resolve; });
  const client = fixture(t, [], () => pending);
  client.archived(['new-chat']);
  assert.ok(client.row('new-chat'));
  resolveList({ ok: true, rows: [], orphans: 0 });
  await flush();
  assert.ok(client.row('new-chat'), 'a stale HTTP result must not erase the archive');
});

test('unarchiving clears both delete controls and the batch selection', async (t) => {
  const client = fixture(t, ['old-chat'], async () => ({ ok: true, rows: [{ id: 'old-chat' }], orphans: 0 }));
  await flush();
  const row = client.row('old-chat');
  assert.ok(row);
  row.children[0].props.onChange({ stopPropagation() {} });
  assert.ok(client.bar());
  client.archived([]);
  assert.equal(client.row('old-chat'), null);
  assert.equal(client.bar(), null, 'restored conversations must leave the batch selection');
});

test('disposing the plugin removes its Workspace subscription', (t) => {
  const client = fixture(t);
  assert.equal(client.subscriptions, 1);
  client.dispose();
  assert.equal(client.subscriptions, 0);
});

test('deleting a newly archived session with no captured DOM node hides its stable row and refreshes the native list',async t=>{
 const client=fixture(t,[],undefined,{confirm:true,remove:()=>({ok:true,results:[{id:'new-chat',ok:true}]})});
 await flush();assert.equal(client.row('new-chat'),null);client.archived(['new-chat']);
 client.row('new-chat').children[1].props.onClick({stopPropagation(){}});await flush();
 assert.equal(client.row('new-chat'),null);assert.match(client.stylesheet,/data-row-key="session:new-chat"/);assert.equal(client.refreshes,1);
 client.archived(['new-chat']);assert.equal(client.row('new-chat'),null,'a stale archive projection must not resurrect the deleted controls');
});

test('partial batch deletion hides only successful identities and keeps failed rows usable',async t=>{
 const client=fixture(t,['good','bad'],undefined,{confirm:true,remove:()=>({ok:false,results:[{id:'good',ok:true},{id:'bad',ok:false,error:'Locked'}]})});
 await flush();client.row('good').children[0].props.onChange({stopPropagation(){}});client.row('bad').children[0].props.onChange({stopPropagation(){}});
 const button=node=>Array.isArray(node)?node.map(button).find(Boolean):node?.props?.key==='delete'?node:node?.children?.map(button).find(Boolean);
 button(client.bar()).props.onClick();await flush();
 assert.equal(client.row('good'),null);assert.ok(client.row('bad'));assert.match(client.stylesheet,/session:good/);assert.doesNotMatch(client.stylesheet,/session:bad/);
});

test('distinct run and task identities never share archive or deletion state',async t=>{
 const first='lark:chat:abcdefgh:0#1',second='lark:chat:ijklmnop:1#2';
 const client=fixture(t,[first],undefined,{confirm:true,remove:()=>({ok:true,results:[{id:first,ok:true}]})});await flush();assert.ok(client.row(first));assert.equal(client.row(second),null);
 client.archived([first,second]);client.row(first).children[1].props.onClick({stopPropagation(){}});await flush();assert.ok(client.row(second));assert.doesNotMatch(client.stylesheet,/ijklmnop/);
});

test('pending deletions stay hidden after a client reload while the host still advertises the archived session',async t=>{
 const client=fixture(t,['cached-id'],async()=>({ok:true,rows:[],orphans:0,deletedSessionIds:['cached-id'],pendingCleanup:['cached-id']}));await flush();assert.equal(client.row('cached-id'),null);assert.match(client.stylesheet,/session:cached-id/);client.archived(['cached-id']);assert.equal(client.row('cached-id'),null);
});
