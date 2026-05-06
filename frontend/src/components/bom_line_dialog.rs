//! Slice 8a: add/edit a BOM line dialog.
//!
//! Single dialog covers both Add and Edit (mode tag). Picker uses the
//! existing `/api/parts?search=` endpoint; user types and we debounce-
//! lite via the resource refetching whenever the search input changes.
//! Selecting a part fills the line; Save POSTs (Add) or PUTs (Edit) the
//! BOM line and closes.

use leptos::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;
use web_sys::HtmlInputElement;

use crate::api;
use crate::types::PartRow;
use crate::{
    BomLineEditCtx, BomLineEditMode, BomLineEditState, DataVersion,
};

#[component]
pub fn BomLineDialog() -> impl IntoView {
    let state = expect_context::<BomLineEditState>().0;
    view! {
        <Show when=move || state.get().is_some()>
            {move || {
                let ctx = match state.get() { Some(c) => c, None => return ().into_any() };
                view! { <Body ctx=ctx/> }.into_any()
            }}
        </Show>
    }
}

#[component]
fn Body(ctx: BomLineEditCtx) -> impl IntoView {
    let state = expect_context::<BomLineEditState>().0;
    let data_version = expect_context::<DataVersion>().0;

    let mode = ctx.mode;
    let project_id = ctx.project_id;
    let line_id = ctx.line_id;

    // Mutable form state.
    let part_id = RwSignal::new(ctx.part_id);
    let part_label = RwSignal::new(if ctx.part_id.is_some() {
        format!("{}{}",
            ctx.part_name,
            if ctx.part_internal_part_number.is_empty() {
                String::new()
            } else { format!(" ({})", ctx.part_internal_part_number) })
    } else { String::new() });
    let quantity = RwSignal::new(ctx.quantity);
    let overage = RwSignal::new(ctx.overage);
    let overage_type = RwSignal::new(ctx.overage_type.clone());
    let lot_number = RwSignal::new(ctx.lot_number.clone());
    let remarks = RwSignal::new(ctx.remarks.clone());

    // Picker state.
    let picker_open = RwSignal::new(part_id.get_untracked().is_none());
    let search = RwSignal::new(String::new());

    let saving = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);

    let close = move || state.set(None);
    let close_btn = move |_: leptos::ev::MouseEvent| close();

    let title = match mode {
        BomLineEditMode::Add => "Add Part to BOM".to_string(),
        BomLineEditMode::Edit => "Edit BOM Line".to_string(),
    };

    let on_save = move |_: leptos::ev::MouseEvent| {
        let pid = match part_id.get() {
            Some(p) => p,
            None => {
                error.set(Some("Pick a part first.".into()));
                return;
            }
        };
        if quantity.get() < 1 {
            error.set(Some("Quantity must be at least 1.".into()));
            return;
        }
        if overage.get() < 0 {
            error.set(Some("Overage cannot be negative.".into()));
            return;
        }
        let body = api::BomLineWrite {
            part_id: pid,
            quantity: quantity.get(),
            remarks: {
                let r = remarks.get();
                if r.trim().is_empty() { None } else { Some(r) }
            },
            overage_type: {
                let t = overage_type.get();
                if t.is_empty() { None } else { Some(t) }
            },
            overage: Some(overage.get()),
            lot_number: {
                let l = lot_number.get();
                if l.is_empty() { None } else { Some(l) }
            },
        };
        saving.set(true);
        error.set(None);
        spawn_local(async move {
            let res = match mode {
                BomLineEditMode::Add => api::post_bom_line(project_id, body).await.map(|_| ()),
                BomLineEditMode::Edit => api::put_bom_line(project_id, line_id, body).await,
            };
            saving.set(false);
            match res {
                Ok(()) => {
                    data_version.update(|v| *v += 1);
                    state.set(None);
                }
                Err(e) => error.set(Some(e.0)),
            }
        });
    };

    view! {
        <div class="modal-backdrop" on:click=close_btn>
            <div class="modal modal-wide" on:click=|e| e.stop_propagation()>
                <div class="modal-head">
                    <h3>{title}</h3>
                    <button class="modal-close" on:click=close_btn>"✕"</button>
                </div>
                <div class="modal-body">
                    <div class="form-row">
                        <label>"Part"</label>
                        <div class="bom-part-picker">
                            <input type="text" placeholder="Click to pick / search part…"
                                prop:value={move || part_label.get()}
                                prop:readonly=true
                                on:click=move |_| picker_open.set(true)/>
                            <button class="btn-info"
                                on:click=move |_| picker_open.set(true)>
                                "Pick…"
                            </button>
                        </div>
                    </div>
                    <Show when=move || picker_open.get()>
                        <PartPicker
                            search=search
                            on_pick=Callback::new(move |(row,): (PartRow,)| {
                                let label = if row.internal_part_number.as_deref().unwrap_or("").is_empty() {
                                    row.name.clone()
                                } else {
                                    format!("{} ({})", row.name, row.internal_part_number.clone().unwrap_or_default())
                                };
                                part_id.set(Some(row.id));
                                part_label.set(label);
                                picker_open.set(false);
                            })/>
                    </Show>
                    <div class="form-row">
                        <label>"Quantity"</label>
                        <input type="number" min="1"
                            prop:value={move || quantity.get().to_string()}
                            on:input=move |ev: leptos::ev::Event| {
                                let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                                    .and_then(|e| e.value().parse().ok()).unwrap_or(1);
                                quantity.set(v);
                            }/>
                    </div>
                    <div class="form-row">
                        <label>"Overage"</label>
                        <div class="bom-overage-row">
                            <input type="number" min="0"
                                prop:value={move || overage.get().to_string()}
                                on:input=move |ev: leptos::ev::Event| {
                                    let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                                        .and_then(|e| e.value().parse().ok()).unwrap_or(0);
                                    overage.set(v);
                                }/>
                            <select
                                prop:value={move || {
                                    let t = overage_type.get();
                                    if t.is_empty() { "absolute".into() } else { t }
                                }}
                                on:change=move |ev: leptos::ev::Event| {
                                    let v = ev.target().and_then(|t| t.dyn_into::<web_sys::HtmlSelectElement>().ok())
                                        .map(|e| e.value()).unwrap_or_default();
                                    overage_type.set(v);
                                }>
                                <option value="absolute">"absolute (e.g., +5 pcs)"</option>
                                <option value="percent">"percent (e.g., +5%)"</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <label>"Lot number"</label>
                        <input type="text"
                            prop:value={move || lot_number.get()}
                            on:input=move |ev: leptos::ev::Event| {
                                let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                                    .map(|e| e.value()).unwrap_or_default();
                                lot_number.set(v);
                            }/>
                    </div>
                    <div class="form-row">
                        <label>"Remarks"</label>
                        <input type="text" placeholder="e.g., R1, R2 — schematic refs"
                            prop:value={move || remarks.get()}
                            on:input=move |ev: leptos::ev::Event| {
                                let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                                    .map(|e| e.value()).unwrap_or_default();
                                remarks.set(v);
                            }/>
                    </div>
                    <Show when=move || error.get().is_some()>
                        <div class="modal-error">
                            {move || error.get().unwrap_or_default()}
                        </div>
                    </Show>
                </div>
                <div class="modal-foot">
                    <button class="btn-secondary" on:click=close_btn>"Cancel"</button>
                    <button class="btn-success"
                        prop:disabled=move || saving.get()
                        on:click=on_save>{
                            move || if saving.get() { "Saving…" } else { "Save" }
                        }</button>
                </div>
            </div>
        </div>
    }
}

/// Part picker: search box + result list. Uses /api/parts with a search
/// query. Limit is small (50) — for typical projects this fits one screen
/// once the user has narrowed the search.
#[component]
fn PartPicker(
    search: RwSignal<String>,
    on_pick: Callback<(PartRow,)>,
) -> impl IntoView {
    let results = LocalResource::new(move || {
        let q = search.get();
        async move {
            // Allow both real and meta parts in the picker. Meta-parts
            // on a BOM line are intentional ("any matching part"); the
            // run-time allocation editor resolves them to specific real
            // parts when the project is run.
            api::fetch_parts(
                None, None, None, None, None,
                q,
                50, 0,
                None, None,
                None,
            ).await
        }
    });

    view! {
        <div class="bom-picker-panel">
            <input type="text" autofocus="true" placeholder="Search parts by name / IPN…"
                prop:value={move || search.get()}
                on:input=move |ev: leptos::ev::Event| {
                    let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                        .map(|e| e.value()).unwrap_or_default();
                    search.set(v);
                }/>
            <Suspense fallback=|| view! {
                <p class="muted" style="padding:8px">"Searching…"</p>
            }>
                {move || results.get().map(|res| match &*res {
                    Err(e) => view! {
                        <p class="muted" style="padding:8px">{format!("Error: {}", e.0)}</p>
                    }.into_any(),
                    Ok(resp) => {
                        let total = resp.total;
                        let items = resp.items.clone();
                        if items.is_empty() {
                            return view! {
                                <p class="muted" style="padding:8px">"No matching parts."</p>
                            }.into_any();
                        }
                        view! {
                            <p class="muted bom-picker-status">
                                {format!("{} match{} (showing first {})",
                                    total,
                                    if total == 1 { "" } else { "es" },
                                    items.len())}
                            </p>
                            <div class="bom-picker-results">
                                {items.into_iter().map(|row| {
                                    let row_for_pick = row.clone();
                                    let row_for_label = row.clone();
                                    let label_main = row_for_label.name.clone();
                                    let label_sub = match row_for_label.internal_part_number.as_deref() {
                                        Some(s) if !s.is_empty() => s.to_string(),
                                        _ => row_for_label.description.clone().unwrap_or_default(),
                                    };
                                    let stock = row_for_label.stock_level;
                                    let is_meta = row_for_label.meta_part;
                                    let meta_chip = if is_meta {
                                        view! { <span class="meta-tag" title="Meta-part — resolved to specific real parts at run time">"(meta)"</span> }.into_any()
                                    } else { ().into_any() };
                                    view! {
                                        <div class="bom-picker-row"
                                            class:meta-part-row=is_meta
                                            on:click=move |_| on_pick.run((row_for_pick.clone(),))>
                                            <div class="bom-picker-name">
                                                {label_main}
                                                {meta_chip}
                                            </div>
                                            <div class="bom-picker-meta muted">{label_sub}</div>
                                            <div class="bom-picker-stock right">
                                                {if is_meta { String::new() } else { format!("stock: {stock}") }}
                                            </div>
                                        </div>
                                    }
                                }).collect::<Vec<_>>()}
                            </div>
                        }.into_any()
                    }
                })}
            </Suspense>
        </div>
    }
}
