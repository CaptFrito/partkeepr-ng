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
