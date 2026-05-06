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

use crate::api::{self, Predicate};
use crate::types::{ParameterNameRow, SiPrefixRow};
use crate::PredicatesState;

#[component]
pub fn ParametricFilter() -> impl IntoView {
    let predicates = expect_context::<PredicatesState>().0;
    let collapsed = RwSignal::new(predicates.get_untracked().is_empty());

    // Names + SI prefixes are loaded once. Both are small (<200 rows
    // each) and effectively immutable during a session.
    let names = LocalResource::new(|| api::fetch_parameter_names());
    let prefixes = LocalResource::new(|| api::fetch_si_prefixes_rich());

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
    let on_clear = move |_| predicates.set(Vec::new());

    view! {
        <div class="parametric-filter">
            <div class="parametric-header">
                <button class="parametric-toggle"
                    on:click=move |_| collapsed.update(|v| *v = !*v)>
                    {move || if collapsed.get() { "▶" } else { "▼" }}
                    " Filters"
                    {move || {
                        let n = predicates.with(|v| v.len());
                        if n == 0 { String::new() } else { format!(" ({n})") }
                    }}
                </button>
                <div class="spacer"/>
                <button class="btn-success btn-attach" on:click=on_add>"+ Add filter"</button>
                <Show when=move || !predicates.with(|v| v.is_empty())>
                    <button class="btn-secondary" on:click=on_clear>"Clear all"</button>
                </Show>
            </div>
            <Show when=move || !collapsed.get()>
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
