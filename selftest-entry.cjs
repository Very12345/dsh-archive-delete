// Run OUR client entry the way the browser loader does, with slots + react stubs:
// proves the module face, both seat registrations, and — importantly — that the
// row controls appear ONLY for ids the host reports as archived.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const entry = process.argv[2] || path.join(__dirname, "client.js");
const ARCHIVED_ID = "session-aaaa-archived";
const PLAIN_ID = "session-bbbb-plain";

let captured;
globalThis.window = globalThis;
globalThis.__ModuleLoader__ = {
  load(module) {
    captured = module;
    return module;
  },
};
globalThis.confirm = () => false;
globalThis.fetch = (url) => {
  if (String(url).includes("/list")) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          total: 1,
          orphans: 0,
          rows: [{ id: ARCHIVED_ID, exists: true, live: false }],
        }),
    });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
};

const reactStub = {
  Fragment: Symbol("Fragment"),
  createElement(type, props, ...children) {
    return { type, props: props || {}, children };
  },
  useRef(initial) {
    return { current: initial ?? null };
  },
  useState(initial) {
    const slot = { value: typeof initial === "function" ? initial() : initial };
    return [slot.value, (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
  },
  useEffect() {},
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
};

// eslint-disable-next-line no-eval
eval(fs.readFileSync(entry, "utf8"));
if (!captured) {
  console.log("FAIL: the file never called __ModuleLoader__.load");
  process.exit(1);
}
console.log("entry id:", captured.id, "| factory:", typeof captured.factory);

const face = captured.factory((spec) => {
  if (spec === "react") return reactStub;
  throw new Error(`unexpected require: ${spec}`);
});
console.log("face:", { name: face.name, inject: face.inject, apply: typeof face.apply });

const seats = [];
const ctx = {
  effect: (callback) => callback(),
  workspaces: { list: {
    getSnapshot: () => ({ state: "ready", archivedSessionIds: [ARCHIVED_ID] }),
    subscribe: () => () => {},
  } },
  slots: {
    inject: (name, callback) => {
      callback();
      return () => {};
    },
    register(meta, component) {
      seats.push({ seat: meta.name, id: meta.id, order: meta.order, component });
      return () => {};
    },
  },
};
face.apply(ctx);
console.log("registered seats:", seats.map((s) => `${s.seat}#${s.id}@${s.order}`));

const row = seats.find((s) => s.seat === "sidebar.workspaces.session.row.action");
const bar = seats.find((s) => s.seat === "shell.overlay");
if (!row || !bar) throw new Error("a seat was not registered");

// wait for the async /list the entry fires on apply()
setTimeout(() => {
  const unarchived = row.component({ sessionId: PLAIN_ID, displayTitle: "normal chat" });
  assert.equal(unarchived, null, "ordinary sessions must not offer deletion");
  console.log("NOT archived -> no controls:", unarchived === null);

  const archived = row.component({ sessionId: ARCHIVED_ID, displayTitle: "old chat" });
  const [checkbox, button] = archived?.children || [];
  assert.equal(checkbox?.props?.type, "checkbox");
  assert.equal(button?.type, "button");
  assert.equal(row.component({}), null);
  assert.equal(bar.component({}), null);
  console.log("archived -> checkbox:", checkbox?.props?.type === "checkbox");
  console.log("archived -> delete button:", button?.type === "button");

  console.log("renders null without a sessionId:", row.component({}) === null);
  console.log("bar renders nothing while idle:", bar.component({}) === null);
  console.log("RESULT: entry self-test passed");
}, 30);
