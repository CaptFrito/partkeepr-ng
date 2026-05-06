//! Slice 5c-4: center-pane lookup tables.
//!
//! When LeftPaneMode is Lookups, the parts grid is hidden and this panel
//! takes its place. Renders the table for the entity selected in
//! LookupTypeList, with a "+ Add" button and per-row hover edit/delete.

use leptos::prelude::*;
use serde_json::json;

use crate::api;
use crate::types::{
    DistributorRow, ManufacturerRow, PartUnitRow, SiPrefixRow, UnitRow,
};
use crate::{
    DataVersion, LookupEditCtx, LookupEditMode, LookupEditState, LookupKind, SelectedLookup,
};

#[component]
pub fn LookupsPanel() -> impl IntoView {
    let selected = expect_context::<SelectedLookup>().0;
    let edit_state = expect_context::<LookupEditState>().0;

    let title = move || match selected.get() {
        LookupKind::Manufacturers => "Manufacturers",
        LookupKind::Distributors  => "Distributors",
        LookupKind::PartUnits     => "Part Units",
        LookupKind::Units         => "Units",
        LookupKind::SiPrefixes    => "SI Prefixes",
    };

    let on_add = move |_| {
        let kind = selected.get();
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Create,
            kind,
            id: 0,
            name: String::new(),
            data: json!({}),
            block_counts: Vec::new(),
        }));
    };

    view! {
        <div class="lookups-panel">
            <div class="toolbar">
                <h2 class="lookups-title">{title}</h2>
                <div class="spacer"/>
                <button class="btn-success" on:click=on_add>{move || format!("+ Add {}", singular(title()))}</button>
            </div>
            {move || match selected.get() {
                LookupKind::Manufacturers => view! { <MfgTable/> }.into_any(),
                LookupKind::Distributors  => view! { <DistTable/> }.into_any(),
                LookupKind::PartUnits     => view! { <PartUnitTable/> }.into_any(),
                LookupKind::Units         => view! { <UnitTable/> }.into_any(),
                LookupKind::SiPrefixes    => view! { <SiPrefixTable/> }.into_any(),
            }}
        </div>
    }
}

/// English singular for the "+ Add X" button. Quick lookup, not a
/// general utility — only the five labels below ever get passed in.
fn singular(plural: &str) -> &str {
    match plural {
        "Manufacturers" => "Manufacturer",
        "Distributors"  => "Distributor",
        "Part Units"    => "Part Unit",
        "Units"         => "Unit",
        "SI Prefixes"   => "SI Prefix",
        other => other,
    }
}

// ---------------------------------------------------------------------------
//  Manufacturer table
// ---------------------------------------------------------------------------

#[component]
fn MfgTable() -> impl IntoView {
    let edit_state = expect_context::<LookupEditState>().0;
    let data_version = expect_context::<DataVersion>().0;
    let rows = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_manufacturers_full()
    });
    view! {
        <Suspense fallback=|| view! { <p class="muted" style="padding:12px">"Loading…"</p> }>
            {move || rows.get().map(|res| match &*res {
                Err(e) => view! {
                    <p class="muted" style="padding:12px">{format!("Error: {}", e.0)}</p>
                }.into_any(),
                Ok(data) => {
                    let count = data.len();
                    let items = data.clone();
                    view! {
                        <p class="lookups-count">{format!("{count} manufacturer{}", if count == 1 {""} else {"s"})}</p>
                        <table class="parts">
                            <thead><tr>
                                <th class="right">"#"</th>
                                <th>"Name"</th>
                                <th>"URL"</th>
                                <th>"Email / phone"</th>
                                <th class="right">"Parts"</th>
                                <th class="right">""</th>
                            </tr></thead>
                            <tbody>{
                                items.into_iter().map(|m| view! { <MfgRow m=m/> }).collect::<Vec<_>>()
                            }</tbody>
                        </table>
                    }.into_any()
                }
            })}
        </Suspense>
    }
}

#[component]
fn MfgRow(m: ManufacturerRow) -> impl IntoView {
    let edit_state = expect_context::<LookupEditState>().0;
    let id = m.id;
    let name_for_edit = m.name.clone();
    let name_for_del = m.name.clone();
    let part_count = m.part_count;
    let row_data = serde_json::to_value(&m).unwrap_or(json!({}));
    let row_data_for_edit = row_data.clone();

    let on_edit = move |_| {
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Edit,
            kind: LookupKind::Manufacturers,
            id,
            name: name_for_edit.clone(),
            data: row_data_for_edit.clone(),
            block_counts: Vec::new(),
        }));
    };
    let on_delete = move |e: leptos::ev::MouseEvent| {
        e.stop_propagation();
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Delete,
            kind: LookupKind::Manufacturers,
            id,
            name: name_for_del.clone(),
            data: json!({}),
            block_counts: vec![("part".to_string(), part_count)],
        }));
    };

    view! {
        <tr class="lookup-row" on:click=on_edit>
            <td class="right">{m.id}</td>
            <td>{m.name}</td>
            <td class="muted">{m.url.unwrap_or_default()}</td>
            <td class="muted">{format!("{} {}", m.email.unwrap_or_default(), m.phone.unwrap_or_default()).trim().to_string()}</td>
            <td class="right">{m.part_count}</td>
            <td class="right">
                <button class="tree-act tree-act-del"
                    title="Delete" on:click=on_delete>"🗑"</button>
            </td>
        </tr>
    }
}

// ---------------------------------------------------------------------------
//  Distributor table
// ---------------------------------------------------------------------------

#[component]
fn DistTable() -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let rows = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_distributors_full()
    });
    view! {
        <Suspense fallback=|| view! { <p class="muted" style="padding:12px">"Loading…"</p> }>
            {move || rows.get().map(|res| match &*res {
                Err(e) => view! {
                    <p class="muted" style="padding:12px">{format!("Error: {}", e.0)}</p>
                }.into_any(),
                Ok(data) => {
                    let count = data.len();
                    let items = data.clone();
                    view! {
                        <p class="lookups-count">{format!("{count} distributor{}", if count == 1 {""} else {"s"})}</p>
                        <table class="parts">
                            <thead><tr>
                                <th class="right">"#"</th>
                                <th>"Name"</th>
                                <th>"URL"</th>
                                <th>"Reports"</th>
                                <th class="right">"Parts"</th>
                                <th class="right">""</th>
                            </tr></thead>
                            <tbody>{
                                items.into_iter().map(|d| view! { <DistRow d=d/> }).collect::<Vec<_>>()
                            }</tbody>
                        </table>
                    }.into_any()
                }
            })}
        </Suspense>
    }
}

#[component]
fn DistRow(d: DistributorRow) -> impl IntoView {
    let edit_state = expect_context::<LookupEditState>().0;
    let id = d.id;
    let name_for_edit = d.name.clone();
    let name_for_del = d.name.clone();
    let part_count = d.part_count;
    let row_data = serde_json::to_value(&d).unwrap_or(json!({}));
    let row_data_for_edit = row_data.clone();

    let on_edit = move |_| {
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Edit,
            kind: LookupKind::Distributors,
            id,
            name: name_for_edit.clone(),
            data: row_data_for_edit.clone(),
            block_counts: Vec::new(),
        }));
    };
    let on_delete = move |e: leptos::ev::MouseEvent| {
        e.stop_propagation();
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Delete,
            kind: LookupKind::Distributors,
            id,
            name: name_for_del.clone(),
            data: json!({}),
            block_counts: vec![("part".to_string(), part_count)],
        }));
    };

    view! {
        <tr class="lookup-row" on:click=on_edit>
            <td class="right">{d.id}</td>
            <td>{d.name}</td>
            <td class="muted">{d.url.unwrap_or_default()}</td>
            <td>{if d.enabled_for_reports { "yes" } else { "no" }}</td>
            <td class="right">{d.part_count}</td>
            <td class="right">
                <button class="tree-act tree-act-del"
                    title="Delete" on:click=on_delete>"🗑"</button>
            </td>
        </tr>
    }
}

// ---------------------------------------------------------------------------
//  PartUnit table
// ---------------------------------------------------------------------------

#[component]
fn PartUnitTable() -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let rows = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_part_units_full()
    });
    view! {
        <Suspense fallback=|| view! { <p class="muted" style="padding:12px">"Loading…"</p> }>
            {move || rows.get().map(|res| match &*res {
                Err(e) => view! {
                    <p class="muted" style="padding:12px">{format!("Error: {}", e.0)}</p>
                }.into_any(),
                Ok(data) => {
                    let items = data.clone();
                    view! {
                        <table class="parts">
                            <thead><tr>
                                <th class="right">"#"</th>
                                <th>"Name"</th>
                                <th>"Short"</th>
                                <th>"Default"</th>
                                <th class="right">"Parts"</th>
                                <th class="right">""</th>
                            </tr></thead>
                            <tbody>{
                                items.into_iter().map(|p| view! { <PartUnitRowView p=p/> }).collect::<Vec<_>>()
                            }</tbody>
                        </table>
                    }.into_any()
                }
            })}
        </Suspense>
    }
}

#[component]
fn PartUnitRowView(p: PartUnitRow) -> impl IntoView {
    let edit_state = expect_context::<LookupEditState>().0;
    let id = p.id;
    let name_for_edit = p.name.clone();
    let name_for_del = p.name.clone();
    let part_count = p.part_count;
    let row_data = serde_json::to_value(&p).unwrap_or(json!({}));
    let row_data_for_edit = row_data.clone();

    let on_edit = move |_| {
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Edit,
            kind: LookupKind::PartUnits,
            id,
            name: name_for_edit.clone(),
            data: row_data_for_edit.clone(),
            block_counts: Vec::new(),
        }));
    };
    let on_delete = move |e: leptos::ev::MouseEvent| {
        e.stop_propagation();
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Delete,
            kind: LookupKind::PartUnits,
            id,
            name: name_for_del.clone(),
            data: json!({}),
            block_counts: vec![("part".to_string(), part_count)],
        }));
    };

    view! {
        <tr class="lookup-row" on:click=on_edit>
            <td class="right">{p.id}</td>
            <td>{p.name}</td>
            <td>{p.short_name}</td>
            <td>{if p.is_default { "★" } else { "" }}</td>
            <td class="right">{p.part_count}</td>
            <td class="right">
                <button class="tree-act tree-act-del"
                    title="Delete" on:click=on_delete>"🗑"</button>
            </td>
        </tr>
    }
}

// ---------------------------------------------------------------------------
//  Unit table (with M:M prefix list)
// ---------------------------------------------------------------------------

#[component]
fn UnitTable() -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let rows = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_units_rich()
    });
    view! {
        <Suspense fallback=|| view! { <p class="muted" style="padding:12px">"Loading…"</p> }>
            {move || rows.get().map(|res| match &*res {
                Err(e) => view! {
                    <p class="muted" style="padding:12px">{format!("Error: {}", e.0)}</p>
                }.into_any(),
                Ok(data) => {
                    let items = data.clone();
                    view! {
                        <table class="parts">
                            <thead><tr>
                                <th class="right">"#"</th>
                                <th>"Name"</th>
                                <th>"Symbol"</th>
                                <th class="right">"# Prefixes"</th>
                                <th class="right">"# Params"</th>
                                <th class="right">""</th>
                            </tr></thead>
                            <tbody>{
                                items.into_iter().map(|u| view! { <UnitRowView u=u/> }).collect::<Vec<_>>()
                            }</tbody>
                        </table>
                    }.into_any()
                }
            })}
        </Suspense>
    }
}

#[component]
fn UnitRowView(u: UnitRow) -> impl IntoView {
    let edit_state = expect_context::<LookupEditState>().0;
    let id = u.id;
    let name_for_edit = u.name.clone();
    let name_for_del = u.name.clone();
    let parameter_count = u.parameter_count;
    let prefix_count = u.allowed_prefix_ids.len() as i64;
    let row_data = serde_json::to_value(&u).unwrap_or(json!({}));
    let row_data_for_edit = row_data.clone();

    let on_edit = move |_| {
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Edit,
            kind: LookupKind::Units,
            id,
            name: name_for_edit.clone(),
            data: row_data_for_edit.clone(),
            block_counts: Vec::new(),
        }));
    };
    let on_delete = move |e: leptos::ev::MouseEvent| {
        e.stop_propagation();
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Delete,
            kind: LookupKind::Units,
            id,
            name: name_for_del.clone(),
            data: json!({}),
            block_counts: vec![("parameter".to_string(), parameter_count)],
        }));
    };

    view! {
        <tr class="lookup-row" on:click=on_edit>
            <td class="right">{u.id}</td>
            <td>{u.name}</td>
            <td>{u.symbol}</td>
            <td class="right">{prefix_count}</td>
            <td class="right">{u.parameter_count}</td>
            <td class="right">
                <button class="tree-act tree-act-del"
                    title="Delete" on:click=on_delete>"🗑"</button>
            </td>
        </tr>
    }
}

// ---------------------------------------------------------------------------
//  SiPrefix table
// ---------------------------------------------------------------------------

#[component]
fn SiPrefixTable() -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let rows = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_si_prefixes_rich()
    });
    view! {
        <Suspense fallback=|| view! { <p class="muted" style="padding:12px">"Loading…"</p> }>
            {move || rows.get().map(|res| match &*res {
                Err(e) => view! {
                    <p class="muted" style="padding:12px">{format!("Error: {}", e.0)}</p>
                }.into_any(),
                Ok(data) => {
                    let items = data.clone();
                    view! {
                        <table class="parts">
                            <thead><tr>
                                <th class="right">"#"</th>
                                <th>"Prefix"</th>
                                <th>"Symbol"</th>
                                <th class="right">"Base"</th>
                                <th class="right">"Exp"</th>
                                <th class="right">"Multiplier"</th>
                                <th class="right">"# Params"</th>
                                <th class="right">"# Units"</th>
                                <th class="right">""</th>
                            </tr></thead>
                            <tbody>{
                                items.into_iter().map(|s| view! { <SiPrefixRowView s=s/> }).collect::<Vec<_>>()
                            }</tbody>
                        </table>
                    }.into_any()
                }
            })}
        </Suspense>
    }
}

#[component]
fn SiPrefixRowView(s: SiPrefixRow) -> impl IntoView {
    let edit_state = expect_context::<LookupEditState>().0;
    let id = s.id;
    let name_for_edit = s.prefix.clone();
    let name_for_del = s.prefix.clone();
    let parameter_count = s.parameter_count;
    let unit_count = s.unit_count;
    let multiplier = format!("{}^{}", s.base, s.exponent);
    let row_data = serde_json::to_value(&s).unwrap_or(json!({}));
    let row_data_for_edit = row_data.clone();

    let on_edit = move |_| {
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Edit,
            kind: LookupKind::SiPrefixes,
            id,
            name: name_for_edit.clone(),
            data: row_data_for_edit.clone(),
            block_counts: Vec::new(),
        }));
    };
    let on_delete = move |e: leptos::ev::MouseEvent| {
        e.stop_propagation();
        edit_state.set(Some(LookupEditCtx {
            mode: LookupEditMode::Delete,
            kind: LookupKind::SiPrefixes,
            id,
            name: name_for_del.clone(),
            data: json!({}),
            block_counts: vec![
                ("parameter".to_string(), parameter_count),
                ("unit".to_string(), unit_count),
            ],
        }));
    };

    view! {
        <tr class="lookup-row" on:click=on_edit>
            <td class="right">{s.id}</td>
            <td>{s.prefix}</td>
            <td>{s.symbol}</td>
            <td class="right">{s.base}</td>
            <td class="right">{s.exponent}</td>
            <td class="right">{multiplier}</td>
            <td class="right">{s.parameter_count}</td>
            <td class="right">{s.unit_count}</td>
            <td class="right">
                <button class="tree-act tree-act-del"
                    title="Delete" on:click=on_delete>"🗑"</button>
            </td>
        </tr>
    }
}
