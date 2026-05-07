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
    //  Login window
    // ------------------------------------------------------------

    function showLogin() {
        webix.ui({
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
                    { view: "text", name: "username", label: "Username", labelWidth: 90, value: "" },
                    { view: "text", type: "password", name: "password", label: "Password", labelWidth: 90, value: "" },
                    { view: "label", id: "pk-login-error", label: "", css: "pk-login-error", hidden: true },
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
        }).show();
        $$("pk-login-form").focus();
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
        $$("pk-login").close();
        renderShell(result.body.user);
    }

    // ------------------------------------------------------------
    //  Main shell — three-column layout
    // ------------------------------------------------------------

    function renderShell(user) {
        webix.ui({
            id: "pk-app",
            type: "space",
            rows: [
                buildHeader(user),
                {
                    cols: [
                        { id: "pk-left", header: "Browse", body: { template: "Left pane (W2 will populate this)" }, width: 300, view: "accordionitem" },
                        { view: "resizer" },
                        { id: "pk-center", header: "Parts", body: { template: "Center pane (W2 will populate this)" }, view: "accordionitem" },
                        { view: "resizer" },
                        { id: "pk-right", header: "Detail", body: { template: "Right pane (W2 will populate this)" }, width: 380, view: "accordionitem" },
                    ],
                },
            ],
        });
    }

    function buildHeader(user) {
        const adminBadge = user.is_admin ? `<span class="pk-user-admin">admin</span>` : "";
        return {
            view: "toolbar",
            id: "pk-header",
            css: "pk-header",
            height: 44,
            cols: [
                { view: "label", label: "<b>PartKeeper</b>", width: 140 },
                {},
                {
                    view: "label",
                    label: `<span class="pk-user-name">${escapeHtml(user.username)}</span>${adminBadge}`,
                    width: 220,
                    align: "right",
                },
                {
                    view: "button",
                    value: "Sign out",
                    width: 100,
                    click: doLogout,
                },
            ],
        };
    }

    async function doLogout() {
        await api.logout();
        webix.ui({}, $$("pk-app"));
        showLogin();
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
        );
    }

    // ------------------------------------------------------------
    //  Bootstrap
    // ------------------------------------------------------------

    webix.ready(async function () {
        webix.ui({
            view: "layout",
            id: "pk-app",
            rows: [{ template: "Loading…", css: "pk-loading" }],
        });

        try {
            const me = await api.me();
            if (me) {
                renderShell(me);
            } else {
                webix.ui({}, $$("pk-app"));
                showLogin();
            }
        } catch (e) {
            webix.message({ type: "error", text: "Could not reach the server." });
            console.error(e);
        }
    });
})();
