// partkeepr-ng — Webix-based frontend, W1 foundation.
//
// Same-origin with the API: the backend serves these files via
// tower-http's ServeDir. Session cookie rides along automatically;
// no CORS shenanigans, no `credentials: include` needed.

(function () {
    "use strict";

    // ------------------------------------------------------------
    //  API client (thin)
    // ------------------------------------------------------------

    const api = {
        async me() {
            const r = await fetch("/api/me", { method: "GET" });
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
    };

    // ------------------------------------------------------------
    //  Mount management
    //
    //  We hold a single top-level Webix view at any time. When we
    //  transition between login and shell, we destruct the previous
    //  view first and mount a fresh one — Webix doesn't auto-clean
    //  if you just re-call webix.ui() with a new config.
    // ------------------------------------------------------------

    let topView = null;

    function unmount() {
        if (topView) {
            try { topView.destructor(); } catch (_) {}
            topView = null;
        }
    }

    // ------------------------------------------------------------
    //  Login window
    // ------------------------------------------------------------

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

    // ------------------------------------------------------------
    //  Main shell — three-column layout
    // ------------------------------------------------------------

    function mountShell(user) {
        unmount();
        topView = webix.ui({
            id: "pk-app",
            rows: [
                buildHeader(user),
                {
                    cols: [
                        { id: "pk-left", template: "Left pane (W2 will populate this)", width: 300 },
                        { view: "resizer" },
                        { id: "pk-center", template: "Center pane (W2 will populate this)" },
                        { view: "resizer" },
                        { id: "pk-right", template: "Right pane (W2 will populate this)", width: 380 },
                    ],
                },
            ],
        });
    }

    function buildHeader(user) {
        const adminBadge = user.is_admin ? `<span class="pk-user-admin">admin</span>` : "";
        const userHtml = `<span class="pk-user-name">${escapeHtml(user.username)}</span>${adminBadge}`;
        return {
            view: "toolbar",
            id: "pk-header",
            css: "pk-header",
            height: 44,
            cols: [
                { view: "label", label: '<span class="pk-app-title">PartKeeper</span>', width: 160 },
                {},
                { view: "label", label: userHtml, width: 240 },
                {
                    view: "button",
                    value: "Sign out",
                    width: 110,
                    click: doLogout,
                },
            ],
        };
    }

    async function doLogout() {
        await api.logout();
        mountLogin();
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
        );
    }

    // ------------------------------------------------------------
    //  Bootstrap
    // ------------------------------------------------------------

    function showFatalError(e) {
        document.body.innerHTML =
            '<div style="font-family:sans-serif;padding:24px;color:#a33">' +
            '<h2>PartKeeper failed to start</h2>' +
            '<pre>' + escapeHtml(e && e.message ? e.message : String(e)) + '</pre>' +
            '</div>';
        console.error("[partkeepr] boot failed", e);
    }

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
