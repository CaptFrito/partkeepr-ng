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
        async parts({ filter, search, byField, limit = 500, offset = 0 } = {}) {
            const p = new URLSearchParams();
            if (filter && filter.kind && filter.id != null) {
                p.set(filter.kind, String(filter.id));
            }
            if (search) p.set("search", search);
            if (byField) {
                if (byField.stock_mode) p.set("stock_mode", byField.stock_mode);
                if (byField.meta_only != null) p.set("meta_only", String(byField.meta_only));
                if (byField.distributor_id) p.set("distributor_id", String(byField.distributor_id));
                if (byField.price_min != null && byField.price_min !== "") p.set("price_min", String(byField.price_min));
                if (byField.price_max != null && byField.price_max !== "") p.set("price_max", String(byField.price_max));
            }
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

        // Projects
        async listProjects() {
            const r = await fetch("/api/projects");
            if (!r.ok) throw new Error(`projects list failed: ${r.status}`);
            return r.json();
        },
        async projectById(id) {
            const r = await fetch(`/api/projects/${id}`);
            if (!r.ok) throw new Error(`project ${id} failed: ${r.status}`);
            return r.json();
        },
        async createProject(body) {
            const r = await fetch("/api/projects", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`create project failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async updateProject(id, body) {
            const r = await fetch(`/api/projects/${id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`update project failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async deleteProject(id) {
            const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
            if (!r.ok) throw new Error(`delete project failed: ${r.status} ${await r.text()}`);
        },
        async addBomLine(projectId, body) {
            const r = await fetch(`/api/projects/${projectId}/parts`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`add BOM line failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async updateBomLine(projectId, ppid, body) {
            const r = await fetch(`/api/projects/${projectId}/parts/${ppid}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`update BOM line failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async deleteBomLine(projectId, ppid) {
            const r = await fetch(`/api/projects/${projectId}/parts/${ppid}`, { method: "DELETE" });
            if (!r.ok) throw new Error(`delete BOM line failed: ${r.status} ${await r.text()}`);
        },
        async runPreview(projectId, quantity) {
            const r = await fetch(`/api/projects/${projectId}/runs/preview?quantity=${quantity}`);
            if (!r.ok) throw new Error(`run preview failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async runProject(projectId, body) {
            const r = await fetch(`/api/projects/${projectId}/runs`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`run project failed: ${r.status} ${await r.text()}`);
            return r.json();
        },
        async listRuns(projectId) {
            const r = await fetch(`/api/projects/${projectId}/runs`);
            if (!r.ok) throw new Error(`list runs failed: ${r.status}`);
            return r.json();
        },
        async deleteRun(projectId, runId, restoreStock) {
            const url = `/api/projects/${projectId}/runs/${runId}` + (restoreStock ? "?restore_stock=true" : "");
            const r = await fetch(url, { method: "DELETE" });
            if (!r.ok) throw new Error(`delete run failed: ${r.status} ${await r.text()}`);
        },
        async partProjects(partId) {
            const r = await fetch(`/api/parts/${partId}/projects`);
            if (!r.ok) throw new Error(`part-projects failed: ${r.status}`);
            return r.json();
        },
        async partRuns(partId) {
            const r = await fetch(`/api/parts/${partId}/runs`);
            if (!r.ok) throw new Error(`part-runs failed: ${r.status}`);
            return r.json();
        },
    };

    // ============================================================
    //  Mount management
    // ============================================================

    let topView = null;
    let currentUser = null;  // set on login so per-user state can key on it

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
        currentUser = user;
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
        ensureFilterDistributorsLoaded();
        // Restore per-user parts-grid layout (W8c).
        setTimeout(restorePartsGridState, 0);

        // Lazy-load the other trees the first time the user switches to
        // them. Webix tabbar with multiview:true auto-fires onChange when
        // the active cell changes; we hook for two reasons:
        //   1. trigger the lazy load
        //   2. swap the center pane between parts grid and lookups grid
        $$("pk-left-tabbar").attachEvent("onChange", function (newId) {
            if (newId === "tab-storage") loadStorageTree();
            else if (newId === "tab-footprints") loadFootprintTree();
            else if (newId === "tab-projects") loadProjectsList();
            // Swap center cell to match the left-pane mode:
            //   tree tabs (categories/storage/footprints) → parts grid
            //   projects                                   → project view
            //   lookups                                    → lookups grid
            //                                                (showLookupType swaps it)
            if (newId === "tab-projects") {
                const cell = $$("centerpane-project");
                if (cell) cell.show();
            } else if (newId !== "tab-lookups") {
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
                        { value: "Projects", id: "tab-projects" },
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
                        { id: "tab-projects", rows: [buildProjectsListView()] },
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
        openStorageLocationEditor("new", null, parentId);
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
            // leaf — comprehensive editor with Image + Contained Parts tabs
            openStorageLocationEditor(
                "edit",
                { id: node.location_id, name: node.value },
                null
            );
        }
    }

    function openStorageLocationEditor(mode, existing, parentCategoryId) {
        const isEdit = mode === "edit";
        const locId = isEdit && existing ? existing.id : null;
        const seed = existing || { name: "" };

        const tabs = [
            {
                header: "Identity",
                body: {
                    rows: [
                        { view: "text", name: "name", label: "Name", labelWidth: 130, required: true },
                        {},
                    ],
                },
            },
        ];
        if (isEdit) {
            tabs.push({
                header: "Image",
                body: buildAttachmentsSection({
                    tableId: "pk-sloc-images",
                    uploaderId: "pk-sloc-images-uploader",
                    kind: "StorageLocationImage",
                    getParentId: () => locId,
                }),
            });
            tabs.push({
                header: "Contained Parts",
                body: {
                    rows: [
                        {
                            view: "toolbar",
                            css: "pk-pane-toolbar",
                            height: 32,
                            cols: [
                                { view: "label", id: "pk-sloc-contained-status", label: "", css: "pk-pane-title" },
                            ],
                        },
                        {
                            view: "datatable",
                            id: "pk-sloc-contained",
                            css: "pk-grid",
                            select: "row",
                            columns: [
                                { id: "name", header: "Name", fillspace: true, sort: "string" },
                                { id: "internal_part_number", header: "IPN", width: 110, sort: "string" },
                                {
                                    id: "stock_level",
                                    header: { text: "Stock", css: "pk-th-numeric" },
                                    width: 70, sort: "int", css: "pk-numeric",
                                },
                                {
                                    id: "category_path",
                                    header: "Category",
                                    width: 220,
                                    sort: "string",
                                    template: (o) => {
                                        const parts = (o.category_path || "").split(" ➤ ");
                                        return escapeHtml(parts[parts.length - 1] || "");
                                    },
                                },
                            ],
                        },
                    ],
                },
            });
        }

        webix.ui({
            view: "window",
            id: "pk-sloc-editor",
            modal: true,
            position: "center",
            width: 820,
            height: 600,
            head: isEdit ? `Edit storage location "${existing.name}"` : "New storage location",
            body: {
                view: "form",
                id: "pk-sloc-editor-form",
                elements: [
                    { view: "tabview", cells: tabs },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-sloc-editor").close() },
                            {
                                view: "button",
                                value: isEdit ? "Save" : "Create",
                                width: 110,
                                css: isEdit ? "webix_primary" : "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-sloc-editor-form").getValues();
                                    if (!v.name || !v.name.trim()) {
                                        webix.message({ type: "error", text: "Name is required" });
                                        return;
                                    }
                                    try {
                                        let savedId;
                                        if (isEdit) {
                                            await api.updateStorageLocation(existing.id, { name: v.name.trim() });
                                            savedId = existing.id;
                                        } else {
                                            const created = await api.createStorageLocation({
                                                category_id: parentCategoryId,
                                                name: v.name.trim(),
                                            });
                                            savedId = created.id;
                                        }
                                        $$("pk-sloc-editor").close();
                                        await reloadStorageTreeAndGrid("sloc:" + savedId);
                                        webix.message({ text: "Saved", type: "success" });
                                        if (!isEdit) {
                                            // Re-open in edit mode so the operator can attach an image.
                                            openStorageLocationEditor("edit", { id: savedId, name: v.name.trim() }, null);
                                        }
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
        $$("pk-sloc-editor-form").setValues(seed);

        if (isEdit) {
            refreshAttachments({ tableId: "pk-sloc-images", kind: "StorageLocationImage", getParentId: () => locId });
            // Load contained parts (read-only).
            api.parts({ filter: { kind: "storage_location", id: locId }, limit: 1000, offset: 0 })
                .then((json) => {
                    const grid = $$("pk-sloc-contained");
                    if (!grid) return;
                    grid.clearAll();
                    grid.parse(json.items);
                    const status = $$("pk-sloc-contained-status");
                    if (status) status.setValue(`${json.items.length} part${json.items.length === 1 ? "" : "s"} in this location`);
                })
                .catch((e) => console.error(e));
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
        openFootprintLeafEditor("new", null, parentId);
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
            // leaf — comprehensive editor with Images + Attachments tabs
            const full = await api.footprintById(node.footprint_id);
            openFootprintLeafEditor(
                "edit",
                full || { id: node.footprint_id, name: node.value, description: "" },
                null
            );
        }
    }

    function openFootprintLeafEditor(mode, existing, parentCategoryId) {
        const isEdit = mode === "edit";
        const fpId = isEdit && existing ? existing.id : null;
        const seed = existing || { name: "", description: "" };

        const tabs = [
            {
                header: "Identity",
                body: {
                    rows: [
                        { view: "text", name: "name", label: "Name", labelWidth: 130, required: true },
                        { view: "textarea", name: "description", label: "Description", labelWidth: 130, height: 100 },
                        {},
                    ],
                },
            },
        ];
        if (isEdit) {
            tabs.push({
                header: "Images",
                body: buildAttachmentsSection({
                    tableId: "pk-fp-images",
                    uploaderId: "pk-fp-images-uploader",
                    kind: "FootprintImage",
                    getParentId: () => fpId,
                }),
            });
            tabs.push({
                header: "Attachments",
                body: buildAttachmentsSection({
                    tableId: "pk-fp-attachments",
                    uploaderId: "pk-fp-attachments-uploader",
                    kind: "FootprintAttachment",
                    getParentId: () => fpId,
                }),
            });
        }

        webix.ui({
            view: "window",
            id: "pk-fp-editor",
            modal: true,
            position: "center",
            width: 820,
            height: 600,
            head: isEdit ? `Edit footprint "${existing.name}"` : "New footprint",
            body: {
                view: "form",
                id: "pk-fp-editor-form",
                elements: [
                    { view: "tabview", cells: tabs },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-fp-editor").close() },
                            {
                                view: "button",
                                value: isEdit ? "Save" : "Create",
                                width: 110,
                                css: isEdit ? "webix_primary" : "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-fp-editor-form").getValues();
                                    if (!v.name || !v.name.trim()) {
                                        webix.message({ type: "error", text: "Name is required" });
                                        return;
                                    }
                                    const body = {
                                        name: v.name.trim(),
                                        description: (v.description || "").trim() || null,
                                    };
                                    try {
                                        let savedId;
                                        if (isEdit) {
                                            await api.updateFootprint(existing.id, body);
                                            savedId = existing.id;
                                        } else {
                                            const created = await api.createFootprint({
                                                ...body,
                                                category_id: parentCategoryId,
                                            });
                                            savedId = created.id;
                                        }
                                        $$("pk-fp-editor").close();
                                        await reloadFootprintTreeAndGrid("fp:" + savedId);
                                        webix.message({ text: "Saved", type: "success" });
                                        if (!isEdit) {
                                            // Re-open in edit mode so the operator can immediately
                                            // attach images/files to the freshly created footprint.
                                            const full = await api.footprintById(savedId);
                                            openFootprintLeafEditor("edit", full, null);
                                        }
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
        $$("pk-fp-editor-form").setValues(seed);

        if (isEdit) {
            refreshAttachments({ tableId: "pk-fp-images", kind: "FootprintImage", getParentId: () => fpId });
            refreshAttachments({ tableId: "pk-fp-attachments", kind: "FootprintAttachment", getParentId: () => fpId });
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

    // --- Projects left-pane list ---

    function buildProjectsListView() {
        return {
            rows: [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 38,
                    cols: [
                        { view: "button", value: "+ Project", css: "pk-btn-add", width: 110, click: openProjectAdd },
                        {},
                    ],
                },
                {
                    view: "list",
                    id: "pk-projects-list",
                    css: "pk-projects-list",
                    select: true,
                    template: function (o) {
                        const desc = o.description ? `<div class="pk-projects-desc">${escapeHtml(o.description)}</div>` : "";
                        const meta = [];
                        if (o.parts_count != null) meta.push(`${o.parts_count} parts`);
                        if (o.runs_count) meta.push(`${o.runs_count} runs`);
                        if (o.last_run_at) meta.push(`last ${o.last_run_at.substring(0, 10)}`);
                        const metaHtml = meta.length
                            ? `<span class="pk-projects-meta">${meta.join(" · ")}</span>`
                            : "";
                        return `<div class="pk-projects-name">${escapeHtml(o.name)}${metaHtml}</div>${desc}`;
                    },
                    type: { height: 56 },
                    on: {
                        onAfterSelect: function (id) {
                            loadProjectIntoCenter(id);
                        },
                    },
                },
            ],
        };
    }

    let projectsListLoaded = false;
    async function loadProjectsList(force) {
        if (projectsListLoaded && !force) return;
        try {
            const rows = await api.listProjects();
            const list = $$("pk-projects-list");
            list.clearAll();
            list.parse(rows);
            projectsListLoaded = true;
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load projects" });
        }
    }

    // --- Project center pane ---

    let currentProject = null;  // most recently loaded project detail

    function buildProjectCenterRows() {
        return [
            {
                view: "toolbar",
                css: "pk-pane-toolbar",
                height: 40,
                cols: [
                    { view: "label", id: "pk-project-title", label: "Project", css: "pk-pane-title" },
                    {},
                    { view: "button", value: "▶ Run", css: "pk-btn-add", width: 80, click: openRunDialog },
                    { view: "button", value: "✎ Edit", css: "webix_primary", width: 90, click: openProjectEdit },
                    { view: "button", value: "🗑 Delete", css: "pk-btn-remove", width: 100, click: confirmProjectDelete },
                ],
            },
            {
                view: "template",
                id: "pk-project-header",
                template: '<div class="pk-detail-empty">Select a project from the left.</div>',
                height: 70,
                borderless: true,
            },
            {
                view: "toolbar",
                id: "pk-bom-toolbar",
                css: "pk-pane-toolbar",
                height: 38,
                hidden: true,
                cols: [
                    { view: "label", id: "pk-bom-title", label: "BOM", css: "pk-pane-title" },
                    {},
                    { view: "button", value: "+ Line", css: "pk-btn-add", width: 80, click: openBomAdd },
                    { view: "button", value: "✎ Edit", css: "webix_primary", width: 80, click: openBomEdit },
                    { view: "button", value: "🗑 Remove", css: "pk-btn-remove", width: 95, click: confirmBomDelete },
                ],
            },
            {
                view: "datatable",
                id: "pk-bom-grid",
                css: "pk-grid",
                hidden: true,
                select: "row",
                resizeColumn: { headerOnly: true, size: 4 },
                columns: [
                    {
                        id: "part_name", header: "Part", width: 220, sort: "string",
                        template: (o) => escapeHtml(o.part_name || ""),
                    },
                    {
                        id: "part_internal_part_number", header: "IPN", width: 110, sort: "string",
                        template: (o) => escapeHtml(o.part_internal_part_number || ""),
                    },
                    {
                        id: "quantity", header: { text: "Qty", css: "pk-th-numeric" },
                        width: 70, sort: "int", css: "pk-numeric",
                    },
                    {
                        id: "overage", header: "Overage", width: 110,
                        template: (o) => {
                            if (!o.overage_type || !o.overage) return "";
                            const suffix = o.overage_type === "percent" ? "%" : "";
                            return `${o.overage}${suffix} (${o.overage_type})`;
                        },
                    },
                    { id: "lot_number", header: "Lot", width: 110, template: (o) => escapeHtml(o.lot_number || "") },
                    { id: "remarks", header: "Remarks", fillspace: true, template: (o) => escapeHtml(o.remarks || "") },
                    {
                        id: "part_stock_level", header: { text: "Stock", css: "pk-th-numeric" },
                        width: 70, css: "pk-numeric",
                        template: (o) => o.part_stock_level != null ? o.part_stock_level : "",
                    },
                ],
                on: {
                    onItemClick: function (sel) {
                        // Drive the right-pane part detail when a BOM line is clicked.
                        const row = this.getItem(sel.row);
                        if (row && row.part_id) loadPartDetail(row.part_id);
                    },
                },
            },
            {
                view: "scrollview",
                id: "pk-project-scroll",
                scroll: "y",
                body: {
                    view: "template",
                    id: "pk-project-body",
                    template: " ",
                    autoheight: true,
                },
            },
        ];
    }

    async function loadProjectIntoCenter(projectId) {
        let proj, runs;
        try {
            // Fetch project + runs together so the lower section renders
            // with run history in one HTML pass — no second async hop, no
            // DOM-after-setHTML race.
            [proj, runs] = await Promise.all([
                api.projectById(projectId),
                api.listRuns(projectId).catch(() => []),
            ]);
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load project" });
            return;
        }
        currentProject = proj;
        $$("pk-project-title").setValue(`Project: ${escapeHtml(proj.name)}`);
        $$("pk-project-header").setHTML(renderProjectHeaderHtml(proj));
        $$("pk-bom-toolbar").show();
        $$("pk-bom-grid").show();
        $$("pk-bom-title").setValue(`BOM (${(proj.parts || []).length})`);
        const grid = $$("pk-bom-grid");
        grid.clearAll();
        grid.parse(proj.parts || []);
        $$("pk-project-body").setHTML(renderProjectLowerHtml(proj, runs));
        // Wire up delete-run buttons rendered into the runs-section table.
        const sec = document.getElementById("pk-project-runs-section");
        if (sec) {
            sec.querySelectorAll('button[data-action="del-run"]').forEach((btn) => {
                btn.addEventListener("click", () => {
                    const rid = parseInt(btn.dataset.rid, 10);
                    confirmRunDelete(projectId, rid);
                });
            });
        }
        const cell = $$("centerpane-project");
        if (cell) cell.show();
    }

    function renderProjectHeaderHtml(p) {
        return `<div class="pk-detail-section pk-detail-header">
            <div class="pk-detail-name">${escapeHtml(p.name)}</div>
            ${p.description ? `<div class="pk-detail-desc">${escapeHtml(p.description)}</div>` : ""}
        </div>`;
    }

    function renderProjectLowerHtml(p, runs) {
        const sections = [];
        if (p.attachments && p.attachments.length) {
            const rows = p.attachments.map((a) => {
                const tag = a.is_image ? "img" : "doc";
                const size = a.size ? `${(a.size / 1024).toFixed(1)} KB` : "";
                const url = `/files/ProjectAttachment/${a.id}`;
                return `<tr>
                    <td><a href="${url}" target="_blank">${escapeHtml(a.original_filename || a.filename)}</a></td>
                    <td>${tag}</td>
                    <td class="pk-numeric">${escapeHtml(size)}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(
                `Attachments (${p.attachments.length})`,
                `<table class="pk-detail-table"><thead><tr><th>File</th><th>Type</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table>`
            ));
        }

        let runsBody;
        if (!runs || !runs.length) {
            runsBody = `<p class="pk-help-hint">No runs yet — use ▶ Run to record a build.</p>`;
        } else {
            const rows = runs.map((r) => {
                const date = (r.run.run_date_time || "").substring(0, 16).replace("T", " ");
                const lines = (r.lines || []).length;
                return `<tr>
                    <td>${escapeHtml(date)}</td>
                    <td class="pk-numeric">×${r.run.quantity}</td>
                    <td class="pk-numeric">${lines} line${lines === 1 ? "" : "s"}</td>
                    <td><button class="pk-link-btn" data-rid="${r.run.id}" data-action="del-run">delete…</button></td>
                </tr>`;
            }).join("");
            runsBody = `<table class="pk-detail-table">
                <thead><tr><th>When</th><th class="pk-numeric">Qty</th><th class="pk-numeric">Lines</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
        }
        sections.push(`<div id="pk-project-runs-section">` +
            detailSectionHtml(`Runs${runs && runs.length ? ` (${runs.length})` : ""}`, runsBody) +
            `</div>`);
        return sections.join("");
    }

    // --- Run dialog ---

    let runPreviewQty = 1;

    function openRunDialog() {
        if (!currentProject) {
            webix.message({ type: "error", text: "Select a project first." });
            return;
        }
        if (!currentProject.parts || !currentProject.parts.length) {
            webix.message({ type: "error", text: "Project has no BOM lines — add some first." });
            return;
        }

        runPreviewQty = 1;

        webix.ui({
            view: "window",
            id: "pk-run-dialog",
            modal: true,
            position: "center",
            width: 880,
            height: 620,
            head: `Run project: ${currentProject.name}`,
            body: {
                rows: [
                    {
                        view: "toolbar",
                        css: "pk-pane-toolbar",
                        height: 44,
                        cols: [
                            { view: "label", label: "Build quantity:", width: 130, css: "pk-pane-title" },
                            {
                                view: "counter",
                                id: "pk-run-quantity",
                                value: 1, min: 1, step: 1, width: 110,
                                on: {
                                    onChange: function (newVal) {
                                        runPreviewQty = parseInt(newVal, 10) || 1;
                                        refreshRunPreview();
                                    },
                                },
                            },
                            {},
                            {
                                view: "label",
                                id: "pk-run-banner",
                                label: "",
                                hidden: true,
                                css: "pk-run-banner",
                            },
                        ],
                    },
                    {
                        view: "datatable",
                        id: "pk-run-preview",
                        css: "pk-grid",
                        select: false,
                        rowCss: function (o) {
                            return o.shortfall ? "pk-row-shortfall" : "";
                        },
                        columns: [
                            { id: "part_name", header: "Part", fillspace: true,
                              template: (o) => `${escapeHtml(o.part_name || "(orphan)")}${o.is_meta ? ' <span class="pk-detail-meta-tag">META</span>' : ""}` },
                            { id: "bom_quantity", header: { text: "BOM", css: "pk-th-numeric" }, width: 60, css: "pk-numeric" },
                            { id: "per_build", header: { text: "Per build", css: "pk-th-numeric" }, width: 80, css: "pk-numeric" },
                            { id: "effective", header: { text: "Needed", css: "pk-th-numeric" }, width: 75, css: "pk-numeric" },
                            { id: "current_stock", header: { text: "Stock", css: "pk-th-numeric" }, width: 65, css: "pk-numeric",
                              template: (o) => o.current_stock != null ? o.current_stock : "—" },
                            {
                                id: "shortfall_label", header: "Status", width: 110,
                                template: (o) => {
                                    if (o.is_meta) return '<span class="pk-stock-remove">META — needs allocation</span>';
                                    if (o.shortfall) return `<span class="pk-stock-remove">SHORTFALL ${(o.current_stock || 0) - o.effective}</span>`;
                                    return '<span class="pk-stock-add">OK</span>';
                                },
                            },
                            { id: "lot_number", header: "Lot", width: 100,
                              template: (o) => escapeHtml(o.lot_number || "") },
                        ],
                    },
                    { view: "textarea", id: "pk-run-comment", placeholder: "Run comment (optional)", height: 50 },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 50,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 100, click: () => $$("pk-run-dialog").close() },
                            {
                                view: "button",
                                id: "pk-run-go",
                                value: "▶ Run",
                                width: 110,
                                css: "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: doRun,
                            },
                        ],
                    },
                ],
            },
        }).show();
        refreshRunPreview();
    }

    async function refreshRunPreview() {
        if (!currentProject) return;
        try {
            const lines = await api.runPreview(currentProject.id, runPreviewQty);
            const grid = $$("pk-run-preview");
            grid.clearAll();
            grid.parse(lines);
            // Banner: how many shortfalls?
            const shortfalls = lines.filter((l) => l.shortfall).length;
            const metas = lines.filter((l) => l.is_meta).length;
            const banner = $$("pk-run-banner");
            if (metas > 0) {
                banner.setValue(`<b>${metas}</b> meta-part line${metas === 1 ? "" : "s"} — backend will refuse without per-line allocations (W7c.X)`);
                banner.show();
            } else if (shortfalls > 0) {
                banner.setValue(`<b>${shortfalls}</b> line${shortfalls === 1 ? "" : "s"} short — run will produce negative stock (allowed)`);
                banner.show();
            } else {
                banner.hide();
            }
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Preview failed: " + (e.message || e) });
        }
    }

    async function doRun() {
        if (!currentProject) return;
        const body = {
            quantity: runPreviewQty,
            comment: ($$("pk-run-comment").getValue() || "").trim() || null,
            lot_overrides: {},
            allocations: {},
        };
        const projectId = currentProject.id;

        // Step 1: actually run the project. Distinguish run failure from
        // post-run refresh failure so we don't say "Run failed" after the
        // backend already committed.
        try {
            await api.runProject(projectId, body);
        } catch (e) {
            console.error(e);
            const msg = String(e.message || e);
            if (msg.includes("meta-part")) {
                webix.alert({
                    title: "Run rejected",
                    width: 540,
                    text:
                        '<div style="text-align:left;line-height:1.5">' +
                        '<p>This BOM has one or more meta-part lines.</p>' +
                        '<p>Meta-parts have no stock of their own — they need to be resolved to specific real parts at run time. ' +
                        'The per-line allocation editor for that flow lands in W7c follow-up; for now, replace meta-parts with real parts on the BOM, or skip running this project.</p>' +
                        `<details><summary>Server message</summary><pre>${escapeHtml(msg)}</pre></details>` +
                        '</div>',
                });
            } else {
                webix.message({ type: "error", text: "Run failed: " + msg });
            }
            return;
        }

        // Step 2: refresh UI. Failures here are surface-only — the run
        // itself is already committed on the server.
        $$("pk-run-dialog").close();
        webix.message({ text: `Recorded run ×${body.quantity}`, type: "success" });
        try {
            await loadProjectIntoCenter(projectId);
            await loadProjectsList(true);
            const list = $$("pk-projects-list");
            if (list && list.exists(projectId)) list.select(projectId);
        } catch (e) {
            console.error("post-run refresh failed:", e);
            // Don't toast — the run succeeded, the user can refresh manually.
        }
    }

    function confirmRunDelete(projectId, runId) {
        webix.ui({
            view: "window",
            id: "pk-run-delete",
            modal: true,
            position: "center",
            width: 480,
            head: `Delete run #${runId}`,
            body: {
                view: "form",
                id: "pk-run-delete-form",
                elements: [
                    {
                        view: "label",
                        label:
                            "Run history is normally append-only. This is the admin escape hatch — " +
                            "use it for fixing mistakes or cleaning up test runs.",
                        height: 50,
                    },
                    {
                        view: "checkbox",
                        name: "restore_stock",
                        labelRight: "Also restore stock (insert compensating positive entries)",
                        labelWidth: 0,
                        value: 0,
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 50,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 100, click: () => $$("pk-run-delete").close() },
                            {
                                view: "button",
                                value: "Delete run",
                                width: 130,
                                css: "pk-btn-remove",
                                click: async function () {
                                    const v = $$("pk-run-delete-form").getValues();
                                    try {
                                        await api.deleteRun(projectId, runId, !!v.restore_stock);
                                        $$("pk-run-delete").close();
                                        await loadProjectIntoCenter(projectId);
                                        await loadProjectsList(true);
                                        const list = $$("pk-projects-list");
                                        if (list && list.exists(projectId)) list.select(projectId);
                                        webix.message({ text: "Run deleted", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
    }

    // --- BOM CRUD ---

    function openBomAdd() {
        if (!currentProject) {
            webix.message({ type: "error", text: "Select a project first." });
            return;
        }
        openBomLineDialog("new", null);
    }

    function openBomEdit() {
        if (!currentProject) return;
        const grid = $$("pk-bom-grid");
        const sel = grid && grid.getSelectedId() ? grid.getItem(grid.getSelectedId()) : null;
        if (!sel) {
            webix.message({ type: "error", text: "Select a BOM line to edit." });
            return;
        }
        openBomLineDialog("edit", sel);
    }

    function confirmBomDelete() {
        if (!currentProject) return;
        const grid = $$("pk-bom-grid");
        const sel = grid && grid.getSelectedId() ? grid.getItem(grid.getSelectedId()) : null;
        if (!sel) {
            webix.message({ type: "error", text: "Select a BOM line to remove." });
            return;
        }
        const projId = currentProject.id;
        webix.confirm({
            title: "Remove BOM line",
            type: "confirm-error",
            ok: "Remove",
            cancel: "Cancel",
            text: `Remove <b>${escapeHtml(sel.part_name || "(orphan)")}</b> from BOM?`,
            callback: async (result) => {
                if (!result) return;
                try {
                    await api.deleteBomLine(projId, sel.id);
                    await loadProjectIntoCenter(projId);
                    webix.message({ text: "Removed", type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Remove failed: " + (e.message || e) });
                }
            },
        });
    }

    function openBomLineDialog(mode, existing) {
        const isEdit = mode === "edit";
        const seed = existing || {
            part_id: null, quantity: 1, remarks: "",
            overage_type: "", overage: 0, lot_number: "",
        };
        webix.ui({
            view: "window",
            id: "pk-bom-line",
            modal: true,
            position: "center",
            width: 540,
            head: isEdit ? `Edit BOM line` : "New BOM line",
            body: {
                view: "form",
                id: "pk-bom-line-form",
                elements: [
                    {
                        view: "combo",
                        id: "pk-bom-line-part",
                        name: "part_id",
                        label: "Part",
                        labelWidth: 120,
                        suggest: {
                            body: {
                                template: function (o) {
                                    const ipn = o.internal_part_number ? ` <span class="pk-bom-ipn">${escapeHtml(o.internal_part_number)}</span>` : "";
                                    const cat = o.category_path ? ` <span class="pk-bom-cat">${escapeHtml((o.category_path.split(" ➤ ").pop()) || "")}</span>` : "";
                                    return `${escapeHtml(o.name || "")}${ipn}${cat}`;
                                },
                            },
                            data: [],  // populated below
                        },
                        readonly: isEdit,  // can't change the part on an existing line — remove + re-add instead
                    },
                    { view: "counter", name: "quantity", label: "Quantity", labelWidth: 120, value: 1, min: 1, step: 1 },
                    {
                        view: "richselect",
                        name: "overage_type",
                        label: "Overage type",
                        labelWidth: 120,
                        options: [
                            { id: "", value: "(none)" },
                            { id: "absolute", value: "absolute" },
                            { id: "percent", value: "percent" },
                        ],
                    },
                    { view: "counter", name: "overage", label: "Overage amount", labelWidth: 120, value: 0, min: 0, step: 1 },
                    { view: "text", name: "lot_number", label: "Lot number", labelWidth: 120 },
                    { view: "textarea", name: "remarks", label: "Remarks", labelWidth: 120, height: 50 },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-bom-line").close() },
                            {
                                view: "button",
                                value: isEdit ? "Save" : "Add",
                                width: 100,
                                css: "webix_primary",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-bom-line-form").getValues();
                                    if (!v.part_id) {
                                        webix.message({ type: "error", text: "Pick a part." });
                                        return;
                                    }
                                    const body = {
                                        part_id: parseInt(v.part_id, 10),
                                        quantity: parseInt(v.quantity, 10) || 1,
                                        remarks: (v.remarks || "").trim() || null,
                                        overage_type: v.overage_type || "",
                                        overage: parseInt(v.overage, 10) || 0,
                                        lot_number: (v.lot_number || "").trim() || null,
                                    };
                                    try {
                                        if (isEdit) {
                                            await api.updateBomLine(currentProject.id, existing.id, body);
                                        } else {
                                            await api.addBomLine(currentProject.id, body);
                                        }
                                        $$("pk-bom-line").close();
                                        await loadProjectIntoCenter(currentProject.id);
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
        // Populate the part suggest list from /api/parts (full list — 685
        // parts is small enough; we filter client-side via Webix's combo).
        api.parts({ limit: 1000 }).then((json) => {
            const data = (json.items || []).map((p) => ({
                id: p.id,
                value: p.name + (p.internal_part_number ? ` [${p.internal_part_number}]` : ""),
                name: p.name,
                internal_part_number: p.internal_part_number,
                category_path: p.category_path,
            }));
            const suggest = $$("pk-bom-line-part").getPopup();
            const list = suggest.getList();
            list.clearAll();
            list.parse(data);
        }).catch((e) => console.error(e));
        $$("pk-bom-line-form").setValues(seed);
    }

    // --- Project add/edit/delete ---

    function openProjectAdd() {
        openProjectEditor("new", null);
    }

    function openProjectEdit() {
        if (!currentProject) {
            webix.message({ type: "error", text: "Select a project first." });
            return;
        }
        openProjectEditor("edit", currentProject);
    }

    function confirmProjectDelete() {
        if (!currentProject) {
            webix.message({ type: "error", text: "Select a project first." });
            return;
        }
        const p = currentProject;
        webix.confirm({
            title: "Delete project",
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text: `Delete project <b>${escapeHtml(p.name)}</b>? Refused if any runs exist (run history is append-only).`,
            callback: async (result) => {
                if (!result) return;
                try {
                    await api.deleteProject(p.id);
                    currentProject = null;
                    $$("pk-project-title").setValue("Project");
                    $$("pk-project-body").setHTML('<div class="pk-detail-empty">Select a project from the left.</div>');
                    await loadProjectsList(true);
                    webix.message({ text: "Project deleted", type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    function openProjectEditor(mode, existing) {
        const isEdit = mode === "edit";
        const projId = isEdit && existing ? existing.id : null;
        const seed = existing || { name: "", description: "" };

        const tabs = [
            {
                header: "Identity",
                body: {
                    rows: [
                        { view: "text", name: "name", label: "Name", labelWidth: 110, required: true },
                        { view: "textarea", name: "description", label: "Description", labelWidth: 110, height: 100 },
                        {},
                    ],
                },
            },
        ];
        if (isEdit) {
            tabs.push({
                header: "Attachments",
                body: buildAttachmentsSection({
                    tableId: "pk-project-attachments",
                    uploaderId: "pk-project-attachments-uploader",
                    kind: "ProjectAttachment",
                    getParentId: () => projId,
                }),
            });
        }

        webix.ui({
            view: "window",
            id: "pk-project-editor",
            modal: true,
            position: "center",
            width: 720,
            height: 540,
            head: isEdit ? `Edit project "${existing.name}"` : "New project",
            body: {
                view: "form",
                id: "pk-project-editor-form",
                elements: [
                    { view: "tabview", cells: tabs },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-project-editor").close() },
                            {
                                view: "button",
                                value: isEdit ? "Save" : "Create",
                                width: 110,
                                css: isEdit ? "webix_primary" : "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-project-editor-form").getValues();
                                    if (!v.name || !v.name.trim()) {
                                        webix.message({ type: "error", text: "Name is required" });
                                        return;
                                    }
                                    const body = {
                                        name: v.name.trim(),
                                        description: (v.description || "").trim() || null,
                                    };
                                    try {
                                        let savedId;
                                        if (isEdit) {
                                            await api.updateProject(existing.id, body);
                                            savedId = existing.id;
                                        } else {
                                            const created = await api.createProject(body);
                                            savedId = created.id;
                                        }
                                        $$("pk-project-editor").close();
                                        await loadProjectsList(true);
                                        await loadProjectIntoCenter(savedId);
                                        const list = $$("pk-projects-list");
                                        if (list && list.exists(savedId)) list.select(savedId);
                                        webix.message({ text: "Saved", type: "success" });
                                        if (!isEdit) {
                                            // Re-open in edit mode so the operator can attach files immediately.
                                            const fresh = await api.projectById(savedId);
                                            openProjectEditor("edit", fresh);
                                        }
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
        $$("pk-project-editor-form").setValues(seed);

        if (isEdit) {
            refreshAttachments({ tableId: "pk-project-attachments", kind: "ProjectAttachment", getParentId: () => projId });
        }
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
    // byField holds the optional flat predicates exposed by the filter
    // pane (stock_mode, meta_only, distributor_id, price_min/max).
    let currentParts = { filter: null, search: "", byField: {} };

    function buildCenterPane() {
        return {
            id: "pk-center",
            view: "multiview",
            cells: [
                { id: "centerpane-grid", rows: buildPartsGridRows() },
                { id: "centerpane-lookups", rows: buildLookupsCenterRows() },
                { id: "centerpane-project", rows: buildProjectCenterRows() },
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
                            view: "toggle",
                            id: "pk-filters-toggle",
                            type: "iconButton",
                            label: "▾ Filters",
                            offLabel: "▸ Filters",
                            width: 90,
                            on: {
                                onChange: function (newVal) {
                                    const pane = $$("pk-filters-pane");
                                    if (!pane) return;
                                    if (newVal) pane.show();
                                    else pane.hide();
                                },
                            },
                        },
                        { view: "button", value: "⊞ Columns", width: 110, click: openColumnsDialog },
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
                    id: "pk-filters-pane",
                    view: "toolbar",
                    css: "pk-filters-pane",
                    height: 50,
                    hidden: true,
                    cols: [
                        {
                            view: "richselect",
                            id: "pk-filter-stock",
                            label: "Stock",
                            labelWidth: 50,
                            width: 180,
                            value: "any",
                            options: [
                                { id: "any", value: "any" },
                                { id: "in_stock", value: "in stock (>0)" },
                                { id: "out_of_stock", value: "out of stock (=0)" },
                                { id: "low_stock", value: "low stock (<min)" },
                            ],
                        },
                        {
                            view: "richselect",
                            id: "pk-filter-meta",
                            label: "Type",
                            labelWidth: 50,
                            width: 160,
                            value: "any",
                            options: [
                                { id: "any", value: "any" },
                                { id: "real", value: "real only" },
                                { id: "meta", value: "meta only" },
                            ],
                        },
                        {
                            view: "richselect",
                            id: "pk-filter-distributor",
                            label: "Distributor",
                            labelWidth: 80,
                            width: 240,
                            value: "",
                            options: [{ id: "", value: "(any)" }],  // populated lazily
                        },
                        {
                            view: "text",
                            id: "pk-filter-price-min",
                            label: "Price min",
                            labelWidth: 75,
                            width: 130,
                            placeholder: "(any)",
                        },
                        {
                            view: "text",
                            id: "pk-filter-price-max",
                            label: "max",
                            labelWidth: 35,
                            width: 110,
                            placeholder: "(any)",
                        },
                        {},
                        { view: "button", value: "Apply", css: "webix_primary", width: 90, click: applyFilters },
                        { view: "button", value: "Reset", width: 90, click: resetFilters },
                    ],
                },
                {
                    view: "datatable",
                    id: "pk-parts-grid",
                    css: "pk-grid",
                    select: "row",
                    resizeColumn: { headerOnly: true, size: 4 },
                    dragColumn: true,
                    // Show the per-column filter row beneath each header.
                    headerRowHeight: 26,
                    columns: [
                        {
                            id: "name",
                            header: ["Name", { content: "textFilter" }],
                            width: 220,
                            sort: "string",
                            template: (o) => escapeHtml(o.name || ""),
                        },
                        {
                            id: "internal_part_number",
                            header: ["IPN", { content: "textFilter" }],
                            width: 110,
                            sort: "string",
                            template: (o) => escapeHtml(o.internal_part_number || ""),
                        },
                        {
                            id: "description",
                            header: ["Description", { content: "textFilter" }],
                            fillspace: true,
                            sort: "string",
                            template: (o) => escapeHtml(o.description || ""),
                        },
                        {
                            id: "category_path",
                            header: ["Category", { content: "selectFilter" }],
                            width: 240,
                            sort: "string",
                            // The full breadcrumb is what we filter against,
                            // but we render the leaf for grid density.
                            template: (o) => {
                                const p = o.category_path || "";
                                const parts = p.split(" ➤ ");
                                return escapeHtml(parts[parts.length - 1] || p);
                            },
                        },
                        {
                            id: "stock_level",
                            header: [{ text: "Stock", css: "pk-th-numeric" }, { content: "numberFilter" }],
                            width: 70,
                            sort: "int",
                            css: "pk-numeric",
                        },
                        {
                            id: "average_price",
                            header: [{ text: "Avg $", css: "pk-th-numeric" }, { content: "textFilter" }],
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
                        onAfterColumnDrop: function () { savePartsGridState(); },
                        onColumnResize: function () { savePartsGridState(); },
                        onAfterColumnHide: function () { savePartsGridState(); },
                        onAfterColumnShow: function () { savePartsGridState(); },
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
        if (currentLookupType === "manufacturers") {
            openManufacturerEditor("new", null);
            return;
        }
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
        if (currentLookupType === "manufacturers") {
            openManufacturerEditor("edit", sel);
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

    // Comprehensive manufacturer editor (Identity + Logos tabs).
    // Other lookup types use the generic showLookupEditDialog.
    function openManufacturerEditor(mode, existing) {
        const isEdit = mode === "edit";
        const mfgId = isEdit && existing ? existing.id : null;
        const seed = existing || {
            name: "", url: "", email: "", phone: "", fax: "",
            address: "", comment: "",
        };

        const tabs = [
            {
                header: "Identity",
                body: {
                    rows: [
                        { view: "text", name: "name", label: "Name", labelWidth: 110, required: true },
                        { view: "text", name: "url", label: "URL", labelWidth: 110 },
                        { view: "text", name: "email", label: "Email", labelWidth: 110 },
                        { view: "text", name: "phone", label: "Phone", labelWidth: 110 },
                        { view: "text", name: "fax", label: "Fax", labelWidth: 110 },
                        { view: "textarea", name: "address", label: "Address", labelWidth: 110, height: 60 },
                        { view: "textarea", name: "comment", label: "Comment", labelWidth: 110, height: 80 },
                        {},
                    ],
                },
            },
        ];
        if (isEdit) {
            tabs.push({
                header: "Logos",
                body: buildAttachmentsSection({
                    tableId: "pk-mfg-logos",
                    uploaderId: "pk-mfg-logos-uploader",
                    kind: "ManufacturerICLogo",
                    getParentId: () => mfgId,
                }),
            });
        }

        webix.ui({
            view: "window",
            id: "pk-mfg-editor",
            modal: true,
            position: "center",
            width: 820,
            height: 620,
            head: isEdit ? `Edit manufacturer "${existing.name}"` : "New manufacturer",
            body: {
                view: "form",
                id: "pk-mfg-editor-form",
                elements: [
                    { view: "tabview", cells: tabs },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-mfg-editor").close() },
                            {
                                view: "button",
                                value: isEdit ? "Save" : "Create",
                                width: 110,
                                css: isEdit ? "webix_primary" : "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-mfg-editor-form").getValues();
                                    if (!v.name || !v.name.trim()) {
                                        webix.message({ type: "error", text: "Name is required" });
                                        return;
                                    }
                                    const body = {
                                        name: v.name.trim(),
                                        url: (v.url || "").trim() || null,
                                        email: (v.email || "").trim() || null,
                                        phone: (v.phone || "").trim() || null,
                                        fax: (v.fax || "").trim() || null,
                                        address: (v.address || "").trim() || null,
                                        comment: (v.comment || "").trim() || null,
                                    };
                                    try {
                                        let savedId;
                                        if (isEdit) {
                                            await api.lookupUpdate("/api/manufacturers", existing.id, body);
                                            savedId = existing.id;
                                        } else {
                                            const created = await api.lookupCreate("/api/manufacturers", body);
                                            savedId = created.id;
                                        }
                                        $$("pk-mfg-editor").close();
                                        await showLookupType("manufacturers");
                                        webix.message({ text: "Saved", type: "success" });
                                        if (!isEdit) {
                                            // Re-open in edit mode so the operator can attach a logo.
                                            openManufacturerEditor("edit", { ...body, id: savedId });
                                        }
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
        $$("pk-mfg-editor-form").setValues(seed);

        if (isEdit) {
            refreshAttachments({ tableId: "pk-mfg-logos", kind: "ManufacturerICLogo", getParentId: () => mfgId });
        }
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
        if ("byField" in opts) currentParts.byField = opts.byField;
        try {
            const json = await api.parts({
                filter: currentParts.filter,
                search: currentParts.search,
                byField: currentParts.byField,
                limit: 500,
                offset: 0,
            });
            const grid = $$("pk-parts-grid");
            grid.clearAll();
            grid.parse(json.items);
            const fbits = [];
            if (currentParts.search) fbits.push(`search "${currentParts.search}"`);
            if (currentParts.byField) {
                if (currentParts.byField.stock_mode) fbits.push(currentParts.byField.stock_mode.replace("_", " "));
                if (currentParts.byField.meta_only === true) fbits.push("meta only");
                if (currentParts.byField.meta_only === false) fbits.push("real only");
                if (currentParts.byField.distributor_id) fbits.push("distributor");
                if (currentParts.byField.price_min || currentParts.byField.price_max) fbits.push("price range");
            }
            const filterSuffix = fbits.length ? ` · ${fbits.join(" · ")}` : "";
            $$("pk-parts-status").setValue(`${json.items.length} of ${json.total} parts${filterSuffix}`);
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
            const [part, projects, runs] = await Promise.all([
                api.part(id),
                api.partProjects(id).catch(() => []),
                api.partRuns(id).catch(() => []),
            ]);
            currentPart = part;
            $$("pk-detail").setHTML(renderPartDetailHtml(part, projects, runs));
            const actions = $$("pk-detail-actions");
            if (actions) actions.show();
            // Wire up project links in the cross-cutting sections.
            const root = $$("pk-detail").$view;
            if (root) {
                root.querySelectorAll('a[data-project-id]').forEach((a) => {
                    a.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        const pid = parseInt(a.dataset.projectId, 10);
                        jumpToProject(pid);
                    });
                });
            }
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load part detail" });
        }
    }

    // ============================================================
    //  Parts grid column persistence (W8c)
    //
    //  Webix datatable's getState/setState round-trips column order,
    //  widths, and which ones are hidden. We save it to localStorage on
    //  every change, keyed per user so different operators don't fight
    //  over the layout. DB-backed persistence is W8c.X (needs new
    //  /api/grid_presets POST/PUT/DELETE).
    // ============================================================

    function partsGridStorageKey() {
        const u = currentUser ? currentUser.username : "anon";
        return `pk:parts-grid-state:${u}`;
    }

    // Captured once on first mount so 'Reset layout' has a known target
    // to revert to. Cleared on logout.
    let _partsGridDefaultState = null;

    function savePartsGridState() {
        const grid = $$("pk-parts-grid");
        if (!grid) return;
        try {
            const state = grid.getState();
            localStorage.setItem(partsGridStorageKey(), JSON.stringify(state));
        } catch (e) {
            console.warn("savePartsGridState failed:", e);
        }
    }

    function restorePartsGridState() {
        const grid = $$("pk-parts-grid");
        if (!grid) return;
        // Capture pristine defaults on first call so Reset can use them.
        if (_partsGridDefaultState == null) {
            try { _partsGridDefaultState = grid.getState(); } catch (_) {}
        }
        try {
            const raw = localStorage.getItem(partsGridStorageKey());
            if (!raw) return;
            const state = JSON.parse(raw);
            grid.setState(state);
        } catch (e) {
            console.warn("restorePartsGridState failed:", e);
        }
    }

    function clearPartsGridState() {
        try {
            localStorage.removeItem(partsGridStorageKey());
        } catch (_) {}
        const grid = $$("pk-parts-grid");
        if (grid && _partsGridDefaultState != null) {
            try { grid.setState(_partsGridDefaultState); } catch (e) { console.warn(e); }
        }
    }

    function openColumnsDialog() {
        const grid = $$("pk-parts-grid");
        if (!grid) return;
        // Build the list of column ids → human label and current visibility.
        const cfg = grid.config.columns;
        const items = cfg.map((c) => {
            // Column header may be a string OR an array of header config
            // objects. Walk the array and find the first {text:...} or
            // string entry — that's the label.
            let label = c.id;
            if (typeof c.header === "string") label = c.header;
            else if (Array.isArray(c.header)) {
                for (const h of c.header) {
                    if (typeof h === "string") { label = h; break; }
                    if (h && typeof h === "object" && h.text) { label = h.text; break; }
                }
            } else if (c.header && typeof c.header === "object" && c.header.text) {
                label = c.header.text;
            }
            return { id: c.id, label, hidden: !!c.hidden };
        });

        webix.ui({
            view: "window",
            id: "pk-columns-dialog",
            modal: true,
            position: "center",
            width: 380,
            head: "Columns",
            body: {
                rows: [
                    { template: "Toggle column visibility:", height: 32, css: "pk-dialog-hint", borderless: true },
                    {
                        view: "list",
                        id: "pk-columns-list",
                        data: items,
                        select: false,
                        type: { height: 32 },
                        template: function (o) {
                            const checked = o.hidden ? "" : "checked";
                            return `<label><input type="checkbox" ${checked} data-col="${o.id}"> ${escapeHtml(o.label)}</label>`;
                        },
                        onClick: {
                            // Click a row → toggle the checkbox + grid column.
                            "webix_list_item": function (ev, row) {
                                // Let the native checkbox toggle drive things;
                                // intercept the click on the label/text otherwise.
                                if (ev.target && ev.target.tagName !== "INPUT") {
                                    const cb = ev.target.closest(".webix_list_item")
                                        ? ev.target.closest(".webix_list_item").querySelector("input[type=checkbox]")
                                        : null;
                                    if (cb) cb.click();
                                }
                            },
                        },
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 48,
                        cols: [
                            { view: "button", value: "Reset layout", width: 130, click: function () {
                                clearPartsGridState();
                                $$("pk-columns-dialog").close();
                                webix.message({ text: "Layout reset", type: "success" });
                            } },
                            {},
                            { view: "button", value: "Done", width: 90, css: "webix_primary", click: () => $$("pk-columns-dialog").close() },
                        ],
                    },
                ],
            },
        }).show();

        // Wire up the inline checkboxes after the list mounts.
        setTimeout(() => {
            const list = $$("pk-columns-list");
            if (!list || !list.$view) return;
            list.$view.querySelectorAll('input[type=checkbox][data-col]').forEach((cb) => {
                cb.addEventListener("change", () => {
                    const colId = cb.dataset.col;
                    if (cb.checked) grid.showColumn(colId);
                    else grid.hideColumn(colId);
                    // savePartsGridState fires from onAfterColumnHide/Show.
                });
            });
        }, 0);
    }

    // ============================================================
    //  Parts grid filter pane (W8a)
    // ============================================================

    let filterDistributorsLoaded = false;

    async function ensureFilterDistributorsLoaded() {
        if (filterDistributorsLoaded) return;
        try {
            const dists = await api.lookupList("/api/distributors");
            const sel = $$("pk-filter-distributor");
            if (!sel) return;
            const options = [{ id: "", value: "(any)" }].concat(
                dists.map((d) => ({ id: String(d.id), value: d.name }))
            );
            sel.define("options", options);
            sel.refresh();
            filterDistributorsLoaded = true;
        } catch (e) {
            console.error(e);
        }
    }

    function readFiltersFromPane() {
        const stock = $$("pk-filter-stock").getValue();
        const meta = $$("pk-filter-meta").getValue();
        const dist = $$("pk-filter-distributor").getValue();
        const priceMin = ($$("pk-filter-price-min").getValue() || "").trim();
        const priceMax = ($$("pk-filter-price-max").getValue() || "").trim();
        const out = {};
        if (stock && stock !== "any") out.stock_mode = stock;
        if (meta === "real") out.meta_only = false;
        else if (meta === "meta") out.meta_only = true;
        if (dist) out.distributor_id = parseInt(dist, 10);
        if (priceMin) out.price_min = priceMin;
        if (priceMax) out.price_max = priceMax;
        return out;
    }

    function applyFilters() {
        ensureFilterDistributorsLoaded();
        loadParts({ byField: readFiltersFromPane() });
    }

    function resetFilters() {
        $$("pk-filter-stock").setValue("any");
        $$("pk-filter-meta").setValue("any");
        $$("pk-filter-distributor").setValue("");
        $$("pk-filter-price-min").setValue("");
        $$("pk-filter-price-max").setValue("");
        loadParts({ byField: {} });
    }

    function jumpToProject(projectId) {
        // Switch left tabbar to Projects, ensure the list is loaded,
        // select the requested project (which fires loadProjectIntoCenter).
        const tabbar = $$("pk-left-tabbar");
        if (tabbar) tabbar.setValue("tab-projects");
        loadProjectsList(true).then(() => {
            const list = $$("pk-projects-list");
            if (list && list.exists(projectId)) list.select(projectId);
            else loadProjectIntoCenter(projectId);
        });
    }

    function renderPartDetailHtml(p, projects, runs) {
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

        // Cross-cutting: which projects' BOMs reference this part
        if (projects && projects.length) {
            const rows = projects.map((row) => {
                const overage = row.overage_type && row.overage
                    ? ` <span class="pk-help-hint">(+${row.overage}${row.overage_type === "percent" ? "%" : ""})</span>`
                    : "";
                const remarks = row.remarks ? ` &mdash; <span class="pk-help-hint">${escapeHtml(row.remarks)}</span>` : "";
                return `<tr>
                    <td><a href="#" data-project-id="${row.project_id}">${escapeHtml(row.project_name)}</a></td>
                    <td class="pk-numeric">${row.quantity}${overage}</td>
                    <td>${remarks}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(
                `Used in projects (${projects.length})`,
                `<table class="pk-detail-table">
                    <thead><tr><th>Project</th><th class="pk-numeric">BOM qty</th><th>Notes</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>`
            ));
        }

        // Cross-cutting: recent project runs that consumed this part
        if (runs && runs.length) {
            const rows = runs.slice(0, 8).map((r) => {
                const date = (r.run_date_time || "").substring(0, 10);
                const lot = r.lot_number ? ` <span class="pk-help-hint">[${escapeHtml(r.lot_number)}]</span>` : "";
                return `<tr>
                    <td>${escapeHtml(date)}</td>
                    <td><a href="#" data-project-id="${r.project_id}">${escapeHtml(r.project_name)}</a></td>
                    <td class="pk-numeric">×${r.run_quantity}</td>
                    <td class="pk-numeric pk-stock-remove">−${r.deducted_quantity}${lot}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(
                `Recent runs (${runs.length})`,
                `<table class="pk-detail-table">
                    <thead><tr><th>Date</th><th>Project</th><th class="pk-numeric">Run ×</th><th class="pk-numeric">Δ</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>`
            ));
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
