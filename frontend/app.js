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
        async parts({ category, search, limit = 200, offset = 0 } = {}) {
            const p = new URLSearchParams();
            if (category) p.set("category", category);
            if (search) p.set("search", search);
            p.set("limit", String(limit));
            p.set("offset", String(offset));
            const r = await fetch("/api/parts?" + p.toString());
            if (!r.ok) throw new Error(`parts list failed: ${r.status}`);
            return r.json();
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
    //  Left pane — category tree
    // ============================================================

    function buildLeftPane() {
        return {
            id: "pk-left",
            width: 280,
            rows: [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 32,
                    cols: [
                        { view: "label", label: "Categories", css: "pk-pane-title" },
                    ],
                },
                {
                    view: "tree",
                    id: "pk-cat-tree",
                    select: true,
                    drag: false,
                    template: function (obj, common) {
                        const indent = common.icon(obj, common);
                        const count = obj.part_count > 0
                            ? ` <span class="pk-cat-count">${obj.part_count}</span>`
                            : "";
                        return `${indent}<span class="pk-cat-name">${escapeHtml(obj.value)}</span>${count}`;
                    },
                    on: {
                        onAfterSelect: function (id) {
                            const node = this.getItem(id);
                            // Treat "Root Category" (lvl 0) as "all parts" — no filter.
                            const filterId = node && node.lvl === 0 ? null : (node ? node.id : null);
                            loadParts({ category: filterId });
                        },
                    },
                },
            ],
        };
    }

    async function loadCategoryTree() {
        try {
            const arr = await api.categoryTree();
            const tree = $$("pk-cat-tree");
            tree.clearAll();
            tree.parse(arr.map(transformCategoryNode));
            // Auto-select root, which loads all parts.
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
            out.open = node.lvl === 0;  // expand root by default
        }
        return out;
    }

    // ============================================================
    //  Center pane — parts grid
    // ============================================================

    let currentParts = { category: null, search: "" };

    function buildCenterPane() {
        return {
            id: "pk-center",
            rows: [
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
            ],
        };
    }

    async function loadParts(opts) {
        if ("category" in opts) currentParts.category = opts.category;
        try {
            const json = await api.parts({
                category: currentParts.category,
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
