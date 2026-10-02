// dsh-archive-delete — HOST half.
//
// DSH can only ARCHIVE a conversation: it hides the session id inside
// <DSH_HOME>/storages/workspace.json (global.archivedSessionIds) and the Web GUI
// then offers no list, no restore and no delete for it. The community plugins
// covering that gap are all still pinned to the 0.1.x line, so this is our own
// line-agnostic seat: the client half injects a delete button into the sidebar
// row's hover card, and this half answers it with one HTTP route that removes the
// session directory AND its archive entry.
//
// Standalone: no bridge/Feishu coupling or DSH service imports. The native
// registry is discovered on demand; older hosts retain the file-store fallback.
// File locks and live store entries prevent deleting conversations in use.
import { execFileSync, execFile } from "node:child_process";
import {
	existsSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deletionBook } from "./deletion-book.js";

export const name = "dsh-archive-delete";
export const inject = ["webServer"];

/** Session logs are `session[.<fmt>].jsonl.zstd` — v4 since the 0.2 line. */
const LOG_PATTERN = /^session(?:\.[a-z0-9]+)?\.jsonl\.zstd$/;
/** DSH's open-session lock (flock'd while a session is being driven). */
const LOCK_NAME = "session.lock";

const resolveDshHome = () => {
	const explicit = process.env.DSH_HOME?.trim();
	if (explicit) return explicit;
	const webagentHome = process.env.WEBAGENT_HOME?.trim();
	if (webagentHome) return join(webagentHome, "deepseek-harness");
	return join(homedir(), ".dsh");
};

/** Directory names encode the id (`lark-link:…` → `lark-link~003A…`). */
const decodeDirName = (dirName) =>
	dirName.replace(/~([0-9a-fA-F]{4})/g, (_all, hex) =>
		String.fromCharCode(Number.parseInt(hex, 16)),
	);

const sessionsRoot = () => join(resolveDshHome(), "sessions");

/** Find the session directory for an id, scanning every project key. */
const locate = (sessionId) => {
	const root = sessionsRoot();
	let projects;
	try {
		projects = readdirSync(root);
	} catch {
		return undefined;
	}
	for (const project of projects) {
		const projectDir = join(root, project);
		let entries;
		try {
			entries = readdirSync(projectDir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry !== sessionId && decodeDirName(entry) !== sessionId) continue;
			const dir = join(projectDir, entry);
			try {
				if (!statSync(dir).isDirectory()) continue;
			} catch {
				continue;
			}
			const logName = readdirSync(dir).find((file) => LOG_PATTERN.test(file));
			return { dir, project, projectDir, logName };
		}
	}
	return undefined;
};

/**
 * A live session holds its lock with flock(2), so acquiring it momentarily is
 * the test: success ⇒ nobody is driving it, failure ⇒ leave it alone.
 */
export const probeSessionLock = (dir, platform = process.platform, execute = execFileSync) => {
	const lock = join(dir, LOCK_NAME);
	if (!existsSync(lock)) return false;
	try {
		if (platform === "win32") execute(join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./native/probe-session-lock.ps1", import.meta.url)), "-Path", lock], { stdio: "ignore", windowsHide: true, timeout: 3000 });
		else execute("flock", ["-n", lock, "true"], { stdio: "ignore", windowsHide: true, timeout: 3000 });
		return false;
	} catch (error) {
		// A missing flock binary cannot prove that an existing lock is idle.
		// Refuse deletion on platforms where the lock cannot be probed.
		if (error?.code === "ENOENT") return true;
		return true;
	}
};

const registryPath = () => join(resolveDshHome(), "storages", "workspace.json");

/** Legacy fallback: remove this identity from archives, pins and workspace membership. */
const unarchive = (sessionId) => {
	const file = registryPath();
	let registry;
	try {
		registry = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return false;
	}
	if (!registry || typeof registry !== "object") return false;
	const global = registry.global ?? {};
	const ids = Array.isArray(global.archivedSessionIds)
		? global.archivedSessionIds.map(String)
		: [];
	const kept = ids.filter((id) => id !== sessionId);
	let changed = kept.length !== ids.length;
	global.archivedSessionIds = kept;
	if (Array.isArray(global.pinnedSessionIds)) {
		const pinned = global.pinnedSessionIds.filter((id) => id !== sessionId);
		changed ||= pinned.length !== global.pinnedSessionIds.length;
		global.pinnedSessionIds = pinned;
	}
	for (const record of Object.values(registry.tables?.workspaces ?? {})) {
		if (!Array.isArray(record?.sessionIds)) continue;
		const members = record.sessionIds.filter((id) => id !== sessionId);
		changed ||= members.length !== record.sessionIds.length;
		record.sessionIds = members;
	}
	if (!changed) return false;
	const tmp = `${file}.archive-delete-write`;
	writeFileSync(tmp, JSON.stringify({ ...registry, global }, null, 2));
	renameSync(tmp, file);
	return true;
};

const sendJson = (res, status, payload) => {
	res?.writeHead?.(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res?.end?.(JSON.stringify(payload));
};

const readJson = (req) =>
	new Promise((resolve) => {
		let body = "";
		req?.on?.("data", (chunk) => {
			body += chunk;
			if (body.length > 65536) req.destroy?.();
		});
		req?.on?.("end", () => {
			try {
				resolve(JSON.parse(body || "{}"));
			} catch {
				resolve({});
			}
		});
		req?.on?.("error", () => resolve({}));
	});

/** Use the live registry's durable writes so its caches and Workspace feed agree. */
const nativeRegistry = (ctx) => {
	const registry = ctx?.get?.("workspaceRegistry");
	if (!registry) return undefined;
	if (!Array.isArray(registry.archivedSessionIds) || typeof registry.list !== "function" || typeof registry.unarchiveSession !== "function")
		throw new Error("当前 DSH 工作区登记接口不兼容，未进行删除");
	return registry;
};
const isLive = async (dir) => {
	const lock=join(dir,LOCK_NAME);if(!existsSync(lock))return false;
	const command=process.platform==="win32" ? join(process.env.SystemRoot||"C:/Windows","System32/WindowsPowerShell/v1.0/powershell.exe") : "flock";
	const args=process.platform==="win32" ? ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",fileURLToPath(new URL("./native/probe-session-lock.ps1",import.meta.url)),"-Path",lock] : ["-n",lock,"true"];
	return new Promise(resolve=>execFile(command,args,{windowsHide:true,timeout:3000},error=>resolve(!!error)));
};

const isActive = async (ctx, id) => {
	if (ctx?.get?.("agents")?.get?.(id)?.status === "running") return true;
	if (typeof ctx?.waterfall === "function") return (await ctx.waterfall("workspace/session-activity", { sessionId: id }, () => Promise.resolve([]))).length > 0;
	return false;
};

const removeRegistration = async (id, registry, ctx) => {
	if (registry) {
		for (const workspace of registry.list()) {
			if (typeof workspace.detachSession !== "function") throw new Error("当前 DSH 工作区不支持移除会话登记");
			// The public sessionIds view can already filter a missing log; detach still
			// removes its durable accounting slot, and is a no-op for other workspaces.
			await workspace.detachSession(id);
		}
		await registry.unpinSession?.(id);
		await registry.unarchiveSession(id);
	} else unarchive(id);
	// Official Session Controller relays this event to every connected session list.
	try { ctx?.emit?.("api-session/removed", id); } catch (error) { ctx?.logger?.warn?.("删除后的会话列表通知失败：" + String(error)); }
};

const removeSession = async (sessionId, registry, ctx, book, queued = false) => {
	if (await isActive(ctx, sessionId)) return { ok: false, error: "该会话仍有任务正在执行或结束中，请先停止并等待任务结束" };
	for (const workspace of registry?.list() ?? []) {
		if (typeof workspace.detachSession !== "function")
			throw new Error("当前 DSH 工作区不支持移除会话登记，未进行删除");
	}
	const found = locate(sessionId);
	const resident = !!ctx?.get?.("sessions")?.get?.(sessionId);
	if (resident || found && await isLive(found.dir) || ctx?.get?.("sessions")?.get?.(sessionId)) {
		if (!queued) { book.mark(sessionId, "pending"); try { ctx?.emit?.("api-session/removed", sessionId); } catch {} }
		return { ok: true, pending: true, message: "已从列表移除；宿主释放文件句柄后自动清理记录" };
	}
	if (!queued) book.mark(sessionId, "pending");
	if (!found) {
		await removeRegistration(sessionId, registry, ctx);
		book.mark(sessionId, "deleted");
		return {
			ok: true,
			message: "会话已不在磁盘上，已清理会话登记和列表",
		};
	}
	const scope = relative(resolve(sessionsRoot()), resolve(found.dir));
	if (!scope || scope === ".." || scope.startsWith(".." + sep) || isAbsolute(scope)) throw new Error("会话目录不在当前 DSH 会话存储内");
	rmSync(found.dir, { recursive: true, force: true });
	await removeRegistration(sessionId, registry, ctx);
	book.mark(sessionId, "deleted");
	return {
		ok: true,
		message: `已删除 ${found.project}/${sessionId}（并清理会话登记）`,
	};
};

/** Every id is attempted; one live session must not block the rest. */
const removeMany = async (ids, registry, ctx, book) => {
	const results = [];
	for (const id of ids) {
		try {
			const result = await removeSession(id, registry, ctx, book);
			results.push({ id, ...result });
		} catch (error) {
			if(book.entries.get(id)?.state==="pending"){
				try{ctx?.emit?.("api-session/removed",id);}catch{}
				results.push({id,ok:true,pending:true,message:"已进入清理队列，待宿主释放文件或存储恢复后自动完成"});continue;
			}
			results.push({
				id,
				ok: false,
				error: error instanceof Error ? error.message : "删除失败",
			});
		}
	}
	return results;
};

/**
 * Deletion is for ARCHIVED conversations only — that is the plugin's whole scope,
 * and it must hold at the API too, not just in the GUI: a plain conversation id
 * is refused unless the caller explicitly forces it. Without this, any id in the
 * session store could be erased through the route (which is how a live session
 * got removed during verification).
 */
const archivedGate = (registry) => {
	if (registry) return new Set(registry.archivedSessionIds.map(String));
	const ids = new Set();
	try {
		const registry = JSON.parse(readFileSync(registryPath(), "utf8"));
		const raw = registry?.global?.archivedSessionIds;
		if (Array.isArray(raw)) for (const id of raw) ids.add(String(id));
	} catch {
		// no registry yet — nothing is gated
	}
	return ids;
};

/** Session identities are opaque; different runs/tasks must never be conflated. */
const gateKey = (id) => String(id ?? "").trim();

const guardScope = (ids, force, registry, book) => {
	const gate = archivedGate(registry);
	const allowed = new Set([...gate].map((id) => gateKey(id)));
	for (const id of book.refresh().keys()) allowed.add(id);
	if (force) return ids;
	return ids.filter((id) => allowed.has(gateKey(id)));
};

/** Drop every gate entry whose session directory is already gone (list-only). */
const pruneDangling = async (registry, ctx, book) => {
	const dangling = listArchived(registry).rows.filter((row) => !row.exists);
	return { targets: dangling.map((row) => row.id), results: await removeMany(dangling.map((row) => row.id), registry, ctx, book) };
};

/** Archived ids with their on-disk state — copied from the bridge's route. */
const listArchived = (registry) => {
	let ids = registry ? [...registry.archivedSessionIds] : [];
	try {
		if (!registry) {
		const registry = JSON.parse(readFileSync(registryPath(), "utf8"));
		const raw = registry?.global?.archivedSessionIds;
		if (Array.isArray(raw)) ids = raw.map(String);
		}
	} catch {
		// no registry yet
	}
	const rows = ids.map((id) => {
		const found = locate(id);
		// Listing must not start one OS probe per row; verify locks only on deletion.
		return { id, exists: Boolean(found), live: found ? existsSync(join(found.dir, LOCK_NAME)) : false };
	});
	return { total: rows.length, orphans: rows.filter((row) => !row.exists).length, rows };
};

export function apply(ctx) {
	const webServer = ctx?.webServer;
	if (!webServer) return;
	const book = deletionBook(resolveDshHome());book.refresh();
	let deleting = Promise.resolve();
	let stopped = false;
	const serialize = (action) => { const task = deleting.then(action); deleting = task.catch(() => {}); return task; };
	let draining=null;
	const drain = () => {
		if(stopped || draining)return draining||Promise.resolve();
		draining=(async()=>{
			for(const record of [...book.refresh().values()])if(record.state==="pending" && !stopped){
				await serialize(async()=>{
					if(stopped || book.refresh().get(record.id)?.state!=="pending")return;
					try{await removeSession(record.id,nativeRegistry(ctx),ctx,book,true);}catch(error){ctx?.logger?.warn?.("待清理会话暂未释放："+String(error));}
				});
			}
		})().finally(()=>{draining=null;});return draining;
	};
	const backgroundDrain=()=>{void drain().catch(error=>ctx?.logger?.warn?.("会话清理队列读取失败："+String(error)));};
	ctx.effect(() => {
		backgroundDrain();const timer=setInterval(backgroundDrain,5000);timer.unref?.();
		return async () => { stopped = true; clearInterval(timer); await deleting; };
	}, "archive-delete: finish pending cleanup");
	if (typeof ctx.on === "function") {
		ctx.on("session/disposed", backgroundDrain);
		ctx.on("agent/disposed", backgroundDrain);
		ctx.on("agent/pre-step", (payload, next) => book.has(String(payload?.agent?.session?.id || payload?.agent?.id || "")) ? Promise.resolve({kind:"reject"}) : next());
		ctx.on("session/created", session => {
			const id=String(session.id);
			if(book.has(id)){book.mark(id,"pending");throw new Error("该会话已删除，不能重新创建同一会话 ID");}
		});
	}

	ctx.effect(
		() =>
			webServer.register({
				kind: "exact",
				path: "/plugins/dsh-archive-delete/delete",
				handler: async (req, res) => {
					if (req?.method !== "POST") {
						sendJson(res, 405, { ok: false, error: "仅支持 POST" });
						return;
					}
					const body = await readJson(req);
					await serialize(async () => {
					try {
						const registry = nativeRegistry(ctx);
						// `op: "prune"` sweeps every gate entry whose session is already
						// gone; `sessionIds` deletes a batch; `sessionId` one session.
						if (String(body?.op ?? "") === "prune") {
							const swept = await pruneDangling(registry, ctx, book);
							sendJson(res, 200, {
								ok: true,
								pruned: swept.results.length,
								removed: swept.results.filter((row) => row.ok).length,
								results: swept.results,
							});
							return;
						}
						const ids = Array.isArray(body?.sessionIds)
							? body.sessionIds.map((id) => String(id ?? "").trim()).filter(Boolean)
							: [String(body?.sessionId ?? "").trim()].filter(Boolean);
						if (ids.length === 0) {
							sendJson(res, 400, { ok: false, error: "缺少 sessionId / sessionIds" });
							return;
						}
						// Scope guard: only ARCHIVED conversations are deletable (the GUI
						// only shows controls for those, and the API must agree).
						const allowed = guardScope(ids, body?.force === true, registry, book);
						const refused = ids
							.filter((id) => !allowed.includes(id))
							.map((id) => ({
								id,
								ok: false,
								error: "该会话未归档，本插件只删除已归档的对话",
							}));
						const results = [...await removeMany(allowed, registry, ctx, book), ...refused];
						const failed = results.filter((row) => !row.ok);
						sendJson(res, 200, {
							ok: failed.length === 0,
							removed: results.length - failed.length,
							failed: failed.length,
							results,
						});
					} catch (error) {
						sendJson(res, 500, {
							ok: false,
							error: error instanceof Error ? error.message : "删除失败",
						});
					}
					});
				},
			}),
		"dsh-archive-delete: delete route",
	);

	ctx.effect(
		() =>
			webServer.register({
				kind: "exact",
				path: "/plugins/dsh-archive-delete/list",
				handler: (_req, res) => {
					try {
						const records=book.refresh(),archived=listArchived(nativeRegistry(ctx));
						const rows=archived.rows.filter(row=>!records.has(row.id));
						sendJson(res, 200, { ok: true, ...archived, total:rows.length, orphans:rows.filter(row=>!row.exists).length, rows, deletedSessionIds:[...records.keys()], pendingCleanup:[...records.values()].filter(row=>row.state==="pending").map(row=>row.id) });
					} catch (error) {
						sendJson(res, 500, {
							ok: false,
							error: error instanceof Error ? error.message : "读取失败",
						});
					}
				},
			}),
		"dsh-archive-delete: archived list route",
	);
}
