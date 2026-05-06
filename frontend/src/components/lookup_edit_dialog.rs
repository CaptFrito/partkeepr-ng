//! Slice 5c-4: unified edit dialog for lookup tables.
//!
//! One dialog shell that dispatches to a per-entity form based on
//! `LookupEditCtx::kind`. Three modes: Create / Edit / Delete. The
//! Delete branch reads from `block_counts` to refuse upfront when refs
//! exist; this is consistent with the storage- and footprint-side
//! behaviours.

use leptos::prelude::*;
use serde_json::json;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;
use web_sys::{HtmlInputElement, HtmlTextAreaElement};

use crate::api;
use crate::components::attachments_section::AttachmentsSelfLoader;
use crate::types::SiPrefixRow;
use crate::{
    DataVersion, LookupEditCtx, LookupEditMode, LookupEditState, LookupKind,
};

#[component]
pub fn LookupEditDialog() -> impl IntoView {
    let dialog_state = expect_context::<LookupEditState>().0;
    let data_version = expect_context::<DataVersion>().0;

    // One signal per possible field. Each kind reads/writes the subset
    // it cares about. Cheaper than a Vec<dyn Trait> dispatch.
    let f_name      = RwSignal::new(String::new());
    let f_short     = RwSignal::new(String::new());
    let f_symbol    = RwSignal::new(String::new());
    let f_url       = RwSignal::new(String::new());
    let f_email     = RwSignal::new(String::new());
    let f_phone     = RwSignal::new(String::new());
    let f_fax       = RwSignal::new(String::new());
    let f_address   = RwSignal::new(String::new());
    let f_comment   = RwSignal::new(String::new());
    let f_skuurl    = RwSignal::new(String::new());
    let f_enabled   = RwSignal::new(true);
    let f_default   = RwSignal::new(false);
    let f_base      = RwSignal::new(10i32);
    let f_exponent  = RwSignal::new(0i32);
    let f_prefixes  = RwSignal::new(Vec::<i32>::new());

    let submitting = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);

    // Resources we need for the Unit form (allowed-prefix multi-select).
    let prefixes = LocalResource::new(|| async {
        api::fetch_si_prefixes_rich().await
    });

    Effect::new(move |prev: Option<bool>| {
        let now_open = dialog_state.get().is_some();
        if now_open && prev != Some(true) {
            error.set(None);
            submitting.set(false);
            // Reset all fields, then populate from ctx.data on Edit.
            f_name.set(String::new());
            f_short.set(String::new());
            f_symbol.set(String::new());
            f_url.set(String::new());
            f_email.set(String::new());
            f_phone.set(String::new());
            f_fax.set(String::new());
            f_address.set(String::new());
            f_comment.set(String::new());
            f_skuurl.set(String::new());
            f_enabled.set(true);
            f_default.set(false);
            f_base.set(10);
            f_exponent.set(0);
            f_prefixes.set(Vec::new());

            if let Some(ctx) = dialog_state.get() {
                if ctx.mode == LookupEditMode::Edit {
                    let d = &ctx.data;
                    set_str(d, "name",  &f_name);
                    set_str(d, "short_name", &f_short);
                    set_str(d, "symbol", &f_symbol);
                    set_str(d, "url",   &f_url);
                    set_str(d, "email", &f_email);
                    set_str(d, "phone", &f_phone);
                    set_str(d, "fax",   &f_fax);
                    set_str(d, "address", &f_address);
                    set_str(d, "comment", &f_comment);
                    set_str(d, "skuurl", &f_skuurl);
                    if let Some(b) = d.get("enabled_for_reports").and_then(|v| v.as_bool()) {
                        f_enabled.set(b);
                    }
                    if let Some(b) = d.get("is_default").and_then(|v| v.as_bool()) {
                        f_default.set(b);
                    }
                    if let Some(n) = d.get("base").and_then(|v| v.as_i64()) {
                        f_base.set(n as i32);
                    }
                    if let Some(n) = d.get("exponent").and_then(|v| v.as_i64()) {
                        f_exponent.set(n as i32);
                    }
                    if ctx.kind == LookupKind::SiPrefixes {
                        // SiPrefix uses `prefix` not `name`.
                        set_str(d, "prefix", &f_name);
                    }
                    if let Some(arr) = d.get("allowed_prefix_ids").and_then(|v| v.as_array()) {
                        let ids: Vec<i32> = arr.iter()
                            .filter_map(|v| v.as_i64().map(|n| n as i32))
                            .collect();
                        f_prefixes.set(ids);
                    }
                }
            }
        }
        now_open
    });

    let close = move || dialog_state.set(None);

    let title = move || {
        let Some(ctx) = dialog_state.get() else { return String::new(); };
        let entity = match ctx.kind {
            LookupKind::Manufacturers => "Manufacturer",
            LookupKind::Distributors  => "Distributor",
            LookupKind::PartUnits     => "Part Unit",
            LookupKind::Units         => "Unit",
            LookupKind::SiPrefixes    => "SI Prefix",
        };
        match ctx.mode {
            LookupEditMode::Create => format!("Add {entity}"),
            LookupEditMode::Edit   => format!("Edit {entity}: {}", ctx.name),
            LookupEditMode::Delete => format!("Delete {entity}: {}", ctx.name),
        }
    };

    let submit = move || {
        let Some(ctx) = dialog_state.get() else { return; };
        // Build the (path, body) for create/update or just path for delete.
        let trimmed_name = f_name.get().trim().to_string();
        let want_str = |s: RwSignal<String>| {
            let v = s.get();
            if v.trim().is_empty() { serde_json::Value::Null }
            else { serde_json::Value::String(v) }
        };

        let result: Result<(String, Option<serde_json::Value>), &'static str> = match (ctx.kind, ctx.mode) {
            (kind, LookupEditMode::Delete) => {
                let path = match kind {
                    LookupKind::Manufacturers => format!("/api/manufacturers/{}", ctx.id),
                    LookupKind::Distributors  => format!("/api/distributors/{}", ctx.id),
                    LookupKind::PartUnits     => format!("/api/part_measurement_units/{}", ctx.id),
                    LookupKind::Units         => format!("/api/units/{}", ctx.id),
                    LookupKind::SiPrefixes    => format!("/api/si_prefixes/{}", ctx.id),
                };
                Ok((path, None))
            }
            (LookupKind::Manufacturers, mode) => {
                if trimmed_name.is_empty() { return error.set(Some("Name is required.".into())); }
                let body = json!({
                    "name": trimmed_name,
                    "address": want_str(f_address),
                    "url": want_str(f_url),
                    "email": want_str(f_email),
                    "phone": want_str(f_phone),
                    "fax": want_str(f_fax),
                    "comment": want_str(f_comment),
                });
                let path = if mode == LookupEditMode::Create {
                    "/api/manufacturers".into()
                } else { format!("/api/manufacturers/{}", ctx.id) };
                Ok((path, Some(body)))
            }
            (LookupKind::Distributors, mode) => {
                if trimmed_name.is_empty() { return error.set(Some("Name is required.".into())); }
                let body = json!({
                    "name": trimmed_name,
                    "address": want_str(f_address),
                    "url": want_str(f_url),
                    "phone": want_str(f_phone),
                    "fax": want_str(f_fax),
                    "email": want_str(f_email),
                    "comment": want_str(f_comment),
                    "skuurl": want_str(f_skuurl),
                    "enabled_for_reports": f_enabled.get(),
                });
                let path = if mode == LookupEditMode::Create {
                    "/api/distributors".into()
                } else { format!("/api/distributors/{}", ctx.id) };
                Ok((path, Some(body)))
            }
            (LookupKind::PartUnits, mode) => {
                let trimmed_short = f_short.get().trim().to_string();
                if trimmed_name.is_empty() || trimmed_short.is_empty() {
                    return error.set(Some("Name and short name are required.".into()));
                }
                let body = json!({
                    "name": trimmed_name,
                    "short_name": trimmed_short,
                    "is_default": f_default.get(),
                });
                let path = if mode == LookupEditMode::Create {
                    "/api/part_measurement_units".into()
                } else { format!("/api/part_measurement_units/{}", ctx.id) };
                Ok((path, Some(body)))
            }
            (LookupKind::Units, mode) => {
                let trimmed_symbol = f_symbol.get().trim().to_string();
                if trimmed_name.is_empty() || trimmed_symbol.is_empty() {
                    return error.set(Some("Name and symbol are required.".into()));
                }
                let body = json!({
                    "name": trimmed_name,
                    "symbol": trimmed_symbol,
                    "allowed_prefix_ids": f_prefixes.get(),
                });
                let path = if mode == LookupEditMode::Create {
                    "/api/units".into()
                } else { format!("/api/units/{}", ctx.id) };
                Ok((path, Some(body)))
            }
            (LookupKind::SiPrefixes, mode) => {
                let trimmed_symbol = f_symbol.get().trim().to_string();
                if trimmed_name.is_empty() {
                    return error.set(Some("Prefix is required.".into()));
                }
                let body = json!({
                    "prefix": trimmed_name,
                    "symbol": trimmed_symbol,
                    "base": f_base.get(),
                    "exponent": f_exponent.get(),
                });
                let path = if mode == LookupEditMode::Create {
                    "/api/si_prefixes".into()
                } else { format!("/api/si_prefixes/{}", ctx.id) };
                Ok((path, Some(body)))
            }
        };

        let (path, body) = match result { Ok(x) => x, Err(e) => { error.set(Some(e.into())); return; } };

        submitting.set(true); error.set(None);
        spawn_local(async move {
            let res: Result<(), String> = match (ctx.mode, body.as_ref()) {
                (LookupEditMode::Create, Some(b)) => api::lookup_post(&path, b).await
                    .map(|_| ()).map_err(|e| e.0),
                (LookupEditMode::Edit, Some(b)) => api::lookup_put(&path, b).await
                    .map_err(|e| e.0),
                (LookupEditMode::Delete, _) => match api::lookup_delete(&path).await {
                    Ok(()) => Ok(()),
                    Err(api::LookupDeleteError::Conflict(c)) => Err(format!("Cannot delete: {c}")),
                    Err(api::LookupDeleteError::Other(s)) => Err(s),
                },
                _ => Err("internal: missing body".into()),
            };
            submitting.set(false);
            match res {
                Ok(()) => {
                    data_version.update(|v| *v += 1);
                    dialog_state.set(None);
                }
                Err(e) => error.set(Some(e)),
            }
        });
    };

    let kind = move || dialog_state.get().map(|c| c.kind);
    let mode = move || dialog_state.get().map(|c| c.mode);

    // Whether Delete should be gated (any block_count > 0).
    let delete_blocked = move || dialog_state.get()
        .map(|c| c.block_counts.iter().any(|(_, n)| *n > 0))
        .unwrap_or(false);

    view! {
        <Show when=move || dialog_state.get().is_some()>
            <div class="modal-backdrop" on:click=move |_| close()>
                <div class="modal" on:click=move |e: leptos::ev::MouseEvent| { e.stop_propagation(); }>
                    <div class="modal-head">
                        <h3>{title}</h3>
                        <button class="modal-close" on:click=move |_| close()>"✕"</button>
                    </div>
                    <div class="modal-body">
                        <Show when=move || matches!(mode(), Some(LookupEditMode::Delete))>
                            {move || dialog_state.get().map(|ctx| {
                                let blocked = ctx.block_counts.iter().any(|(_, n)| *n > 0);
                                view! {
                                    <p>{
                                        if blocked {
                                            format!("Cannot delete \"{}\".", ctx.name)
                                        } else {
                                            format!("This will permanently delete \"{}\".", ctx.name)
                                        }
                                    }</p>
                                    <Show when=move || blocked>
                                        <ul class="modal-counts">{
                                            ctx.block_counts.iter()
                                                .filter(|(_, n)| *n > 0)
                                                .map(|(label, n)| view! {
                                                    <li>{format!("{} {} reference{}",
                                                        n, label, if *n == 1 {""} else {"s"})}</li>
                                                }).collect::<Vec<_>>()
                                        }</ul>
                                        <p class="modal-help">
                                            "Reassign or delete those references first."
                                        </p>
                                    </Show>
                                    <Show when=move || !blocked>
                                        <p class="modal-help">"No references — safe to delete."</p>
                                    </Show>
                                }
                            })}
                        </Show>
                        <Show when=move || matches!(mode(), Some(LookupEditMode::Create) | Some(LookupEditMode::Edit))>
                            <Show when=move || matches!(kind(), Some(LookupKind::Manufacturers))>
                                <NameOrgFields name=f_name url=f_url email=f_email phone=f_phone
                                    fax=f_fax address=f_address comment=f_comment/>
                                <Show when=move || matches!(mode(), Some(LookupEditMode::Edit))>
                                    {move || dialog_state.get().map(|ctx| {
                                        let id = ctx.id;
                                        view! {
                                            <h4 class="modal-subhead">"Logos"</h4>
                                            <AttachmentsSelfLoader
                                                kind="ManufacturerICLogo"
                                                list_path=format!("/api/manufacturers/{id}/logos")
                                                upload_path=format!("/api/manufacturers/{id}/logos")/>
                                        }
                                    })}
                                </Show>
                            </Show>
                            <Show when=move || matches!(kind(), Some(LookupKind::Distributors))>
                                <NameOrgFields name=f_name url=f_url email=f_email phone=f_phone
                                    fax=f_fax address=f_address comment=f_comment/>
                                <TextField name="SKU URL" sig=f_skuurl/>
                                <CheckField name="Enabled for reports" sig=f_enabled/>
                            </Show>
                            <Show when=move || matches!(kind(), Some(LookupKind::PartUnits))>
                                <TextField name="Name" sig=f_name/>
                                <TextField name="Short name" sig=f_short/>
                                <CheckField name="Is default" sig=f_default/>
                            </Show>
                            <Show when=move || matches!(kind(), Some(LookupKind::Units))>
                                <TextField name="Name" sig=f_name/>
                                <TextField name="Symbol" sig=f_symbol/>
                                <PrefixMultiSelect prefixes=prefixes selected=f_prefixes/>
                            </Show>
                            <Show when=move || matches!(kind(), Some(LookupKind::SiPrefixes))>
                                <TextField name="Prefix" sig=f_name/>
                                <TextField name="Symbol" sig=f_symbol/>
                                <IntField name="Base" sig=f_base/>
                                <IntField name="Exponent" sig=f_exponent/>
                                <p class="modal-help">
                                    "Multiplier = base ^ exponent (e.g., kilo = 10^3, kibi = 2^10)."
                                </p>
                            </Show>
                        </Show>
                        <Show when=move || error.get().is_some()>
                            <div class="modal-error">{move || error.get().unwrap_or_default()}</div>
                        </Show>
                    </div>
                    <div class="modal-foot">
                        <button class="btn-secondary"
                            prop:disabled={move || submitting.get()}
                            on:click=move |_| close()>"Cancel"</button>
                        <Show when=move || matches!(mode(), Some(LookupEditMode::Delete))>
                            <button class="btn-danger"
                                prop:disabled={move || submitting.get() || delete_blocked()}
                                on:click=move |_| submit()>{
                                    move || if submitting.get() { "Deleting…" } else { "Delete" }
                                }</button>
                        </Show>
                        <Show when=move || matches!(mode(), Some(LookupEditMode::Create))>
                            <button class="btn-success"
                                prop:disabled={move || submitting.get()}
                                on:click=move |_| submit()>{
                                    move || if submitting.get() { "Saving…" } else { "Add" }
                                }</button>
                        </Show>
                        <Show when=move || matches!(mode(), Some(LookupEditMode::Edit))>
                            <button class="btn-info"
                                prop:disabled={move || submitting.get()}
                                on:click=move |_| submit()>{
                                    move || if submitting.get() { "Saving…" } else { "Save" }
                                }</button>
                        </Show>
                    </div>
                </div>
            </div>
        </Show>
    }
}

fn set_str(d: &serde_json::Value, key: &str, sig: &RwSignal<String>) {
    if let Some(s) = d.get(key).and_then(|v| v.as_str()) {
        sig.set(s.to_string());
    }
}

#[component]
fn TextField(name: &'static str, sig: RwSignal<String>) -> impl IntoView {
    view! {
        <label class="form-row">
            <span>{name}</span>
            <input type="text"
                prop:value={move || sig.get()}
                on:input=move |ev: leptos::ev::Event| {
                    let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                        .map(|e| e.value()).unwrap_or_default();
                    sig.set(v);
                }/>
        </label>
    }
}

#[component]
fn IntField(name: &'static str, sig: RwSignal<i32>) -> impl IntoView {
    view! {
        <label class="form-row">
            <span>{name}</span>
            <input type="number"
                prop:value={move || sig.get().to_string()}
                on:input=move |ev: leptos::ev::Event| {
                    let v: i32 = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                        .map(|e| e.value()).and_then(|s| s.parse().ok()).unwrap_or(0);
                    sig.set(v);
                }/>
        </label>
    }
}

#[component]
fn CheckField(name: &'static str, sig: RwSignal<bool>) -> impl IntoView {
    view! {
        <label class="form-row">
            <span>{name}</span>
            <input type="checkbox"
                prop:checked={move || sig.get()}
                on:change=move |ev: leptos::ev::Event| {
                    let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                        .map(|e| e.checked()).unwrap_or(false);
                    sig.set(v);
                }/>
        </label>
    }
}

#[component]
fn NameOrgFields(
    name: RwSignal<String>,
    url: RwSignal<String>,
    email: RwSignal<String>,
    phone: RwSignal<String>,
    fax: RwSignal<String>,
    address: RwSignal<String>,
    comment: RwSignal<String>,
) -> impl IntoView {
    view! {
        <TextField name="Name" sig=name/>
        <TextField name="URL" sig=url/>
        <TextField name="Email" sig=email/>
        <TextField name="Phone" sig=phone/>
        <TextField name="Fax" sig=fax/>
        <TextareaField name="Address" sig=address/>
        <TextareaField name="Comment" sig=comment/>
    }
}

#[component]
fn TextareaField(name: &'static str, sig: RwSignal<String>) -> impl IntoView {
    view! {
        <label class="form-row form-row-tall">
            <span>{name}</span>
            <textarea rows="2"
                prop:value={move || sig.get()}
                on:input=move |ev: leptos::ev::Event| {
                    let v = ev.target().and_then(|t| t.dyn_into::<HtmlTextAreaElement>().ok())
                        .map(|e| e.value()).unwrap_or_default();
                    sig.set(v);
                }/>
        </label>
    }
}

#[component]
fn PrefixMultiSelect(
    prefixes: LocalResource<Result<Vec<SiPrefixRow>, api::ApiError>>,
    selected: RwSignal<Vec<i32>>,
) -> impl IntoView {
    view! {
        <div class="form-row form-row-tall">
            <span>"Allowed prefixes"</span>
            <div class="prefix-grid">
                <Suspense fallback=|| view! { <span class="muted">"Loading prefixes…"</span> }>
                    {move || prefixes.get().map(|res| match &*res {
                        Err(_) => view! { <span class="muted">"(error)"</span> }.into_any(),
                        Ok(rows) => {
                            let items = rows.clone();
                            view! {
                                <>{
                                    items.into_iter().map(|p| {
                                        let id = p.id;
                                        let is_checked = move || selected.with(|s| s.contains(&id));
                                        let toggle = move |ev: leptos::ev::Event| {
                                            let checked = ev.target()
                                                .and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                                                .map(|e| e.checked()).unwrap_or(false);
                                            selected.update(|s| {
                                                if checked && !s.contains(&id) { s.push(id); }
                                                else if !checked { s.retain(|x| *x != id); }
                                            });
                                        };
                                        view! {
                                            <label class="prefix-cell">
                                                <input type="checkbox"
                                                    prop:checked=is_checked
                                                    on:change=toggle/>
                                                {format!("{} ({})", p.prefix, p.symbol)}
                                            </label>
                                        }
                                    }).collect::<Vec<_>>()
                                }</>
                            }.into_any()
                        }
                    })}
                </Suspense>
            </div>
        </div>
    }
}
