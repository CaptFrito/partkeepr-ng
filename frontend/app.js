// SPDX-License-Identifier: GPL-3.0-or-later
//
// partkeepr-ng — Webix frontend.
//
// Same-origin with the API: backend serves these files via tower-http
// ServeDir. Session cookie rides along automatically; no CORS, no
// `credentials: include` needed.

"use strict";


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
        head: "Sign in to PartKeepr-ng",
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
    // Figure out which lookup sources are
    // available; reveal the "🔎 Add via Mouser" button on hit.
    refreshLookupCapabilities();

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
            { view: "label",
              label: '<img src="assets/logo.svg" class="pk-app-logo" alt=""/>' +
                     '<span class="pk-app-title">PartKeepr-ng</span>',
              width: 200 },
            {},
            {
                view: "search",
                id: "pk-scan",
                placeholder: "🔍 Scan / search IPN…",
                width: 280,
                on: {
                    onSearchIconClick: function () { handleScan(this.getValue()); this.setValue(""); },
                    // Webix's onEnter doesn't always fire when the
                    // value contains URL chars or the input was
                    // populated via a fast HID typing burst (barcode
                    // scanner). Bind a DOM-level keydown on the
                    // underlying <input> so Enter always triggers.
                    onAfterRender: function () {
                        const node = this.getInputNode && this.getInputNode();
                        if (!node || node._pkScanBound) return;
                        node._pkScanBound = true;
                        // Capture the Webix view in a closure — `this`
                        // inside addEventListener is the DOM element.
                        const view = this;
                        node.addEventListener("keydown", (ev) => {
                            if (ev.key === "Enter" || ev.keyCode === 13) {
                                ev.preventDefault();
                                const v = view.getValue();
                                view.setValue("");
                                handleScan(v);
                            }
                        });
                    },
                },
            },
            { view: "button", value: "📷 Scan", width: 100,
              tooltip: "Open scan-capture overlay. Suppresses browser shortcuts (Alt+digit, Ctrl+T, ...) so HID scanners that emit control chars via Alt+digit don't trigger tab-switching.",
              click: () => openScanCaptureOverlay() },
            { view: "button", value: "🖨 Label", width: 100, click: () => openLabelDialog({ template: "Custom" }) },
            { view: "label", label: userHtml, width: 220 },
            { view: "button", value: "Sign out", width: 100, click: doLogout },
        ],
    };
}

async function doLogout() {
    await api.logout();
    mountLogin();
}

// ============================================================
//  Center pane — parts grid
// ============================================================

// Active filter for the parts grid. `filter` is null (= all parts)
// or { kind: "category"|"storage_folder"|"storage_location"|
//              "footprint_folder"|"footprint", id: number }.
// byField holds the optional flat predicates exposed by the filter
// pane (stock_mode, meta_only, distributor_id, price_min/max).
// predicates holds the parametric-pane predicates (W9). When set,
// the parts grid is populated from /api/parts/parametric instead.
let currentParts = { filter: null, search: "", byField: {}, predicates: [], footprint_ids: [], category_ids: [] };

/// Selected footprint ids in the parametric pane's footprint
/// picker. Module-level so the popup can read/write while open
/// and the main applyParametricSearch can read on submit.
let selectedFootprintIds = [];
/// Selected category ids ("functional class") in the parametric
/// pane's class picker. Each picked category auto-expands to its
/// sub-tree on the backend, so picking a parent matches all
/// descendants. Module-level for the same reason as above.
let selectedCategoryIds = [];

/// Refresh the right-hand status label next to the category-
/// class picker button. Mirrors refreshParametricFpLabel.
function refreshParametricCatLabel() {
    const lbl = $$("pk-parametric-cat-status");
    if (!lbl) return;
    if (!selectedCategoryIds.length) {
        lbl.define("label", '<span style="color:#aaa">(none picked)</span>');
    } else {
        const flat = lookupsCache && lookupsCache.categories_tree
            ? flattenCategoryTree(lookupsCache.categories_tree)
            : [];
        const names = selectedCategoryIds
            .map((id) => {
                const m = flat.find((c) => c.id === id);
                // flattenCategoryTree pads the value with NBSPs
                // for indentation; trim for the inline label.
                return m ? (m.value || "").replace(/^[ \s]+/, "") : null;
            })
            .filter(Boolean);
        const label = (names.length <= 4 && names.join(", ").length <= 60)
            ? names.join(", ")
            : `${names.length} classes`;
        lbl.define("label", `<span>${escapeHtml(label)}</span>`);
    }
    lbl.refresh();
}

/// Shuttle popup for "functional class" picking. Same as
/// openFootprintPickerPopup but operates on PartCategory rows
/// (flattened with depth indentation). Each picked category will
/// expand to its sub-tree on the backend, so picking "Active
/// Components" includes every leaf under it.
function openCategoryPickerPopup(anchorBtn) {
    const old = $$("pk-cat-popup");
    if (old) old.destructor();

    const flat = lookupsCache && lookupsCache.categories_tree
        ? flattenCategoryTree(lookupsCache.categories_tree)
        : [];
    const allItems = flat.map((c) => ({ id: c.id, value: c.value }));
    const selectedSet = new Set(selectedCategoryIds);
    const availableData = allItems.filter((it) => !selectedSet.has(it.id));
    const selectedData  = allItems.filter((it) =>  selectedSet.has(it.id));

    function syncToModule() {
        const lst = $$("pk-cat-selected");
        if (!lst) return;
        const ids = [];
        lst.data.each((it) => { if (it && it.id) ids.push(it.id); });
        selectedCategoryIds = ids;
        refreshParametricCatLabel();
        const avail = $$("pk-cat-available");
        const aHdr = $$("pk-cat-avail-hdr");
        const sHdr = $$("pk-cat-sel-hdr");
        if (avail && aHdr) aHdr.define("label", `Available (${avail.count()})`);
        if (lst && sHdr)   sHdr.define("label", `Selected (${lst.count()})`);
        if (aHdr) aHdr.refresh();
        if (sHdr) sHdr.refresh();
    }

    function moveItem(fromListId, toListId, itemId) {
        const from = $$(fromListId);
        const to   = $$(toListId);
        if (!from || !to) return;
        const item = from.getItem(itemId);
        if (!item) return;
        from.remove(itemId);
        to.add({ id: item.id, value: item.value });
        syncToModule();
    }

    const popup = webix.ui({
        view: "popup",
        id: "pk-cat-popup",
        width: 600,
        height: 420,
        body: {
            rows: [
                {
                    cols: [
                        {
                            width: 290,
                            rows: [
                                { view: "label", id: "pk-cat-avail-hdr",
                                  label: `Available (${availableData.length})`,
                                  css: "pk-pane-title" },
                                {
                                    view: "search",
                                    placeholder: "Filter classes…",
                                    on: {
                                        onTimedKeyPress: function () {
                                            const list = $$("pk-cat-available");
                                            if (!list) return;
                                            const q = (this.getValue() || "").toLowerCase();
                                            list.filter((item) =>
                                                !q || (item.value || "").toLowerCase().indexOf(q) !== -1);
                                        },
                                    },
                                },
                                {
                                    view: "list",
                                    id: "pk-cat-available",
                                    select: false,
                                    template: "#value#",
                                    data: availableData,
                                    scroll: "y",
                                    on: {
                                        onItemClick: function (id) {
                                            moveItem("pk-cat-available", "pk-cat-selected", id);
                                        },
                                    },
                                },
                            ],
                        },
                        {
                            width: 290,
                            rows: [
                                { view: "label", id: "pk-cat-sel-hdr",
                                  label: `Selected (${selectedData.length})`,
                                  css: "pk-pane-title" },
                                { height: 36, view: "label",
                                  label: '<span class="pk-help-hint">Each pick includes all sub-classes</span>' },
                                {
                                    view: "list",
                                    id: "pk-cat-selected",
                                    select: false,
                                    template: "#value#",
                                    data: selectedData,
                                    scroll: "y",
                                    on: {
                                        onItemClick: function (id) {
                                            moveItem("pk-cat-selected", "pk-cat-available", id);
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    view: "toolbar",
                    cols: [
                        { view: "button", value: "Clear all", width: 100,
                          click: () => {
                              const sel = $$("pk-cat-selected");
                              if (!sel) return;
                              const ids = [];
                              sel.data.each((it) => { if (it && it.id) ids.push(it.id); });
                              ids.forEach((id) => moveItem("pk-cat-selected", "pk-cat-available", id));
                          } },
                        {},
                        { view: "button", value: "Done", css: "webix_primary", width: 90,
                          click: () => $$("pk-cat-popup") && $$("pk-cat-popup").hide() },
                    ],
                },
            ],
        },
    });

    if (anchorBtn && anchorBtn.$view) {
        popup.show(anchorBtn.$view);
    } else {
        popup.show();
    }
}

/// Refresh the right-hand status label next to the footprint
/// picker button. "(none picked)" / "1 footprint" / "0603, 0805".
function refreshParametricFpLabel() {
    const lbl = $$("pk-parametric-fp-status");
    if (!lbl) return;
    if (!selectedFootprintIds.length) {
        lbl.define("label", '<span style="color:#aaa">(none picked)</span>');
    } else {
        const fps = lookupsCache && lookupsCache.footprints || [];
        const names = selectedFootprintIds
            .map((id) => (fps.find((f) => f.id === id) || {}).name)
            .filter(Boolean);
        // Show names if short, else just count.
        const label = (names.length <= 4 && names.join(", ").length <= 60)
            ? names.join(", ")
            : `${names.length} footprints`;
        lbl.define("label", `<span>${escapeHtml(label)}</span>`);
    }
    lbl.refresh();
}

/// Shuttle-list (dual-list) multi-select for footprints. Left
/// pane lists "Available" (everything not yet picked, filterable);
/// right pane lists "Selected" (the OR-clause that the search
/// will use). Click on the left → moves to right. Click on right
/// → moves back to left.
///
/// Why shuttle instead of inline multi-select: makes the OR-list
/// explicit and visible at a glance. Webix Standard's `select:
/// "multiselect"` works but the visual feedback is just row
/// highlighting, which doesn't read as "OR" to the operator.
function openFootprintPickerPopup(anchorBtn) {
    const old = $$("pk-fp-popup");
    if (old) old.destructor();

    const fps = (lookupsCache && lookupsCache.footprints) || [];
    const allItems = fps.map((f) => ({ id: f.id, value: f.name }));
    const selectedSet = new Set(selectedFootprintIds);
    const availableData = allItems.filter((it) => !selectedSet.has(it.id));
    const selectedData  = allItems.filter((it) =>  selectedSet.has(it.id));

    function syncToModule() {
        const lst = $$("pk-fp-selected");
        if (!lst) return;
        const ids = [];
        lst.data.each((it) => { if (it && it.id) ids.push(it.id); });
        selectedFootprintIds = ids;
        refreshParametricFpLabel();
        // Update the count headers on each side.
        const avail = $$("pk-fp-available");
        const aHdr = $$("pk-fp-avail-hdr");
        const sHdr = $$("pk-fp-sel-hdr");
        if (avail && aHdr) aHdr.define("label", `Available (${avail.count()})`);
        if (lst && sHdr)   sHdr.define("label", `Selected (${lst.count()})`);
        if (aHdr) aHdr.refresh();
        if (sHdr) sHdr.refresh();
    }

    function moveItem(fromListId, toListId, itemId) {
        const from = $$(fromListId);
        const to   = $$(toListId);
        if (!from || !to) return;
        const item = from.getItem(itemId);
        if (!item) return;
        from.remove(itemId);
        to.add({ id: item.id, value: item.value });
        syncToModule();
    }

    const popup = webix.ui({
        view: "popup",
        id: "pk-fp-popup",
        width: 560,
        height: 380,
        body: {
            rows: [
                {
                    cols: [
                        // ── Available (left) ──
                        {
                            width: 270,
                            rows: [
                                { view: "label", id: "pk-fp-avail-hdr",
                                  label: `Available (${availableData.length})`,
                                  css: "pk-pane-title" },
                                {
                                    view: "search",
                                    id: "pk-fp-search",
                                    placeholder: "Filter…",
                                    on: {
                                        onTimedKeyPress: function () {
                                            const list = $$("pk-fp-available");
                                            if (!list) return;
                                            const q = (this.getValue() || "").toLowerCase();
                                            list.filter((item) =>
                                                !q || (item.value || "").toLowerCase().indexOf(q) !== -1);
                                        },
                                    },
                                },
                                {
                                    view: "list",
                                    id: "pk-fp-available",
                                    select: false,
                                    template: "#value#",
                                    data: availableData,
                                    scroll: "y",
                                    on: {
                                        onItemClick: function (id) {
                                            moveItem("pk-fp-available", "pk-fp-selected", id);
                                        },
                                    },
                                },
                            ],
                        },
                        // ── Selected (right) ──
                        {
                            width: 270,
                            rows: [
                                { view: "label", id: "pk-fp-sel-hdr",
                                  label: `Selected (${selectedData.length})`,
                                  css: "pk-pane-title" },
                                { height: 36, view: "label", label: '<span class="pk-help-hint">Click to remove from OR-list</span>' },
                                {
                                    view: "list",
                                    id: "pk-fp-selected",
                                    select: false,
                                    template: "#value#",
                                    data: selectedData,
                                    scroll: "y",
                                    on: {
                                        onItemClick: function (id) {
                                            moveItem("pk-fp-selected", "pk-fp-available", id);
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    view: "toolbar",
                    cols: [
                        { view: "button", value: "Clear all", width: 100,
                          click: () => {
                              // Move every selected item back to Available.
                              const sel = $$("pk-fp-selected");
                              const avail = $$("pk-fp-available");
                              if (!sel || !avail) return;
                              const ids = [];
                              sel.data.each((it) => { if (it && it.id) ids.push(it.id); });
                              ids.forEach((id) => moveItem("pk-fp-selected", "pk-fp-available", id));
                          } },
                        {},
                        { view: "button", value: "Done", css: "webix_primary", width: 90,
                          click: () => $$("pk-fp-popup") && $$("pk-fp-popup").hide() },
                    ],
                },
            ],
        },
    });

    if (anchorBtn && anchorBtn.$view) {
        popup.show(anchorBtn.$view);
    } else {
        popup.show();
    }
}

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
            // Row 1: title + create-actions. Keeps the "I want to
            // make a part" affordances visually grouped and the
            // toolbar narrow enough that the center pane can be
            // shrunk meaningfully.
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
                        id: "pk-lookup-button",
                        value: "🔎 Add via lookup",
                        css: "pk-btn-add",
                        width: 165,
                        hidden: true,  // shown only when ≥1 source is configured
                        click: () => openLookupSearchDialog(),
                    },
                    {
                        view: "button",
                        id: "pk-receive-button",
                        value: "📦 Receive Order",
                        css: "pk-btn-add",
                        width: 165,
                        hidden: true,  // shown only when ≥1 source has order_status_available
                        // Default: pick the only-configured source if exactly
                        // one is enabled, else "digikey" (richer data, larger
                        // catalog). The dialog itself has a source picker
                        // when ≥2 sources are available.
                        click: () => openOrderReceiveDialog(defaultReceiveSource()),
                    },
                    {
                        view: "button",
                        value: "⎘ Duplicate",
                        css: "webix_primary",
                        width: 130,
                        click: () => openPartEditor("duplicate"),
                    },
                ],
            },
            // Row 2: view toggles + filters + search. Lets the
            // operator narrow the center pane without losing
            // any controls.
            {
                view: "toolbar",
                css: "pk-pane-toolbar",
                height: 40,
                cols: [
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
                        view: "button",
                        id: "pk-presets-button",
                        value: "★ Presets ▾",
                        width: 110,
                        click: function () { openPresetsMenu(this); },
                    },
                    {
                        view: "toggle",
                        id: "pk-parametric-toggle",
                        type: "iconButton",
                        label: "▾ Parametric",
                        offLabel: "▸ Parametric",
                        width: 115,
                        on: {
                            onChange: function (newVal) {
                                const pane = $$("pk-parametric-pane");
                                if (!pane) return;
                                if (newVal) {
                                    pane.show();
                                    // Populate parameter-name combo + SI prefix /
                                    // unit options + footprint multi-select. No-op
                                    // if already loaded.
                                    ensureParametricLookupsReady();
                                } else {
                                    pane.hide();
                                }
                            },
                        },
                    },
                    {},
                    {
                        view: "search",
                        id: "pk-search",
                        placeholder: "Search name / description / IPN…",
                        width: 320,
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
                id: "pk-parametric-pane",
                css: "pk-filters-pane",
                hidden: true,
                rows: [
                    // Category (functional class) filter row —
                    // multi-select with sub-tree expansion. Picks
                    // are OR'd; each pick auto-includes every
                    // descendant so picking "Active Components"
                    // matches everything under it. Same shuttle
                    // UX as the footprint picker below.
                    {
                        view: "toolbar",
                        css: "pk-pane-toolbar",
                        height: 38,
                        cols: [
                            {
                                view: "checkbox",
                                id: "pk-parametric-cat-toggle",
                                label: "",
                                labelRight: "Class",
                                labelWidth: 0,
                                width: 110,
                                on: {
                                    onChange: function (newVal) {
                                        const btn = $$("pk-parametric-cat-button");
                                        if (!btn) return;
                                        if (newVal) {
                                            btn.enable();
                                        } else {
                                            btn.disable();
                                            selectedCategoryIds = [];
                                            refreshParametricCatLabel();
                                        }
                                    },
                                },
                            },
                            {
                                view: "button",
                                id: "pk-parametric-cat-button",
                                value: "Pick classes…",
                                width: 200,
                                disabled: true,
                                click: function () { openCategoryPickerPopup(this); },
                            },
                            {
                                view: "label",
                                id: "pk-parametric-cat-status",
                                label: "",
                                css: "pk-help-hint",
                            },
                        ],
                    },
                    // Footprint filter row — multi-select, gated by
                    // a checkbox. Webix Standard (GPL) doesn't ship
                    // `multicombo` (Pro-only), so we use a button
                    // that opens a popup with a `list` in
                    // multiselect mode, which IS in GPL. Status
                    // label shows the current pick count.
                    {
                        view: "toolbar",
                        css: "pk-pane-toolbar",
                        height: 38,
                        cols: [
                            {
                                view: "checkbox",
                                id: "pk-parametric-fp-toggle",
                                label: "",
                                labelRight: "Footprint",
                                labelWidth: 0,
                                width: 110,
                                on: {
                                    onChange: function (newVal) {
                                        const btn = $$("pk-parametric-fp-button");
                                        if (!btn) return;
                                        if (newVal) {
                                            btn.enable();
                                        } else {
                                            btn.disable();
                                            selectedFootprintIds = [];
                                            refreshParametricFpLabel();
                                        }
                                    },
                                },
                            },
                            {
                                view: "button",
                                id: "pk-parametric-fp-button",
                                value: "Pick footprints…",
                                width: 200,
                                disabled: true,
                                click: function () { openFootprintPickerPopup(this); },
                            },
                            {
                                view: "label",
                                id: "pk-parametric-fp-status",
                                label: "",
                                css: "pk-help-hint",
                            },
                        ],
                    },
                    {
                        view: "toolbar",
                        css: "pk-pane-toolbar",
                        height: 32,
                        cols: [
                            { view: "label", label: "Parameter predicates (AND-combined)", css: "pk-pane-title" },
                            {},
                            { view: "button", value: "+ Add predicate", css: "pk-btn-add", width: 130, click: addParametricPredicate },
                            { view: "button", value: "− Remove", css: "pk-btn-remove", width: 90, click: removeParametricPredicate },
                        ],
                    },
                    {
                        view: "datatable",
                        id: "pk-parametric-grid",
                        css: "pk-grid",
                        height: 180,
                        editable: true,
                        // Single click both edits AND selects (the
                        // onBeforeEditStart hook below ensures the
                        // row is selected so − Remove sees it).
                        editaction: "click",
                        select: "row",
                        on: {
                            onBeforeEditStart: function (state) {
                                if (state && state.row) this.select(state.row);
                            },
                        },
                        columns: [
                            {
                                id: "name",
                                header: "Parameter",
                                width: 200,
                                editor: "combo",
                                options: [],  // populated lazily
                            },
                            {
                                id: "op",
                                header: "Op",
                                width: 70,
                                editor: "richselect",
                                options: [
                                    { id: "=", value: "=" },
                                    { id: "!=", value: "≠" },
                                    { id: "<", value: "<" },
                                    { id: "<=", value: "≤" },
                                    { id: ">", value: ">" },
                                    { id: ">=", value: "≥" },
                                    { id: "like", value: "like" },
                                ],
                            },
                            {
                                id: "value_type",
                                header: "Type",
                                width: 90,
                                editor: "richselect",
                                options: [
                                    { id: "numeric", value: "numeric" },
                                    { id: "string", value: "string" },
                                ],
                            },
                            { id: "value", header: "Value", width: 100, editor: "text", css: "pk-numeric" },
                            {
                                id: "si_prefix_id",
                                header: "Prefix",
                                width: 100,
                                editor: "richselect",
                                options: [],  // populated by ensureParametricLookupsReady
                                template: function (o) {
                                    if (!o.si_prefix_id || !lookupsCache) return "";
                                    const p = (lookupsCache.prefixes || []).find((x) => String(x.id) === String(o.si_prefix_id));
                                    return p ? escapeHtml(p.symbol) : "";
                                },
                            },
                            {
                                id: "unit_id",
                                header: "Unit",
                                width: 130,
                                editor: "richselect",
                                options: [],
                                template: function (o) {
                                    if (!o.unit_id || !lookupsCache) return "";
                                    const u = (lookupsCache.units || []).find((x) => String(x.id) === String(o.unit_id));
                                    return u ? escapeHtml(u.name + " (" + u.symbol + ")") : "";
                                },
                            },
                            { id: "string_value", header: "String value", fillspace: true, editor: "text" },
                        ],
                        data: [],
                    },
                    {
                        view: "toolbar",
                        css: "pk-pane-toolbar",
                        height: 38,
                        cols: [
                            { view: "label", label: '<span class="pk-help-hint">Numeric: fill Value + Prefix + Unit · String: use String value</span>' },
                            {},
                            { view: "button", value: "Apply parametric", css: "webix_primary", width: 150, click: applyParametricSearch },
                            { view: "button", value: "Reset", width: 90, click: resetParametricSearch },
                        ],
                    },
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
                {
                    kind: "prefix_checkboxes",
                    name: "allowed_prefix_ids",
                    label: "SI prefixes allowed",
                },
            ],
            seed: existing || { name: "", symbol: "", allowed_prefix_ids: [] },
            serialize: (v) => ({
                name: v.name.trim(),
                symbol: (v.symbol || "").trim(),
                // The prefix_checkboxes field contributes one
                // _pfx_<id>:bool key per prefix; collect the truthy
                // ones back into the array shape the API expects.
                allowed_prefix_ids: Object.keys(v)
                    .filter((k) => k.startsWith("_pfx_") && !!v[k])
                    .map((k) => parseInt(k.slice(5), 10))
                    .filter((n) => !isNaN(n)),
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
                { view: "button", value: "🔀 Merge into…", width: 130, click: openLookupMergeDialog },
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

async function openLookupAdd() {
    if (!currentLookupType) return;
    if (currentLookupType === "manufacturers") {
        openManufacturerEditor("new", null);
        return;
    }
    // Units' edit dialog includes a prefix-checkbox grid that reads
    // from lookupsCache.prefixes — guarantee it's loaded.
    await ensureLookups();
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
            lookupsCache = null;  // any cross-screen list (units, prefixes, etc.) is now stale
            await showLookupType(currentLookupType);
        },
    });
}

async function openLookupEdit() {
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
    await ensureLookups();
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
            lookupsCache = null;
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

/// Build a friendly display label for a lookup row regardless of
/// type (manufacturers/distributors/units use `name`, si_prefixes
/// uses `prefix`, fall back to `#id`).
function lookupRowLabel(row) {
    if (!row) return "?";
    if (row.name) return row.name;
    if (row.prefix) return row.prefix + (row.symbol ? ` (${row.symbol})` : "");
    return `#${row.id}`;
}

/// Slice 5d — open the merge-into dialog. Source is the currently-
/// selected row; target is picked from the same lookup type's other
/// rows. On confirm: backend reassigns all FK references in one
/// transaction and deletes the source.
async function openLookupMergeDialog() {
    if (!currentLookupType) return;
    const sel = getSelectedLookupRow();
    if (!sel) {
        webix.message({ type: "error", text: "Select a row to merge." });
        return;
    }
    const cfg = LOOKUP_TYPES[currentLookupType];

    // Re-fetch the full list so we always pick from current data
    // (the grid may show a stale snapshot if the user just
    // edited something in another tab).
    let rows;
    try {
        rows = await api.lookupList(cfg.url);
    } catch (e) {
        webix.message({ type: "error", text: "Failed to load list: " + (e.message || e) });
        return;
    }
    const targets = rows
        .filter((r) => r.id !== sel.id)
        .map((r) => ({ id: r.id, value: lookupRowLabel(r) }))
        .sort((a, b) => a.value.localeCompare(b.value));
    if (targets.length === 0) {
        webix.message({ type: "error", text: "No other rows to merge into." });
        return;
    }

    const sourceLabel = lookupRowLabel(sel);

    webix.ui({
        view: "window",
        id: "pk-lookup-merge",
        modal: true,
        position: "center",
        width: 520,
        head: `Merge "${sourceLabel}" into…`,
        body: {
            rows: [
                {
                    view: "template",
                    height: 80,
                    borderless: true,
                    css: "pk-dialog-hint",
                    template: `<div style="padding:10px 14px;line-height:1.5">` +
                        `All references to <b>${escapeHtml(sourceLabel)}</b> ` +
                        `will be reassigned to the target you choose, then ` +
                        `<b>${escapeHtml(sourceLabel)}</b> will be deleted.<br>` +
                        `<span style="color:#b03030">This cannot be undone.</span>` +
                        `</div>`,
                },
                {
                    view: "form",
                    id: "pk-lookup-merge-form",
                    elements: [
                        {
                            view: "richselect",
                            name: "target_id",
                            label: "Target",
                            labelWidth: 80,
                            options: targets,
                        },
                    ],
                },
                {
                    view: "toolbar",
                    css: "pk-dialog-actions",
                    height: 50,
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 100,
                          click: () => $$("pk-lookup-merge").close() },
                        {
                            view: "button",
                            value: "Merge",
                            width: 110,
                            css: "pk-btn-remove",
                            hotkey: "ctrl+s",
                            click: async function () {
                                const v = $$("pk-lookup-merge-form").getValues();
                                const targetId = parseInt(v.target_id, 10);
                                if (!targetId) {
                                    webix.message({ type: "error", text: "Pick a target." });
                                    return;
                                }
                                try {
                                    const resp = await api.lookupMerge(cfg.url, sel.id, targetId);
                                    $$("pk-lookup-merge").close();
                                    // lookupsCache is now stale (units, prefixes
                                    // counts may have shifted; ids are gone).
                                    lookupsCache = null;
                                    await showLookupType(currentLookupType);
                                    const moved = (resp && resp.moved) || {};
                                    const summary = Object.entries(moved)
                                        .filter(([, n]) => n > 0)
                                        .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`)
                                        .join(", ");
                                    const msg = summary
                                        ? `Merged: moved ${summary}.`
                                        : `Merged (no references to move).`;
                                    webix.message({ type: "success", text: msg });
                                } catch (e) {
                                    webix.message({ type: "error", text: "Merge failed: " + (e.message || e) });
                                }
                            },
                        },
                    ],
                },
            ],
        },
    }).show();
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
    // Some fields (prefix_checkboxes) expand into multiple form
    // elements rather than one, so flatMap, not map.
    const formElements = opts.fields.flatMap((f) => {
        if (f.kind === "text") return [{ view: "text", name: f.name, label: f.label, labelWidth: 140, required: !!f.required }];
        if (f.kind === "textarea") return [{ view: "textarea", name: f.name, label: f.label, labelWidth: 140, height: f.height || 60 }];
        if (f.kind === "checkbox") return [{ view: "checkbox", name: f.name, labelRight: f.labelRight || f.label, labelWidth: 140 }];
        if (f.kind === "counter") {
            const c = { view: "counter", name: f.name, label: f.label, labelWidth: 140, step: f.step || 1 };
            if (f.min !== undefined) c.min = f.min;
            if (f.max !== undefined) c.max = f.max;
            return [c];
        }
        if (f.kind === "prefix_checkboxes") {
            // Render the full SI prefix list as a two-column grid
            // of named checkboxes (`_pfx_<id>`). lookupsCache is
            // guaranteed loaded by openLookupAdd/openLookupEdit.
            const pfxs = ((lookupsCache && lookupsCache.prefixes) || [])
                .slice()
                .sort((a, b) => a.exponent - b.exponent);
            if (pfxs.length === 0) {
                return [{ template: "(no SI prefixes defined)", borderless: true, height: 24, css: "pk-help-hint" }];
            }
            const renderRow = (p) => {
                const sym = escapeHtml(p.symbol || "");
                const pre = escapeHtml(p.prefix || "");
                const exp = `${p.base}<sup>${p.exponent}</sup>`;
                return {
                    view: "checkbox",
                    name: "_pfx_" + p.id,
                    labelRight: `${sym} ${pre} (${exp})`,
                    labelWidth: 0,
                    height: 24,
                };
            };
            const half = Math.ceil(pfxs.length / 2);
            const left = pfxs.slice(0, half).map(renderRow);
            const right = pfxs.slice(half).map(renderRow);
            return [
                {
                    view: "template",
                    template: `<div class="pk-detail-section-title">${escapeHtml(f.label)}</div>`,
                    height: 24,
                    borderless: true,
                },
                {
                    cols: [
                        { rows: left },
                        { rows: right },
                    ],
                },
            ];
        }
        return [{ view: "text", name: f.name, label: f.label, labelWidth: 140 }];
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
    // Some kinds expand a single seed key into many form fields —
    // do that translation here so individual buildEdit configs
    // don't have to know.
    const expandedSeed = Object.assign({}, opts.seed);
    for (const f of opts.fields) {
        if (f.kind === "prefix_checkboxes") {
            const ids = (expandedSeed[f.name] || []).map(Number);
            for (const id of ids) expandedSeed["_pfx_" + id] = 1;
            delete expandedSeed[f.name];
        }
    }

    // Default size is fine for most lookups; bump for the unit
    // editor's prefix grid.
    const hasPrefixGrid = opts.fields.some((f) => f.kind === "prefix_checkboxes");
    const winHeight = hasPrefixGrid ? 560 : null;

    webix.ui({
        view: "window",
        id: "pk-lookup-edit",
        modal: true,
        position: "center",
        width: 520,
        ...(winHeight ? { height: winHeight } : {}),
        head: opts.title,
        body: { view: "form", id: "pk-lookup-edit-form", elements: formElements },
    }).show();
    $$("pk-lookup-edit-form").setValues(expandedSeed);
}

async function loadParts(opts) {
    opts = opts || {};
    if ("filter" in opts) currentParts.filter = opts.filter;
    if ("search" in opts) currentParts.search = opts.search;
    if ("byField" in opts) currentParts.byField = opts.byField;
    if ("predicates" in opts) currentParts.predicates = opts.predicates;
    if ("footprint_ids" in opts) currentParts.footprint_ids = opts.footprint_ids;
    if ("category_ids" in opts) currentParts.category_ids = opts.category_ids;
    try {
        const json = await api.parts({
            filter: currentParts.filter,
            search: currentParts.search,
            byField: currentParts.byField,
            predicates: currentParts.predicates,
            footprint_ids: currentParts.footprint_ids,
            category_ids: currentParts.category_ids,
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
        if (currentParts.predicates && currentParts.predicates.length) {
            fbits.push(`${currentParts.predicates.length} predicate${currentParts.predicates.length === 1 ? "" : "s"}`);
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
                                value: "🖨 Label",
                                width: 100,
                                click: () => openLabelDialog({
                                    template: "Part",
                                    id: currentPart && currentPart.id,
                                    name: currentPart && currentPart.name,
                                    internal_part_number: currentPart && currentPart.internal_part_number,
                                }),
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
        const [part, projects, runs, receipts] = await Promise.all([
            api.part(id),
            api.partProjects(id).catch(() => []),
            api.partRuns(id).catch(() => []),
            api.partReceipts(id).catch(() => []),
        ]);
        currentPart = part;
        $$("pk-detail").setHTML(renderPartDetailHtml(part, projects, runs, receipts));
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
            // Per-row Consume buttons in the Packaging section.
            root.querySelectorAll('button.pk-consume-btn[data-psl-id]').forEach((btn) => {
                btn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    const pslId = parseInt(btn.dataset.pslId, 10);
                    const row = (currentPart.locations || []).find((l) => l.id === pslId);
                    if (row) openConsumeContainerDialog(currentPart, row);
                });
            });
        }
    } catch (e) {
        console.error(e);
        webix.message({ type: "error", text: "Failed to load part detail" });
    }
}

// ============================================================
//  Parts grid column persistence (W8c) + named GridPresets (W8c.X)
//
//  Two layers cooperate:
//    1. localStorage holds the current "last seen" layout per
//       user. Saved on every reorder/resize/hide/show. Restored on
//       mount so reload is invisible.
//    2. GridPreset rows on the server hold *named* shared layouts.
//       Anyone logged in can save/edit/delete; one row per grid
//       can be marked default. On a fresh session (no localStorage
//       yet) the default preset, if any, is applied.
//
//  PARTS_GRID = "parts" is the grid slug. Future grids reuse the
//  same backend by passing their own slug.
// ============================================================

const PARTS_GRID = "parts";

function partsGridStorageKey() {
    const u = currentUser ? currentUser.username : "anon";
    return `pk:parts-grid-state:${u}`;
}

// Captured once on first mount so 'Reset layout' has a known target
// to revert to. Cleared on logout.
let _partsGridDefaultState = null;

// Cache of /api/grid_presets?grid=<slug> results, keyed by slug.
// Refreshed after every mutation.
let gridPresetsCache = {};

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

async function restorePartsGridState() {
    const grid = $$("pk-parts-grid");
    if (!grid) return;
    // Capture pristine defaults on first call so Reset can use them.
    if (_partsGridDefaultState == null) {
        try { _partsGridDefaultState = grid.getState(); } catch (_) {}
    }
    // localStorage takes precedence. If present, that's the answer.
    try {
        const raw = localStorage.getItem(partsGridStorageKey());
        if (raw) {
            grid.setState(JSON.parse(raw));
            return;
        }
    } catch (e) {
        console.warn("restorePartsGridState (localStorage) failed:", e);
    }
    // No local state — try the server's default preset (if any).
    try {
        const presets = await loadGridPresets(PARTS_GRID);
        const def = presets.find((p) => p.grid_default);
        if (def) {
            applyGridPreset(def, /*persist=*/ true);
        }
    } catch (e) {
        console.warn("restorePartsGridState (default preset) failed:", e);
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

// ----- GridPreset CRUD glue -----

async function loadGridPresets(grid, force = false) {
    if (!force && gridPresetsCache[grid]) return gridPresetsCache[grid];
    const list = await api.listGridPresets(grid);
    gridPresetsCache[grid] = list;
    return list;
}

function applyGridPreset(preset, persist = true) {
    const grid = $$("pk-parts-grid");
    if (!grid) return;
    try {
        grid.setState(JSON.parse(preset.configuration));
    } catch (e) {
        console.error("apply preset failed:", e);
        webix.message({ type: "error", text: "Could not apply preset (bad configuration)" });
        return;
    }
    // The preset's layout becomes the user's current layout. Save it
    // through to localStorage so reloads stick.
    if (persist) savePartsGridState();
}

function openPresetsMenu(toolbarButton) {
    loadGridPresets(PARTS_GRID, /*force=*/ true)
        .then((presets) => {
            // Close a previously-opened menu before building a new
            // one — otherwise the duplicate id throws.
            const old = $$("pk-presets-popup");
            if (old) old.destructor();

            const data = [];
            if (presets.length === 0) {
                data.push({ id: "_empty", value: "(no saved presets)", $css: "pk-help-hint" });
            } else {
                for (const p of presets) {
                    const star = p.grid_default ? "★ " : "&nbsp;&nbsp;";
                    data.push({
                        id: "apply:" + p.id,
                        value: star + " " + escapeHtml(p.name),
                    });
                }
            }
            data.push({ $template: "Separator" });
            data.push({ id: "save", value: "+ Save current as preset…" });
            data.push({ id: "manage", value: "✎ Manage presets…" });

            const menu = webix.ui({
                view: "contextmenu",
                id: "pk-presets-popup",
                width: 240,
                autoheight: true,
                data: data,
                on: {
                    onMenuItemClick: function (id) {
                        if (id === "_empty") return;
                        if (id === "save") { openSavePresetDialog(PARTS_GRID); return; }
                        if (id === "manage") { openManagePresetsDialog(PARTS_GRID); return; }
                        if (typeof id === "string" && id.startsWith("apply:")) {
                            const pid = parseInt(id.slice(6), 10);
                            const found = (gridPresetsCache[PARTS_GRID] || [])
                                .find((p) => p.id === pid);
                            if (found) {
                                applyGridPreset(found, true);
                                webix.message({ type: "success", text: `Preset "${found.name}" applied` });
                            }
                        }
                    },
                },
            });
            // Position below the toolbar button.
            const node = toolbarButton && toolbarButton.$view;
            if (node) {
                const r = node.getBoundingClientRect();
                menu.show({ x: r.left, y: r.bottom });
            } else {
                menu.show();
            }
        })
        .catch((e) => {
            console.error("openPresetsMenu:", e);
            webix.message({ type: "error", text: "Failed to load presets: " + (e && e.message ? e.message : String(e)) });
        });
}

function openSavePresetDialog(grid) {
    webix.ui({
        view: "window",
        id: "pk-save-preset-dialog",
        modal: true,
        position: "center",
        width: 380,
        head: "Save preset",
        body: {
            rows: [
                {
                    view: "form",
                    id: "pk-save-preset-form",
                    elements: [
                        { view: "text", name: "name", label: "Name", labelWidth: 90,
                          placeholder: "e.g. Engineering, Procurement…" },
                        { view: "checkbox", name: "grid_default", labelRight: "Make default for this grid",
                          labelWidth: 0, label: "" },
                    ],
                },
                {
                    view: "toolbar",
                    css: "pk-dialog-actions",
                    height: 48,
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 90,
                          click: () => $$("pk-save-preset-dialog").close() },
                        { view: "button", value: "Save", width: 90, css: "webix_primary",
                          click: async function () {
                              const v = $$("pk-save-preset-form").getValues();
                              const name = (v.name || "").trim();
                              if (!name) {
                                  webix.message({ type: "error", text: "Name is required" });
                                  return;
                              }
                              const ds = $$("pk-parts-grid");
                              if (!ds) return;
                              const config = JSON.stringify(ds.getState());
                              try {
                                  await api.createGridPreset({
                                      grid, name, configuration: config,
                                      grid_default: !!v.grid_default,
                                  });
                                  gridPresetsCache[grid] = null;
                                  $$("pk-save-preset-dialog").close();
                                  webix.message({ type: "success", text: `Preset "${name}" saved` });
                              } catch (e) {
                                  console.error(e);
                                  webix.message({ type: "error", text: String(e.message || e) });
                              }
                          } },
                    ],
                },
            ],
        },
    }).show();
    setTimeout(() => {
        const f = $$("pk-save-preset-form");
        if (f) f.setValues({ name: "", grid_default: 0 });
    }, 0);
}

function openManagePresetsDialog(grid) {
    loadGridPresets(grid, true).then((presets) => {
        webix.ui({
            view: "window",
            id: "pk-manage-presets-dialog",
            modal: true,
            position: "center",
            width: 600,
            height: 400,
            head: "Manage presets",
            body: {
                rows: [
                    {
                        view: "datatable",
                        id: "pk-manage-presets-grid",
                        data: presets,
                        select: "row",
                        columns: [
                            { id: "name", header: "Name", fillspace: true },
                            {
                                id: "grid_default", header: "Default", width: 80,
                                template: function (o) {
                                    return `<input type="checkbox" data-default="${o.id}" ${o.grid_default ? "checked" : ""}>`;
                                },
                            },
                            {
                                id: "_overwrite", header: "Overwrite", width: 110,
                                template: function (o) {
                                    return `<button class="pk-link-btn" data-overwrite="${o.id}">Replace with current</button>`;
                                },
                            },
                            {
                                id: "_delete", header: "", width: 80,
                                template: function (o) {
                                    return `<button class="pk-link-btn" data-delete="${o.id}" style="color:#b03030">Delete</button>`;
                                },
                            },
                        ],
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 48,
                        cols: [
                            {},
                            { view: "button", value: "Close", width: 90, css: "webix_primary",
                              click: () => $$("pk-manage-presets-dialog").close() },
                        ],
                    },
                ],
            },
        }).show();

        // Wire row-action click handlers after the datatable mounts.
        setTimeout(() => {
            const dt = $$("pk-manage-presets-grid");
            if (!dt || !dt.$view) return;
            dt.$view.addEventListener("click", async (ev) => {
                const t = ev.target;
                if (!t) return;
                const dId = t.dataset.delete && parseInt(t.dataset.delete, 10);
                const oId = t.dataset.overwrite && parseInt(t.dataset.overwrite, 10);
                const defId = t.dataset.default && parseInt(t.dataset.default, 10);

                if (dId) {
                    const row = dt.getItem(dId);
                    if (!row) return;
                    webix.confirm({
                        title: "Delete preset",
                        text: `Delete preset "${escapeHtml(row.name)}"?`,
                        ok: "Delete",
                        cancel: "Cancel",
                    }).then(async () => {
                        try {
                            await api.deleteGridPreset(dId);
                            dt.remove(dId);
                            gridPresetsCache[grid] = null;
                            webix.message({ type: "success", text: "Preset deleted" });
                        } catch (e) {
                            webix.message({ type: "error", text: String(e.message || e) });
                        }
                    });
                } else if (oId) {
                    const row = dt.getItem(oId);
                    if (!row) return;
                    const ds = $$("pk-parts-grid");
                    if (!ds) return;
                    try {
                        const config = JSON.stringify(ds.getState());
                        await api.updateGridPreset(oId, {
                            grid, name: row.name, configuration: config,
                            grid_default: !!row.grid_default,
                        });
                        row.configuration = config;
                        gridPresetsCache[grid] = null;
                        webix.message({ type: "success", text: `Preset "${row.name}" updated` });
                    } catch (e) {
                        webix.message({ type: "error", text: String(e.message || e) });
                    }
                } else if (defId) {
                    const row = dt.getItem(defId);
                    if (!row) return;
                    const newDefault = !!t.checked;
                    try {
                        await api.updateGridPreset(defId, {
                            grid, name: row.name, configuration: row.configuration,
                            grid_default: newDefault,
                        });
                        // If we set a new default, every other row in
                        // the table loses its checkmark — patch the
                        // local data to match the server's transaction.
                        if (newDefault) {
                            dt.data.each((r) => { if (r.id !== defId) r.grid_default = false; });
                        }
                        row.grid_default = newDefault;
                        dt.refresh();
                        gridPresetsCache[grid] = null;
                    } catch (e) {
                        // Roll the checkbox back on failure.
                        t.checked = !newDefault;
                        webix.message({ type: "error", text: String(e.message || e) });
                    }
                }
            });
        }, 0);
    }).catch((e) => {
        console.error(e);
        webix.message({ type: "error", text: "Failed to load presets" });
    });
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

// ============================================================
//  Parametric search pane (W9)
// ============================================================

let parametricLookupsReady = false;

async function ensureParametricLookupsReady() {
    if (parametricLookupsReady) return;
    try {
        const [names, lk] = await Promise.all([
            api.parametricNames(),
            ensureLookups(),
        ]);
        const grid = $$("pk-parametric-grid");
        if (!grid) return;

        // Param-name combo: option id = the parameter name string,
        // value = same. No custom body template — would render HTML
        // into the cell value when an option is picked.
        grid.getColumnConfig("name").options = names.map((n) => ({ id: n.name, value: n.name }));

        const prefOptions = [{ id: "", value: "(none)" }].concat(
            lk.prefixes.map((p) => ({ id: p.id, value: p.symbol + " — " + p.prefix }))
        );
        const unitOptions = [{ id: "", value: "(none)" }].concat(
            lk.units.map((u) => ({ id: u.id, value: u.name + " (" + u.symbol + ")" }))
        );
        grid.getColumnConfig("si_prefix_id").options = prefOptions;
        grid.getColumnConfig("unit_id").options = unitOptions;
        grid.refreshColumns();

        // Footprint + class picker label initialization. The
        // popups build their data from lookupsCache on demand,
        // so nothing to seed here beyond rendering "(none picked)".
        refreshParametricFpLabel();
        refreshParametricCatLabel();

        parametricLookupsReady = true;
    } catch (e) {
        console.error(e);
        webix.message({ type: "error", text: "Failed to load parameter names" });
    }
}

async function addParametricPredicate() {
    await ensureParametricLookupsReady();
    const grid = $$("pk-parametric-grid");
    if (!grid) return;
    const row = { id: webix.uid(), name: "", op: "=", value_type: "numeric", value: "", string_value: "", si_prefix_id: null, unit_id: null };
    grid.add(row);
    grid.select(row.id);
    grid.editCell(row.id, "name");
}

function removeParametricPredicate() {
    const grid = $$("pk-parametric-grid");
    if (!grid) return;
    const sel = grid.getSelectedId();
    if (!sel) {
        webix.message({ type: "error", text: "Select a predicate row." });
        return;
    }
    grid.remove(sel);
}

function applyParametricSearch() {
    const grid = $$("pk-parametric-grid");
    if (!grid) return;

    // Footprint multi-select: collected only when the toggle is on.
    // selectedFootprintIds is a module-level array maintained by
    // the popup picker (openFootprintPickerPopup).
    const fpToggle = $$("pk-parametric-fp-toggle");
    const footprintIds = (fpToggle && fpToggle.getValue())
        ? selectedFootprintIds.slice()
        : [];
    // Class (category) multi-select: same shape, separate state.
    const catToggle = $$("pk-parametric-cat-toggle");
    const categoryIds = (catToggle && catToggle.getValue())
        ? selectedCategoryIds.slice()
        : [];

    const rows = grid.serialize().filter((r) => (r.name || "").trim() && r.op);
    if (!rows.length && footprintIds.length === 0 && categoryIds.length === 0) {
        webix.message({ type: "error", text: "Add at least one predicate row, or pick a class / footprint." });
        return;
    }
    const predicates = rows.map((r) => {
        const isNumeric = r.value_type !== "string";
        const p = {
            name: r.name.trim(),
            op: r.op,
            value_type: isNumeric ? "numeric" : "string",
        };
        if (isNumeric) {
            if (r.value !== "" && r.value != null) p.value = parseFloat(r.value);
            if (r.si_prefix_id) p.si_prefix_id = parseInt(r.si_prefix_id, 10);
            if (r.unit_id) p.unit_id = parseInt(r.unit_id, 10);
        } else {
            if (r.string_value) p.string_value = r.string_value;
        }
        return p;
    });
    loadParts({ predicates, footprint_ids: footprintIds, category_ids: categoryIds });
}

function resetParametricSearch() {
    const grid = $$("pk-parametric-grid");
    if (grid) grid.clearAll();
    const fpToggle  = $$("pk-parametric-fp-toggle");
    const fpBtn     = $$("pk-parametric-fp-button");
    const catToggle = $$("pk-parametric-cat-toggle");
    const catBtn    = $$("pk-parametric-cat-button");
    if (fpToggle)  fpToggle.setValue(0);
    if (fpBtn)     fpBtn.disable();
    if (catToggle) catToggle.setValue(0);
    if (catBtn)    catBtn.disable();
    selectedFootprintIds = [];
    selectedCategoryIds = [];
    refreshParametricFpLabel();
    refreshParametricCatLabel();
    loadParts({ predicates: [], footprint_ids: [], category_ids: [] });
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

function renderPartDetailHtml(p, projects, runs, receipts) {
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

    // Multi-location breakdown (descriptive). Hidden when the
    // operator hasn't broken this part out — keeps the panel
    // clean for ordinary single-bin parts.
    if (p.locations && p.locations.length) {
        const sum = p.locations.reduce((acc, l) => acc + (l.quantity || 0), 0);
        const driftHtml = sum === p.stock_level
            ? `<span class="pk-stock-add">matches stock level</span>`
            : `<span class="pk-stock-remove">⚠ stock level = ${p.stock_level} (off by ${sum - p.stock_level >= 0 ? "+" : ""}${sum - p.stock_level})</span>`;
        const rows = p.locations.map(l => {
            const consumeBtn = (l.quantity || 0) > 0
                ? `<button class="pk-btn-remove pk-consume-btn" data-psl-id="${l.id}" title="Consume from this packaging">🔻</button>`
                : `<span class="pk-help-hint">empty</span>`;
            return `<tr>
                <td>${escapeHtml(l.form)}</td>
                <td class="pk-numeric">${l.quantity}</td>
                <td>${escapeHtml(l.storage_location_name || "")}</td>
                <td>${consumeBtn}</td>
            </tr>`;
        }).join("");
        const footer = `<tr style="font-weight:600;background:#f3f5f7">
            <td style="text-align:right">Total:</td>
            <td class="pk-numeric">${sum}</td>
            <td>${driftHtml}</td>
            <td></td>
        </tr>`;
        sections.push(detailSectionHtml(`Packaging (${p.locations.length})`,
            `<table class="pk-detail-table">
                <thead><tr>
                    <th>Form</th>
                    <th class="pk-numeric">Qty</th>
                    <th>Where</th>
                    <th></th>
                </tr></thead>
                <tbody>${rows}${footer}</tbody>
            </table>`));
    }

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

    // Distributor-attributed receipts.
    // One row per (distributor, sales order #); useful for stock
    // age and "which order is this batch from" tracking.
    if (receipts && receipts.length) {
        const rows = receipts.map((rcp) => {
            const date = (rcp.last_date || "").substring(0, 10);
            const cur = rcp.currency || "";
            const price = rcp.avg_unit_price ? `${rcp.avg_unit_price} ${cur}` : "";
            const partial = (rcp.entry_count > 1) ? ` <span class="pk-help-hint">(${rcp.entry_count} entries)</span>` : "";
            return `<tr>
                <td>${escapeHtml(rcp.distributor_name || "")}</td>
                <td>${escapeHtml(rcp.sales_order_number || "")}${partial}</td>
                <td class="pk-numeric">+${rcp.units_added}</td>
                <td class="pk-numeric">${escapeHtml(price)}</td>
                <td>${escapeHtml(date)}</td>
            </tr>`;
        }).join("");
        sections.push(detailSectionHtml(`Receipts by sales order (${receipts.length})`,
            `<table class="pk-detail-table"><thead><tr><th>Distributor</th><th>SO #</th><th>Units</th><th>Unit price</th><th>Last received</th></tr></thead><tbody>${rows}</tbody></table>`));
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
    function walk(nodes, depth) {
        // Sort siblings alphabetically (case-insensitive); preserves
        // hierarchy while making it easier to find a category by
        // name in long lists.
        const sorted = nodes.slice().sort((a, b) =>
            (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
        );
        for (const n of sorted) {
            // value = bare name (drives closed-selector display);
            // depth = drives indent in the open list via the
            // dropdown body template (see categoryOptionTemplate).
            out.push({ id: n.id, value: n.name, depth: depth });
            if (n.children && n.children.length) walk(n.children, depth + 1);
        }
    }
    walk(tree, 0);
    return out;
}

/// Body template for richselect dropdowns whose options came from
/// `flattenCategoryTree`. Emits `&nbsp;` entities for indent —
/// HTML entities survive Webix's whitespace handling, where
/// regular spaces and even raw U+00A0 don't reliably make it
/// through to the rendered output. Four NBSPs per depth level.
function categoryOptionTemplate(o) {
    const depth = o && o.depth ? o.depth : 0;
    const indent = new Array(depth + 1).join("&nbsp;&nbsp;&nbsp;&nbsp;");
    return indent + escapeHtml(o.value || "");
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

/// Live-recompute the Locations tab status label: "Total: N" with
/// a colored chip when the sum drifts from Part.stockLevel. Called
/// on every onAfterEditStop / onAfterAdd / row removal.
/// "Split / move" dialog for the part editor's Containers tab.
/// Pulls N pcs out of the selected row and inserts a new row with
/// the chosen Form / Storage / Lot. Net stock unchanged — this is
/// a re-labeling, not a stock event. Operator's typical workflow:
///   - "100 pcs show as loose but they're actually on a reel"
///     → split N=100 from Loose row into a new Reel row.
///   - "1200 pcs total, just moved 1000 onto a reel"
///     → split N=1000 from the Loose row, leaving 200 behind.
/// Saves on the part editor's Save button (we don't write to the
/// DB here — the operator can still cancel everything via the
/// dialog's Cancel).
function openSplitContainerDialog(seed, formOptions, storageOptions) {
    const grid = $$("pk-edit-locations");
    if (!grid) return;
    const sel = grid.getSelectedId();
    if (!sel) {
        webix.message({ type: "error", text: "Select a packaging row first." });
        return;
    }
    const src = grid.getItem(sel);
    const srcQty = parseInt(src.quantity, 10) || 0;
    if (srcQty <= 0) {
        webix.message({ type: "error", text: "Selected row has no quantity to move." });
        return;
    }

    const winId = "pk-split-container-dialog";
    if ($$(winId)) { $$(winId).destructor(); }

    const srcFormLabel = src.form || "Loose";
    const srcStorageLabel = (function () {
        if (!src.storage_location_id) return "(unset)";
        const m = (lookupsCache && lookupsCache.storage_locations || [])
            .find((s) => s.id == src.storage_location_id);
        return m ? m.name : `#${src.storage_location_id}`;
    })();

    webix.ui({
        view: "window",
        id: winId,
        modal: true,
        position: "center",
        width: 480,
        head: "Split / move packaging",
        body: {
            view: "form",
            id: "pk-split-container-form",
            elements: [
                {
                    view: "template", borderless: true, height: 50,
                    template:
                        `<div style="padding:6px 4px">` +
                        `<div style="font-size:13px;color:#6a7a8a">From:</div>` +
                        `<div style="font-size:14px"><b>${escapeHtml(srcFormLabel)}</b> · ` +
                        `${escapeHtml(srcStorageLabel)} · ` +
                        `qty <b>${srcQty}</b>` +
                        (src.lot_number ? ` · lot ${escapeHtml(src.lot_number)}` : "") +
                        `</div></div>`,
                },
                { view: "counter", name: "qty", label: "Move quantity", labelWidth: 130,
                  min: 1, max: srcQty, step: 1, value: srcQty },
                { view: "richselect", name: "form", label: "Into form", labelWidth: 130,
                  options: formOptions, value: src.form === "Reel" ? "Loose" : "Reel" },
                { view: "richselect", name: "storage_location_id", label: "Into storage", labelWidth: 130,
                  options: storageOptions,
                  value: src.storage_location_id || defaultStorageLocationId() },
                { view: "text", name: "lot_number", label: "Lot", labelWidth: 130,
                  value: src.lot_number || "" },
                { view: "text", name: "comment", label: "Comment", labelWidth: 130,
                  value: "" },
                {
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 100,
                          click: () => $$(winId) && $$(winId).destructor() },
                        { view: "button", value: "✓ Split", css: "pk-btn-add", width: 110,
                          hotkey: "enter",
                          click: () => doSplit() },
                    ],
                },
            ],
        },
    }).show();

    function doSplit() {
        const v = $$("pk-split-container-form").getValues();
        const n = parseInt(v.qty, 10);
        if (!Number.isFinite(n) || n <= 0 || n > srcQty) {
            webix.message({ type: "error", text: `Quantity must be 1..${srcQty}.` });
            return;
        }
        // Storage is optional now; null = unbinned. The form
        // schema (richselect over storageOptions which includes
        // an "(unbinned)" id=0 option) coerces empty selection
        // to null already.
        // 1. Subtract from source row (or remove entirely when N == srcQty).
        const remaining = srcQty - n;
        if (remaining === 0) {
            grid.remove(sel);
        } else {
            grid.updateItem(sel, { quantity: remaining });
        }
        // 2. Add a new row with the moved quantity.
        const storageId = parseInt(v.storage_location_id, 10);
        const newRow = {
            id: webix.uid(),
            form: v.form || "Loose",
            storage_location_id: storageId > 0 ? storageId : null,
            quantity: n,
            lot_number: (v.lot_number || "").trim(),
            comment: (v.comment || "").trim(),
        };
        grid.add(newRow);
        grid.select(newRow.id);
        updateLocationsTotal(seed);
        $$(winId) && $$(winId).destructor();
        webix.message({ type: "success", text: `Moved ${n} into ${newRow.form}` });
    }
}

/// Consume N units from a specific PartStorageLocation
/// row. Posts a negative-delta StockEntry with `part_storage_location_id`
/// set, which the backend uses to (a) decrement that PSL row's
/// quantity in the same transaction and (b) record traceability on
/// the StockEntry itself. Per the user's "warn-and-allow" memory,
/// over-consumption (qty > row.quantity) is permitted with a warning
/// — the operator may be reconciling against an actually-empty reel.
function openConsumeContainerDialog(part, row) {
    if (!part || !row) return;
    const winId = "pk-consume-container-dialog";
    if ($$(winId)) { $$(winId).destructor(); }
    const formLabel = row.form || "Loose";
    const storageLabel = row.storage_location_name || "(unset)";
    const onHand = row.quantity || 0;
    const lotBit = row.lot_number ? ` · lot ${escapeHtml(row.lot_number)}` : "";
    webix.ui({
        view: "window",
        id: winId,
        modal: true,
        position: "center",
        width: 460,
        head: `Consume from ${formLabel}`,
        body: {
            view: "form",
            id: "pk-consume-container-form",
            elements: [
                {
                    view: "template", borderless: true, height: 60,
                    template:
                        `<div style="padding:6px 4px">` +
                        `<div class="pk-dialog-part-name">${escapeHtml(part.name)}</div>` +
                        `<div class="pk-dialog-subtitle">` +
                        `<b>${escapeHtml(formLabel)}</b> · ${escapeHtml(storageLabel)} · ` +
                        `on hand <b>${onHand}</b>${lotBit}` +
                        `</div></div>`,
                },
                { view: "counter", name: "qty", label: "Consume quantity", labelWidth: 150,
                  min: 1, value: 1, step: 1 },
                { view: "textarea", name: "comment", label: "Comment", labelWidth: 150, height: 60 },
                {
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 100,
                          click: () => $$(winId) && $$(winId).destructor() },
                        { view: "button", value: "🔻 Consume", css: "pk-btn-remove", width: 130,
                          hotkey: "enter",
                          click: () => doConsume() },
                    ],
                },
            ],
        },
    }).show();

    async function doConsume() {
        const v = $$("pk-consume-container-form").getValues();
        const n = parseInt(v.qty, 10);
        if (!Number.isFinite(n) || n <= 0) {
            webix.message({ type: "error", text: "Quantity must be at least 1." });
            return;
        }
        if (n > onHand) {
            // Warn-and-allow: operator may be reconciling against
            // an actually-empty reel. Persist anyway.
            webix.message({ type: "warning",
                text: `Consuming ${n} from a row holding ${onHand} — quantity will go negative.` });
        }
        try {
            await api.addStockEntry(part.id, {
                stock_level: -n,
                comment: (v.comment || "").trim() || null,
                correction: false,
                part_storage_location_id: row.id,
            });
            $$(winId) && $$(winId).destructor();
            await loadPartDetail(part.id);
            await loadParts({});
            const grid = $$("pk-parts-grid");
            if (grid && grid.exists(part.id)) {
                grid.select(part.id);
                grid.showItem(part.id);
            }
            webix.message({ type: "success", text: `Consumed ${n} from ${formLabel}` });
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Consume failed: " + (e.message || e) });
        }
    }
}

function updateLocationsTotal(seed) {
    const grid = $$("pk-edit-locations");
    const status = $$("pk-edit-locations-status");
    if (!grid || !status) return;
    let sum = 0;
    grid.data.each((r) => { sum += parseInt(r.quantity, 10) || 0; });
    const stockLevel = seed && seed.stock_level != null ? seed.stock_level : 0;
    let html;
    if (sum === stockLevel) {
        html = `<span class="pk-stock-add">Total: <b>${sum}</b> · matches stock level</span>`;
    } else {
        const diff = sum - stockLevel;
        const sign = diff > 0 ? "+" : "";
        html = `<span class="pk-stock-remove">Total: <b>${sum}</b> ⚠ stock level = ${stockLevel} (off by ${sign}${diff})</span>`;
    }
    status.define("label", html);
    status.refresh();
}

// ============================================================
//  Common Parameters library — built-in EE template list
//
//  Each entry maps a familiar identifier (R, C, L, Vmax, etc.)
//  to a parameter shape: numeric vs string, unit symbol, default
//  prefix. Unit and prefix symbols are resolved against the
//  install's lookupsCache at insertion time — if the install
//  doesn't have a unit with that symbol the row falls back to
//  unit_id=null and the operator can pick one manually.
//
//  Library is additive — operators can also type free-form names
//  in the parameter editor; we never auto-detect or auto-type
//  parameters from a part's data because plenty of parts aren't
//  electrical.
// ============================================================

const COMMON_PARAMETERS = [
    // Passives — primary value
    { group: "Passives",      name: "C",          description: "Capacitance",           type: "numeric", unit: "F",  prefix: "μ"  },
    { group: "Passives",      name: "R",          description: "Resistance",            type: "numeric", unit: "Ω",  prefix: "k"  },
    { group: "Passives",      name: "L",          description: "Inductance",            type: "numeric", unit: "H",  prefix: "μ"  },
    { group: "Passives",      name: "Q",          description: "Quality factor",        type: "numeric", unit: "",   prefix: ""   },
    { group: "Passives",      name: "ESR",        description: "Equivalent series resistance", type: "numeric", unit: "Ω", prefix: "m" },
    // Voltage / current / power
    { group: "V/I/P",         name: "Vdc",        description: "DC voltage",            type: "numeric", unit: "V",  prefix: ""   },
    { group: "V/I/P",         name: "Vac",        description: "AC voltage (RMS)",      type: "numeric", unit: "V",  prefix: ""   },
    { group: "V/I/P",         name: "Vmax",       description: "Maximum voltage rating",type: "numeric", unit: "V",  prefix: ""   },
    { group: "V/I/P",         name: "Vf",         description: "Forward voltage",       type: "numeric", unit: "V",  prefix: ""   },
    { group: "V/I/P",         name: "Idc",        description: "DC current",            type: "numeric", unit: "A",  prefix: "m"  },
    { group: "V/I/P",         name: "Iac",        description: "AC current",            type: "numeric", unit: "A",  prefix: "m"  },
    { group: "V/I/P",         name: "Imax",       description: "Maximum current rating",type: "numeric", unit: "A",  prefix: "m"  },
    { group: "V/I/P",         name: "P",          description: "Power rating",          type: "numeric", unit: "W",  prefix: ""   },
    { group: "V/I/P",         name: "Rds(on)",    description: "FET on-state resistance",type:"numeric", unit: "Ω",  prefix: "m"  },
    // Frequency / timing
    { group: "Timing",        name: "f",          description: "Frequency",             type: "numeric", unit: "Hz", prefix: "M"  },
    { group: "Timing",        name: "fmin",       description: "Minimum frequency",     type: "numeric", unit: "Hz", prefix: "M"  },
    { group: "Timing",        name: "fmax",       description: "Maximum frequency",     type: "numeric", unit: "Hz", prefix: "M"  },
    { group: "Timing",        name: "tr",         description: "Rise time",             type: "numeric", unit: "s",  prefix: "n"  },
    { group: "Timing",        name: "tf",         description: "Fall time",             type: "numeric", unit: "s",  prefix: "n"  },
    // Temperature
    { group: "Temperature",   name: "Tmin",       description: "Min operating temperature", type: "numeric", unit: "°C", prefix: "" },
    { group: "Temperature",   name: "Tmax",       description: "Max operating temperature", type: "numeric", unit: "°C", prefix: "" },
    { group: "Temperature",   name: "Top",        description: "Operating temperature", type: "numeric", unit: "°C", prefix: ""   },
    // Tolerance
    { group: "Tolerance",     name: "Tol",        description: "Tolerance",             type: "numeric", unit: "%",  prefix: ""   },
    { group: "Tolerance",     name: "Tol+",       description: "Positive tolerance",    type: "numeric", unit: "%",  prefix: ""   },
    { group: "Tolerance",     name: "Tol-",       description: "Negative tolerance",    type: "numeric", unit: "%",  prefix: ""   },
    // Generic strings
    { group: "Generic",       name: "Package",    description: "Physical package",      type: "string"   },
    { group: "Generic",       name: "Dielectric", description: "Capacitor dielectric (X7R, NP0…)",  type: "string" },
    { group: "Generic",       name: "Material",   description: "Material",              type: "string"   },
    { group: "Generic",       name: "Color",      description: "Color",                 type: "string"   },
    { group: "Generic",       name: "Mount",      description: "Mount type (SMD / THT)",type: "string"   },
];

function commonParamLookupSymbol(list, sym) {
    if (!sym || !list) return null;
    const found = list.find((x) => x.symbol === sym);
    return found ? found.id : null;
}

/// Translate a COMMON_PARAMETERS entry to a row shape compatible
/// with the parameter / criteria editor datatables. Resolves
/// unit/prefix symbols against lookupsCache.
function commonParamToRow(entry) {
    const unit_id = entry.unit
        ? commonParamLookupSymbol(lookupsCache && lookupsCache.units, entry.unit)
        : null;
    const si_prefix_id = entry.prefix
        ? commonParamLookupSymbol(lookupsCache && lookupsCache.prefixes, entry.prefix)
        : null;
    return {
        id: webix.uid(),
        name: entry.name,
        description: entry.description || "",
        value_type: entry.type === "string" ? "string" : "numeric",
        value: "",
        string_value: "",
        unit_id: unit_id,
        si_prefix_id: si_prefix_id,
        // criteria editor adds an `op` column too — let
        // editorAddRow's per-call defaults supply that.
    };
}

/// Open the templates picker. `targetTableId` is the datatable
/// receiving new rows (pk-edit-params or pk-edit-criteria).
/// `extraDefaults` is merged into each new row (used by criteria
/// editor to set op="=").
function openCommonParamsDialog(targetTableId, extraDefaults) {
    // Lookups should already be loaded — the part editor
    // depends on them too. If not, surface the failure.
    if (!lookupsCache) {
        webix.message({ type: "error", text: "Lookup data not loaded yet." });
        return;
    }
    // Annotate each library entry with the live install's
    // unit/prefix labels so the operator can see what they'll
    // get — including the "(install lacks unit X)" case.
    const annotated = COMMON_PARAMETERS.map((p) => {
        let unitLabel = "—", unitOk = true;
        if (p.unit) {
            const u = lookupsCache.units.find((x) => x.symbol === p.unit);
            if (u) unitLabel = p.unit;
            else { unitLabel = `${p.unit} (missing)`; unitOk = false; }
        } else if (p.type === "string") {
            unitLabel = "(string)";
        }
        let prefLabel = "";
        if (p.prefix) {
            const pf = lookupsCache.prefixes.find((x) => x.symbol === p.prefix);
            prefLabel = pf ? p.prefix : `${p.prefix}?`;
        }
        return Object.assign({ id: "tpl_" + p.name, _ok: unitOk, _unit: unitLabel, _prefix: prefLabel }, p);
    });

    webix.ui({
        view: "window",
        id: "pk-common-params",
        modal: true,
        position: "center",
        width: 720,
        height: 540,
        head: "Common Parameter Templates",
        body: {
            rows: [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 40,
                    cols: [
                        { view: "label", label: "Filter:", width: 60, css: "pk-pane-title" },
                        {
                            view: "search",
                            id: "pk-common-params-filter",
                            placeholder: "name or description…",
                            width: 280,
                            on: {
                                onTimedKeyPress: function () {
                                    const q = (this.getValue() || "").toLowerCase().trim();
                                    const dt = $$("pk-common-params-grid");
                                    if (!dt) return;
                                    if (!q) { dt.filter(); return; }
                                    dt.filter((row) => {
                                        return (row.name || "").toLowerCase().includes(q)
                                            || (row.description || "").toLowerCase().includes(q)
                                            || (row.group || "").toLowerCase().includes(q);
                                    });
                                },
                            },
                        },
                        {},
                        { view: "label", label: '<span class="pk-help-hint">Ctrl/Shift+click for multi-select · "(missing)" = this install lacks that unit</span>' },
                    ],
                },
                {
                    view: "datatable",
                    id: "pk-common-params-grid",
                    css: "pk-grid",
                    select: "row",
                    multiselect: true,
                    data: annotated,
                    columns: [
                        { id: "group", header: "Group", width: 110 },
                        { id: "name", header: "Name", width: 100 },
                        { id: "description", header: "Description", fillspace: true },
                        { id: "type", header: "Type", width: 75 },
                        {
                            id: "_unit",
                            header: "Unit",
                            width: 110,
                            template: function (o) {
                                if (o._unit && o._unit.includes("missing")) {
                                    return `<span style="color:#b03030">${escapeHtml(o._unit)}</span>`;
                                }
                                return escapeHtml(o._unit || "");
                            },
                        },
                        { id: "_prefix", header: "Prefix", width: 70 },
                    ],
                },
                {
                    view: "toolbar",
                    css: "pk-dialog-actions",
                    height: 50,
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 100, click: () => $$("pk-common-params").close() },
                        {
                            view: "button",
                            value: "+ Add selected",
                            width: 160,
                            css: "pk-btn-add",
                            click: function () {
                                const dt = $$("pk-common-params-grid");
                                const sel = dt ? dt.getSelectedItem(true) : [];
                                const items = Array.isArray(sel) ? sel : (sel ? [sel] : []);
                                if (!items.length) {
                                    webix.message({ type: "error", text: "Select at least one row" });
                                    return;
                                }
                                const target = $$(targetTableId);
                                if (!target) return;
                                let added = 0;
                                for (const it of items) {
                                    const row = Object.assign(commonParamToRow(it), extraDefaults || {});
                                    target.add(row);
                                    added++;
                                }
                                $$("pk-common-params").close();
                                webix.message({ type: "success", text: `Added ${added} parameter${added === 1 ? "" : "s"}` });
                            },
                        },
                    ],
                },
            ],
        },
    }).show();
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
    // Storage locations from cache. Operator convention is to use
    // a "(NOWHERE)" bin as the catch-all for not-yet-placed parts;
    // defaultStorageLocationId() returns its id.
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
    const locationRows = (seed.locations || []).map((l) => ({
        id: webix.uid(),
        form: l.form || "Loose",
        storage_location_id: l.storage_location_id || null,
        quantity: l.quantity != null ? String(l.quantity) : "0",
        lot_number: l.lot_number || "",
        comment: l.comment || "",
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
    // Multi-location form enum — mirrors backend VALID_FORMS in
    // handlers/part_locations.rs.
    const formOptions = [
        { id: "Loose",    value: "Loose" },
        { id: "Reel",     value: "Reel" },
        { id: "CutTape",  value: "CutTape" },
        { id: "Tray",     value: "Tray" },
        { id: "Tube",     value: "Tube" },
        { id: "Feeder",   value: "Feeder" },
        { id: "Bag",      value: "Bag" },
        { id: "Other",    value: "Other" },
    ];
    // (storageOptions already defined above for the part-level field)
    const storageLocNameById = new Map(lookups.storage_locations.map((s) => [String(s.id), s.name]));
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
                                        options: { data: categoryOptions, body: { template: categoryOptionTemplate } },
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
                                            { view: "button", value: "📋 Templates", width: 110, click: () => openCommonParamsDialog("pk-edit-criteria", { op: "=" }) },
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
                                            { view: "button", value: "📋 Templates", width: 110, click: () => openCommonParamsDialog("pk-edit-params") },
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
                        {
                            header: "Packaging",
                            body: {
                                rows: [
                                    {
                                        view: "toolbar",
                                        css: "pk-pane-toolbar",
                                        height: 32,
                                        cols: [
                                            { view: "button", value: "+ Add row", css: "pk-btn-add", width: 100,
                                              click: () => editorAddRow("pk-edit-locations", { form: "Loose", quantity: "0" }) },
                                            { view: "button", value: "⇄ Split / move", width: 130,
                                              tooltip: "Take N pcs out of the selected packaging and move them into a new packaging entry with a different form (e.g., 1000 pcs from Loose → Reel). Total stock is unchanged.",
                                              click: () => openSplitContainerDialog(seed, formOptions, storageOptions) },
                                            { view: "button", value: "− Remove selected", css: "pk-btn-remove", width: 160,
                                              click: () => { editorRemoveRow("pk-edit-locations"); updateLocationsTotal(seed); } },
                                            {},
                                            { view: "label", id: "pk-edit-locations-status", label: "" },
                                        ],
                                    },
                                    {
                                        view: "datatable",
                                        id: "pk-edit-locations",
                                        editable: true,
                                        editaction: "click",
                                        select: "row",
                                        data: locationRows,
                                        on: {
                                            onBeforeEditStart: function (state) {
                                                if (state && state.row) this.select(state.row);
                                            },
                                            onAfterEditStop: function () { updateLocationsTotal(seed); },
                                            onAfterAdd: function () { updateLocationsTotal(seed); },
                                        },
                                        columns: [
                                            {
                                                id: "form", header: "Form", width: 110,
                                                editor: "richselect",
                                                options: formOptions,
                                            },
                                            { id: "quantity", header: { text: "Qty", css: "pk-th-numeric" },
                                              width: 80, css: "pk-numeric", editor: "text" },
                                            {
                                                id: "storage_location_id", header: "Where", fillspace: true,
                                                editor: "richselect",
                                                options: storageOptions,
                                                template: function (o) {
                                                    if (!o.storage_location_id) return "";
                                                    const name = storageLocNameById.get(String(o.storage_location_id));
                                                    return name ? escapeHtml(name) : "";
                                                },
                                            },
                                            // lot_number + comment are still on the row data and saved by
                                            // the scan-receive flow, but not editable from this grid —
                                            // keeps the row tight. The detail panel doesn't show them
                                            // either; full traceability lives on the StockEntry / Receipts
                                            // history.
                                        ],
                                    },
                                ],
                            },
                        },
                        {
                            header: "Receipts",
                            body: {
                                rows: [
                                    {
                                        view: "toolbar",
                                        css: "pk-pane-toolbar",
                                        height: 32,
                                        cols: [
                                            { view: "label", id: "pk-edit-receipts-status",
                                              label: "Stock receipts attributed to a distributor sales order.", css: "pk-help-hint" },
                                            {},
                                        ],
                                    },
                                    {
                                        view: "datatable",
                                        id: "pk-edit-receipts",
                                        editable: false,
                                        select: false,
                                        data: [],
                                        columns: [
                                            { id: "distributor_name", header: "Distributor", width: 130 },
                                            { id: "sales_order_number", header: "SO #", width: 140 },
                                            { id: "units_added", header: { text: "Units", css: "pk-th-numeric" },
                                              width: 90, css: "pk-numeric",
                                              template: (o) => "+" + o.units_added },
                                            { id: "_unit_price", header: { text: "Unit price", css: "pk-th-numeric" },
                                              width: 130, css: "pk-numeric",
                                              template: function (o) {
                                                  if (!o.avg_unit_price) return "";
                                                  return escapeHtml(o.avg_unit_price + " " + (o.currency || ""));
                                              } },
                                            { id: "_last_date", header: "Last received", width: 130,
                                              template: (o) => (o.last_date || "").substring(0, 10) },
                                            { id: "entry_count", header: { text: "Entries", css: "pk-th-numeric" },
                                              width: 90, css: "pk-numeric" },
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

    // Initial render of the Locations status label (sum vs stockLevel).
    setTimeout(() => updateLocationsTotal(seed), 0);

    // Populate the Attachments tab — only meaningful when editing
    // an existing part (new-mode parts have no id yet).
    if (mode === "edit" && currentPart) {
        refreshAttachments({
            tableId: "pk-edit-attachments",
            kind: "PartAttachment",
            getParentId: () => currentPart.id,
        });
        // Receipts tab is read-only; populate from the same endpoint
        // the part-detail panel uses.
        (async () => {
            try {
                const receipts = await api.partReceipts(currentPart.id);
                const grid = $$("pk-edit-receipts");
                if (grid) {
                    grid.clearAll();
                    grid.parse((receipts || []).map((r, i) => Object.assign({ id: i + 1 }, r)));
                }
                const status = $$("pk-edit-receipts-status");
                if (status) {
                    const n = (receipts || []).length;
                    const txt = n
                        ? `${n} order${n === 1 ? "" : "s"} contributed to this part's stock.`
                        : "No distributor-attributed receipts yet. Use the 📦 Receive DK Order button on the parts grid to import an order.";
                    status.define("label", txt);
                    status.refresh();
                }
            } catch (e) {
                console.warn("part receipts load failed:", e);
            }
        })();
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
    const locationsGrid = $$("pk-edit-locations");
    body.locations = locationsGrid
        ? locationsGrid.serialize()
            // Drop only abandoned / empty rows. (unassigned) storage
            // is a legitimate state now (null storageLocation_id), so
            // we no longer require it. The bar for "real row": a form
            // is set AND quantity > 0, OR a lot/comment was filled in.
            .filter((r) => {
                const qty = parseInt(r.quantity, 10) || 0;
                const lot = (r.lot_number || "").trim();
                const cmt = (r.comment || "").trim();
                return (r.form && qty > 0) || lot || cmt;
            })
            .map((r) => {
                const sid = parseInt(r.storage_location_id, 10);
                return {
                    // null = "(unassigned)" — schema column is now nullable.
                    storage_location_id: Number.isFinite(sid) && sid > 0 ? sid : null,
                    form: r.form || "Loose",
                    quantity: parseInt(r.quantity, 10) || 0,
                    lot_number: (r.lot_number || "").trim() || null,
                    comment: (r.comment || "").trim() || null,
                };
            })
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
        '<h2>PartKeepr-ng failed to start</h2>' +
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
        if (me) {
            mountShell(me);
            // Deep-link support: if the URL fragment is "/part/<id>"
            // (the form our printed QR labels encode), route to that
            // part once the shell is up. Loose timing here is fine
            // — handleScan does the same work asynchronously.
            if (location.hash) {
                const m = location.hash.match(/(?:#\/)part\/(\d+)$/);
                if (m) {
                    // Defer one tick so all the shell views finish
                    // their initial mount before we try to navigate.
                    setTimeout(() => handleScan(location.hash), 100);
                }
            }
        } else {
            mountLogin();
        }
    } catch (e) {
        showFatalError(e);
    }
});
