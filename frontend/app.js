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
                    height: 32,
                    cols: [
                        { view: "label", id: "pk-grid-title", label: "Parts", css: "pk-pane-title" },
                        {},
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
                    view: "toolbar",
                    id: "pk-detail-actions",
                    css: "pk-detail-actions",
                    height: 38,
                    hidden: true,
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
                            width: 110,
                            click: () => openStockDialog("reconcile"),
                        },
                        {},
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
                if (prm.value_type === "numeric" && prm.numeric_value != null) {
                    value = `${prm.numeric_value} ${prm.prefix_symbol || ""}${prm.unit_symbol || ""}`.trim();
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
