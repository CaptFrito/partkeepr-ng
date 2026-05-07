// partkeepr-ng — Webix frontend.
//
// Same-origin with the API: backend serves these files via tower-http
// ServeDir. Session cookie rides along automatically; no CORS, no
// `credentials: include` needed.

(function () {
    "use strict";

    // ============================================================
    //  API client
    // ============================================================

    const api = {
        async me() {
            const r = await fetch("/api/me");
            if (r.status === 401) return null;
            if (!r.ok) throw new Error(`/api/me failed: ${r.status}`);
            return r.json();
        },
        async login(username, password) {
            const r = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            if (r.status === 401) return { ok: false, reason: "bad-credentials" };
            if (!r.ok) return { ok: false, reason: "server-error", status: r.status };
            return { ok: true, body: await r.json() };
        },
        async logout() {
            await fetch("/api/logout", { method: "POST" });
        },
        async categoryTree() {
            const r = await fetch("/api/part_categories/tree");
            if (!r.ok) throw new Error(`category tree failed: ${r.status}`);
            return r.json();
        },
        async parts({ filter, search, limit = 500, offset = 0 } = {}) {
            const p = new URLSearchParams();
            if (filter && filter.kind && filter.id != null) {
                p.set(filter.kind, String(filter.id));
            }
            if (search) p.set("search", search);
            p.set("limit", String(limit));
            p.set("offset", String(offset));
            const r = await fetch("/api/parts?" + p.toString());
            if (!r.ok) throw new Error(`parts list failed: ${r.status}`);
            return r.json();
        },
        async storageTree() {
            const r = await fetch("/api/storage_tree");
            if (!r.ok) throw new Error(`storage tree failed: ${r.status}`);
            return r.json();
        },
        async footprintTree() {
            const r = await fetch("/api/footprint_tree");
            if (!r.ok) throw new Error(`footprint tree failed: ${r.status}`);
            return r.json();
        },
        async createPartCategory(body) {
            const r = await fetch("/api/part_categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`create category failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async updatePartCategory(id, body) {
            const r = await fetch(`/api/part_categories/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`update category failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async deletePartCategory(id) {
            const r = await fetch(`/api/part_categories/${id}`, { method: "DELETE" });
            if (!r.ok) throw new Error(`delete category failed: ${r.status} ${await r.text()}`);
        },
        async movePartCategory(id, newParentId) {
            const r = await fetch(`/api/part_categories/${id}/move`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ new_parent_id: newParentId }),
            });
            if (!r.ok) throw new Error(`move category failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async partCategoryById(id) {
            // No GET-by-id endpoint; the tree returns only name/path. We
            // need the description for the edit dialog, so fetch from a
            // helper endpoint. If it doesn't exist, fall back to "" — the
            // backend update accepts an empty description.
            const r = await fetch("/api/part_categories");
            if (!r.ok) return null;
            const flat = await r.json();
            return flat.find((c) => c.id === id) || null;
        },
        async part(id) {
            const r = await fetch("/api/parts/" + id);
            if (!r.ok) throw new Error(`part ${id} failed: ${r.status}`);
            return r.json();
        },
        async addStockEntry(partId, body) {
            const r = await fetch(`/api/parts/${partId}/stock-entries`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) {
                const txt = await r.text();
                throw new Error(`stock save failed: ${r.status} ${txt}`);
            }
            return r.json();
        },
        async deletePart(id) {
            const r = await fetch(`/api/parts/${id}`, { method: "DELETE" });
            if (!r.ok) {
                const txt = await r.text();
                throw new Error(`delete failed: ${r.status} ${txt}`);
            }
        },
        async updatePart(id, body) {
            const r = await fetch(`/api/parts/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) {
                const txt = await r.text();
                throw new Error(`update failed: ${r.status} ${txt}`);
            }
            return r.json();
        },
        async createPart(body) {
            const r = await fetch("/api/parts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) {
                const txt = await r.text();
                throw new Error(`create failed: ${r.status} ${txt}`);
            }
            return r.json();
        },
        async lookups() {
            const fetchJson = (u) => fetch(u).then((r) => {
                if (!r.ok) throw new Error(`${u} failed: ${r.status}`);
                return r.json();
            });
            const [categories_tree, footprints, manufacturers, distributors, storage_locations, part_units, units, prefixes] =
                await Promise.all([
                    fetchJson("/api/part_categories/tree"),
                    fetchJson("/api/footprints"),
                    fetchJson("/api/manufacturers"),
                    fetchJson("/api/distributors"),
                    fetchJson("/api/storage_locations"),
                    fetchJson("/api/part_measurement_units"),
                    fetchJson("/api/units"),
                    fetchJson("/api/si_prefixes"),
                ]);
            return { categories_tree, footprints, manufacturers, distributors, storage_locations, part_units, units, prefixes };
        },

        // Storage location categories
        async createStorageCategory(body) {
            const r = await fetch("/api/storage_location_categories", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`create storage cat failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async updateStorageCategory(id, body) {
            const r = await fetch(`/api/storage_location_categories/${id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`update storage cat failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async deleteStorageCategory(id) {
            const r = await fetch(`/api/storage_location_categories/${id}`, { method: "DELETE" });
            if (!r.ok) throw new Error(`delete storage cat failed: ${r.status} ${await r.text()}`);
        },
        async moveStorageCategory(id, newParentId) {
            const r = await fetch(`/api/storage_location_categories/${id}/move`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ new_parent_id: newParentId }),
            });
            if (!r.ok) throw new Error(`move storage cat failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async storageCategoryById(id) {
            const r = await fetch("/api/storage_location_categories");
            if (!r.ok) return null;
            const flat = await r.json();
            return flat.find((c) => c.id === id) || null;
        },

        // Storage locations (leaves)
        async createStorageLocation(body) {
            const r = await fetch("/api/storage_locations", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`create storage location failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async updateStorageLocation(id, body) {
            const r = await fetch(`/api/storage_locations/${id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`update storage location failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async deleteStorageLocation(id) {
            const r = await fetch(`/api/storage_locations/${id}`, { method: "DELETE" });
            if (!r.ok) throw new Error(`delete storage location failed: ${r.status} ${await r.text()}`);
        },
        async moveStorageLocation(id, newCategoryId) {
            const r = await fetch(`/api/storage_locations/${id}/move`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ new_category_id: newCategoryId }),
            });
            if (!r.ok) throw new Error(`move storage location failed: ${r.status} ${await r.text()}`);
            return r.json();
        },

        // Footprint categories
        async createFootprintCategory(body) {
            const r = await fetch("/api/footprint_categories", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`create footprint cat failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async updateFootprintCategory(id, body) {
            const r = await fetch(`/api/footprint_categories/${id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`update footprint cat failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async deleteFootprintCategory(id) {
            const r = await fetch(`/api/footprint_categories/${id}`, { method: "DELETE" });
            if (!r.ok) throw new Error(`delete footprint cat failed: ${r.status} ${await r.text()}`);
        },
        async moveFootprintCategory(id, newParentId) {
            const r = await fetch(`/api/footprint_categories/${id}/move`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ new_parent_id: newParentId }),
            });
            if (!r.ok) throw new Error(`move footprint cat failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async footprintCategoryById(id) {
            const r = await fetch("/api/footprint_categories");
            if (!r.ok) return null;
            const flat = await r.json();
            return flat.find((c) => c.id === id) || null;
        },

        // Footprints (leaves)
        async createFootprint(body) {
            const r = await fetch("/api/footprints", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`create footprint failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async updateFootprint(id, body) {
            const r = await fetch(`/api/footprints/${id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`update footprint failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async deleteFootprint(id) {
            const r = await fetch(`/api/footprints/${id}`, { method: "DELETE" });
            if (!r.ok) throw new Error(`delete footprint failed: ${r.status} ${await r.text()}`);
        },
        async moveFootprint(id, newCategoryId) {
            const r = await fetch(`/api/footprints/${id}/move`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ new_category_id: newCategoryId }),
            });
            if (!r.ok) throw new Error(`move footprint failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async footprintById(id) {
            const r = await fetch("/api/footprints");
            if (!r.ok) return null;
            const flat = await r.json();
            return flat.find((f) => f.id === id) || null;
        },

        // Generic CRUD for the 5 flat lookups. URL paths and write shapes
        // are configured in the LOOKUP_TYPES table below.
        async lookupList(url) {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`${url} failed: ${r.status}`);
            return r.json();
        },
        async lookupCreate(url, body) {
            const r = await fetch(url, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`create failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async lookupUpdate(url, id, body) {
            const r = await fetch(`${url}/${id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`update failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async lookupDelete(url, id) {
            const r = await fetch(`${url}/${id}`, { method: "DELETE" });
            if (!r.ok) throw new Error(`delete failed: ${r.status} ${await r.text()}`);
        },

        // Attachments
        async listAttachments(kind, parentId) {
            const path = ATTACHMENT_KINDS[kind].listPath(parentId);
            const r = await fetch(path);
            if (!r.ok) throw new Error(`list attachments failed: ${r.status}`);
            return r.json();
        },
        async fetchAttachmentByUrl(kind, parentId, url, filename) {
            const path = ATTACHMENT_KINDS[kind].listPath(parentId) + "/by-url";
            const body = { url };
            if (filename) body.filename = filename;
            const r = await fetch(path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`fetch by URL failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async updateAttachmentDescription(kind, id, description) {
            const r = await fetch(`/api/attachments/${kind}/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ description: description || null }),
            });
            if (!r.ok) throw new Error(`update description failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async deleteAttachment(kind, id) {
            const r = await fetch(`/api/attachments/${kind}/${id}`, { method: "DELETE" });
            if (!r.ok) throw new Error(`delete attachment failed: ${r.status} ${await r.text()}`);
        },
    };

    // ============================================================
    //  Mount management
    // ============================================================

    let topView = null;

    function unmount() {
        if (topView) {
            try { topView.destructor(); } catch (_) {}
            topView = null;
        }
    }

    // ============================================================
    //  Login window
    // ============================================================

    function mountLogin() {
        unmount();
        topView = webix.ui({
            view: "window",
            id: "pk-login",
            css: "pk-login-window",
            modal: true,
            move: false,
            position: "center",
            width: 360,
            head: "Sign in to PartKeeper",
            body: {
                view: "form",
                id: "pk-login-form",
                elements: [
                    { view: "text", name: "username", label: "Username", labelWidth: 90 },
                    { view: "text", type: "password", name: "password", label: "Password", labelWidth: 90 },
                    { view: "label", id: "pk-login-error", label: "", hidden: true },
                    {
                        cols: [
                            {},
                            {
                                view: "button",
                                value: "Sign in",
                                css: "webix_primary",
                                width: 110,
                                hotkey: "enter",
                                click: doLogin,
                            },
                        ],
                    },
                ],
            },
        });
        topView.show();
        setTimeout(() => {
            const form = $$("pk-login-form");
            if (form) form.focus();
        }, 0);
    }

    async function doLogin() {
        const form = $$("pk-login-form");
        const errLabel = $$("pk-login-error");
        const data = form.getValues();
        if (!data.username || !data.password) {
            errLabel.setValue("Username and password are required.");
            errLabel.show();
            return;
        }
        errLabel.hide();
        const result = await api.login(data.username, data.password);
        if (!result.ok) {
            errLabel.setValue(
                result.reason === "bad-credentials"
                    ? "Username or password not recognised."
                    : "Sign-in failed (server error)."
            );
            errLabel.show();
            return;
        }
        mountShell(result.body.user);
    }

    // ============================================================
    //  Main shell — three-column PartManager layout
    // ============================================================

    function mountShell(user) {
        unmount();
        topView = webix.ui({
            id: "pk-app",
            rows: [
                buildHeader(user),
                {
                    cols: [
                        buildLeftPane(),
                        { view: "resizer" },
                        buildCenterPane(),
                        { view: "resizer" },
                        buildRightPane(),
                    ],
                },
            ],
        });
        loadCategoryTree();

        // Lazy-load the other trees the first time the user switches to
        // them. Webix tabbar with multiview:true auto-fires onChange when
        // the active cell changes; we hook for two reasons:
        //   1. trigger the lazy load
        //   2. swap the center pane between parts grid and lookups grid
        $$("pk-left-tabbar").attachEvent("onChange", function (newId) {
            if (newId === "tab-storage") loadStorageTree();
            else if (newId === "tab-footprints") loadFootprintTree();
            // Swap center cell:
            //   tree tabs (categories/storage/footprints) → parts grid
            //   lookups tab → lookups grid (showLookupType handles the swap
            //                                 when the user picks a type)
            if (newId !== "tab-lookups") {
                const cell = $$("centerpane-grid");
                if (cell) cell.show();
            }
        });
    }

    function buildHeader(user) {
        const adminBadge = user.is_admin ? `<span class="pk-user-admin">admin</span>` : "";
        const userHtml = `<span class="pk-user-name">${escapeHtml(user.username)}</span>${adminBadge}`;
        return {
            view: "toolbar",
            id: "pk-header",
            css: "pk-header",
            height: 40,
            cols: [
                { view: "label", label: '<span class="pk-app-title">PartKeeper</span>', width: 160 },
                {},
                { view: "label", label: userHtml, width: 240 },
                { view: "button", value: "Sign out", width: 100, click: doLogout },
            ],
        };
    }

    async function doLogout() {
        await api.logout();
        mountLogin();
    }

    // ============================================================
    //  Left pane — tabbar (Categories / Storage / Footprints / Lookups)
    //  + multiview switching the body
    // ============================================================

    function buildLeftPane() {
        return {
            id: "pk-left",
            width: 280,
            rows: [
                {
                    view: "tabbar",
                    id: "pk-left-tabbar",
                    multiview: true,
                    value: "tab-categories",
                    options: [
                        { value: "Categories", id: "tab-categories" },
                        { value: "Storage", id: "tab-storage" },
                        { value: "Footprints", id: "tab-footprints" },
                        { value: "Lookups", id: "tab-lookups" },
                    ],
                },
                {
                    view: "multiview",
                    id: "pk-left-multiview",
                    cells: [
                        {
                            id: "tab-categories",
                            rows: [buildCategoryActionToolbar(), buildCategoryTreeView()],
                        },
                        {
                            id: "tab-storage",
                            rows: [buildStorageActionToolbar(), buildStorageTreeView()],
                        },
                        {
                            id: "tab-footprints",
                            rows: [buildFootprintActionToolbar(), buildFootprintTreeView()],
                        },
                        { id: "tab-lookups", rows: [buildLookupsStub()] },
                    ],
                },
            ],
        };
    }

    function treeNodeTemplate(obj, common) {
        const indent = common.icon(obj, common);
        const count = obj.part_count > 0
            ? ` <span class="pk-cat-count">${obj.part_count}</span>`
            : "";
        return `${indent}<span class="pk-cat-name">${escapeHtml(obj.value)}</span>${count}`;
    }

    // --- Part categories tree ---

    function buildCategoryTreeView() {
        return {
            view: "tree",
            id: "pk-cat-tree",
            select: true,
            drag: false,
            template: treeNodeTemplate,
            on: {
                onAfterSelect: function (id) {
                    const node = this.getItem(id);
                    const filter = (node && node.lvl === 0) || !node
                        ? null
                        : { kind: "category", id: node.id };
                    loadParts({ filter });
                },
            },
        };
    }

    async function loadCategoryTree() {
        try {
            const arr = await api.categoryTree();
            const tree = $$("pk-cat-tree");
            tree.clearAll();
            tree.parse(arr.map(transformCategoryNode));
            if (arr.length) {
                tree.select(String(arr[0].id));
                tree.open(String(arr[0].id));
            }
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load categories" });
        }
    }

    function transformCategoryNode(node) {
        const out = {
            id: String(node.id),
            value: node.name,
            name: node.name,
            lvl: node.lvl,
            part_count: node.part_count,
            category_path: node.category_path,
        };
        if (node.children && node.children.length) {
            out.data = node.children.map(transformCategoryNode);
            out.open = node.lvl === 0;
        }
        return out;
    }

    // --- Part-category CRUD toolbar + dialogs ---

    function buildCategoryActionToolbar() {
        return {
            view: "toolbar",
            css: "pk-pane-toolbar",
            height: 38,
            cols: [
                { view: "button", value: "+ Sub", css: "pk-btn-add", width: 70, click: openCategoryAdd },
                { view: "button", value: "✎ Edit", css: "webix_primary", width: 75, click: openCategoryEdit },
                { view: "button", value: "Move…", width: 70, click: openCategoryMove },
                { view: "button", value: "🗑", css: "pk-btn-remove", width: 40, click: confirmCategoryDelete },
                {},
            ],
        };
    }

    function getSelectedTreeNode(treeId) {
        const tree = $$(treeId);
        if (!tree) return null;
        const id = tree.getSelectedId();
        if (!id) return null;
        return tree.getItem(id);
    }

    async function reloadPartCategoryTreeAndGrid(reselectId) {
        // Reload the tree, restoring selection if asked. Also refresh the
        // parts grid since category counts may have shifted.
        try {
            const arr = await api.categoryTree();
            const tree = $$("pk-cat-tree");
            tree.clearAll();
            tree.parse(arr.map(transformCategoryNode));
            const target = reselectId != null ? String(reselectId) : (arr[0] ? String(arr[0].id) : null);
            if (target && tree.exists(target)) {
                tree.select(target);
                tree.open(target);
            }
        } catch (e) {
            console.error(e);
        }
        await loadParts({});
    }

    function openCategoryAdd() {
        const sel = getSelectedTreeNode("pk-cat-tree");
        if (!sel) {
            webix.message({ type: "error", text: "Select a parent category first." });
            return;
        }
        showSimpleNameDescDialog({
            title: `New sub-category under "${sel.name}"`,
            saveLabel: "Create",
            initial: { name: "", description: "" },
            onSave: async (v) => {
                await api.createPartCategory({
                    parent_id: parseInt(sel.id, 10),
                    name: v.name,
                    description: v.description || null,
                });
                await reloadPartCategoryTreeAndGrid(sel.id);
            },
        });
    }

    async function openCategoryEdit() {
        const sel = getSelectedTreeNode("pk-cat-tree");
        if (!sel) {
            webix.message({ type: "error", text: "Select a category to edit." });
            return;
        }
        if (sel.lvl === 0) {
            webix.message({ type: "error", text: "The root category cannot be renamed." });
            return;
        }
        const full = await api.partCategoryById(parseInt(sel.id, 10));
        showSimpleNameDescDialog({
            title: `Edit category "${sel.name}"`,
            saveLabel: "Save",
            initial: { name: sel.name, description: (full && full.description) || "" },
            onSave: async (v) => {
                await api.updatePartCategory(parseInt(sel.id, 10), {
                    name: v.name,
                    description: v.description || null,
                });
                await reloadPartCategoryTreeAndGrid(sel.id);
            },
        });
    }

    function confirmCategoryDelete() {
        const sel = getSelectedTreeNode("pk-cat-tree");
        if (!sel) {
            webix.message({ type: "error", text: "Select a category to delete." });
            return;
        }
        if (sel.lvl === 0) {
            webix.message({ type: "error", text: "The root category cannot be deleted." });
            return;
        }
        webix.confirm({
            title: "Delete category",
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text:
                `Delete category <b>${escapeHtml(sel.name)}</b>?<br><br>` +
                `Refused if the category contains parts or sub-categories.`,
            callback: async (result) => {
                if (!result) return;
                try {
                    await api.deletePartCategory(parseInt(sel.id, 10));
                    await reloadPartCategoryTreeAndGrid();
                    webix.message({ text: "Category deleted", type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    function openCategoryMove() {
        const sel = getSelectedTreeNode("pk-cat-tree");
        if (!sel) {
            webix.message({ type: "error", text: "Select a category to move." });
            return;
        }
        if (sel.lvl === 0) {
            webix.message({ type: "error", text: "The root category cannot be moved." });
            return;
        }
        showCategoryMoveDialog({
            moving: sel,
            onPick: async (newParentId) => {
                await api.movePartCategory(parseInt(sel.id, 10), newParentId);
                await reloadPartCategoryTreeAndGrid(sel.id);
            },
        });
    }

    // Generic add/edit dialog for nodes with name + (optional) description.
    // Pass { omitDescription: true } for name-only forms (e.g. storage location).
    function showSimpleNameDescDialog(opts) {
        const formElements = [
            { view: "text", name: "name", label: "Name", labelWidth: 110, required: true },
        ];
        if (!opts.omitDescription) {
            formElements.push({
                view: "textarea", name: "description", label: "Description",
                labelWidth: 110, height: 80,
            });
        }
        formElements.push({
            cols: [
                {},
                { view: "button", value: "Cancel", width: 90, click: () => $$("pk-edit-namedesc").close() },
                {
                    view: "button",
                    value: opts.saveLabel || "Save",
                    width: 100,
                    css: "webix_primary",
                    hotkey: "ctrl+s",
                    click: async function () {
                        const v = $$("pk-edit-namedesc-form").getValues();
                        if (!v.name || !v.name.trim()) {
                            webix.message({ type: "error", text: "Name is required" });
                            return;
                        }
                        try {
                            const payload = { name: v.name.trim() };
                            if (!opts.omitDescription) payload.description = (v.description || "").trim();
                            await opts.onSave(payload);
                            $$("pk-edit-namedesc").close();
                            webix.message({ text: "Saved", type: "success" });
                        } catch (e) {
                            webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                        }
                    },
                },
            ],
        });
        webix.ui({
            view: "window",
            id: "pk-edit-namedesc",
            modal: true,
            position: "center",
            width: 440,
            head: opts.title,
            body: {
                view: "form",
                id: "pk-edit-namedesc-form",
                elements: formElements,
            },
        }).show();
        const initial = opts.initial || {};
        $$("pk-edit-namedesc-form").setValues({
            name: initial.name || "",
            description: initial.description || "",
        });
    }

    // Move-to picker for the part-category tree.
    function showCategoryMoveDialog(opts) {
        const movingId = String(opts.moving.id);

        function exclude(arr, id) {
            return arr
                .filter((n) => String(n.id) !== id)
                .map((n) => Object.assign({}, n, {
                    children: n.children ? exclude(n.children, id) : [],
                }));
        }

        webix.ui({
            view: "window",
            id: "pk-cat-move",
            modal: true,
            position: "center",
            width: 460,
            height: 560,
            head: `Move "${opts.moving.name}" to…`,
            body: {
                rows: [
                    { template: "Pick a new parent category:", height: 32, css: "pk-dialog-hint", borderless: true },
                    {
                        view: "tree",
                        id: "pk-cat-move-tree",
                        select: true,
                        template: treeNodeTemplate,
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 48,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-cat-move").close() },
                            {
                                view: "button",
                                value: "Move",
                                width: 90,
                                css: "webix_primary",
                                click: async function () {
                                    const tree = $$("pk-cat-move-tree");
                                    const targetId = tree.getSelectedId();
                                    if (!targetId) {
                                        webix.message({ type: "error", text: "Pick a target parent" });
                                        return;
                                    }
                                    try {
                                        await opts.onPick(parseInt(targetId, 10));
                                        $$("pk-cat-move").close();
                                        webix.message({ text: "Moved", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Move failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();

        api.categoryTree().then((arr) => {
            const cleaned = exclude(arr, movingId);
            const tree = $$("pk-cat-move-tree");
            tree.clearAll();
            tree.parse(cleaned.map(transformCategoryNode));
            // Open root
            if (cleaned.length) tree.open(String(cleaned[0].id));
        });
    }

    // --- Storage tree (categories + locations as leaves) ---

    function buildStorageTreeView() {
        return {
            view: "tree",
            id: "pk-storage-tree",
            select: true,
            drag: false,
            template: treeNodeTemplate,
            on: {
                onAfterSelect: function (id) {
                    const node = this.getItem(id);
                    if (!node) return;
                    if (node.kind === "leaf") {
                        loadParts({ filter: { kind: "storage_location", id: node.location_id } });
                    } else if (node.lvl === 0) {
                        loadParts({ filter: null });
                    } else {
                        loadParts({ filter: { kind: "storage_folder", id: node.category_id } });
                    }
                },
            },
        };
    }

    let storageTreeLoaded = false;
    async function loadStorageTree() {
        if (storageTreeLoaded) return;
        try {
            const arr = await api.storageTree();
            const tree = $$("pk-storage-tree");
            tree.clearAll();
            tree.parse(arr.map(transformStorageNode));
            if (arr.length) tree.open(transformStorageNode(arr[0]).id);
            storageTreeLoaded = true;
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load storage tree" });
        }
    }

    function transformStorageNode(node) {
        const out = {
            id: "scat:" + node.id,
            value: node.name,
            kind: "folder",
            lvl: node.lvl,
            category_id: node.id,
            category_path: node.category_path,
        };
        const children = [];
        if (node.children) children.push(...node.children.map(transformStorageNode));
        if (node.locations) {
            children.push(...node.locations.map((loc) => ({
                id: "sloc:" + loc.id,
                value: loc.name,
                kind: "leaf",
                location_id: loc.id,
                part_count: loc.part_count,
            })));
        }
        if (children.length) {
            out.data = children;
            out.open = node.lvl === 0;
        }
        return out;
    }

    // --- Storage CRUD toolbar + dialogs ---

    function buildStorageActionToolbar() {
        return {
            view: "toolbar",
            css: "pk-pane-toolbar",
            height: 38,
            cols: [
                { view: "button", value: "+ Sub", css: "pk-btn-add", width: 60, click: openStorageCategoryAdd },
                { view: "button", value: "+ Loc", css: "pk-btn-add", width: 60, click: openStorageLocationAdd },
                { view: "button", value: "✎", css: "webix_primary", width: 36, click: openStorageEdit },
                { view: "button", value: "Move…", width: 70, click: openStorageMove },
                { view: "button", value: "🗑", css: "pk-btn-remove", width: 36, click: confirmStorageDelete },
                {},
            ],
        };
    }

    // Returns the contextual storage-category id for + actions:
    //   folder selected → that folder's category_id
    //   leaf selected   → its parent category's category_id
    //   nothing selected → null
    function getStorageContextCategoryId() {
        const tree = $$("pk-storage-tree");
        if (!tree) return null;
        const id = tree.getSelectedId();
        if (!id) return null;
        const node = tree.getItem(id);
        if (!node) return null;
        if (node.kind === "folder") return node.category_id;
        if (node.kind === "leaf") {
            const parentId = tree.getParentId(id);
            if (!parentId) return null;
            const parent = tree.getItem(parentId);
            return parent ? parent.category_id : null;
        }
        return null;
    }

    async function reloadStorageTreeAndGrid(reselectId) {
        try {
            const arr = await api.storageTree();
            const tree = $$("pk-storage-tree");
            tree.clearAll();
            tree.parse(arr.map(transformStorageNode));
            if (reselectId && tree.exists(reselectId)) {
                tree.select(reselectId);
                tree.open(reselectId);
            } else if (arr.length) {
                tree.open(transformStorageNode(arr[0]).id);
            }
        } catch (e) {
            console.error(e);
        }
        await loadParts({});
    }

    function openStorageCategoryAdd() {
        const parentId = getStorageContextCategoryId();
        if (parentId == null) {
            webix.message({ type: "error", text: "Select a storage folder first." });
            return;
        }
        showSimpleNameDescDialog({
            title: "New storage sub-category",
            saveLabel: "Create",
            initial: { name: "", description: "" },
            onSave: async (v) => {
                const created = await api.createStorageCategory({
                    parent_id: parentId,
                    name: v.name,
                    description: v.description || null,
                });
                await reloadStorageTreeAndGrid("scat:" + created.id);
            },
        });
    }

    function openStorageLocationAdd() {
        const parentId = getStorageContextCategoryId();
        if (parentId == null) {
            webix.message({ type: "error", text: "Select a storage folder first." });
            return;
        }
        showSimpleNameDescDialog({
            title: "New storage location",
            saveLabel: "Create",
            omitDescription: true,
            initial: { name: "" },
            onSave: async (v) => {
                const created = await api.createStorageLocation({
                    category_id: parentId,
                    name: v.name,
                });
                await reloadStorageTreeAndGrid("sloc:" + created.id);
            },
        });
    }

    async function openStorageEdit() {
        const tree = $$("pk-storage-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a folder or location to edit." });
            return;
        }
        if (node.kind === "folder") {
            if (node.lvl === 0) {
                webix.message({ type: "error", text: "The root storage category cannot be renamed." });
                return;
            }
            const full = await api.storageCategoryById(node.category_id);
            showSimpleNameDescDialog({
                title: `Edit storage category "${node.value}"`,
                saveLabel: "Save",
                initial: { name: node.value, description: (full && full.description) || "" },
                onSave: async (v) => {
                    await api.updateStorageCategory(node.category_id, {
                        name: v.name,
                        description: v.description || null,
                    });
                    await reloadStorageTreeAndGrid("scat:" + node.category_id);
                },
            });
        } else {
            // leaf — location edit, name only
            showSimpleNameDescDialog({
                title: `Edit storage location "${node.value}"`,
                saveLabel: "Save",
                omitDescription: true,
                initial: { name: node.value },
                onSave: async (v) => {
                    await api.updateStorageLocation(node.location_id, { name: v.name });
                    await reloadStorageTreeAndGrid("sloc:" + node.location_id);
                },
            });
        }
    }

    function confirmStorageDelete() {
        const tree = $$("pk-storage-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a folder or location to delete." });
            return;
        }
        if (node.kind === "folder" && node.lvl === 0) {
            webix.message({ type: "error", text: "The root storage category cannot be deleted." });
            return;
        }
        const what = node.kind === "folder" ? "storage category" : "storage location";
        webix.confirm({
            title: `Delete ${what}`,
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text:
                `Delete ${what} <b>${escapeHtml(node.value)}</b>?<br><br>` +
                (node.kind === "folder"
                    ? "Refused if it contains locations or sub-categories."
                    : "Refused if any parts reference this location."),
            callback: async (result) => {
                if (!result) return;
                try {
                    if (node.kind === "folder") {
                        await api.deleteStorageCategory(node.category_id);
                    } else {
                        await api.deleteStorageLocation(node.location_id);
                    }
                    await reloadStorageTreeAndGrid();
                    webix.message({ text: `${what} deleted`, type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    function openStorageMove() {
        const tree = $$("pk-storage-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a folder or location to move." });
            return;
        }
        if (node.kind === "folder" && node.lvl === 0) {
            webix.message({ type: "error", text: "The root storage category cannot be moved." });
            return;
        }
        const isFolder = node.kind === "folder";
        showStoragePickerDialog({
            title: isFolder
                ? `Move "${node.value}" to…`
                : `Move location "${node.value}" to…`,
            hint: "Pick a new parent storage category:",
            excludeCategoryId: isFolder ? node.category_id : null,
            onPick: async (newCatId) => {
                if (isFolder) {
                    await api.moveStorageCategory(node.category_id, newCatId);
                    await reloadStorageTreeAndGrid("scat:" + node.category_id);
                } else {
                    await api.moveStorageLocation(node.location_id, newCatId);
                    await reloadStorageTreeAndGrid("sloc:" + node.location_id);
                }
            },
        });
    }

    // Folders-only transform: drop the `locations` arrays so the picker
    // shows just the category structure (you can't put a category or a
    // location *under* a location).
    function transformStorageCategoryOnly(node) {
        const out = {
            id: "scat:" + node.id,
            value: node.name,
            kind: "folder",
            lvl: node.lvl,
            category_id: node.id,
        };
        if (node.children && node.children.length) {
            out.data = node.children.map(transformStorageCategoryOnly);
            out.open = node.lvl === 0;
        }
        return out;
    }

    function showStoragePickerDialog(opts) {
        function exclude(arr, excludedId) {
            if (excludedId == null) return arr;
            return arr
                .filter((n) => "scat:" + n.id !== excludedId)
                .map((n) => Object.assign({}, n, {
                    children: n.children ? exclude(n.children, excludedId) : [],
                }));
        }

        webix.ui({
            view: "window",
            id: "pk-storage-picker",
            modal: true,
            position: "center",
            width: 460,
            height: 560,
            head: opts.title,
            body: {
                rows: [
                    { template: opts.hint, height: 32, css: "pk-dialog-hint", borderless: true },
                    {
                        view: "tree",
                        id: "pk-storage-picker-tree",
                        select: true,
                        template: treeNodeTemplate,
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 48,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-storage-picker").close() },
                            {
                                view: "button",
                                value: "Move",
                                width: 90,
                                css: "webix_primary",
                                click: async function () {
                                    const t = $$("pk-storage-picker-tree");
                                    const targetId = t.getSelectedId();
                                    if (!targetId) {
                                        webix.message({ type: "error", text: "Pick a target category" });
                                        return;
                                    }
                                    const targetNode = t.getItem(targetId);
                                    try {
                                        await opts.onPick(targetNode.category_id);
                                        $$("pk-storage-picker").close();
                                        webix.message({ text: "Moved", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Move failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();

        api.storageTree().then((arr) => {
            const cleaned = exclude(arr, opts.excludeCategoryId ? "scat:" + opts.excludeCategoryId : null);
            const t = $$("pk-storage-picker-tree");
            t.clearAll();
            t.parse(cleaned.map(transformStorageCategoryOnly));
            if (cleaned.length) t.open("scat:" + cleaned[0].id);
        });
    }

    // --- Footprint tree (categories + footprints as leaves) ---

    function buildFootprintTreeView() {
        return {
            view: "tree",
            id: "pk-footprint-tree",
            select: true,
            drag: false,
            template: treeNodeTemplate,
            on: {
                onAfterSelect: function (id) {
                    const node = this.getItem(id);
                    if (!node) return;
                    if (node.kind === "leaf") {
                        loadParts({ filter: { kind: "footprint", id: node.footprint_id } });
                    } else if (node.lvl === 0) {
                        loadParts({ filter: null });
                    } else {
                        loadParts({ filter: { kind: "footprint_folder", id: node.category_id } });
                    }
                },
            },
        };
    }

    let footprintTreeLoaded = false;
    async function loadFootprintTree() {
        if (footprintTreeLoaded) return;
        try {
            const arr = await api.footprintTree();
            const tree = $$("pk-footprint-tree");
            tree.clearAll();
            tree.parse(arr.map(transformFootprintNode));
            if (arr.length) tree.open(transformFootprintNode(arr[0]).id);
            footprintTreeLoaded = true;
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load footprint tree" });
        }
    }

    function transformFootprintNode(node) {
        const out = {
            id: "fcat:" + node.id,
            value: node.name,
            kind: "folder",
            lvl: node.lvl,
            category_id: node.id,
            category_path: node.category_path,
        };
        const children = [];
        if (node.children) children.push(...node.children.map(transformFootprintNode));
        if (node.footprints) {
            children.push(...node.footprints.map((fp) => ({
                id: "fp:" + fp.id,
                value: fp.name,
                kind: "leaf",
                footprint_id: fp.id,
                part_count: fp.part_count,
            })));
        }
        if (children.length) {
            out.data = children;
            out.open = node.lvl === 0;
        }
        return out;
    }

    // --- Footprint CRUD toolbar + dialogs ---

    function buildFootprintActionToolbar() {
        return {
            view: "toolbar",
            css: "pk-pane-toolbar",
            height: 38,
            cols: [
                { view: "button", value: "+ Sub", css: "pk-btn-add", width: 60, click: openFootprintCategoryAdd },
                { view: "button", value: "+ FP", css: "pk-btn-add", width: 56, click: openFootprintAdd },
                { view: "button", value: "✎", css: "webix_primary", width: 36, click: openFootprintEdit },
                { view: "button", value: "Move…", width: 70, click: openFootprintMove },
                { view: "button", value: "🗑", css: "pk-btn-remove", width: 36, click: confirmFootprintDelete },
                {},
            ],
        };
    }

    function getFootprintContextCategoryId() {
        const tree = $$("pk-footprint-tree");
        if (!tree) return null;
        const id = tree.getSelectedId();
        if (!id) return null;
        const node = tree.getItem(id);
        if (!node) return null;
        if (node.kind === "folder") return node.category_id;
        if (node.kind === "leaf") {
            const parentId = tree.getParentId(id);
            if (!parentId) return null;
            const parent = tree.getItem(parentId);
            return parent ? parent.category_id : null;
        }
        return null;
    }

    async function reloadFootprintTreeAndGrid(reselectId) {
        try {
            const arr = await api.footprintTree();
            const tree = $$("pk-footprint-tree");
            tree.clearAll();
            tree.parse(arr.map(transformFootprintNode));
            if (reselectId && tree.exists(reselectId)) {
                tree.select(reselectId);
                tree.open(reselectId);
            } else if (arr.length) {
                tree.open(transformFootprintNode(arr[0]).id);
            }
        } catch (e) {
            console.error(e);
        }
        await loadParts({});
    }

    function openFootprintCategoryAdd() {
        const parentId = getFootprintContextCategoryId();
        if (parentId == null) {
            webix.message({ type: "error", text: "Select a footprint folder first." });
            return;
        }
        showSimpleNameDescDialog({
            title: "New footprint sub-category",
            saveLabel: "Create",
            initial: { name: "", description: "" },
            onSave: async (v) => {
                const created = await api.createFootprintCategory({
                    parent_id: parentId,
                    name: v.name,
                    description: v.description || null,
                });
                await reloadFootprintTreeAndGrid("fcat:" + created.id);
            },
        });
    }

    function openFootprintAdd() {
        const parentId = getFootprintContextCategoryId();
        if (parentId == null) {
            webix.message({ type: "error", text: "Select a footprint folder first." });
            return;
        }
        showSimpleNameDescDialog({
            title: "New footprint",
            saveLabel: "Create",
            initial: { name: "", description: "" },
            onSave: async (v) => {
                const created = await api.createFootprint({
                    category_id: parentId,
                    name: v.name,
                    description: v.description || null,
                });
                await reloadFootprintTreeAndGrid("fp:" + created.id);
            },
        });
    }

    async function openFootprintEdit() {
        const tree = $$("pk-footprint-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a footprint folder or footprint to edit." });
            return;
        }
        if (node.kind === "folder") {
            if (node.lvl === 0) {
                webix.message({ type: "error", text: "The root footprint category cannot be renamed." });
                return;
            }
            const full = await api.footprintCategoryById(node.category_id);
            showSimpleNameDescDialog({
                title: `Edit footprint category "${node.value}"`,
                saveLabel: "Save",
                initial: { name: node.value, description: (full && full.description) || "" },
                onSave: async (v) => {
                    await api.updateFootprintCategory(node.category_id, {
                        name: v.name,
                        description: v.description || null,
                    });
                    await reloadFootprintTreeAndGrid("fcat:" + node.category_id);
                },
            });
        } else {
            // leaf — footprint with name + description
            const full = await api.footprintById(node.footprint_id);
            showSimpleNameDescDialog({
                title: `Edit footprint "${node.value}"`,
                saveLabel: "Save",
                initial: { name: node.value, description: (full && full.description) || "" },
                onSave: async (v) => {
                    await api.updateFootprint(node.footprint_id, {
                        name: v.name,
                        description: v.description || null,
                    });
                    await reloadFootprintTreeAndGrid("fp:" + node.footprint_id);
                },
            });
        }
    }

    function confirmFootprintDelete() {
        const tree = $$("pk-footprint-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a footprint folder or footprint to delete." });
            return;
        }
        if (node.kind === "folder" && node.lvl === 0) {
            webix.message({ type: "error", text: "The root footprint category cannot be deleted." });
            return;
        }
        const what = node.kind === "folder" ? "footprint category" : "footprint";
        webix.confirm({
            title: `Delete ${what}`,
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text:
                `Delete ${what} <b>${escapeHtml(node.value)}</b>?<br><br>` +
                (node.kind === "folder"
                    ? "Refused if it contains footprints or sub-categories."
                    : "Refused if any parts reference this footprint."),
            callback: async (result) => {
                if (!result) return;
                try {
                    if (node.kind === "folder") {
                        await api.deleteFootprintCategory(node.category_id);
                    } else {
                        await api.deleteFootprint(node.footprint_id);
                    }
                    await reloadFootprintTreeAndGrid();
                    webix.message({ text: `${what} deleted`, type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    function openFootprintMove() {
        const tree = $$("pk-footprint-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a footprint folder or footprint to move." });
            return;
        }
        if (node.kind === "folder" && node.lvl === 0) {
            webix.message({ type: "error", text: "The root footprint category cannot be moved." });
            return;
        }
        const isFolder = node.kind === "folder";
        showFootprintPickerDialog({
            title: isFolder
                ? `Move "${node.value}" to…`
                : `Move footprint "${node.value}" to…`,
            hint: "Pick a new parent footprint category:",
            excludeCategoryId: isFolder ? node.category_id : null,
            onPick: async (newCatId) => {
                if (isFolder) {
                    await api.moveFootprintCategory(node.category_id, newCatId);
                    await reloadFootprintTreeAndGrid("fcat:" + node.category_id);
                } else {
                    await api.moveFootprint(node.footprint_id, newCatId);
                    await reloadFootprintTreeAndGrid("fp:" + node.footprint_id);
                }
            },
        });
    }

    function transformFootprintCategoryOnly(node) {
        const out = {
            id: "fcat:" + node.id,
            value: node.name,
            kind: "folder",
            lvl: node.lvl,
            category_id: node.id,
        };
        if (node.children && node.children.length) {
            out.data = node.children.map(transformFootprintCategoryOnly);
            out.open = node.lvl === 0;
        }
        return out;
    }

    function showFootprintPickerDialog(opts) {
        function exclude(arr, excludedId) {
            if (excludedId == null) return arr;
            return arr
                .filter((n) => "fcat:" + n.id !== excludedId)
                .map((n) => Object.assign({}, n, {
                    children: n.children ? exclude(n.children, excludedId) : [],
                }));
        }

        webix.ui({
            view: "window",
            id: "pk-footprint-picker",
            modal: true,
            position: "center",
            width: 460,
            height: 560,
            head: opts.title,
            body: {
                rows: [
                    { template: opts.hint, height: 32, css: "pk-dialog-hint", borderless: true },
                    {
                        view: "tree",
                        id: "pk-footprint-picker-tree",
                        select: true,
                        template: treeNodeTemplate,
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 48,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-footprint-picker").close() },
                            {
                                view: "button",
                                value: "Move",
                                width: 90,
                                css: "webix_primary",
                                click: async function () {
                                    const t = $$("pk-footprint-picker-tree");
                                    const targetId = t.getSelectedId();
                                    if (!targetId) {
                                        webix.message({ type: "error", text: "Pick a target category" });
                                        return;
                                    }
                                    const targetNode = t.getItem(targetId);
                                    try {
                                        await opts.onPick(targetNode.category_id);
                                        $$("pk-footprint-picker").close();
                                        webix.message({ text: "Moved", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Move failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();

        api.footprintTree().then((arr) => {
            const cleaned = exclude(arr, opts.excludeCategoryId ? "fcat:" + opts.excludeCategoryId : null);
            const t = $$("pk-footprint-picker-tree");
            t.clearAll();
            t.parse(cleaned.map(transformFootprintCategoryOnly));
            if (cleaned.length) t.open("fcat:" + cleaned[0].id);
        });
    }

    // --- Lookups left-pane list ---

    function buildLookupsStub() {
        return {
            view: "list",
            id: "pk-lookups-list",
            css: "pk-lookups-list",
            select: true,
            template: function (o) {
                return `<span class="pk-lookups-icon">▤</span> ${escapeHtml(o.value)}`;
            },
            data: [
                { id: "manufacturers", value: "Manufacturers" },
                { id: "distributors", value: "Distributors" },
                { id: "part_units", value: "Part Units" },
                { id: "units", value: "Units (parametric)" },
                { id: "si_prefixes", value: "SI Prefixes" },
            ],
            on: {
                onAfterSelect: function (id) { showLookupType(id); },
            },
        };
    }

    // ============================================================
    //  Center pane — parts grid
    // ============================================================

    // Active filter for the parts grid. `filter` is null (= all parts)
    // or { kind: "category"|"storage_folder"|"storage_location"|
    //              "footprint_folder"|"footprint", id: number }.
    let currentParts = { filter: null, search: "" };

    function buildCenterPane() {
        return {
            id: "pk-center",
            view: "multiview",
            cells: [
                { id: "centerpane-grid", rows: buildPartsGridRows() },
                { id: "centerpane-lookups", rows: buildLookupsCenterRows() },
            ],
        };
    }

    function buildPartsGridRows() {
        return [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 40,
                    cols: [
                        { view: "label", id: "pk-grid-title", label: "Parts", css: "pk-pane-title" },
                        {},
                        {
                            view: "button",
                            value: "+ Part",
                            css: "pk-btn-add",
                            width: 95,
                            click: () => openPartEditor("new"),
                        },
                        {
                            view: "button",
                            value: "+ Meta-Part",
                            css: "pk-btn-meta",
                            width: 125,
                            click: () => openPartEditor("new", { metaPart: true }),
                        },
                        {
                            view: "button",
                            value: "⎘ Duplicate",
                            css: "webix_primary",
                            width: 130,
                            click: () => openPartEditor("duplicate"),
                        },
                        {
                            view: "search",
                            id: "pk-search",
                            placeholder: "Search name / description / IPN…",
                            width: 280,
                            on: {
                                onTimedKeyPress: function () {
                                    currentParts.search = this.getValue().trim();
                                    loadParts({});
                                },
                            },
                        },
                    ],
                },
                {
                    view: "datatable",
                    id: "pk-parts-grid",
                    css: "pk-grid",
                    select: "row",
                    resizeColumn: { headerOnly: true, size: 4 },
                    columns: [
                        {
                            id: "name",
                            header: "Name",
                            width: 220,
                            sort: "string",
                            template: (o) => escapeHtml(o.name || ""),
                        },
                        {
                            id: "internal_part_number",
                            header: "IPN",
                            width: 110,
                            sort: "string",
                            template: (o) => escapeHtml(o.internal_part_number || ""),
                        },
                        {
                            id: "description",
                            header: "Description",
                            fillspace: true,
                            sort: "string",
                            template: (o) => escapeHtml(o.description || ""),
                        },
                        {
                            id: "category_path",
                            header: "Category",
                            width: 240,
                            sort: "string",
                            template: (o) => {
                                const p = o.category_path || "";
                                // show only the leaf for grid density
                                const parts = p.split(" ➤ ");
                                return escapeHtml(parts[parts.length - 1] || p);
                            },
                        },
                        {
                            id: "stock_level",
                            header: { text: "Stock", css: "pk-th-numeric" },
                            width: 70,
                            sort: "int",
                            css: "pk-numeric",
                        },
                        {
                            id: "average_price",
                            header: { text: "Avg $", css: "pk-th-numeric" },
                            width: 80,
                            sort: "int",
                            css: "pk-numeric",
                            template: (o) => {
                                const v = parseFloat(o.average_price);
                                return Number.isFinite(v) ? v.toFixed(4) : "";
                            },
                        },
                    ],
                    on: {
                        onAfterSelect: function (s) {
                            loadPartDetail(s.id);
                        },
                    },
                },
                {
                    view: "label",
                    id: "pk-parts-status",
                    css: "pk-status-bar",
                    label: "",
                    height: 22,
                },
            ];
    }

    // ============================================================
    //  Attachments — reusable section for any of the 6 kinds
    // ============================================================

    const ATTACHMENT_KINDS = {
        PartAttachment: {
            listPath: (id) => `/api/parts/${id}/attachments`,
            label: "Attachments",
        },
        FootprintImage: {
            listPath: (id) => `/api/footprints/${id}/images`,
            label: "Images",
        },
        FootprintAttachment: {
            listPath: (id) => `/api/footprints/${id}/attachments`,
            label: "Attachments",
        },
        ManufacturerICLogo: {
            listPath: (id) => `/api/manufacturers/${id}/logos`,
            label: "Logos",
        },
        StorageLocationImage: {
            listPath: (id) => `/api/storage_locations/${id}/images`,
            label: "Images",
        },
        ProjectAttachment: {
            listPath: (id) => `/api/projects/${id}/attachments`,
            label: "Attachments",
        },
    };

    // Build a Webix view that shows the attachments for one parent entity.
    //   tableId      — unique Webix id for the inner datatable
    //   uploaderId   — unique Webix id for the file-picker
    //   kind         — key into ATTACHMENT_KINDS
    //   getParentId  — () => current parent id (or null when not yet saved)
    function buildAttachmentsSection({ tableId, uploaderId, kind, getParentId }) {
        return {
            rows: [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 38,
                    cols: [
                        {
                            view: "uploader",
                            id: uploaderId,
                            value: "+ Attach files",
                            css: "pk-btn-add",
                            multiple: true,
                            link: tableId,
                            autosend: false,
                            width: 130,
                            on: {
                                onBeforeFileAdd: function () {
                                    const parentId = getParentId();
                                    if (!parentId) {
                                        webix.message({ type: "error", text: "Save the entity first." });
                                        return false;
                                    }
                                    this.config.upload = ATTACHMENT_KINDS[kind].listPath(parentId);
                                    return true;
                                },
                                onFileUpload: function () {
                                    // Re-fetch the list so we get the server's
                                    // canonical view (the uploader's auto-add
                                    // skips fields like id/mimetype).
                                    refreshAttachments({ tableId, kind, getParentId });
                                },
                                onFileUploadError: function (file, response) {
                                    webix.message({
                                        type: "error",
                                        text: "Upload failed: " + (response && response.text ? response.text : "?"),
                                    });
                                },
                            },
                        },
                        {
                            view: "button",
                            value: "+ From URL",
                            css: "webix_primary",
                            width: 110,
                            click: () => openAttachmentByUrlDialog({ tableId, kind, getParentId }),
                        },
                        {
                            view: "button",
                            value: "✎ Description",
                            width: 130,
                            click: () => openAttachmentDescriptionDialog({ tableId, kind, getParentId }),
                        },
                        {
                            view: "button",
                            value: "🗑 Delete",
                            css: "pk-btn-remove",
                            width: 100,
                            click: () => confirmAttachmentDelete({ tableId, kind, getParentId }),
                        },
                        {},
                    ],
                },
                {
                    view: "datatable",
                    id: tableId,
                    css: "pk-grid",
                    select: "row",
                    columns: [
                        {
                            id: "preview",
                            header: "",
                            width: 60,
                            template: function (o) {
                                if (!o.id) return "";
                                if (o.is_image) {
                                    return `<img src="/files/${kind}/${o.id}/thumb" alt="" class="pk-att-thumb">`;
                                }
                                return '<span class="pk-att-doc">📄</span>';
                            },
                        },
                        {
                            id: "originalname",
                            header: "Filename",
                            fillspace: true,
                            template: function (o) {
                                if (!o.id) return "";
                                const name = escapeHtml(o.originalname || o.filename || "");
                                return `<a href="/files/${kind}/${o.id}" target="_blank">${name}</a>`;
                            },
                        },
                        {
                            id: "size",
                            header: { text: "Size", css: "pk-th-numeric" },
                            width: 90,
                            css: "pk-numeric",
                            template: (o) => o.size ? `${(o.size / 1024).toFixed(1)} KB` : "",
                        },
                        {
                            id: "mimetype",
                            header: "Type",
                            width: 130,
                        },
                        {
                            id: "description",
                            header: "Description",
                            width: 200,
                            template: (o) => escapeHtml(o.description || ""),
                        },
                    ],
                    type: { height: 44 },  // taller rows for the thumbs
                },
            ],
        };
    }

    async function refreshAttachments({ tableId, kind, getParentId }) {
        const parentId = getParentId();
        const grid = $$(tableId);
        if (!grid) return;
        if (!parentId) { grid.clearAll(); return; }
        try {
            const rows = await api.listAttachments(kind, parentId);
            grid.clearAll();
            grid.parse(rows);
        } catch (e) {
            console.error(e);
        }
    }

    function openAttachmentByUrlDialog({ tableId, kind, getParentId }) {
        const parentId = getParentId();
        if (!parentId) {
            webix.message({ type: "error", text: "Save the entity first." });
            return;
        }
        webix.ui({
            view: "window",
            id: "pk-att-url",
            modal: true,
            position: "center",
            width: 520,
            head: "Attach by URL",
            body: {
                view: "form",
                id: "pk-att-url-form",
                elements: [
                    { view: "text", name: "url", label: "URL", labelWidth: 100, required: true },
                    { view: "text", name: "filename", label: "Filename", labelWidth: 100,
                      placeholder: "(optional — auto-detected)" },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-att-url").close() },
                            {
                                view: "button",
                                value: "Fetch",
                                width: 100,
                                css: "webix_primary",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-att-url-form").getValues();
                                    if (!v.url || !v.url.trim()) {
                                        webix.message({ type: "error", text: "URL is required" });
                                        return;
                                    }
                                    try {
                                        await api.fetchAttachmentByUrl(kind, parentId,
                                            v.url.trim(), (v.filename || "").trim() || null);
                                        $$("pk-att-url").close();
                                        await refreshAttachments({ tableId, kind, getParentId });
                                        webix.message({ text: "Fetched", type: "success" });
                                    } catch (e) {
                                        showUrlFetchFailedAlert(v.url.trim(), e);
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
        setTimeout(() => $$("pk-att-url-form").focus(), 0);
    }

    function openAttachmentDescriptionDialog({ tableId, kind, getParentId }) {
        const grid = $$(tableId);
        const sel = grid && grid.getSelectedId() ? grid.getItem(grid.getSelectedId()) : null;
        if (!sel) {
            webix.message({ type: "error", text: "Select an attachment first." });
            return;
        }
        webix.ui({
            view: "window",
            id: "pk-att-desc",
            modal: true,
            position: "center",
            width: 480,
            head: `Edit description: ${sel.originalname || sel.filename}`,
            body: {
                view: "form",
                id: "pk-att-desc-form",
                elements: [
                    { view: "textarea", name: "description", label: "Description", labelWidth: 100, height: 100 },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-att-desc").close() },
                            {
                                view: "button",
                                value: "Save",
                                width: 90,
                                css: "webix_primary",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-att-desc-form").getValues();
                                    try {
                                        await api.updateAttachmentDescription(kind, sel.id, v.description);
                                        $$("pk-att-desc").close();
                                        await refreshAttachments({ tableId, kind, getParentId });
                                        webix.message({ text: "Saved", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
        $$("pk-att-desc-form").setValues({ description: sel.description || "" });
    }

    function showUrlFetchFailedAlert(url, error) {
        const msg = String(error && error.message ? error.message : error);

        // Heuristics: extract the host so the alert mentions a specific
        // vendor when known to be problematic.
        let host = "";
        try { host = new URL(url).host.replace(/^www\./, ""); } catch (_) {}
        const knownBlockers = ["analog.com", "octopart.com", "digikey.com", "mouser.com"];
        const isKnownBlocker = knownBlockers.some((h) => host.endsWith(h));

        const reason = msg.includes("error sending request")
            ? "the server refused the connection or timed out"
            : msg.includes("status 403")
                ? "the server returned 403 (forbidden — usually bot protection)"
                : msg.includes("status 404")
                    ? "the server returned 404 (URL not found)"
                    : msg.includes("status 4")
                        ? "the server returned a client error"
                        : msg.includes("status 5")
                            ? "the server returned a server error"
                            : "an error occurred while fetching";

        const blockerNote = isKnownBlocker
            ? `<p><b>${escapeHtml(host)}</b> is known to block automated downloads via Akamai or Cloudflare bot protection. ` +
              `Programmatic clients can't pass their TLS/JS challenges.</p>`
            : "";

        webix.alert({
            title: "URL fetch failed",
            width: 520,
            text:
                `<div style="text-align:left;line-height:1.5">` +
                `<p>Could not fetch <code style="word-break:break-all">${escapeHtml(url)}</code> — ${reason}.</p>` +
                blockerNote +
                `<p><b>Workaround:</b> download the file manually in your browser, ` +
                `then use <b>+ Attach files</b> to upload it.</p>` +
                `<details style="margin-top:8px"><summary style="cursor:pointer;color:#6a7a8a">Show server message</summary>` +
                `<pre style="background:#f3f5f7;padding:6px;font-size:11px;white-space:pre-wrap">${escapeHtml(msg)}</pre>` +
                `</details>` +
                `</div>`,
        });
    }

    function confirmAttachmentDelete({ tableId, kind, getParentId }) {
        const grid = $$(tableId);
        const sel = grid && grid.getSelectedId() ? grid.getItem(grid.getSelectedId()) : null;
        if (!sel) {
            webix.message({ type: "error", text: "Select an attachment first." });
            return;
        }
        const name = sel.originalname || sel.filename;
        webix.confirm({
            title: "Delete attachment",
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text: `Delete <b>${escapeHtml(name)}</b>? This removes the file from disk too.`,
            callback: async (result) => {
                if (!result) return;
                try {
                    await api.deleteAttachment(kind, sel.id);
                    await refreshAttachments({ tableId, kind, getParentId });
                    webix.message({ text: "Deleted", type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    // ============================================================
    //  Lookups CRUD — center pane content + per-type definitions
    // ============================================================

    // Configuration table: each lookup type knows its endpoint, list
    // columns to render, and how to seed/format an edit dialog.
    const LOOKUP_TYPES = {
        manufacturers: {
            label: "Manufacturers",
            url: "/api/manufacturers",
            columns: [
                { id: "name", header: "Name", fillspace: true, sort: "string" },
                { id: "url", header: "URL", width: 220, sort: "string" },
                { id: "email", header: "Email", width: 200, sort: "string" },
                { id: "phone", header: "Phone", width: 130, sort: "string" },
                { id: "part_count", header: { text: "Parts", css: "pk-th-numeric" }, width: 70, sort: "int", css: "pk-numeric" },
            ],
            buildEdit: (existing) => ({
                title: existing ? `Edit manufacturer "${existing.name}"` : "New manufacturer",
                fields: [
                    { kind: "text", name: "name", label: "Name", required: true },
                    { kind: "text", name: "url", label: "URL" },
                    { kind: "text", name: "email", label: "Email" },
                    { kind: "text", name: "phone", label: "Phone" },
                    { kind: "text", name: "fax", label: "Fax" },
                    { kind: "textarea", name: "address", label: "Address", height: 60 },
                    { kind: "textarea", name: "comment", label: "Comment", height: 60 },
                ],
                seed: existing || { name: "", url: "", email: "", phone: "", fax: "", address: "", comment: "" },
                serialize: (v) => ({
                    name: v.name.trim(),
                    url: (v.url || "").trim() || null,
                    email: (v.email || "").trim() || null,
                    phone: (v.phone || "").trim() || null,
                    fax: (v.fax || "").trim() || null,
                    address: (v.address || "").trim() || null,
                    comment: (v.comment || "").trim() || null,
                }),
            }),
        },
        distributors: {
            label: "Distributors",
            url: "/api/distributors",
            columns: [
                { id: "name", header: "Name", fillspace: true, sort: "string" },
                { id: "url", header: "URL", width: 220, sort: "string" },
                { id: "skuurl", header: "SKU URL", width: 200, sort: "string" },
                { id: "phone", header: "Phone", width: 130, sort: "string" },
            ],
            buildEdit: (existing) => ({
                title: existing ? `Edit distributor "${existing.name}"` : "New distributor",
                fields: [
                    { kind: "text", name: "name", label: "Name", required: true },
                    { kind: "text", name: "url", label: "URL" },
                    { kind: "text", name: "skuurl", label: "SKU URL" },
                    { kind: "text", name: "email", label: "Email" },
                    { kind: "text", name: "phone", label: "Phone" },
                    { kind: "text", name: "fax", label: "Fax" },
                    { kind: "textarea", name: "address", label: "Address", height: 60 },
                    { kind: "textarea", name: "comment", label: "Comment", height: 60 },
                    { kind: "checkbox", name: "enabled_for_reports", labelRight: "Enabled for reports" },
                ],
                seed: existing || { name: "", url: "", skuurl: "", email: "", phone: "", fax: "", address: "", comment: "", enabled_for_reports: true },
                serialize: (v) => ({
                    name: v.name.trim(),
                    url: (v.url || "").trim() || null,
                    skuurl: (v.skuurl || "").trim() || null,
                    email: (v.email || "").trim() || null,
                    phone: (v.phone || "").trim() || null,
                    fax: (v.fax || "").trim() || null,
                    address: (v.address || "").trim() || null,
                    comment: (v.comment || "").trim() || null,
                    enabled_for_reports: !!v.enabled_for_reports,
                }),
            }),
        },
        part_units: {
            label: "Part Units",
            url: "/api/part_measurement_units",
            columns: [
                { id: "name", header: "Name", fillspace: true, sort: "string" },
                { id: "short_name", header: "Short", width: 100, sort: "string" },
                {
                    id: "is_default", header: "Default", width: 80,
                    template: (o) => o.is_default ? "<b>✓</b>" : "",
                },
                { id: "part_count", header: { text: "Parts", css: "pk-th-numeric" }, width: 70, sort: "int", css: "pk-numeric" },
            ],
            buildEdit: (existing) => ({
                title: existing ? `Edit part unit "${existing.name}"` : "New part unit",
                fields: [
                    { kind: "text", name: "name", label: "Name", required: true },
                    { kind: "text", name: "short_name", label: "Short name", required: true },
                    { kind: "checkbox", name: "is_default", labelRight: "Default unit for new parts" },
                ],
                seed: existing || { name: "", short_name: "", is_default: false },
                serialize: (v) => ({
                    name: v.name.trim(),
                    short_name: (v.short_name || "").trim(),
                    is_default: !!v.is_default,
                }),
            }),
        },
        units: {
            label: "Units (parametric)",
            url: "/api/units",
            columns: [
                { id: "name", header: "Name", fillspace: true, sort: "string" },
                { id: "symbol", header: "Symbol", width: 110, sort: "string" },
                { id: "parameter_count", header: { text: "Used", css: "pk-th-numeric" }, width: 70, sort: "int", css: "pk-numeric" },
            ],
            buildEdit: (existing) => ({
                title: existing ? `Edit unit "${existing.name}"` : "New unit",
                fields: [
                    { kind: "text", name: "name", label: "Name", required: true },
                    { kind: "text", name: "symbol", label: "Symbol", required: true },
                    // SI prefix M:M editing deferred — for now we send the
                    // existing list back unchanged on update so we don't
                    // wipe it out.
                ],
                seed: existing || { name: "", symbol: "", allowed_prefix_ids: [] },
                serialize: (v, existing) => ({
                    name: v.name.trim(),
                    symbol: (v.symbol || "").trim(),
                    allowed_prefix_ids: existing ? (existing.allowed_prefix_ids || []) : [],
                }),
            }),
        },
        si_prefixes: {
            label: "SI Prefixes",
            url: "/api/si_prefixes",
            columns: [
                { id: "prefix", header: "Prefix", fillspace: true, sort: "string" },
                { id: "symbol", header: "Symbol", width: 90, sort: "string" },
                { id: "base", header: { text: "Base", css: "pk-th-numeric" }, width: 70, sort: "int", css: "pk-numeric" },
                { id: "exponent", header: { text: "Exponent", css: "pk-th-numeric" }, width: 90, sort: "int", css: "pk-numeric" },
                { id: "parameter_count", header: { text: "Used", css: "pk-th-numeric" }, width: 70, sort: "int", css: "pk-numeric" },
            ],
            buildEdit: (existing) => ({
                title: existing ? `Edit SI prefix "${existing.prefix}"` : "New SI prefix",
                fields: [
                    { kind: "text", name: "prefix", label: "Prefix", required: true },
                    { kind: "text", name: "symbol", label: "Symbol", required: true },
                    { kind: "counter", name: "base", label: "Base", min: 2, step: 1 },
                    // Webix counter defaults min:0; exponents go negative
                    // (yocto = -24), so allow plenty of headroom both ways.
                    { kind: "counter", name: "exponent", label: "Exponent", min: -100, max: 100, step: 1 },
                ],
                seed: existing || { prefix: "", symbol: "", base: 10, exponent: 0 },
                serialize: (v) => ({
                    prefix: v.prefix.trim(),
                    symbol: (v.symbol || "").trim(),
                    base: parseInt(v.base, 10) || 10,
                    exponent: parseInt(v.exponent, 10) || 0,
                }),
            }),
        },
    };

    let currentLookupType = null;  // key into LOOKUP_TYPES

    function buildLookupsCenterRows() {
        return [
            {
                view: "toolbar",
                css: "pk-pane-toolbar",
                height: 40,
                cols: [
                    { view: "label", id: "pk-lookups-title", label: "Lookups", css: "pk-pane-title" },
                    {},
                    { view: "button", value: "+ Add", css: "pk-btn-add", width: 80, click: openLookupAdd },
                    { view: "button", value: "✎ Edit", css: "webix_primary", width: 80, click: openLookupEdit },
                    { view: "button", value: "🗑 Delete", css: "pk-btn-remove", width: 90, click: confirmLookupDelete },
                ],
            },
            {
                view: "datatable",
                id: "pk-lookups-grid",
                css: "pk-grid",
                select: "row",
                resizeColumn: { headerOnly: true, size: 4 },
                columns: [],
            },
            {
                view: "label",
                id: "pk-lookups-status",
                css: "pk-status-bar",
                label: "",
                height: 22,
            },
        ];
    }

    async function showLookupType(typeKey) {
        const cfg = LOOKUP_TYPES[typeKey];
        if (!cfg) return;
        currentLookupType = typeKey;
        $$("pk-lookups-title").setValue(cfg.label);
        const grid = $$("pk-lookups-grid");
        // Webix datatable's columns are mostly static; replace via refreshColumns.
        grid.config.columns = cfg.columns;
        grid.refreshColumns();
        try {
            const rows = await api.lookupList(cfg.url);
            grid.clearAll();
            grid.parse(rows);
            $$("pk-lookups-status").setValue(`${rows.length} ${cfg.label.toLowerCase()}`);
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load " + cfg.label.toLowerCase() });
        }
        // Make sure the center pane is showing the lookups cell.
        const cell = $$("centerpane-lookups");
        if (cell) cell.show();
    }

    function getSelectedLookupRow() {
        const grid = $$("pk-lookups-grid");
        if (!grid) return null;
        const id = grid.getSelectedId();
        if (!id) return null;
        const item = grid.getItem(id);
        return item || null;
    }

    function openLookupAdd() {
        if (!currentLookupType) return;
        const cfg = LOOKUP_TYPES[currentLookupType];
        const ed = cfg.buildEdit(null);
        showLookupEditDialog({
            title: ed.title,
            fields: ed.fields,
            seed: ed.seed,
            saveLabel: "Create",
            onSave: async (formValues) => {
                const body = ed.serialize(formValues, null);
                await api.lookupCreate(cfg.url, body);
                await showLookupType(currentLookupType);
            },
        });
    }

    function openLookupEdit() {
        if (!currentLookupType) return;
        const sel = getSelectedLookupRow();
        if (!sel) {
            webix.message({ type: "error", text: "Select a row to edit." });
            return;
        }
        const cfg = LOOKUP_TYPES[currentLookupType];
        const ed = cfg.buildEdit(sel);
        showLookupEditDialog({
            title: ed.title,
            fields: ed.fields,
            seed: ed.seed,
            saveLabel: "Save",
            onSave: async (formValues) => {
                const body = ed.serialize(formValues, sel);
                await api.lookupUpdate(cfg.url, sel.id, body);
                await showLookupType(currentLookupType);
            },
        });
    }

    function confirmLookupDelete() {
        if (!currentLookupType) return;
        const sel = getSelectedLookupRow();
        if (!sel) {
            webix.message({ type: "error", text: "Select a row to delete." });
            return;
        }
        const cfg = LOOKUP_TYPES[currentLookupType];
        const label = sel.name || sel.prefix || `#${sel.id}`;
        webix.confirm({
            title: `Delete from ${cfg.label}`,
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text:
                `Delete <b>${escapeHtml(label)}</b>?<br><br>` +
                `Refused if any parts / parameters reference it.`,
            callback: async (result) => {
                if (!result) return;
                try {
                    await api.lookupDelete(cfg.url, sel.id);
                    await showLookupType(currentLookupType);
                    webix.message({ text: "Deleted", type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    function showLookupEditDialog(opts) {
        const formElements = opts.fields.map((f) => {
            if (f.kind === "text") return { view: "text", name: f.name, label: f.label, labelWidth: 140, required: !!f.required };
            if (f.kind === "textarea") return { view: "textarea", name: f.name, label: f.label, labelWidth: 140, height: f.height || 60 };
            if (f.kind === "checkbox") return { view: "checkbox", name: f.name, labelRight: f.labelRight || f.label, labelWidth: 140 };
            if (f.kind === "counter") {
                const c = { view: "counter", name: f.name, label: f.label, labelWidth: 140, step: f.step || 1 };
                if (f.min !== undefined) c.min = f.min;
                if (f.max !== undefined) c.max = f.max;
                return c;
            }
            return { view: "text", name: f.name, label: f.label, labelWidth: 140 };
        });
        formElements.push({
            cols: [
                {},
                { view: "button", value: "Cancel", width: 90, click: () => $$("pk-lookup-edit").close() },
                {
                    view: "button",
                    value: opts.saveLabel || "Save",
                    width: 100,
                    css: "webix_primary",
                    hotkey: "ctrl+s",
                    click: async function () {
                        const v = $$("pk-lookup-edit-form").getValues();
                        // Validate required text fields
                        for (const f of opts.fields) {
                            if (f.kind === "text" && f.required && !(v[f.name] || "").trim()) {
                                webix.message({ type: "error", text: `${f.label} is required` });
                                return;
                            }
                        }
                        try {
                            await opts.onSave(v);
                            $$("pk-lookup-edit").close();
                            webix.message({ text: "Saved", type: "success" });
                        } catch (e) {
                            webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                        }
                    },
                },
            ],
        });
        webix.ui({
            view: "window",
            id: "pk-lookup-edit",
            modal: true,
            position: "center",
            width: 520,
            head: opts.title,
            body: { view: "form", id: "pk-lookup-edit-form", elements: formElements },
        }).show();
        $$("pk-lookup-edit-form").setValues(opts.seed);
    }

    async function loadParts(opts) {
        opts = opts || {};
        if ("filter" in opts) currentParts.filter = opts.filter;
        if ("search" in opts) currentParts.search = opts.search;
        try {
            const json = await api.parts({
                filter: currentParts.filter,
                search: currentParts.search,
                limit: 500,
                offset: 0,
            });
            const grid = $$("pk-parts-grid");
            grid.clearAll();
            grid.parse(json.items);
            const status = `${json.items.length} of ${json.total} parts`;
            $$("pk-parts-status").setValue(status);
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load parts" });
        }
    }

    // ============================================================
    //  Right pane — part detail
    // ============================================================

    function buildRightPane() {
        return {
            id: "pk-right",
            width: 380,
            rows: [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 32,
                    cols: [
                        { view: "label", label: "Detail", css: "pk-pane-title" },
                    ],
                },
                {
                    id: "pk-detail-actions",
                    hidden: true,
                    rows: [
                        {
                            view: "toolbar",
                            css: "pk-detail-actions",
                            height: 42,
                            cols: [
                                {
                                    view: "button",
                                    value: "+ Add stock",
                                    css: "pk-btn-add",
                                    width: 110,
                                    click: () => openStockDialog("add"),
                                },
                                {
                                    view: "button",
                                    value: "− Remove",
                                    css: "pk-btn-remove",
                                    width: 100,
                                    click: () => openStockDialog("remove"),
                                },
                                {
                                    view: "button",
                                    value: "⇄ Reconcile",
                                    css: "webix_primary",
                                    width: 120,
                                    click: () => openStockDialog("reconcile"),
                                },
                                {},
                            ],
                        },
                        {
                            view: "toolbar",
                            css: "pk-detail-actions",
                            height: 42,
                            cols: [
                                {
                                    view: "button",
                                    value: "✎ Edit",
                                    css: "webix_primary",
                                    width: 100,
                                    click: () => openPartEditor("edit"),
                                },
                                {
                                    view: "button",
                                    value: "🗑 Delete",
                                    css: "pk-btn-remove",
                                    width: 110,
                                    click: () => openDeleteDialog(),
                                },
                                {},
                            ],
                        },
                    ],
                },
                {
                    view: "scrollview",
                    id: "pk-detail-scroll",
                    scroll: "y",
                    body: {
                        id: "pk-detail",
                        template: '<div class="pk-detail-empty">Select a part to view detail.</div>',
                        autoheight: true,
                    },
                },
            ],
        };
    }

    let currentPart = null;

    async function loadPartDetail(id) {
        try {
            const part = await api.part(id);
            currentPart = part;
            $$("pk-detail").setHTML(renderPartDetailHtml(part));
            const actions = $$("pk-detail-actions");
            if (actions) actions.show();
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load part detail" });
        }
    }

    function renderPartDetailHtml(p) {
        const sections = [];

        // Header
        const ipn = p.internal_part_number ? ` <span class="pk-detail-ipn">${escapeHtml(p.internal_part_number)}</span>` : "";
        const meta = p.meta_part ? ` <span class="pk-detail-meta-tag">META</span>` : "";
        const lowStock = p.low_stock ? ` <span class="pk-detail-low-stock">LOW STOCK</span>` : "";
        sections.push(`
            <div class="pk-detail-section pk-detail-header">
                <div class="pk-detail-name">${escapeHtml(p.name)}${ipn}${meta}${lowStock}</div>
                ${p.description ? `<div class="pk-detail-desc">${escapeHtml(p.description)}</div>` : ""}
            </div>
        `);

        // Identity / classification
        const idRows = [];
        if (p.category) idRows.push(["Category", escapeHtml(p.category.category_path)]);
        if (p.storage_location) idRows.push(["Storage", escapeHtml(`${p.storage_location.name}  —  ${p.storage_location.category_path}`)]);
        if (p.footprint) idRows.push(["Footprint", escapeHtml(p.footprint.name)]);
        if (p.part_unit) idRows.push(["Unit", escapeHtml(`${p.part_unit.name} (${p.part_unit.short_name})`)]);
        if (idRows.length) sections.push(detailSectionHtml("Classification", kvTable(idRows)));

        // Stock
        const stockRows = [
            ["On hand", String(p.stock_level)],
            ["Min stock", String(p.min_stock_level)],
            ["Avg price", p.average_price],
        ];
        sections.push(detailSectionHtml("Stock", kvTable(stockRows)));

        // Manufacturers
        if (p.manufacturers && p.manufacturers.length) {
            const rows = p.manufacturers.map(m =>
                `<tr><td>${escapeHtml(m.manufacturer_name || "")}</td><td>${escapeHtml(m.part_number || "")}</td></tr>`
            ).join("");
            sections.push(detailSectionHtml(`Manufacturers (${p.manufacturers.length})`,
                `<table class="pk-detail-table"><thead><tr><th>Manufacturer</th><th>MPN</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        // Distributors
        if (p.distributors && p.distributors.length) {
            const rows = p.distributors.map(d =>
                `<tr>
                    <td>${escapeHtml(d.distributor_name || "")}</td>
                    <td>${escapeHtml(d.order_number || "")}</td>
                    <td class="pk-numeric">${escapeHtml(d.price || "")}</td>
                    <td class="pk-numeric">${escapeHtml(String(d.packaging_unit || ""))}</td>
                </tr>`
            ).join("");
            sections.push(detailSectionHtml(`Distributors (${p.distributors.length})`,
                `<table class="pk-detail-table"><thead><tr><th>Distributor</th><th>Order #</th><th>Price</th><th>Pkg</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        // Parameters
        if (p.parameters && p.parameters.length) {
            const rows = p.parameters.map(prm => {
                let value = "";
                if (prm.value_type === "numeric" && prm.value != null) {
                    value = `${prm.value} ${prm.si_prefix_symbol || ""}${prm.unit_symbol || ""}`.trim();
                } else if (prm.string_value) {
                    value = prm.string_value;
                }
                return `<tr><td>${escapeHtml(prm.name || "")}</td><td>${escapeHtml(value)}</td></tr>`;
            }).join("");
            sections.push(detailSectionHtml(`Parameters (${p.parameters.length})`,
                `<table class="pk-detail-table"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        // Recent stock entries
        if (p.stock_entries && p.stock_entries.length) {
            const rows = p.stock_entries.slice(0, 8).map(e => {
                const delta = e.stock_level > 0 ? `+${e.stock_level}` : String(e.stock_level);
                const cls = e.stock_level > 0 ? "pk-stock-add" : "pk-stock-remove";
                const corr = e.correction ? " (recount)" : "";
                const date = (e.date_time || "").substring(0, 10);
                return `<tr>
                    <td>${escapeHtml(date)}</td>
                    <td class="pk-numeric ${cls}">${delta}${corr}</td>
                    <td class="pk-numeric">${escapeHtml(e.price || "")}</td>
                    <td>${escapeHtml(e.username || "")}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(`Recent stock activity`,
                `<table class="pk-detail-table"><thead><tr><th>Date</th><th>Δ</th><th>Price</th><th>By</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        // Attachments
        if (p.attachments && p.attachments.length) {
            const rows = p.attachments.map(a => {
                const tag = a.is_image ? "img" : "doc";
                const size = a.size ? `${(a.size / 1024).toFixed(1)} KB` : "";
                const url = `/files/PartAttachment/${a.id}`;
                return `<tr>
                    <td><a href="${url}" target="_blank">${escapeHtml(a.original_filename || a.filename)}</a></td>
                    <td>${tag}</td>
                    <td class="pk-numeric">${escapeHtml(size)}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(`Attachments (${p.attachments.length})`,
                `<table class="pk-detail-table"><thead><tr><th>File</th><th>Type</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        return sections.join("");
    }

    function detailSectionHtml(title, body) {
        return `<div class="pk-detail-section">
            <div class="pk-detail-section-title">${escapeHtml(title)}</div>
            <div class="pk-detail-section-body">${body}</div>
        </div>`;
    }

    function kvTable(rows) {
        return `<table class="pk-detail-kv">${
            rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join("")
        }</table>`;
    }

    // ============================================================
    //  Stock dialog (add / remove / reconcile)
    // ============================================================

    function openStockDialog(mode) {
        if (!currentPart) return;
        const titles = { add: "Add stock", remove: "Remove stock", reconcile: "Reconcile stock" };
        const subtitle =
            `<div class="pk-dialog-subtitle">` +
            `On hand: <b>${currentPart.stock_level}</b>` +
            (currentPart.average_price && parseFloat(currentPart.average_price) > 0
                ? ` &middot; Avg price: <b>${escapeHtml(currentPart.average_price)}</b>`
                : "") +
            `</div>`;

        const elements = [
            {
                view: "template",
                template:
                    `<div class="pk-dialog-part-name">${escapeHtml(currentPart.name)}</div>` +
                    subtitle,
                height: 50,
                borderless: true,
                css: "pk-dialog-header",
            },
        ];

        if (mode === "reconcile") {
            elements.push({
                view: "counter",
                id: "pk-stock-target",
                label: "New on-hand total",
                labelWidth: 150,
                value: currentPart.stock_level,
                step: 1,
            });
        } else {
            elements.push({
                view: "counter",
                id: "pk-stock-qty",
                label: mode === "add" ? "Add quantity" : "Remove quantity",
                labelWidth: 150,
                value: 1,
                min: 1,
                step: 1,
            });
        }

        if (mode === "add") {
            elements.push({
                view: "text",
                id: "pk-stock-price",
                label: "Price (per piece)",
                labelWidth: 150,
                value: currentPart.average_price || "",
            });
        }

        elements.push({
            view: "textarea",
            id: "pk-stock-comment",
            label: "Comment",
            labelWidth: 150,
            height: 60,
        });

        elements.push({
            cols: [
                {},
                {
                    view: "button",
                    value: "Cancel",
                    width: 90,
                    click: () => $$("pk-stock-dialog").close(),
                },
                {
                    view: "button",
                    value: "Save",
                    width: 90,
                    css:
                        mode === "add" ? "pk-btn-add" :
                        mode === "remove" ? "pk-btn-remove" :
                        "webix_primary",
                    hotkey: "enter",
                    click: () => submitStock(mode),
                },
            ],
        });

        webix.ui({
            view: "window",
            id: "pk-stock-dialog",
            modal: true,
            position: "center",
            width: 440,
            head: titles[mode],
            css: "pk-stock-dialog",
            body: { view: "form", id: "pk-stock-form", elements },
        }).show();
    }

    async function submitStock(mode) {
        if (!currentPart) return;
        const partId = currentPart.id;
        let body;

        if (mode === "reconcile") {
            const target = $$("pk-stock-target").getValue();
            const delta = target - currentPart.stock_level;
            if (delta === 0) {
                webix.message({ type: "error", text: "Target equals current level — nothing to reconcile." });
                return;
            }
            body = {
                stock_level: delta,
                comment: $$("pk-stock-comment").getValue() || null,
                correction: true,
            };
        } else {
            const qty = $$("pk-stock-qty").getValue();
            if (qty <= 0) {
                webix.message({ type: "error", text: "Quantity must be at least 1." });
                return;
            }
            body = {
                stock_level: mode === "add" ? qty : -qty,
                comment: $$("pk-stock-comment").getValue() || null,
                correction: false,
            };
            if (mode === "add") {
                const price = $$("pk-stock-price").getValue();
                if (price && parseFloat(price) >= 0) body.price = price;
            }
        }

        try {
            await api.addStockEntry(partId, body);
            $$("pk-stock-dialog").close();
            // Refresh detail (stock entries + level + avg) and parts grid (stock column).
            await loadPartDetail(partId);
            await loadParts({});
            // Re-select the row so the highlight stays consistent.
            const grid = $$("pk-parts-grid");
            if (grid && grid.exists(partId)) {
                grid.select(partId);
                grid.showItem(partId);
            }
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Stock save failed: " + (e.message || e) });
        }
    }

    // ============================================================
    //  Lookups cache (categories, footprints, etc.) — lazy-loaded
    //  on first editor open and reused.
    // ============================================================

    let lookupsCache = null;

    async function ensureLookups() {
        if (!lookupsCache) lookupsCache = await api.lookups();
        return lookupsCache;
    }

    // Flatten the category tree into a list of {id, value: breadcrumb}
    // so a Webix combo can render it linearly while still showing the path.
    function flattenCategoryTree(tree) {
        const out = [];
        function walk(nodes, indent) {
            for (const n of nodes) {
                const prefix = "  ".repeat(indent);
                out.push({ id: n.id, value: prefix + n.name });
                if (n.children && n.children.length) walk(n.children, indent + 1);
            }
        }
        walk(tree, 0);
        return out;
    }

    // ============================================================
    //  Part editor (Identity / Classification / Manufacturers /
    //  Distributors / Parameters tabs)
    // ============================================================

    function editorAddRow(tableId, defaults) {
        const table = $$(tableId);
        if (!table) return;
        const row = Object.assign({ id: webix.uid() }, defaults || {});
        table.add(row);
        table.select(row.id);
        table.editCell(row.id, table.config.columns[0].id);
    }

    function editorRemoveRow(tableId) {
        const table = $$(tableId);
        if (!table) return;
        const sel = table.getSelectedId();
        if (sel) table.remove(sel);
    }


    async function openPartEditor(mode, opts) {
        opts = opts || {};
        if ((mode === "edit" || mode === "duplicate") && !currentPart) {
            webix.message({ type: "error", text: "Select a part first." });
            return;
        }

        let lookups;
        try {
            lookups = await ensureLookups();
        } catch (e) {
            webix.message({ type: "error", text: "Failed to load lookups: " + (e.message || e) });
            return;
        }

        const categoryOptions = flattenCategoryTree(lookups.categories_tree);
        const footprintOptions = lookups.footprints.map((f) => ({ id: f.id, value: f.name }));
        const storageOptions = lookups.storage_locations.map((s) => ({ id: s.id, value: s.name }));
        const partUnitOptions = lookups.part_units.map((u) => ({
            id: u.id, value: u.name + (u.short_name ? ` (${u.short_name})` : ""),
        }));

        // Seed values:
        //   edit       — start from currentPart, save via PUT
        //   new        — blank (or {meta_part: true} when opts.metaPart)
        //   duplicate  — copy of currentPart, name gets " (copy)" suffix,
        //                save via POST so a new id is assigned
        let seed;
        if (mode === "edit") {
            seed = currentPart;
        } else if (mode === "duplicate") {
            seed = Object.assign({}, currentPart, {
                name: (currentPart.name || "") + " (copy)",
                internal_part_number: "",
            });
        } else {
            seed = opts.metaPart ? { meta_part: true } : {};
        }

        // Sub-table seed rows (W4.3). Webix datatable rows need a stable
        // local id; we mint one with webix.uid() so add/remove works
        // even before the row has a server-side id.
        const mfgRows = (seed.manufacturers || []).map((m) => ({
            id: webix.uid(),
            manufacturer_id: m.manufacturer_id,
            part_number: m.part_number || "",
        }));
        const distRows = (seed.distributors || []).map((d) => ({
            id: webix.uid(),
            distributor_id: d.distributor_id,
            order_number: d.order_number || "",
            price: d.price != null ? String(d.price) : "",
            currency: d.currency || "",
            sku: d.sku || "",
            packaging_unit: d.packaging_unit != null ? d.packaging_unit : 1,
            ignore_for_reports: !!d.ignore_for_reports,
        }));
        const paramRows = (seed.parameters || []).map((p) => ({
            id: webix.uid(),
            name: p.name || "",
            description: p.description || "",
            value_type: p.value_type || "numeric",
            value: p.value != null ? String(p.value) : "",
            string_value: p.string_value || "",
            unit_id: p.unit_id || null,
            si_prefix_id: p.si_prefix_id || null,
        }));
        const criteriaRows = (seed.criteria || []).map((c) => ({
            id: webix.uid(),
            name: c.name || "",
            op: c.op || "=",
            value_type: c.value_type || "numeric",
            value: c.value != null ? String(c.value) : "",
            string_value: c.string_value || "",
            unit_id: c.unit_id || null,
            si_prefix_id: c.si_prefix_id || null,
        }));

        const mfgOptions = lookups.manufacturers.map((m) => ({ id: m.id, value: m.name }));
        const distOptions = lookups.distributors.map((d) => ({ id: d.id, value: d.name }));
        const unitOptions = [{ id: "", value: "(none)" }].concat(
            lookups.units.map((u) => ({ id: u.id, value: u.name + " (" + u.symbol + ")" }))
        );
        const prefixOptions = [{ id: "", value: "(none)" }].concat(
            lookups.prefixes.map((p) => ({ id: p.id, value: p.symbol + " — " + p.prefix }))
        );
        const valueTypeOptions = [{ id: "numeric", value: "numeric" }, { id: "string", value: "string" }];
        const opOptions = [
            { id: "=", value: "=" },
            { id: "!=", value: "≠" },
            { id: "<", value: "<" },
            { id: "<=", value: "≤" },
            { id: ">", value: ">" },
            { id: ">=", value: "≥" },
            { id: "like", value: "like" },
        ];

        // Pre-built lookup maps keyed by stringified id — Webix's richselect
        // editor returns the option's id back into the row, but the type
        // (string vs number) is not stable across edits. Doing String(...)
        // on both sides of the lookup makes the cell render reliably.
        const mfgNameById = new Map(lookups.manufacturers.map((m) => [String(m.id), m.name]));
        const distNameById = new Map(lookups.distributors.map((d) => [String(d.id), d.name]));
        const unitLabelById = new Map(lookups.units.map((u) => [String(u.id), u.name + " (" + u.symbol + ")"]));
        const prefixSymbolById = new Map(lookups.prefixes.map((p) => [String(p.id), p.symbol]));

        const initial = {
            name: seed.name || "",
            description: seed.description || "",
            internal_part_number: seed.internal_part_number || "",
            comment: seed.comment || "",
            category_id: seed.category_id || (categoryOptions[0] && categoryOptions[0].id) || null,
            footprint_id: seed.footprint_id || null,
            storage_location_id: seed.storage_location_id || null,
            part_unit_id: seed.part_unit_id || (partUnitOptions[0] && partUnitOptions[0].id) || null,
            min_stock_level: seed.min_stock_level || 0,
            status: seed.status || "",
            part_condition: seed.part_condition || "",
            production_remarks: seed.production_remarks || "",
            needs_review: !!seed.needs_review,
            meta_part: !!seed.meta_part,
        };

        const titleText =
            mode === "edit" ? `Edit part: ${escapeHtml(seed.name)}` :
            mode === "duplicate" ? `Duplicate from: ${escapeHtml(currentPart.name)}` :
            opts.metaPart ? "New meta-part" :
            "New part";

        webix.ui({
            view: "window",
            id: "pk-editor",
            modal: true,
            position: "center",
            width: 820,
            height: 620,
            css: "pk-editor-window",
            head: titleText,
            body: {
                view: "form",
                id: "pk-editor-form",
                elements: [
                    {
                        view: "tabview",
                        cells: [
                            {
                                header: "Identity",
                                body: {
                                    rows: [
                                        { view: "text", name: "name", label: "Name", labelWidth: 130, required: true },
                                        { view: "text", name: "internal_part_number", label: "IPN", labelWidth: 130 },
                                        { view: "textarea", name: "description", label: "Description", labelWidth: 130, height: 60 },
                                        { view: "textarea", name: "comment", label: "Comment", labelWidth: 130, height: 60 },
                                        { view: "text", name: "status", label: "Status", labelWidth: 130 },
                                        { view: "text", name: "part_condition", label: "Condition", labelWidth: 130 },
                                        { view: "textarea", name: "production_remarks", label: "Production remarks", labelWidth: 130, height: 50 },
                                        {
                                            cols: [
                                                { view: "checkbox", name: "needs_review", labelRight: "Needs review", labelWidth: 130, width: 280 },
                                                { view: "checkbox", name: "meta_part", labelRight: "Meta-part", labelWidth: 0, width: 200 },
                                                {},
                                            ],
                                        },
                                    ],
                                },
                            },
                            {
                                header: "Classification",
                                body: {
                                    rows: [
                                        {
                                            view: "richselect",
                                            name: "category_id",
                                            label: "Category",
                                            labelWidth: 130,
                                            options: { data: categoryOptions, body: { template: "#value#" } },
                                        },
                                        {
                                            view: "richselect",
                                            name: "footprint_id",
                                            label: "Footprint",
                                            labelWidth: 130,
                                            options: footprintOptions,
                                        },
                                        {
                                            view: "richselect",
                                            name: "storage_location_id",
                                            label: "Storage location",
                                            labelWidth: 130,
                                            options: storageOptions,
                                        },
                                        {
                                            view: "richselect",
                                            name: "part_unit_id",
                                            label: "Part unit",
                                            labelWidth: 130,
                                            options: partUnitOptions,
                                        },
                                        { view: "counter", name: "min_stock_level", label: "Min stock", labelWidth: 130, value: 0, min: 0 },
                                        {},
                                    ],
                                },
                            },
                            {
                                header: "Manufacturers",
                                body: {
                                    rows: [
                                        {
                                            view: "toolbar",
                                            css: "pk-pane-toolbar",
                                            height: 32,
                                            cols: [
                                                { view: "button", value: "+ Add row", css: "pk-btn-add", width: 100, click: () => editorAddRow("pk-edit-mfgs") },
                                                { view: "button", value: "− Remove selected", css: "pk-btn-remove", width: 160, click: () => editorRemoveRow("pk-edit-mfgs") },
                                                {},
                                            ],
                                        },
                                        {
                                            view: "datatable",
                                            id: "pk-edit-mfgs",
                                            editable: true,
                                            editaction: "click",
                                            select: "row",
                                            data: mfgRows,
                                            columns: [
                                                {
                                                    id: "manufacturer_id",
                                                    header: "Manufacturer",
                                                    width: 280,
                                                    editor: "richselect",
                                                    options: mfgOptions,
                                                    template: function (o) {
                                                        const name = mfgNameById.get(String(o.manufacturer_id));
                                                        return name ? escapeHtml(name) : '<span class="pk-pick-prompt">— pick —</span>';
                                                    },
                                                },
                                                { id: "part_number", header: "MPN", fillspace: true, editor: "text" },
                                            ],
                                        },
                                    ],
                                },
                            },
                            {
                                header: "Distributors",
                                body: {
                                    rows: [
                                        {
                                            view: "toolbar",
                                            css: "pk-pane-toolbar",
                                            height: 32,
                                            cols: [
                                                { view: "button", value: "+ Add row", css: "pk-btn-add", width: 100, click: () => editorAddRow("pk-edit-dists", { packaging_unit: 1 }) },
                                                { view: "button", value: "− Remove selected", css: "pk-btn-remove", width: 160, click: () => editorRemoveRow("pk-edit-dists") },
                                                {},
                                            ],
                                        },
                                        {
                                            view: "datatable",
                                            id: "pk-edit-dists",
                                            editable: true,
                                            editaction: "click",
                                            select: "row",
                                            data: distRows,
                                            columns: [
                                                {
                                                    id: "distributor_id",
                                                    header: "Distributor",
                                                    width: 200,
                                                    editor: "richselect",
                                                    options: distOptions,
                                                    template: function (o) {
                                                        const name = distNameById.get(String(o.distributor_id));
                                                        return name ? escapeHtml(name) : '<span class="pk-pick-prompt">— pick —</span>';
                                                    },
                                                },
                                                { id: "order_number", header: "Order #", width: 130, editor: "text" },
                                                { id: "price", header: "Price", width: 80, editor: "text", css: "pk-numeric" },
                                                { id: "currency", header: "Cur", width: 60, editor: "text" },
                                                { id: "sku", header: "SKU", width: 100, editor: "text" },
                                                { id: "packaging_unit", header: "Pkg", width: 70, editor: "text", css: "pk-numeric" },
                                                {
                                                    id: "ignore_for_reports",
                                                    header: "Skip",
                                                    width: 50,
                                                    template: "{common.checkbox()}",
                                                    checkValue: true,
                                                    uncheckValue: false,
                                                },
                                            ],
                                            on: {
                                                onCheck: function (rowId, _colId, state) {
                                                    const row = this.getItem(rowId);
                                                    if (row) row.ignore_for_reports = state;
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                            {
                                header: "Criteria",
                                body: {
                                    rows: [
                                        {
                                            view: "toolbar",
                                            css: "pk-pane-toolbar",
                                            height: 32,
                                            cols: [
                                                { view: "button", value: "+ Add row", css: "pk-btn-add", width: 100, click: () => editorAddRow("pk-edit-criteria", { value_type: "numeric", op: "=" }) },
                                                { view: "button", value: "− Remove selected", css: "pk-btn-remove", width: 160, click: () => editorRemoveRow("pk-edit-criteria") },
                                                {},
                                                { view: "label", label: '<span class="pk-help-hint">Match real parts whose parameters satisfy ALL these predicates · only used when "Meta-part" is checked</span>' },
                                            ],
                                        },
                                        {
                                            view: "datatable",
                                            id: "pk-edit-criteria",
                                            editable: true,
                                            editaction: "click",
                                            select: "row",
                                            data: criteriaRows,
                                            columns: [
                                                { id: "name", header: "Parameter", width: 160, editor: "text" },
                                                {
                                                    id: "op",
                                                    header: "Op",
                                                    width: 70,
                                                    editor: "richselect",
                                                    options: opOptions,
                                                },
                                                {
                                                    id: "value_type",
                                                    header: "Type",
                                                    width: 90,
                                                    editor: "richselect",
                                                    options: valueTypeOptions,
                                                },
                                                { id: "value", header: "Value", width: 90, editor: "text", css: "pk-numeric" },
                                                {
                                                    id: "si_prefix_id",
                                                    header: "Prefix",
                                                    width: 100,
                                                    editor: "richselect",
                                                    options: prefixOptions,
                                                    template: function (o) {
                                                        if (!o.si_prefix_id) return "";
                                                        const sym = prefixSymbolById.get(String(o.si_prefix_id));
                                                        return sym ? escapeHtml(sym) : "";
                                                    },
                                                },
                                                {
                                                    id: "unit_id",
                                                    header: "Unit",
                                                    width: 130,
                                                    editor: "richselect",
                                                    options: unitOptions,
                                                    template: function (o) {
                                                        if (!o.unit_id) return "";
                                                        const label = unitLabelById.get(String(o.unit_id));
                                                        return label ? escapeHtml(label) : "";
                                                    },
                                                },
                                                { id: "string_value", header: "String value", fillspace: true, editor: "text" },
                                            ],
                                        },
                                    ],
                                },
                            },
                            {
                                header: "Attachments",
                                body: buildAttachmentsSection({
                                    tableId: "pk-edit-attachments",
                                    uploaderId: "pk-edit-attachments-uploader",
                                    kind: "PartAttachment",
                                    getParentId: () => (mode === "edit" && currentPart ? currentPart.id : null),
                                }),
                            },
                            {
                                header: "Parameters",
                                body: {
                                    rows: [
                                        {
                                            view: "toolbar",
                                            css: "pk-pane-toolbar",
                                            height: 32,
                                            cols: [
                                                { view: "button", value: "+ Add row", css: "pk-btn-add", width: 100, click: () => editorAddRow("pk-edit-params", { value_type: "numeric" }) },
                                                { view: "button", value: "− Remove selected", css: "pk-btn-remove", width: 160, click: () => editorRemoveRow("pk-edit-params") },
                                                {},
                                                { view: "label", label: '<span class="pk-help-hint">Numeric: fill Value + Unit + Prefix · String: fill String value</span>' },
                                            ],
                                        },
                                        {
                                            view: "datatable",
                                            id: "pk-edit-params",
                                            editable: true,
                                            editaction: "click",
                                            select: "row",
                                            data: paramRows,
                                            columns: [
                                                { id: "name", header: "Name", width: 160, editor: "text" },
                                                {
                                                    id: "value_type",
                                                    header: "Type",
                                                    width: 90,
                                                    editor: "richselect",
                                                    options: valueTypeOptions,
                                                },
                                                { id: "value", header: "Value", width: 100, editor: "text", css: "pk-numeric" },
                                                {
                                                    id: "si_prefix_id",
                                                    header: "Prefix",
                                                    width: 110,
                                                    editor: "richselect",
                                                    options: prefixOptions,
                                                    template: function (o) {
                                                        if (!o.si_prefix_id) return "";
                                                        const sym = prefixSymbolById.get(String(o.si_prefix_id));
                                                        return sym ? escapeHtml(sym) : "";
                                                    },
                                                },
                                                {
                                                    id: "unit_id",
                                                    header: "Unit",
                                                    width: 130,
                                                    editor: "richselect",
                                                    options: unitOptions,
                                                    template: function (o) {
                                                        if (!o.unit_id) return "";
                                                        const label = unitLabelById.get(String(o.unit_id));
                                                        return label ? escapeHtml(label) : "";
                                                    },
                                                },
                                                { id: "string_value", header: "String value", fillspace: true, editor: "text" },
                                            ],
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 100, click: () => $$("pk-editor").close() },
                            {
                                view: "button",
                                value: mode === "edit" ? "Save" : "Create",
                                width: 110,
                                css: mode === "edit" ? "webix_primary" : "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: () => submitPartEditor(mode === "edit" ? "edit" : "new"),
                            },
                        ],
                    },
                ],
            },
        }).show();
        $$("pk-editor-form").setValues(initial);

        // Populate the Attachments tab — only meaningful when editing
        // an existing part (new-mode parts have no id yet).
        if (mode === "edit" && currentPart) {
            refreshAttachments({
                tableId: "pk-edit-attachments",
                kind: "PartAttachment",
                getParentId: () => currentPart.id,
            });
        }
    }

    async function submitPartEditor(mode) {
        const form = $$("pk-editor-form");
        if (!form.validate()) {
            webix.message({ type: "error", text: "Name is required." });
            return;
        }
        const v = form.getValues();
        // Coerce richselect ids to int, empty strings to null.
        const idOrNull = (x) => (x === "" || x == null ? null : parseInt(x, 10));
        const body = {
            name: v.name.trim(),
            description: (v.description || "").trim() || null,
            internal_part_number: (v.internal_part_number || "").trim() || null,
            comment: (v.comment || "").trim(),
            status: (v.status || "").trim() || null,
            part_condition: (v.part_condition || "").trim() || null,
            production_remarks: (v.production_remarks || "").trim() || null,
            needs_review: !!v.needs_review,
            meta_part: !!v.meta_part,
            min_stock_level: parseInt(v.min_stock_level, 10) || 0,
            category_id: idOrNull(v.category_id),
            footprint_id: idOrNull(v.footprint_id),
            storage_location_id: idOrNull(v.storage_location_id),
            part_unit_id: idOrNull(v.part_unit_id),
        };

        // Sub-tables: gather rows. Drop rows missing a required FK
        // (manufacturer_id / distributor_id / param name) so half-typed
        // rows don't poison the save.
        const mfgGrid = $$("pk-edit-mfgs");
        body.manufacturers = mfgGrid
            ? mfgGrid.serialize()
                .filter((r) => r.manufacturer_id)
                .map((r) => ({
                    manufacturer_id: parseInt(r.manufacturer_id, 10),
                    part_number: (r.part_number || "").trim() || null,
                }))
            : [];
        const distGrid = $$("pk-edit-dists");
        body.distributors = distGrid
            ? distGrid.serialize()
                .filter((r) => r.distributor_id)
                .map((r) => ({
                    distributor_id: parseInt(r.distributor_id, 10),
                    order_number: (r.order_number || "").trim() || null,
                    price: r.price !== "" && r.price != null ? String(r.price) : null,
                    currency: (r.currency || "").trim() || null,
                    sku: (r.sku || "").trim() || null,
                    packaging_unit: parseInt(r.packaging_unit, 10) || 1,
                    ignore_for_reports: !!r.ignore_for_reports,
                }))
            : [];
        const paramGrid = $$("pk-edit-params");
        body.parameters = paramGrid
            ? paramGrid.serialize()
                .filter((r) => (r.name || "").trim())
                .map((r) => ({
                    name: r.name.trim(),
                    description: (r.description || "").trim(),
                    value_type: r.value_type === "string" ? "string" : "numeric",
                    value: r.value !== "" && r.value != null && !isNaN(parseFloat(r.value))
                        ? parseFloat(r.value)
                        : null,
                    string_value: (r.string_value || "").trim(),
                    minimum_value: null,
                    maximum_value: null,
                    unit_id: r.unit_id ? parseInt(r.unit_id, 10) : null,
                    si_prefix_id: r.si_prefix_id ? parseInt(r.si_prefix_id, 10) : null,
                    min_si_prefix_id: null,
                    max_si_prefix_id: null,
                }))
            : [];
        const criteriaGrid = $$("pk-edit-criteria");
        body.criteria = criteriaGrid
            ? criteriaGrid.serialize()
                .filter((r) => (r.name || "").trim())
                .map((r) => ({
                    name: r.name.trim(),
                    op: r.op || "=",
                    value_type: r.value_type === "string" ? "string" : "numeric",
                    value: r.value !== "" && r.value != null && !isNaN(parseFloat(r.value))
                        ? parseFloat(r.value)
                        : null,
                    string_value: (r.string_value || "").trim() || null,
                    unit_id: r.unit_id ? parseInt(r.unit_id, 10) : null,
                    si_prefix_id: r.si_prefix_id ? parseInt(r.si_prefix_id, 10) : null,
                }))
            : [];
        try {
            let savedId;
            if (mode === "edit") {
                await api.updatePart(currentPart.id, body);
                savedId = currentPart.id;
            } else {
                const result = await api.createPart(body);
                savedId = result.id;
            }
            $$("pk-editor").close();
            await loadParts({});
            // Re-select the saved part so detail refreshes too.
            const grid = $$("pk-parts-grid");
            if (grid && savedId != null && grid.exists(savedId)) {
                grid.select(savedId);
                grid.showItem(savedId);
            } else if (savedId != null) {
                await loadPartDetail(savedId);
            }
            webix.message({ text: mode === "edit" ? "Part saved" : "Part created", type: "success" });
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
        }
    }

    // ============================================================
    //  Delete part
    // ============================================================

    function openDeleteDialog() {
        if (!currentPart) return;
        const name = escapeHtml(currentPart.name);
        const ipn = currentPart.internal_part_number
            ? ` <span class="pk-detail-ipn">${escapeHtml(currentPart.internal_part_number)}</span>`
            : "";
        webix.confirm({
            title: "Delete part",
            ok: "Delete",
            cancel: "Cancel",
            type: "confirm-error",
            text:
                `<div style="text-align:left">Delete <b>${name}</b>${ipn}?<br><br>` +
                `Stock history is preserved. Project run history (if any) blocks this — ` +
                `the backend will refuse and the part stays in place.</div>`,
            callback: async function (result) {
                if (!result) return;
                try {
                    await api.deletePart(currentPart.id);
                    webix.message({ text: `Deleted ${currentPart.name}`, type: "success" });
                    // Clear detail, hide actions, reload grid.
                    currentPart = null;
                    $$("pk-detail").setHTML('<div class="pk-detail-empty">Select a part to view detail.</div>');
                    $$("pk-detail-actions").hide();
                    await loadParts({});
                } catch (e) {
                    console.error(e);
                    webix.message({
                        type: "error",
                        text: e.message && e.message.includes("400")
                            ? "Cannot delete: part is referenced by project runs."
                            : "Delete failed: " + (e.message || e),
                    });
                }
            },
        });
    }

    // ============================================================
    //  Helpers
    // ============================================================

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
        );
    }

    function showFatalError(e) {
        document.body.innerHTML =
            '<div style="font-family:sans-serif;padding:24px;color:#a33">' +
            '<h2>PartKeeper failed to start</h2>' +
            '<pre>' + escapeHtml(e && e.message ? e.message : String(e)) + '</pre>' +
            '</div>';
        console.error("[partkeepr] boot failed", e);
    }

    // ============================================================
    //  Bootstrap
    // ============================================================

    webix.ready(async function () {
        try {
            const me = await api.me();
            if (me) mountShell(me);
            else mountLogin();
        } catch (e) {
            showFatalError(e);
        }
    });
})();
