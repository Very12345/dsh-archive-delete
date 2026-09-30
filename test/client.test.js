import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture(t, ids = [], fetchList = async () => ({ ok: true, rows: ids, orphans: 0 })) {
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
  const sandbox = {
    console,
    confirm: () => false,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name) => events.delete(name),
    fetch: async () => { requests += 1; return { ok: true, json: fetchList }; },
    __ModuleLoader__: { load: (value) => { loaded = value; } }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), sandbox);
  const face = loaded.factory((name) => { assert.equal(name, 'react'); return react; });
  face.apply({
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
