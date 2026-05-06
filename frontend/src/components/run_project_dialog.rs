//! Slice 8b + 11c follow-up: Run a project with per-line allocations.
//!
//! Workflow:
//! 1. Operator picks how many builds (`quantity`).
//! 2. Backend's `runs/preview?quantity=N` returns the per-line breakdown
//!    (effective qty, current_stock, shortfall, is_meta).
//! 3. For each BOM line, the dialog renders an *allocation editor*:
//!    - Real-part lines pre-fill one allocation row with the
//!      BOM-specified part at full effective qty.
//!    - Meta-part lines start empty — operator picks one or more real
//!      parts to draw from (search-as-you-type picker per allocation).
//!    - Operator can split across multiple real parts (one allocation
//!      row per real part), substitute on real-part lines too, set
//!      per-allocation lot numbers.
//! 4. Allocated-vs-required is shown per line; mismatch fires a yellow
//!    warning banner but does NOT block Run (warn-and-allow).
//! 5. **▶ Run** posts to `/api/projects/{pid}/runs` with
//!    `allocations[project_part_id] = [{real_part_id, quantity, lot}…]`.
//!    The server expands each allocation into its own
//!    `ProjectRunPart` + negative `StockEntry`, so the audit trail
//!    records exactly which real parts were consumed.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};

use leptos::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;
use web_sys::{HtmlInputElement, HtmlTextAreaElement};

use crate::api;
use crate::types::{PartListResponse, PartRow, RunPreviewLine};
use crate::{DataVersion, RunProjectCtx, RunProjectState};

/// Local-resource type for the per-line "meta-part matches" fetch.
/// Aliased so the prop signatures don't blow up.
type MatchesResource = LocalResource<Result<PartListResponse, api::ApiError>>;

/// Per-allocation editable form state. Each one becomes one
/// `RunAllocation` on submit.
#[derive(Clone, Debug)]
struct EditableAllocation {
    /// Stable across signal updates so `<For key=…>` can DOM-reuse
    /// the row. Without this, focus flips to the next render.
    key: u32,
    real_part_id: Option<i32>,
    real_part_name: String,
    real_part_stock: Option<i32>,
    real_part_is_meta: bool,
    quantity: String,
    lot_number: String,
}

static ALLOC_KEY: AtomicU32 = AtomicU32::new(1);
fn next_alloc_key() -> u32 {
    ALLOC_KEY.fetch_add(1, Ordering::Relaxed)
}

#[component]
pub fn RunProjectDialog() -> impl IntoView {
    let state = expect_context::<RunProjectState>().0;
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
fn Body(ctx: RunProjectCtx) -> impl IntoView {
    let state = expect_context::<RunProjectState>().0;
    let data_version = expect_context::<DataVersion>().0;
    let pid = ctx.project_id;
    let project_name = ctx.project_name.clone();

    let quantity = RwSignal::new(1i32);
    let comment = RwSignal::new(String::new());
    // Per-BOM-line allocation list. Keyed by project_part_id.
    let allocations = RwSignal::new(HashMap::<i32, Vec<EditableAllocation>>::new());
    // Latch — initial pre-fill happens once when the first preview
    // load lands. Subsequent quantity changes don't blow away
    // operator edits; operator can use the per-line "Reset" button
    // if they want to reset.
    let initialized = RwSignal::new(false);
    let saving = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);

    // Preview refetches whenever `quantity` changes.
    let preview = LocalResource::new(move || {
        let q = quantity.get();
        async move {
            if q < 1 { return Ok(Vec::<RunPreviewLine>::new()); }
            api::fetch_run_preview(pid, q).await
        }
    });

    // First-time pre-fill: when preview lands, seed allocations.
    Effect::new(move |_| {
        if initialized.get() { return; }
        if let Some(res) = preview.get() {
            if let Ok(lines) = &*res {
                let mut map = HashMap::<i32, Vec<EditableAllocation>>::new();
                for line in lines {
                    if line.is_meta {
                        // Meta-part lines start empty — operator must pick.
                        map.insert(line.project_part_id, Vec::new());
                    } else if let Some(part_id) = line.part_id {
                        // Real-part lines pre-fill one allocation with
                        // the BOM's part at full effective qty.
                        map.insert(line.project_part_id, vec![EditableAllocation {
                            key: next_alloc_key(),
                            real_part_id: Some(part_id),
                            real_part_name: line.part_name.clone().unwrap_or_default(),
                            real_part_stock: line.current_stock,
                            real_part_is_meta: false,
                            quantity: line.effective.to_string(),
                            lot_number: line.lot_number.clone(),
                        }]);
                    } else {
                        // Orphan — backend will reject; keep empty here.
                        map.insert(line.project_part_id, Vec::new());
                    }
                }
                allocations.set(map);
                initialized.set(true);
            }
        }
    });

    let close = move || state.set(None);
    let close_btn = move |_: leptos::ev::MouseEvent| close();

    let on_run = move |_: leptos::ev::MouseEvent| {
        let q = quantity.get();
        if q < 1 {
            error.set(Some("Quantity must be at least 1.".into()));
            return;
        }

        // Build the wire allocations map, dropping rows that don't
        // resolve to a real part or have non-positive qty (the
        // backend would reject those anyway).
        let mut wire_allocs: HashMap<String, Vec<api::RunAllocation>> = HashMap::new();
        for (line_id, list) in allocations.get().into_iter() {
            let wire: Vec<api::RunAllocation> = list.into_iter()
                .filter_map(|a| {
                    let rid = a.real_part_id?;
                    let qty: i32 = a.quantity.trim().parse().ok()?;
                    if qty <= 0 { return None; }
                    Some(api::RunAllocation {
                        real_part_id: rid,
                        quantity: qty,
                        lot_number: if a.lot_number.is_empty() { None } else { Some(a.lot_number) },
                    })
                })
                .collect();
            if !wire.is_empty() {
                wire_allocs.insert(line_id.to_string(), wire);
            }
        }

        let body = api::RunRequest {
            quantity: q,
            comment: {
                let c = comment.get();
                if c.trim().is_empty() { None } else { Some(c) }
            },
            lot_overrides: HashMap::new(),
            allocations: wire_allocs,
        };
        saving.set(true);
        error.set(None);
        spawn_local(async move {
            let res = api::post_run(pid, body).await;
            saving.set(false);
            match res {
                Ok(_) => {
                    data_version.update(|v| *v += 1);
                    state.set(None);
                }
                Err(e) => error.set(Some(e.0)),
            }
        });
    };

    view! {
        <div class="modal-backdrop" on:click=close_btn>
            <div class="modal modal-wide modal-tall" on:click=|e| e.stop_propagation()>
                <div class="modal-head">
                    <h3>{format!("Run \"{}\"", project_name)}</h3>
                    <button class="modal-close" on:click=close_btn>"✕"</button>
                </div>
                <div class="modal-body">
                    <div class="form-row">
                        <label>"Quantity (builds)"</label>
                        <input type="number" min="1" autofocus="true"
                            prop:value={move || quantity.get().to_string()}
                            on:input=move |ev: leptos::ev::Event| {
                                let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                                    .and_then(|e| e.value().parse().ok()).unwrap_or(1);
                                quantity.set(v.max(1));
                            }/>
                    </div>
                    <div class="form-row form-row-tall">
                        <label>"Comment"</label>
                        <textarea rows="2" placeholder="Optional note attached to every stock entry"
                            prop:value={move || comment.get()}
                            on:input=move |ev: leptos::ev::Event| {
                                let v = ev.target().and_then(|t| t.dyn_into::<HtmlTextAreaElement>().ok())
                                    .map(|e| e.value()).unwrap_or_default();
                                comment.set(v);
                            }/>
                    </div>
                    <h4 class="run-preview-title">"Stock impact"</h4>
                    <Suspense fallback=|| view! {
                        <p class="muted" style:padding="6px 0">"Computing preview…"</p>
                    }>
                        {move || preview.get().map(|res| match &*res {
                            Err(e) => view! {
                                <p class="muted">{format!("Preview error: {}", e.0)}</p>
                            }.into_any(),
                            Ok(lines) => {
                                if lines.is_empty() {
                                    return view! {
                                        <p class="muted">
                                            "Project has no BOM lines — add parts before running."
                                        </p>
                                    }.into_any();
                                }
                                let lines_v = lines.clone();
                                view! {
                                    <For
                                        each=move || lines_v.clone()
                                        key=|l| l.project_part_id
                                        let:line>
                                        <LineGroup line=line allocations=allocations/>
                                    </For>
                                }.into_any()
                            }
                        })}
                    </Suspense>
                    <Show when=move || error.get().is_some()>
                        <div class="modal-error">{move || error.get().unwrap_or_default()}</div>
                    </Show>
                </div>
                <div class="modal-foot">
                    <button class="btn-secondary" on:click=close_btn>"Cancel"</button>
                    <button class="btn-success"
                        prop:disabled=move || saving.get()
                        on:click=on_run>{
                            move || if saving.get() { "Running…" } else { "▶ Run" }
                        }</button>
                </div>
            </div>
        </div>
    }
}

#[component]
fn LineGroup(
    line: RunPreviewLine,
    allocations: RwSignal<HashMap<i32, Vec<EditableAllocation>>>,
) -> impl IntoView {
    let line_id = line.project_part_id;
    let part_name = line.part_name.clone().unwrap_or_else(|| "(missing part)".into());
    let is_meta = line.is_meta;
    let required = line.effective;
    let bom_part_id = line.part_id;
    let bom_part_name = part_name.clone();
    let bom_part_stock = line.current_stock;
    let bom_lot = line.lot_number.clone();

    // For meta-part lines, fetch the candidate match list once. Each
    // AllocationRow on this line subscribes to the same resource —
    // LocalResource caches, so adding a new allocation row doesn't
    // refetch.
    let matches: Option<MatchesResource> = if is_meta {
        let mid = bom_part_id.unwrap_or(0);
        Some(LocalResource::new(move || async move {
            api::fetch_part_matches(mid, 200, 0).await
        }))
    } else {
        None
    };

    let line_allocs = move || allocations.with(|m| m.get(&line_id).cloned().unwrap_or_default());

    let allocated_total = move || {
        line_allocs().iter()
            .filter_map(|a| a.quantity.trim().parse::<i32>().ok())
            .sum::<i32>()
    };
    let mismatch = move || allocated_total() != required;

    let on_add = move |_: leptos::ev::MouseEvent| {
        allocations.update(|m| {
            m.entry(line_id).or_default().push(EditableAllocation {
                key: next_alloc_key(),
                real_part_id: None,
                real_part_name: String::new(),
                real_part_stock: None,
                real_part_is_meta: false,
                quantity: "0".into(),
                lot_number: String::new(),
            });
        });
    };

    // "Reset" returns this line to its pre-fill state. For real-part
    // lines, that's [BOM-part, full effective qty]; for meta-part
    // lines, that's an empty allocation list (operator picks again).
    let on_reset = move |_: leptos::ev::MouseEvent| {
        allocations.update(|m| {
            let new_list = if is_meta {
                Vec::new()
            } else if let Some(pid) = bom_part_id {
                vec![EditableAllocation {
                    key: next_alloc_key(),
                    real_part_id: Some(pid),
                    real_part_name: bom_part_name.clone(),
                    real_part_stock: bom_part_stock,
                    real_part_is_meta: false,
                    quantity: required.to_string(),
                    lot_number: bom_lot.clone(),
                }]
            } else {
                Vec::new()
            };
            m.insert(line_id, new_list);
        });
    };

    let group_class = if is_meta { "run-line-group run-line-meta" } else { "run-line-group" };

    view! {
        <div class={group_class}>
            <div class="run-line-header">
                <span class="run-line-name">{part_name}</span>
                {if is_meta {
                    view! { <span class="meta-tag">"(meta)"</span> }.into_any()
                } else { ().into_any() }}
                <span class="run-line-required muted">
                    {format!("required: {required}")}
                </span>
                <span class="run-line-allocated"
                    class:warn=mismatch>
                    {move || format!("allocated: {}", allocated_total())}
                </span>
                <div class="spacer"/>
                <button class="link-btn" title="Reset this line's allocations"
                    on:click=on_reset>"reset"</button>
            </div>
            <Show when=mismatch>
                <p class="run-warning">
                    {move || format!(
                        "Allocation mismatch — {} allocated for a required {}. \
                         Run will proceed; verify the discrepancy is intentional.",
                        allocated_total(), required
                    )}
                </p>
            </Show>
            <For
                each=line_allocs
                key=|a| a.key
                let:alloc>
                <AllocationRow line_id=line_id alloc=alloc allocations=allocations matches=matches/>
            </For>
            <button class="btn-action btn-add" on:click=on_add>
                "+ Add allocation"
            </button>
        </div>
    }
}

#[component]
fn AllocationRow(
    line_id: i32,
    alloc: EditableAllocation,
    allocations: RwSignal<HashMap<i32, Vec<EditableAllocation>>>,
    /// `Some` when this row is on a meta-part BOM line — the picker
    /// shows the meta-part's candidate matches by default. `None` for
    /// real-part lines (free-text search only).
    matches: Option<MatchesResource>,
) -> impl IntoView {
    let key = alloc.key;
    let initial_part_id = alloc.real_part_id;
    let initial_quantity = alloc.quantity.clone();
    let initial_lot = alloc.lot_number.clone();

    // Picker state. picker_open: are we picking a part? If a part is
    // already chosen we show a summary with a "change" link.
    // any_part_mode: when true and we're on a meta-line, the picker
    // switches from "show meta matches" to free-text search.
    let picker_search = RwSignal::new(String::new());
    let picker_open = RwSignal::new(initial_part_id.is_none());
    let any_part_mode = RwSignal::new(false);
    let on_meta_line = matches.is_some();

    let on_qty = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        update_alloc(allocations, line_id, key, |a| a.quantity = v);
    };
    let on_lot = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        update_alloc(allocations, line_id, key, |a| a.lot_number = v);
    };
    let on_remove = move |_: leptos::ev::MouseEvent| {
        allocations.update(|m| {
            if let Some(list) = m.get_mut(&line_id) {
                list.retain(|a| a.key != key);
            }
        });
    };
    let on_change_part = move |_: leptos::ev::MouseEvent| {
        picker_open.set(true);
    };

    // Search results — debounced via the LocalResource recompute.
    let search_results = LocalResource::new(move || {
        let q = picker_search.get();
        async move {
            if q.trim().is_empty() {
                return Ok(crate::types::PartListResponse {
                    items: Vec::new(),
                    total: 0,
                    limit: 0,
                    offset: 0,
                });
            }
            api::fetch_parts(
                None, None, None, None, None,
                q,
                30, 0,
                None, None,
                None,
            ).await
        }
    });

    let picked_label = move || {
        // Read live from allocations so the summary reflects state
        // changes (e.g. another row's pick doesn't matter, but if
        // someone else updates this row it still tracks).
        allocations.with(|m| {
            m.get(&line_id)
                .and_then(|list| list.iter().find(|a| a.key == key))
                .map(|a| a.real_part_name.clone())
                .unwrap_or_default()
        })
    };
    let picked_stock = move || {
        allocations.with(|m| {
            m.get(&line_id)
                .and_then(|list| list.iter().find(|a| a.key == key))
                .and_then(|a| a.real_part_stock)
        })
    };

    let on_pick = move |row: PartRow| {
        let name = row.name.clone();
        let id = row.id;
        let stock = row.stock_level;
        let is_meta = row.meta_part;
        update_alloc(allocations, line_id, key, |a| {
            a.real_part_id = Some(id);
            a.real_part_name = name;
            a.real_part_stock = Some(stock);
            a.real_part_is_meta = is_meta;
        });
        picker_search.set(String::new());
        picker_open.set(false);
    };

    view! {
        <div class="run-alloc-row">
            <div class="run-alloc-part">
                {move || {
                    if !picker_open.get() {
                        let label = picked_label();
                        let label_for_summary = label.clone();
                        return view! {
                            <span class="run-alloc-name" title=label>{label_for_summary}</span>
                            <button class="link-btn" on:click=on_change_part>"change"</button>
                        }.into_any();
                    }
                    // Picker is open. Three sub-modes:
                    //   1. real-part line: free-text search (the only option).
                    //   2. meta-part line, default: show the candidate
                    //      matches as a clickable list, with an "any part"
                    //      checkbox to switch modes.
                    //   3. meta-part line, any_part_mode: free-text search
                    //      with the same checkbox to switch back.
                    if !on_meta_line || any_part_mode.get() {
                        view! {
                            <PickerInline
                                search=picker_search
                                results=search_results
                                on_pick=Callback::new(move |(r,): (PartRow,)| on_pick(r))/>
                            <Show when=move || on_meta_line>
                                <label class="run-picker-toggle">
                                    <input type="checkbox" prop:checked=move || any_part_mode.get()
                                        on:change=move |ev: leptos::ev::Event| {
                                            use wasm_bindgen::JsCast;
                                            let v = ev.target()
                                                .and_then(|t| t.dyn_into::<web_sys::HtmlInputElement>().ok())
                                                .map(|e| e.checked()).unwrap_or(false);
                                            any_part_mode.set(v);
                                        }/>
                                    " Search any part (off-spec substitute)"
                                </label>
                            </Show>
                        }.into_any()
                    } else {
                        let matches_resource = matches.expect("on_meta_line implies matches=Some");
                        view! {
                            <MatchesPicker
                                matches=matches_resource
                                on_pick=Callback::new(move |(r,): (PartRow,)| on_pick(r))/>
                            <label class="run-picker-toggle">
                                <input type="checkbox" prop:checked=move || any_part_mode.get()
                                    on:change=move |ev: leptos::ev::Event| {
                                        use wasm_bindgen::JsCast;
                                        let v = ev.target()
                                            .and_then(|t| t.dyn_into::<web_sys::HtmlInputElement>().ok())
                                            .map(|e| e.checked()).unwrap_or(false);
                                        any_part_mode.set(v);
                                    }/>
                                " Search any part (off-spec substitute)"
                            </label>
                        }.into_any()
                    }
                }}
            </div>
            <input class="run-alloc-qty" type="number" min="0" placeholder="qty"
                prop:value=initial_quantity on:input=on_qty/>
            <span class="run-alloc-stock muted">
                {move || picked_stock().map(|s| format!("stock: {s}")).unwrap_or_default()}
            </span>
            <input class="run-alloc-lot" type="text" placeholder="lot"
                prop:value=initial_lot on:input=on_lot/>
            <button class="row-remove" title="Remove allocation"
                on:click=on_remove>"×"</button>
        </div>
    }
}

#[component]
fn MatchesPicker(
    matches: MatchesResource,
    on_pick: Callback<(PartRow,)>,
) -> impl IntoView {
    view! {
        <div class="run-picker">
            <Suspense fallback=|| view! {
                <p class="muted run-picker-status">"Loading matches…"</p>
            }>
                {move || matches.get().map(|res| match &*res {
                    Err(e) => view! {
                        <p class="muted run-picker-status">{format!("Error: {}", e.0)}</p>
                    }.into_any(),
                    Ok(resp) => {
                        if resp.items.is_empty() {
                            return view! {
                                <p class="muted run-picker-status">
                                    "No real parts currently match this meta-part. \
                                     Tick the box below to search any part."
                                </p>
                            }.into_any();
                        }
                        let items = resp.items.clone();
                        view! {
                            <p class="muted run-picker-status">
                                {format!("{} match{}", items.len(),
                                    if items.len() == 1 { "" } else { "es" })}
                            </p>
                            <div class="run-picker-results">
                                {items.into_iter().map(|row| {
                                    let row_for_pick = row.clone();
                                    let name = row.name.clone();
                                    let stock = row.stock_level;
                                    view! {
                                        <div class="run-picker-row"
                                            on:click=move |_| on_pick.run((row_for_pick.clone(),))>
                                            <span class="run-picker-name">{name}</span>
                                            <span class="run-picker-stock muted">
                                                {format!("stock: {stock}")}
                                            </span>
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

#[component]
fn PickerInline(
    search: RwSignal<String>,
    results: LocalResource<Result<crate::types::PartListResponse, api::ApiError>>,
    on_pick: Callback<(PartRow,)>,
) -> impl IntoView {
    view! {
        <div class="run-picker">
            <input type="text" placeholder="search parts…"
                prop:value=move || search.get()
                on:input=move |ev: leptos::ev::Event| {
                    let v = event_target_value(&ev);
                    search.set(v);
                }/>
            <Show when=move || !search.get().trim().is_empty()>
                <Suspense fallback=|| view! {
                    <p class="muted run-picker-status">"Searching…"</p>
                }>
                    {move || results.get().map(|res| match &*res {
                        Err(e) => view! {
                            <p class="muted run-picker-status">{format!("Error: {}", e.0)}</p>
                        }.into_any(),
                        Ok(resp) => {
                            if resp.items.is_empty() {
                                return view! {
                                    <p class="muted run-picker-status">"No matches."</p>
                                }.into_any();
                            }
                            let items = resp.items.clone();
                            view! {
                                <div class="run-picker-results">
                                    {items.into_iter().map(|row| {
                                        let row_for_pick = row.clone();
                                        let name = row.name.clone();
                                        let stock = row.stock_level;
                                        let is_meta = row.meta_part;
                                        let stock_disp = if is_meta {
                                            String::new()
                                        } else { format!("stock: {stock}") };
                                        view! {
                                            <div class="run-picker-row"
                                                class:meta-part-row=is_meta
                                                on:click=move |_| on_pick.run((row_for_pick.clone(),))>
                                                <span class="run-picker-name">{name}</span>
                                                {if is_meta {
                                                    view! { <span class="meta-tag">"(meta)"</span> }.into_any()
                                                } else { ().into_any() }}
                                                <span class="run-picker-stock muted">{stock_disp}</span>
                                            </div>
                                        }
                                    }).collect::<Vec<_>>()}
                                </div>
                            }.into_any()
                        }
                    })}
                </Suspense>
            </Show>
        </div>
    }
}

fn update_alloc<F>(
    allocations: RwSignal<HashMap<i32, Vec<EditableAllocation>>>,
    line_id: i32,
    key: u32,
    f: F,
) where F: FnOnce(&mut EditableAllocation) {
    allocations.update(|m| {
        if let Some(list) = m.get_mut(&line_id) {
            if let Some(a) = list.iter_mut().find(|a| a.key == key) {
                f(a);
            }
        }
    });
}

// Quiet dead-code warnings on the helpers held only for symmetry with
// the BOM-line dialog's PartPicker pattern.
#[allow(dead_code)]
fn _unused_initial(_p: Option<i32>, _s: Option<i32>) {}
