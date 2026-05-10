// SPDX-License-Identifier: GPL-3.0-or-later
//
// partkeepr-ng — Webix frontend bootstrap.
//
// This file owns the smallest set of concerns: mount/unmount, login
// dialog, main-shell layout (three-column PartManager), header bar,
// logout, and the webix.ready() entry point. Every larger feature
// (parts grid, trees, dialogs, scan workflow, …) lives in
// `views/*.js`, loaded as separate <script> tags in index.html and
// shared with this file via classic-script global lexical scope.
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
