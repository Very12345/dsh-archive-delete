// dsh-archive-delete — CLIENT half.
//
// Scope: ARCHIVED conversations only. DSH archives by hiding the session id in
// the host gate list (`storages/workspace.json`). The DSH Workspace projection
// delivers Host-confirmed archive changes; controls follow that observable so
// newly archived conversations need no reload or focus change. The delete route
// independently validates archive membership before touching session data.
//
// Two surfaces:
//   * `sidebar.workspaces.session.row.action` — the icon strip beside the archive
//     box and the pin button (rendered as `renderSlot(..., { sessionId, displayTitle })`).
//     Archived rows get a selection checkbox + a 🗑.
//   * `shell.overlay` — the seat the built-in row dialogs use; the batch bar lives
//     there (count, delete-selected, sweep-dangling, dismiss).
//
// After a delete the row disappears IMMEDIATELY and no full page load happens: a
// `[data-row-key="…"] { display: none !important }` rule is added for each removed
// row (a React re-render cannot resurrect it, unlike an inline style), plus the
// same style on the live node. State is module-scoped, so every row occupant and
// the bar share one selection.
//
// Plain JS on purpose: the DSH client loader hands the factory a `require`, so the
// plugin needs no build step to stay compatible with new lines.
//
// The registration id must be the FULL published package name: the client-modules
// host requests each bundle under its package name (`/plugins/<id>/client.js`) and
// then asserts the script registered that same id. This file ships unbundled, so
// there is no build step to keep the two in sync — change it here.
window.__ModuleLoader__.load({
	id: "@very12345/dsh-archive-delete",
	factory: (require) => {
		const R = require("react");
		const h = R.createElement;
		const win = globalThis;
		const DELETE_ROUTE = "/plugins/dsh-archive-delete/delete";
		const LIST_ROUTE = "/plugins/dsh-archive-delete/list";
		const STYLE_ID = "dsh-archive-delete-hide";

		/**
		 * The gate list keeps DSH session ids (`lark-link:dm:oc_x:<nonce>:<index>`),
		 * and a row hands back the same identity — but a task-key suffix (`…#2`) or a
		 * run nonce must not make the two sides mismatch, so both are normalized to
		 * the conversation-level key before comparing.
		 */
		const normalize = (value) => {
			let id = String(value ?? "").trim();
			id = id.replace(/:[a-z0-9]{8,}:\d+$/, "");
			return id.replace(/#\d+$/, "");
		};

		// ---- shared state (module scope) -------------------------------------
		const store = {
			/** normalized ids reported by the host as archived. */
			archived: new Set(),
			archivedLoaded: false,
			/** ids already removed on the host — their rows are hidden. */
			deleted: new Set(),
			/** normalized key → { id, title }; `id` is what the host must locate. */
			selected: new Map(),
			status: "",
			busy: false,
			orphans: null,
		};
		/** normalized id → the live row element (for hiding exactly that row). */
		const rowNodes = new Map();
		const listeners = new Set();
		let revision = 0;
		let workspaceList = null;
		const subscribe = (notify) => {
			listeners.add(notify);
			return () => listeners.delete(notify);
		};
		const getRevision = () => revision;
		const emit = () => {
			revision += 1;
			for (const notify of [...listeners]) {
				try {
					notify();
				} catch {
					// a broken listener must never break a delete
				}
			}
		};
		const useShared = () => {
			R.useSyncExternalStore(subscribe, getRevision, getRevision);
			return store;
		};
		const installArchived = (ids) => {
			const next = new Set(ids.map(normalize));
			let changed = !store.archivedLoaded || next.size !== store.archived.size
				|| [...next].some((id) => !store.archived.has(id));
			store.archived = next;
			store.archivedLoaded = true;
			for (const id of store.selected.keys()) {
				if (next.has(id)) continue;
				store.selected.delete(id);
				changed = true;
			}
			if (changed) emit();
		};
		const syncWorkspaceArchives = () => {
			const snapshot = workspaceList?.getSnapshot();
			if (Array.isArray(snapshot?.archivedSessionIds)) installArchived(snapshot.archivedSessionIds);
		};

		const post = (payload) =>
			win
				.fetch(DELETE_ROUTE, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				})
				.then(async (response) => ({ ok: response.ok, value: await response.json().catch(() => ({})) }));

		const refreshList = () =>
			win
				.fetch(LIST_ROUTE, { cache: "no-store" })
				.then((response) => response.ok ? response.json() : null)
				.then((value) => {
					if (value?.ok === false || !Array.isArray(value?.rows)) return;
					// HTTP supplies disk metadata, never a newer archive projection.
					// An in-flight response may predate a just-confirmed DSH archive.
					if (!workspaceList) installArchived(value.rows.map((row) => row.id));
					store.orphans = Number.isFinite(value?.orphans) ? value.orphans : null;
					emit();
				})
				.catch(() => undefined);

		/**
		 * Hide rows for real: a stylesheet rule keyed by the row's own
		 * `data-row-key` survives re-renders, an inline style does not.
		 */
		const hideRows = (ids) => {
			const doc = win.document;
			if (!doc?.head) return;
			const rules = [];
			for (const id of ids) {
				const key = normalize(id);
				const node = rowNodes.get(key);
				const value = node?.getAttribute?.("data-row-key") ?? null;
				if (!value) continue;
				if (node?.style) node.style.setProperty("display", "none", "important");
				if (store.deleted.has(`hidden:${value}`)) continue;
				store.deleted.add(`hidden:${value}`);
				rules.push(`[data-row-key="${String(value).replace(/["\\]/g, "\\$&")}"]{display:none !important}`);
			}
			if (rules.length === 0) return;
			let style = doc.getElementById(STYLE_ID);
			if (!style) {
				style = doc.createElement("style");
				style.id = STYLE_ID;
				doc.head.appendChild(style);
			}
			style.textContent = `${style.textContent ?? ""}${rules.join("")}`;
		};

		/** Delete N sessions in ONE request; failures do not block the successes. */
		const runDelete = (ids, label) => {
			if (store.busy || ids.length === 0) return;
			const confirmed = win.confirm?.(
				`永久删除${label}？\n\n${ids.length} 条会话记录会从磁盘删除，无法恢复。`,
			);
			if (!confirmed) return;
			store.busy = true;
			store.status = `正在删除 ${ids.length} 条…`;
			emit();
			void post({ sessionIds: ids })
				.then(({ ok, value }) => {
					const results = Array.isArray(value?.results) ? value.results : [];
					if (results.length === 0) {
						store.busy = false;
						store.status = String(value?.error || "删除失败");
						emit();
						return;
					}
					const done = results.filter((row) => row.ok);
					const bad = results.filter((row) => !row.ok);
					for (const row of done) {
						const key = normalize(row.id);
						store.deleted.add(key);
						store.selected.delete(key);
					}
					hideRows(done.map((row) => row.id));
					store.busy = false;
					store.status = bad.length
						? `已删除 ${done.length} 条，${bad.length} 条失败（${bad[0]?.error || "未知原因"}）`
						: `已删除 ${done.length} 条`;
					emit();
					// The gate list changed: refresh so the row's controls go away too.
					void refreshList();
					return ok;
				})
				.catch(() => {
					store.busy = false;
					store.status = "删除失败（网络错误）";
					emit();
				});
		};

		const runPrune = () => {
			if (store.busy) return;
			const count = store.orphans == null ? "" : `${store.orphans} 条`;
			const confirmed = win.confirm?.(
				`清理${count}悬空归档条目？\n\n这些会话在磁盘上已不存在，只把它们的归档记录去掉。`,
			);
			if (!confirmed) return;
			store.busy = true;
			store.status = "正在清理悬空条目…";
			emit();
			void post({ op: "prune" })
				.then(({ value }) => {
					store.busy = false;
					store.status = `已清理 ${Number(value?.removed ?? 0)} 条悬空条目`;
					emit();
					void refreshList();
				})
				.catch(() => {
					store.busy = false;
					store.status = "清理失败（网络错误）";
					emit();
				});
		};

		const flatButton = (secondary) => ({
			border: secondary ? "1px solid rgba(255,255,255,.25)" : "none",
			background: secondary ? "transparent" : "#d4380d",
			color: "#fff",
			borderRadius: "7px",
			padding: "3px 10px",
			fontSize: "12px",
			lineHeight: "18px",
			cursor: "pointer",
		});

		// ---- row occupant ----------------------------------------------------
		const RowAction = (props) => {
			const sessionId = String(props?.sessionId ?? "");
			const title = String(props?.displayTitle ?? "");
			const ref = R.useRef(null);
			const shared = useShared();
			const key = normalize(sessionId);
			const isDeleted = shared.deleted.has(key);
			const isArchived = shared.archived.has(key);
			const isSelected = shared.selected.has(key);

			// Remember our row element so a later delete can hide exactly this row.
			R.useEffect(() => {
				if (!key || isDeleted) return;
				const node = ref.current;
				const row =
					(node && typeof node.closest === "function" ? node.closest("[data-row-key]") : null) ?? node;
				if (row) rowNodes.set(key, row);
			}, [key, isDeleted]);

			// Archived only: a normal conversation must never grow a delete button.
			if (!sessionId || isDeleted || !isArchived) return null;

			const toggleSelect = () => {
				if (shared.selected.has(key)) shared.selected.delete(key);
				else shared.selected.set(key, { id: sessionId, title });
				emit();
			};

			return h(
				R.Fragment,
				null,
				h("input", {
					type: "checkbox",
					checked: isSelected,
					onChange: (event) => {
						event?.stopPropagation?.();
						toggleSelect();
					},
					onClick: (event) => event?.stopPropagation?.(),
					title: "勾选（可多选后批量删除）",
					"aria-label": "选择这个已归档对话",
					style: { margin: "0 2px 0 0", cursor: "pointer", verticalAlign: "middle" },
				}),
				h(
					"button",
					{
						ref,
						type: "button",
						title: `永久删除已归档的${title ? `「${title}」` : "对话"}（含磁盘上的会话记录）`,
						"aria-label": "删除这个已归档对话",
						disabled: shared.busy,
						onClick: (event) => {
							event?.stopPropagation?.();
							runDelete([sessionId], title ? `「${title}」` : "这个已归档对话");
						},
						style: {
							border: "none",
							background: "transparent",
							color: "inherit",
							borderRadius: "6px",
							padding: "2px 5px",
							fontSize: "13px",
							lineHeight: "16px",
							cursor: shared.busy ? "default" : "pointer",
							opacity: shared.busy ? 0.45 : 0.75,
						},
					},
					"🗑",
				),
			);
		};

		// ---- batch bar (overlay seat) ---------------------------------------
		const BatchBar = () => {
			const shared = useShared();
			R.useEffect(() => {
				void refreshList();
				const onFocus = () => void refreshList();
				win.addEventListener?.("focus", onFocus);
				return () => win.removeEventListener?.("focus", onFocus);
			}, []);

			const count = shared.selected.size;
			if (count === 0 && !shared.status) return null;

			const children = [
				h("span", { key: "label" }, count > 0 ? `已选 ${count} 条` : shared.status),
			];
			if (count > 0) {
				children.push(
					h(
						"button",
						{
							key: "delete",
							type: "button",
							disabled: shared.busy,
							onClick: () =>
								runDelete(
									[...shared.selected.values()].map((entry) => entry.id),
									`这 ${count} 个已归档对话`,
								),
							style: flatButton(false),
						},
						shared.busy ? "删除中…" : "删除选中",
					),
					h(
						"button",
						{
							key: "clear",
							type: "button",
							onClick: () => {
								shared.selected.clear();
								emit();
							},
							style: flatButton(true),
						},
						"取消",
					),
				);
			} else {
				children.push(
					h(
						"button",
						{
							key: "dismiss",
							type: "button",
							onClick: () => {
								shared.status = "";
								emit();
							},
							style: flatButton(true),
						},
						"知道了",
					),
				);
			}
			children.push(
				h(
					"button",
					{
						key: "prune",
						type: "button",
						disabled: shared.busy,
						title: "只清理磁盘上已不存在的归档条目（不动真实会话）",
						onClick: () => runPrune(),
						style: flatButton(true),
					},
					shared.orphans != null ? `清理悬空 (${shared.orphans})` : "清理悬空",
				),
			);

			return h(
				"div",
				{
					style: {
						position: "fixed",
						left: "50%",
						bottom: "24px",
						transform: "translateX(-50%)",
						zIndex: 9999,
						display: "flex",
						gap: "8px",
						alignItems: "center",
						padding: "8px 12px",
						borderRadius: "10px",
						background: "rgba(24,24,27,.94)",
						color: "#f4f4f5",
						boxShadow: "0 6px 24px rgba(0,0,0,.35)",
						fontSize: "13px",
					},
				},
				children,
			);
		};

		const inject = ["slots", "workspaces"];
		function apply(ctx) {
			const list = ctx.workspaces?.list;
			if (typeof list?.getSnapshot === "function" && typeof list?.subscribe === "function") {
				ctx.effect(() => {
					workspaceList = list;
					const unsubscribe = list.subscribe(syncWorkspaceArchives);
					syncWorkspaceArchives();
					return () => {
						unsubscribe();
						workspaceList = null;
					};
				});
			}
			void refreshList();
			ctx.slots.inject("sidebar.workspaces.session.row.action", () =>
				ctx.slots.register(
					{
						name: "sidebar.workspaces.session.row.action",
						id: "dsh-archive-delete",
						order: 300,
						label: "删除已归档对话",
					},
					RowAction,
				),
			);
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register(
					{
						name: "shell.overlay",
						id: "dsh-archive-delete-bar",
						order: 900,
						label: "删除选中",
					},
					BatchBar,
				),
			);
		}

		return {
			name: "dsh-archive-delete-client",
			inject,
			apply,
		};
	},
});
