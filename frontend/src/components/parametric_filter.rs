//! Slice 11b: parametric filter pane.
//!
//! Sits above the parts grid (in Categories / Storage / Footprints
//! modes). One predicate per row; multiple rows AND together.
//!
//! Each row carries a parameter dropdown (loaded once from
//! `/api/part_parameters/names`), an operator dropdown filtered by the
//! parameter's value_type, and a value input — text for string, number
//! plus optional SI-prefix dropdown for numeric.
//!
//! Predicate state lives in `PredicatesState` (a `RwSignal<Vec<Predicate>>`
//! provided as context). Changes there are mirrored to the URL hash by
//! main.rs so a filtered view is shareable / reload-survivable.

use leptos::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{HtmlInputElement, HtmlSelectElement};

use crate::api::{self, FieldFilters, LookupOption, Predicate};
use crate::types::{ParameterNameRow, SiPrefixRow};
use crate::{FieldFiltersState, PredicatesState};

#[component]
pub fn ParametricFilter() -> impl IntoView {
    let predicates = expect_context::<PredicatesState>().0;
    let field_filters = expect_context::<FieldFiltersState>().0;
    // Default-collapsed when nothing is set; expanded when there's any
    // active filter to surface why the grid is filtered.
    let any_active = move || {
        !predicates.with(|v| v.is_empty())
            || field_filters.with(|f| {
                f.stock_mode.is_some()
                    || f.distributor_id.is_some()
                    || f.price_min.is_some()
                    || f.price_max.is_some()
                    || f.created_after.is_some()
                    || f.recurse_categories == Some(false)
            })
    };
    let collapsed = RwSignal::new(!any_active());

    // Names + SI prefixes are loaded once. Both are small (<200 rows
    // each) and effectively immutable during a session.
    let names = LocalResource::new(|| api::fetch_parameter_names());
    let prefixes = LocalResource::new(|| api::fetch_si_prefixes_rich());
    let distributors = LocalResource::new(|| api::fetch_distributors());

    let on_add = move |_| {
        predicates.update(|v| {
            v.push(Predicate {
                name: String::new(),
                op: "=".to_string(),
                value_type: "numeric".to_string(),
                ..Default::default()
            });
        });
        collapsed.set(false);
    };
    let on_clear_all = move |_| {
        predicates.set(Vec::new());
        field_filters.set(FieldFilters::default());
    };
    let active_count = move || {
        let preds = predicates.with(|v| v.len());
        let fields = field_filters.with(|f| {
            (f.stock_mode.is_some() as usize)
                + (f.distributor_id.is_some() as usize)
                + (f.price_min.is_some() as usize)
                + (f.price_max.is_some() as usize)
                + (f.created_after.is_some() as usize)
                + (if f.recurse_categories == Some(false) { 1 } else { 0 })
        });
        preds + fields
    };

    view! {
        <div class="parametric-filter">
            <div class="parametric-header">
                <button class="parametric-toggle"
                    on:click=move |_| collapsed.update(|v| *v = !*v)>
                    {move || if collapsed.get() { "▶" } else { "▼" }}
                    " Filters"
                    {move || {
                        let n = active_count();
                        if n == 0 { String::new() } else { format!(" ({n})") }
                    }}
                </button>
                <div class="spacer"/>
                <Show when=move || any_active()>
                    <button class="btn-secondary" on:click=on_clear_all>"Clear all"</button>
                </Show>
            </div>
            <Show when=move || !collapsed.get()>
                // ----- By-field section (slice 6a) -----
                <FieldFilterRow distributors=distributors/>
                // ----- By-parameter section (slice 11b) -----
                <div class="filter-section-head">
                    <span class="filter-section-label">"By parameter"</span>
                    <div class="spacer"/>
                    <button class="btn-success btn-attach" on:click=on_add>"+ Add filter"</button>
                </div>
                <Suspense fallback=|| view! {
                    <p class="muted" style:padding="6px 0">"Loading parameter names…"</p>
                }>
                    {move || match (names.get(), prefixes.get()) {
                        (Some(n_res), Some(p_res)) => {
                            let names_v = match &*n_res {
                                Ok(v) => v.clone(),
                                Err(e) => {
                                    return view! {
                                        <p class="muted">{format!("Error: {}", e.0)}</p>
                                    }.into_any();
                                }
                            };
                            let prefixes_v = match &*p_res {
                                Ok(v) => v.clone(),
                                Err(e) => {
                                    return view! {
                                        <p class="muted">{format!("Error: {}", e.0)}</p>
                                    }.into_any();
                                }
                            };
                            view! {
                                <PredicateRows names=names_v prefixes=prefixes_v/>
                            }.into_any()
                        }
                        _ => view! { <span/> }.into_any(),
                    }}
                </Suspense>
            </Show>
        </div>
    }
}

#[component]
fn FieldFilterRow(
    distributors: LocalResource<Result<Vec<LookupOption>, api::ApiError>>,
) -> impl IntoView {
    let field_filters = expect_context::<FieldFiltersState>().0;

    // Stock-mode 4-way pill.
    let mode_btn = move |mode: Option<&'static str>, label: &'static str| -> AnyView {
        let mode_for_active = mode.map(|s| s.to_string());
        let mode_for_click = mode.map(|s| s.to_string());
        let active = move || field_filters.with(|f| f.stock_mode == mode_for_active);
        view! {
            <button class="meta-filter-btn"
                class:active=active
                on:click=move |_| {
                    let m = mode_for_click.clone();
                    field_filters.update(|f| f.stock_mode = m);
                }>{label}</button>
        }.into_any()
    };

    // Recurse checkbox — a `Some(false)` value means "no recursion";
    // `None` (default) keeps recursion on. Toggle flips between the two.
    let recurse_off = move || field_filters.with(|f| f.recurse_categories == Some(false));
    let on_recurse_toggle = move |ev: leptos::ev::Event| {
        use wasm_bindgen::JsCast;
        let checked = ev.target()
            .and_then(|t| t.dyn_into::<web_sys::HtmlInputElement>().ok())
            .map(|e| e.checked()).unwrap_or(true);
        field_filters.update(|f| {
            // Checkbox visible to user is "Include subcategories" — checked
            // = recurse (default), unchecked = exact match.
            f.recurse_categories = if checked { None } else { Some(false) };
        });
    };

    let dist_id = move || field_filters.with(|f| f.distributor_id);
    let on_distributor_change = move |ev: leptos::ev::Event| {
        use wasm_bindgen::JsCast;
        let raw = ev.target()
            .and_then(|t| t.dyn_into::<web_sys::HtmlSelectElement>().ok())
            .map(|e| e.value()).unwrap_or_default();
        let new_id: Option<i32> = if raw.is_empty() { None } else { raw.parse().ok() };
        field_filters.update(|f| f.distributor_id = new_id);
    };

    let price_min = move || field_filters.with(|f| f.price_min.clone()).unwrap_or_default();
    let on_price_min = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        field_filters.update(|f| {
            f.price_min = if v.trim().is_empty() { None } else { Some(v) };
        });
    };
    let price_max = move || field_filters.with(|f| f.price_max.clone()).unwrap_or_default();
    let on_price_max = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        field_filters.update(|f| {
            f.price_max = if v.trim().is_empty() { None } else { Some(v) };
        });
    };

    let created_after = move || field_filters.with(|f| f.created_after.clone()).unwrap_or_default();
    let on_created_after = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        field_filters.update(|f| {
            f.created_after = if v.trim().is_empty() { None } else { Some(v) };
        });
    };

    view! {
        <div class="filter-section-head">
            <span class="filter-section-label">"By field"</span>
        </div>
        <div class="field-filter-grid">
            <div class="field-filter-cell">
                <label class="field-filter-label">"Stock"</label>
                <div class="meta-filter">
                    {mode_btn(None, "Any")}
                    {mode_btn(Some("in_stock"), "In")}
                    {mode_btn(Some("out_of_stock"), "Out")}
                    {mode_btn(Some("low_stock"), "Low")}
                </div>
            </div>
            <div class="field-filter-cell">
                <label class="field-filter-label">"Distributor"</label>
                <select prop:value=move || dist_id().map(|n| n.to_string()).unwrap_or_default()
                    on:change=on_distributor_change>
                    <option value="">"(any)"</option>
                    <Suspense fallback=|| ()>
                        {move || distributors.get().map(|res| match &*res {
                            Err(_) => ().into_any(),
                            Ok(rows) => {
                                let opts = rows.clone();
                                view! {
                                    {opts.into_iter().map(|d| view! {
                                        <option value=d.id.to_string()>{d.name}</option>
                                    }).collect::<Vec<_>>()}
                                }.into_any()
                            }
                        })}
                    </Suspense>
                </select>
            </div>
            <div class="field-filter-cell">
                <label class="field-filter-label">"Price ≥"</label>
                <input type="text" placeholder="0.00"
                    prop:value=price_min on:input=on_price_min/>
            </div>
            <div class="field-filter-cell">
                <label class="field-filter-label">"Price ≤"</label>
                <input type="text" placeholder="0.00"
                    prop:value=price_max on:input=on_price_max/>
            </div>
            <div class="field-filter-cell">
                <label class="field-filter-label">"Created after"</label>
                <input type="date"
                    prop:value=created_after on:input=on_created_after/>
            </div>
            <div class="field-filter-cell field-filter-checkbox">
                <label>
                    <input type="checkbox"
                        prop:checked=move || !recurse_off()
                        on:change=on_recurse_toggle/>
                    " Include subcategories"
                </label>
            </div>
        </div>
    }
}

#[component]
fn PredicateRows(
    names: Vec<ParameterNameRow>,
    prefixes: Vec<SiPrefixRow>,
) -> impl IntoView {
    let predicates = expect_context::<PredicatesState>().0;
    // Memo: only re-fire when the predicate count changes. Without this,
    // the iteration closure re-runs on every keystroke (because every
    // input reads/writes the predicates signal), unmounting and
    // remounting the row's <input> elements — which is what caused the
    // focus-loss-after-each-keystroke bug.
    let row_count = Memo::new(move |_| predicates.with(|v| v.len()));
    view! {
        <Show when=move || row_count.get() == 0>
            <p class="muted" style:padding="6px 0">
                "Click "<strong>"+ Add filter"</strong>" to narrow the parts list by parameter."
            </p>
        </Show>
        {move || {
            let n = row_count.get();
            let names = names.clone();
            let prefixes = prefixes.clone();
            (0..n).map(|i| view! {
                <PredicateRow idx=i names=names.clone() prefixes=prefixes.clone()/>
            }).collect::<Vec<_>>()
        }}
    }
}

#[component]
fn PredicateRow(
    idx: usize,
    names: Vec<ParameterNameRow>,
    prefixes: Vec<SiPrefixRow>,
) -> impl IntoView {
    let predicates = expect_context::<PredicatesState>().0;

    // Snapshot getters for rendering without subscribing to the whole
    // Vec — read just our row's fields. The two we use to drive
    // structural rendering decisions (value-cell shape, operator
    // option list) get wrapped in Memos so they only fire when their
    // own value actually changes — without that, every keystroke fires
    // predicates and triggers a re-render that loses the operator
    // dropdown's selection and unmounts the value <input>.
    let row_name      = move || predicates.with(|v| v.get(idx).map(|p| p.name.clone()).unwrap_or_default());
    let row_op        = Memo::new(move |_| predicates.with(|v| v.get(idx).map(|p| p.op.clone()).unwrap_or_default()));
    let row_vtype     = Memo::new(move |_| predicates.with(|v| v.get(idx).map(|p| p.value_type.clone()).unwrap_or_default()));
    let row_str_val   = move || predicates.with(|v| v.get(idx).and_then(|p| p.string_value.clone()).unwrap_or_default());
    let row_num_val   = move || predicates.with(|v| v.get(idx).and_then(|p| p.value).map(|n| n.to_string()).unwrap_or_default());
    let row_prefix_id = move || predicates.with(|v| v.get(idx).and_then(|p| p.si_prefix_id));

    // When the parameter dropdown changes, look up the row's metadata
    // (value_type + dominant unit) and reset the row's value-shaped
    // fields so we don't carry a numeric value into a string predicate.
    let names_for_select = names.clone();
    let on_param_change = move |ev: leptos::ev::Event| {
        let v = ev.target().and_then(|t| t.dyn_into::<HtmlSelectElement>().ok())
            .map(|e| e.value()).unwrap_or_default();
        // The select's option value is "name|value_type" so we don't
        // collide on the same name appearing as both string and numeric.
        let (name, vtype) = match v.split_once('|') {
            Some((n, t)) => (n.to_string(), t.to_string()),
            None => (v, "numeric".to_string()),
        };
        predicates.update(|preds| {
            if let Some(p) = preds.get_mut(idx) {
                p.name = name;
                p.value_type = vtype.clone();
                // Reset value-shaped fields when value_type changes.
                p.string_value = None;
                p.string_values = None;
                p.value = None;
                p.values = None;
                // For numeric, default the SI prefix to the parameter's
                // dominant prefix-of-unit (use the unit's own base — we
                // can refine when we wire UnitSiPrefixes M:M into the
                // dropdown filtering). For now: clear it.
                p.si_prefix_id = None;
                // Reset op if the current op isn't legal for the new
                // value_type (e.g., 'like' on numeric).
                if vtype == "numeric" && p.op == "like" {
                    p.op = "=".to_string();
                }
            }
        });
        // Hide the names binding from the closure inferencer.
        let _ = &names_for_select;
    };

    let on_op_change = move |ev: leptos::ev::Event| {
        let v = ev.target().and_then(|t| t.dyn_into::<HtmlSelectElement>().ok())
            .map(|e| e.value()).unwrap_or_default();
        predicates.update(|preds| {
            if let Some(p) = preds.get_mut(idx) {
                p.op = v;
            }
        });
    };

    let on_string_value_input = move |ev: leptos::ev::Event| {
        let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
            .map(|e| e.value()).unwrap_or_default();
        predicates.update(|preds| {
            if let Some(p) = preds.get_mut(idx) {
                p.string_value = if v.is_empty() { None } else { Some(v) };
            }
        });
    };

    let on_numeric_value_input = move |ev: leptos::ev::Event| {
        let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
            .map(|e| e.value()).unwrap_or_default();
        let parsed: Option<f64> = if v.trim().is_empty() { None } else { v.parse().ok() };
        predicates.update(|preds| {
            if let Some(p) = preds.get_mut(idx) {
                p.value = parsed;
            }
        });
    };

    let on_prefix_change = move |ev: leptos::ev::Event| {
        let raw = ev.target().and_then(|t| t.dyn_into::<HtmlSelectElement>().ok())
            .map(|e| e.value()).unwrap_or_default();
        let new_id: Option<i32> = if raw.is_empty() { None } else { raw.parse().ok() };
        predicates.update(|preds| {
            if let Some(p) = preds.get_mut(idx) {
                p.si_prefix_id = new_id;
            }
        });
    };

    let on_remove = move |_: leptos::ev::MouseEvent| {
        predicates.update(|preds| {
            if idx < preds.len() {
                preds.remove(idx);
            }
        });
    };

    // Build the static option lists once per row render.
    let name_options: Vec<_> = {
        let mut sorted = names.clone();
        sorted.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        sorted
    };
    let prefix_options = prefixes.clone();

    view! {
        <div class="predicate-row">
            <select class="predicate-name"
                prop:value=move || {
                    let n = row_name();
                    let t = row_vtype.get();
                    if n.is_empty() { String::new() } else { format!("{n}|{t}") }
                }
                on:change=on_param_change>
                <option value="">"— pick parameter —"</option>
                {name_options.iter().map(|n| {
                    let value = format!("{}|{}", n.name, n.value_type);
                    let unit = n.dom_unit_symbol.clone().unwrap_or_default();
                    let suffix = if unit.is_empty() {
                        format!(" — {}", n.value_type)
                    } else {
                        format!(" — {} ({})", n.value_type, unit)
                    };
                    let label = format!("{}{}", n.name, suffix);
                    view! { <option value=value>{label}</option> }
                }).collect::<Vec<_>>()}
            </select>
            <select class="predicate-op"
                prop:value=move || row_op.get()
                on:change=on_op_change>
                <OperatorOptions value_type_fn=row_vtype.into()/>
            </select>
            // Numeric value + prefix vs. string value, picked off
            // value_type. Both share the predicate-value-cell wrapper so
            // the row layout stays consistent.
            {move || {
                let vt = row_vtype.get();
                if vt == "numeric" {
                    let prefixes = prefix_options.clone();
                    view! {
                        <span class="predicate-value-cell">
                            <input type="text"
                                class="predicate-value"
                                placeholder="value"
                                prop:value=row_num_val
                                on:input=on_numeric_value_input/>
                            <select class="predicate-prefix"
                                prop:value=move || row_prefix_id().map(|n| n.to_string()).unwrap_or_default()
                                on:change=on_prefix_change>
                                <option value="">"(no prefix)"</option>
                                {prefixes.into_iter().map(|p| {
                                    view! {
                                        <option value=p.id.to_string()>
                                            {format!("{} ({})", p.symbol, p.prefix)}
                                        </option>
                                    }
                                }).collect::<Vec<_>>()}
                            </select>
                        </span>
                    }.into_any()
                } else {
                    view! {
                        <span class="predicate-value-cell">
                            <input type="text"
                                class="predicate-value-string"
                                placeholder="value (use % as wildcard for 'like')"
                                prop:value=row_str_val
                                on:input=on_string_value_input/>
                        </span>
                    }.into_any()
                }
            }}
            <button class="tree-act tree-act-del" title="Remove filter"
                on:click=on_remove>"🗑"</button>
        </div>
    }
}

/// Operator <option> set, filtered by value_type. `like` is hidden for
/// numeric; everything else is allowed both ways (the backend rejects
/// invalid combinations with 400).
#[component]
fn OperatorOptions(
    value_type_fn: Signal<String>,
) -> impl IntoView {
    view! {
        {move || {
            let vt = value_type_fn.get();
            let ops: &[(&str, &str)] = if vt == "string" {
                &[
                    ("=",    "= equals"),
                    ("!=",   "≠ not equals"),
                    ("<",    "< less than"),
                    ("<=",   "≤ less than or equal"),
                    (">",    "> greater than"),
                    (">=",   "≥ greater than or equal"),
                    ("like", "% matches (wildcard)"),
                    ("in",   "∈ in list"),
                ]
            } else {
                &[
                    ("=",  "= equals"),
                    ("!=", "≠ not equals"),
                    ("<",  "< less than"),
                    ("<=", "≤ less than or equal"),
                    (">",  "> greater than"),
                    (">=", "≥ greater than or equal"),
                    ("in", "∈ in list"),
                ]
            };
            ops.iter().map(|(op, label)| view! {
                <option value=op.to_string()>{label.to_string()}</option>
            }).collect::<Vec<_>>()
        }}
    }
}
