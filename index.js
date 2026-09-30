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
// Deliberately standalone (no bridge/Feishu coupling, no DSH service imports):
// the store is a plain directory tree and liveness is an flock probe, so the
// plugin keeps working across DSH versions (v3/v4 log names are matched by
// shape) and cannot break anyone else's load order.
import { execFileSync } from "node:child_process";
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
import { join } from "node:path";

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
	dirName.replace(/~([0-9a-fA-F]{6})/g, (_all, hex) =>
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
const isLive = (dir) => {
	const lock = join(dir, LOCK_NAME);
	if (!existsSync(lock)) return false;
	try {
		execFileSync("flock", ["-n", lock, "true"], { stdio: "ignore" });
		return false;
	} catch (error) {
		// A missing flock binary cannot prove that an existing lock is idle.
		// Refuse deletion on platforms where the lock cannot be probed.
		if (error?.code === "ENOENT") return true;
		return true;
	}
};

const registryPath = () => join(resolveDshHome(), "storages", "workspace.json");

/** Drop the id from DSH's archive gate list, preserving every other key. */
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
	if (kept.length === ids.length) return false;
	global.archivedSessionIds = kept;
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

const removeSession = (sessionId) => {
	const found = locate(sessionId);
	if (!found) {
		const ungated = unarchive(sessionId);
		return {
			ok: true,
			message: ungated
				? "会话已不在磁盘上，已顺手清理它的归档条目"
				: "该会话已不存在（磁盘与归档列表都没有）",
		};
	}
	if (isLive(found.dir)) {
		return {
			ok: false,
			error: "该会话正在使用中（DSH 持有写锁），请先停止它再删除",
		};
	}
	rmSync(found.dir, { recursive: true, force: true });
	const ungated = unarchive(sessionId);
	return {
		ok: true,
		message: `已删除 ${found.project}/${sessionId}${ungated ? "（并清理归档条目）" : ""}`,
	};
};

/** Every id is attempted; one live session must not block the rest. */
const removeMany = (ids) =>
	ids.map((id) => {
		try {
			const result = removeSession(id);
			return { id, ...result };
		} catch (error) {
			return {
				id,
				ok: false,
				error: error instanceof Error ? error.message : "删除失败",
			};
		}
	});

/**
 * Deletion is for ARCHIVED conversations only — that is the plugin's whole scope,
 * and it must hold at the API too, not just in the GUI: a plain conversation id
 * is refused unless the caller explicitly forces it. Without this, any id in the
 * session store could be erased through the route (which is how a live session
 * got removed during verification).
 */
const archivedGate = () => {
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

/** Compare generously: the gate stores the run-qualified id, callers may not. */
const gateKey = (id) => {
	let value = String(id ?? "").trim();
	value = value.replace(/:[a-z0-9]{8,}:\d+$/, "");
	return value.replace(/#\d+$/, "");
};

const guardScope = (ids, force) => {
	const gate = archivedGate();
	const allowed = new Set([...gate].map((id) => gateKey(id)));
	if (force) return ids;
	return ids.filter((id) => allowed.has(gateKey(id)));
};

/** Drop every gate entry whose session directory is already gone (list-only). */
const pruneDangling = () => {
	const dangling = listArchived().rows.filter((row) => !row.exists);
	return { targets: dangling.map((row) => row.id), results: removeMany(dangling.map((row) => row.id)) };
};

/** Archived ids with their on-disk state — copied from the bridge's route. */
const listArchived = () => {
	let ids = [];
	try {
		const registry = JSON.parse(readFileSync(registryPath(), "utf8"));
		const raw = registry?.global?.archivedSessionIds;
		if (Array.isArray(raw)) ids = raw.map(String);
	} catch {
		// no registry yet
	}
	const rows = ids.map((id) => {
		const found = locate(id);
		return { id, exists: Boolean(found), live: found ? isLive(found.dir) : false };
	});
	return { total: rows.length, orphans: rows.filter((row) => !row.exists).length, rows };
};

export function apply(ctx) {
	const webServer = ctx?.webServer;
	if (!webServer) return;

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
					try {
						// `op: "prune"` sweeps every gate entry whose session is already
						// gone; `sessionIds` deletes a batch; `sessionId` one session.
						if (String(body?.op ?? "") === "prune") {
							const swept = pruneDangling();
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
						const allowed = guardScope(ids, body?.force === true);
						const refused = ids
							.filter((id) => !allowed.includes(id))
							.map((id) => ({
								id,
								ok: false,
								error: "该会话未归档，本插件只删除已归档的对话",
							}));
						const results = [...removeMany(allowed), ...refused];
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
						sendJson(res, 200, { ok: true, ...listArchived() });
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
