import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { apply } from '../index.js';

function fixture(t) {
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
  apply({ effect: (callback) => callback(), webServer: { register: (route) => { routes.set(route.path, route); return () => {}; } } });
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
