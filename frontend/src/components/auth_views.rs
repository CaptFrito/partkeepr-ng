//! Slice 10b: login screen + header user widget.
//!
//! The login screen takes the entire viewport when the AuthState is
//! LoggedOut. The header widget renders the current user's name +
//! admin badge + Logout button when LoggedIn.

use leptos::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;
use web_sys::HtmlInputElement;

use crate::api::{self, AuthError};
use crate::{AuthState, AuthStatus};

#[component]
pub fn LoginScreen() -> impl IntoView {
    let auth = expect_context::<AuthState>().0;

    let username = RwSignal::new(String::new());
    let password = RwSignal::new(String::new());
    let submitting = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);

    let on_submit = move |ev: leptos::ev::SubmitEvent| {
        ev.prevent_default();
        let u = username.get();
        let p = password.get();
        if u.trim().is_empty() || p.is_empty() {
            error.set(Some("Username and password are required.".into()));
            return;
        }
        submitting.set(true);
        error.set(None);
        spawn_local(async move {
            let res = api::login(&u, &p).await;
            submitting.set(false);
            match res {
                Ok(user) => {
                    auth.set(AuthStatus::LoggedIn(user));
                }
                Err(AuthError::BadCredentials) => {
                    error.set(Some("Username or password not recognised.".into()));
                }
                Err(AuthError::Unauthenticated) => {
                    error.set(Some("Session expired. Please sign in again.".into()));
                }
                Err(AuthError::Other(e)) => {
                    error.set(Some(format!("Sign-in failed: {}", e.0)));
                }
            }
        });
    };

    view! {
        <div class="login-screen">
            <form class="login-card" on:submit=on_submit>
                <h1 class="login-title">"partkeepr-ng"</h1>
                <p class="muted login-subtitle">"Sign in to continue"</p>
                <label class="login-field">
                    <span>"Username"</span>
                    <input type="text" autofocus="true" autocomplete="username"
                        prop:value=move || username.get()
                        on:input=move |ev: leptos::ev::Event| {
                            let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                                .map(|e| e.value()).unwrap_or_default();
                            username.set(v);
                        }/>
                </label>
                <label class="login-field">
                    <span>"Password"</span>
                    <input type="password" autocomplete="current-password"
                        prop:value=move || password.get()
                        on:input=move |ev: leptos::ev::Event| {
                            let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                                .map(|e| e.value()).unwrap_or_default();
                            password.set(v);
                        }/>
                </label>
                <Show when=move || error.get().is_some()>
                    <div class="modal-error">{move || error.get().unwrap_or_default()}</div>
                </Show>
                <button type="submit" class="btn-success login-submit"
                    prop:disabled=move || submitting.get()>{
                        move || if submitting.get() { "Signing in…" } else { "Sign in" }
                    }</button>
                <p class="muted login-foot">
                    "Uses your existing PartKeepr credentials. Password reset is "
                    "not yet available in this app — ask the admin if you need help."
                </p>
            </form>
        </div>
    }
}

#[component]
pub fn HeaderUser() -> impl IntoView {
    let auth = expect_context::<AuthState>().0;

    let on_logout = move |_: leptos::ev::MouseEvent| {
        spawn_local(async move {
            let _ = api::logout().await;
            auth.set(AuthStatus::LoggedOut);
        });
    };

    view! {
        {move || match auth.get() {
            AuthStatus::LoggedIn(u) => {
                let badge = if u.is_admin {
                    view! { <span class="header-admin-badge">"admin"</span> }.into_any()
                } else { ().into_any() };
                view! {
                    <div class="header-user">
                        <span class="header-username">{u.username.clone()}</span>
                        {badge}
                        <button class="header-logout" on:click=on_logout
                            title="Sign out">"Logout"</button>
                    </div>
                }.into_any()
            }
            _ => ().into_any(),
        }}
    }
}
