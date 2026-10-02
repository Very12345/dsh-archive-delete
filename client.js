// dsh-archive-delete — CLIENT half.
//
// Scope: ARCHIVED conversations only. DSH archives by hiding the session id in
// the host gate list (`storages/workspace.json`). The DSH Workspace projection
// delivers Host-confirmed archive changes; controls follow that observable so
// newly archived conversations need no reload or focus change. The delete route
// independently validates archive membership before touching session data.
//
// Three surfaces: settings summary, sidebar controls and the batch overlay.
// Existing archive/deletion gates remain unchanged.
//
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
		const { Modal, Button } = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = R.createElement;
		const SETTINGS_CSS = "\n.dshp-page{--sp-text:var(--dsw-alias-label-primary,#20242c);--sp-muted:var(--dsw-alias-label-secondary,#69717f);--sp-border:var(--dsw-alias-border-l3,#e4e7ec);--sp-bg:var(--dsw-alias-bg-layer-2,#fff);--sp-soft:var(--dsw-alias-bg-layer-3,#f7f8fa);--sp-accent:#3d64df;color:var(--sp-text);width:100%;max-width:720px;padding:12px 0 32px;font-family:inherit;font-size:14px;line-height:1.5}\n.dshp-page *{box-sizing:border-box}.dshp-header{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:28px}.dshp-title{display:flex;align-items:center;gap:14px}.dshp-symbol{display:grid;place-items:center;flex:none;width:44px;height:44px;border:1px solid var(--sp-border);border-radius:13px;background:var(--sp-soft);font-size:20px}.dshp-page h2{font-size:18px;font-weight:600;line-height:1.5;letter-spacing:normal;margin:0}.dshp-subtitle{color:var(--sp-muted);font-size:13px;margin:5px 0 0}.dshp-status{display:inline-flex;align-items:center;gap:7px;color:var(--sp-muted);font-size:12px;white-space:nowrap;border:1px solid var(--sp-border);border-radius:20px;padding:5px 10px}.dshp-dot{width:6px;height:6px;flex:none;border-radius:50%;background:#969eab}.dshp-status[data-ok=true] .dshp-dot{background:#21936a}.dshp-status[data-warn=true] .dshp-dot{background:#c58c2e}\n.dshp-section{margin-top:26px}.dshp-heading{color:var(--sp-muted);font-weight:600;font-size:13px;margin:0 0 10px}.dshp-panel{background:var(--sp-bg);border:1px solid var(--sp-border);border-radius:12px;overflow:hidden}.dshp-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px}.dshp-row+.dshp-row{border-top:1px solid var(--sp-border)}.dshp-label{font-weight:550;font-size:14px;margin:0}.dshp-help{font-size:12px;color:var(--sp-muted);line-height:1.65;margin:4px 0 0}.dshp-page button,.dshp-page input,.dshp-page select{font:inherit}.dshp-page button{cursor:pointer}.dshp-page button:disabled{cursor:default;opacity:.45}.dshp-page button:focus-visible,.dshp-page input:focus-visible,.dshp-page select:focus-visible{outline:3px solid #8ba9ff;outline-offset:3px}.dshp-switch{position:relative;flex:none;width:40px;height:24px;border:0;border-radius:20px;padding:3px;background:#a0a7b2}.dshp-switch[aria-checked=true]{background:var(--sp-accent)}.dshp-knob{display:block;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transform:translateX(0);transition:transform .15s}.dshp-switch[aria-checked=true] .dshp-knob{transform:translateX(16px)}\n.dshp-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;border:1px solid var(--sp-border);background:var(--sp-bg);color:var(--sp-text);border-radius:7px;padding:7px 12px;font-size:12px!important}.dshp-button:hover{background:var(--sp-soft)}.dshp-primary{background:var(--sp-accent)!important;border-color:var(--sp-accent)!important;color:white!important}.dshp-danger{color:var(--dsw-alias-label-error,#c73f38)}.dshp-footnote{color:var(--sp-muted);font-size:12px;line-height:1.65;margin:12px 2px 0}.dshp-error{color:var(--dsw-alias-label-error,#c73f38);background:var(--sp-soft);border:1px solid var(--sp-border);padding:12px 14px;border-radius:8px;font-size:12px;margin-top:14px}.dshp-footer{font-size:11px;color:var(--sp-muted);margin-top:18px}.dshp-empty{font-size:12px;color:var(--sp-muted);padding:20px}.dshp-option{width:100%;display:flex;align-items:center;gap:12px;text-align:left;padding:14px;border:1px solid transparent;background:transparent;color:var(--sp-text);border-radius:8px}.dshp-option[aria-checked=true]{background:var(--sp-soft);border-color:var(--sp-border)}.dshp-option-copy{flex:1}.dshp-radio{width:16px;height:16px;border:1.5px solid #9ca5b3;border-radius:50%;display:grid;place-items:center;flex:none}.dshp-option[aria-checked=true] .dshp-radio{border-color:var(--sp-accent)}.dshp-option[aria-checked=true] .dshp-radio:after{content:'';width:8px;height:8px;border-radius:50%;background:var(--sp-accent)}.dshp-options{padding:6px}.dshp-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dshp-tags{display:flex;gap:7px;flex-wrap:wrap}.dshp-tag{font-size:12px;color:var(--sp-muted);background:var(--sp-soft);border:1px solid var(--sp-border);padding:4px 9px;border-radius:6px}.dshp-form{padding:20px;border-top:1px solid var(--sp-border);display:grid;gap:12px}.dshp-page input:not([type=checkbox]),.dshp-page select{min-height:36px;border:1px solid var(--sp-border)!important;border-radius:7px!important;background:var(--sp-bg)!important;color:var(--sp-text)!important;padding:7px 10px!important;font:inherit!important}.dshp-page input[type=checkbox]{accent-color:var(--sp-accent);width:15px;height:15px;flex:none}.dshp-disclosure{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;text-align:left;background:transparent;border:0;color:var(--sp-text);padding:20px;font-size:14px;font-weight:550}.dshp-disclosure span:last-child{color:var(--sp-muted)}.dshp-user{padding:14px 20px}.dshp-user+.dshp-user{border-top:1px solid var(--sp-border)}.dshp-user summary{cursor:pointer;list-style:none}.dshp-user summary::-webkit-details-marker{display:none}.dshp-user summary:after{content:'\u203a';float:right;color:var(--sp-muted)}.dshp-user[open] summary:after{content:'\u2304'}.dshp-user-meta{color:var(--sp-muted);font-size:12px;overflow-wrap:anywhere;margin-top:6px}\n@media(max-width:520px){.dshp-page h2{font-size:18px}.dshp-header{align-items:flex-start;gap:10px}.dshp-subtitle{max-width:220px}.dshp-symbol{width:38px;height:38px}.dshp-row,.dshp-form,.dshp-disclosure{padding:16px}.dshp-row{gap:12px}.dshp-status{font-size:11px}}\n@media(prefers-reduced-motion:reduce){.dshp-knob{transition:none}}\n";
		const win = globalThis;
		const DELETE_ROUTE = "/plugins/dsh-archive-delete/delete";
		const LIST_ROUTE = "/plugins/dsh-archive-delete/list";
		const STYLE_ID = "dsh-archive-delete-hide";

		/** Keep the complete opaque Session identity, including task/run qualifiers. */
		const normalize = (value) => String(value ?? "").trim();

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
			pendingCleanup: 0,
			confirmation: null,
		};
		/** normalized id → the live row element (for hiding exactly that row). */
		const rowNodes = new Map();
		const listeners = new Set();
		let revision = 0;
		let workspaceList = null;
		let refreshSessions = () => Promise.resolve();
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
					const deleted = Array.isArray(value.deletedSessionIds) ? value.deletedSessionIds : [];
					for (const id of deleted) { const key=normalize(id); store.deleted.add(key); store.selected.delete(key); }
					hideRows(deleted);
					store.pendingCleanup = Array.isArray(value.pendingCleanup) ? value.pendingCleanup.length : 0;
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
				// The exact stable key works even if the row was not mounted when deletion finished.
				const value = node?.getAttribute?.("data-row-key") || `session:${key}`;
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
		const applyDeleted = (results) => {
			const done = results.filter((row) => row.ok);
			for (const row of done) { const key = normalize(row.id); store.deleted.add(key); store.selected.delete(key); }
			hideRows(done.map((row) => row.id));
			if (done.length) void Promise.resolve().then(refreshSessions).catch(() => undefined);
			return done;
		};

		/** Delete N sessions in ONE request; failures do not block the successes. */
		const runDelete = (ids, label) => {
			if (store.busy || store.confirmation || ids.length === 0) return;
			store.confirmation = {
				kind: "delete", ids: [...ids],
				title: `永久删除${label}？`,
				description: `${ids.length} 条会话记录会从磁盘删除，无法恢复。`,
			};
			emit();
		};
		const deleteConfirmed = (ids) => {
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
					const done = applyDeleted(results);
					const bad = results.filter((row) => !row.ok);
					const pending = done.filter((row) => row.pending).length;
					store.busy = false;
					store.status = bad.length
						? `已删除 ${done.length} 条，${bad.length} 条失败（${bad[0]?.error || "未知原因"}）`
						: pending ? `已从列表移除 ${done.length} 条，${pending} 条待宿主释放文件后自动清理` : `已删除 ${done.length} 条`;
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
			if (store.busy || store.confirmation) return;
			const count = store.orphans == null ? "" : `${store.orphans} 条`;
			store.confirmation = {
				kind: "prune", title: `清理${count}悬空归档条目？`,
				description: "这些会话在磁盘上已不存在，只把它们的归档记录去掉。",
			};
			emit();
		};
		const pruneConfirmed = () => {
			store.busy = true;
			store.status = "正在清理悬空条目…";
			emit();
			void post({ op: "prune" })
				.then(({ value }) => {
					applyDeleted(Array.isArray(value?.results) ? value.results : []);
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

		// Electron's blocking window.confirm can leave the renderer unfocused.
		// The host Modal owns its focus trap, Escape handling and focus restoration;
		// no native window or global clipboard/focus hooks are needed here.
		const ConfirmationDialog = () => {
			const request = useShared().confirmation;
			if (!request) return null;
			const cancel = () => { store.confirmation = null; emit(); };
			const confirm = () => {
				if (store.confirmation !== request || store.busy) return;
				store.confirmation = null;
				if (request.kind === "delete") deleteConfirmed(request.ids);
				else pruneConfirmed();
			};
			return h(Modal, {
				open: true, title: request.title, description: request.description,
				closeLabel: "取消", onClose: cancel,
				footer: h(R.Fragment, null,
					h(Button, { variant: "outline", "data-modal-autofocus": true, onClick: cancel }, "取消"),
					h(Button, { variant: "outline", style: { color: "var(--dsw-alias-label-error,#c73f38)" }, onClick: confirm }, request.kind === "delete" ? "永久删除" : "清理"),
				),
			});
		};

		const flatButton = (secondary) => ({
            border:'1px solid var(--dsw-alias-border-l3,#e4e7ec)',background:secondary?'var(--dsw-alias-bg-layer-2,#fff)':'#c73f38',color:secondary?'var(--dsw-alias-label-primary,#20242c)':'#fff',borderRadius:'7px',padding:'7px 12px',fontSize:'12px',lineHeight:'18px',cursor:'pointer'
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
				if (!key || isDeleted || !isArchived) return;
				const node = ref.current;
				const row =
					(node && typeof node.closest === "function" ? node.closest("[data-row-key]") : null) ?? node;
				if (row) rowNodes.set(key, row);
				return () => { if (rowNodes.get(key) === row) rowNodes.delete(key); };
			}, [key, isDeleted, isArchived]);

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
					h("svg",{width:15,height:15,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.7,"aria-hidden":true},h("path",{d:"M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"})),
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
                        flexWrap:"wrap",
                        maxWidth:"calc(100vw - 32px)",
						gap: "8px",
						alignItems: "center",
						padding: "8px 12px",
						borderRadius: "12px",
						background: "var(--dsw-alias-bg-layer-2,#fff)",
                        border:"1px solid var(--dsw-alias-border-l3,#e4e7ec)",
						color: "var(--dsw-alias-label-primary,#20242c)",
						boxShadow: "0 8px 28px rgba(0,0,0,.14)",
						fontSize: "13px",
					},
				},
				children,
			);
		};

        const ArchiveSettings = () => {
            const shared=useShared();R.useEffect(()=>{void refreshList();},[]);
            const count=[...shared.archived].filter(id=>!shared.deleted.has(id)).length;
            return h('section',{className:'dshp-page'},h('style',null,SETTINGS_CSS),
              h('header',{className:'dshp-header'},h('div',{className:'dshp-title'},h('span',{className:'dshp-symbol'},h('svg',{width:22,height:22,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,'aria-hidden':true},h('path',{d:'M3 3h18v5H3zM5 8v13h14V8M9 12h6'}))),h('div',null,h('h2',null,'归档管理'),h('p',{className:'dshp-subtitle'},'整理不再需要的已归档对话。'))),h('span',{className:'dshp-status'},count+' 条归档')),
              h('section',{className:'dshp-section'},h('h3',{className:'dshp-heading'},'已归档对话'),h('div',{className:'dshp-panel'},h('div',{className:'dshp-row'},h('div',null,h('p',{className:'dshp-label'},'批量删除'),h('p',{className:'dshp-help'},'在侧栏归档列表中勾选对话后，可一次删除。')),h('button',{type:'button',className:'dshp-button dshp-danger',disabled:shared.busy||!shared.selected.size,onClick:()=>runDelete([...shared.selected.values()].map(item=>item.id),'这 '+shared.selected.size+' 个已归档对话')},shared.busy?'处理中…':'删除选中'+(shared.selected.size?' · '+shared.selected.size:'')))),h('p',{className:'dshp-footnote'},'仅处理已归档对话。永久删除前会再次确认。')),
              h('section',{className:'dshp-section'},h('h3',{className:'dshp-heading'},'维护'),h('div',{className:'dshp-panel'},h('div',{className:'dshp-row'},h('div',null,h('p',{className:'dshp-label'},'清理无效归档记录'),h('p',{className:'dshp-help'},'移除磁盘上已经不存在的会话登记，不删除现有文件。')),h('button',{type:'button',className:'dshp-button',disabled:shared.busy,onClick:runPrune},'清理'+(shared.orphans!==null?' · '+shared.orphans:''))))),
              shared.status?h('p',{className:'dshp-footnote',role:'status'},shared.status):null,
              shared.pendingCleanup?h('p',{className:'dshp-footnote'},'待文件清理：'+shared.pendingCleanup+' 条。会话对象或写锁释放后自动完成。'):null);
        };

		const inject = ["slots", "workspaces"];
		function apply(ctx) {
			const sessions = ctx.get?.("sessions");
			if (typeof sessions?.refresh === "function") refreshSessions = () => sessions.refresh();
			ctx.effect(() => () => { win.document?.getElementById?.(STYLE_ID)?.remove(); rowNodes.clear(); });
			ctx.effect(() => {
				const timer=win.setInterval?.(()=>{if(store.pendingCleanup>0)void refreshList();},3000);timer?.unref?.();
				return()=>{if(timer!==undefined)win.clearInterval?.(timer);};
			});
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
            ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'archive-delete',label:'归档管理',order:48},ArchiveSettings));
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
					{ name: "shell.overlay", id: "dsh-archive-delete-confirm", order: 901, label: "确认删除" },
					ConfirmationDialog,
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
