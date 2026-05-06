//! Slice 8a: center-pane project editor.
//!
//! When LeftPaneMode is Projects, this panel renders. If no project is
//! selected, it shows a help blurb. Otherwise it renders the project's
//! header (name, description, action buttons), the BOM grid, and the
//! attachments section.
//!
//! Editing project name/description is via the ProjectEditDialog (modal),
//! the same dialog used for create + delete.

use leptos::prelude::*;

use crate::api;
use crate::components::AttachmentsSection;
use crate::types::{ProjectDetail, ProjectPartView, RunHistoryEntry};
use crate::{
    BomLineEditCtx, BomLineEditMode, BomLineEditState, DataVersion, ProjectEditCtx,
    ProjectEditMode, ProjectEditState, RunDeleteCtx, RunDeleteState, RunProjectCtx,
    RunProjectState, SelectedPart, SelectedProject,
};

#[component]
pub fn ProjectPanel() -> impl IntoView {
    let selected = expect_context::<SelectedProject>().0;
    // edit_state + bom_state are used inside the editor body (see
    // ProjectEditorBody); only `selected` is consulted up here.

    view! {
        <div class="project-panel">
            {move || match selected.get() {
                None => view! { <AllRunsView/> }.into_any(),
                Some(id) => view! { <ProjectEditor id=id/> }.into_any(),
            }}
        </div>
    }
}

#[component]
fn AllRunsView() -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let selected = expect_context::<SelectedProject>().0;
    let resource = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_all_runs(50, 0)
    });
    view! {
        <div class="all-runs-view">
            <h2 class="project-title">"All project runs"</h2>
            <p class="muted">
                "Newest 50 runs across every project. Pick a project on the left to "
                "edit its BOM, run it, or see its full history."
            </p>
            <Suspense fallback=|| view! {
                <p class="muted" style:padding="6px 0">"Loading runs…"</p>
            }>
                {move || resource.get().map(|res| match &*res {
                    Err(e) => view! {
                        <p class="muted" style:padding="6px 0">{format!("Error: {}", e.0)}</p>
                    }.into_any(),
                    Ok(resp) => {
                        if resp.items.is_empty() {
                            return view! {
                                <p class="muted" style:padding="6px 0">
                                    "No runs recorded yet."
                                </p>
                            }.into_any();
                        }
                        let total = resp.total;
                        let shown = resp.items.len();
                        let items = resp.items.clone();
                        view! {
                            <p class="muted">
                                {format!("Showing {} of {} total runs.", shown, total)}
                            </p>
                            <table class="parts all-runs-table">
                                <thead><tr>
                                    <th>"When"</th>
                                    <th>"Project"</th>
                                    <th class="right">"Builds"</th>
                                    <th class="right">"Lines"</th>
                                </tr></thead>
                                <tbody>{
                                    items.into_iter().map(|r| {
                                        let pid = r.project_id;
                                        let project_name = r.project_name.clone();
                                        let when = r.run_date_time.clone()
                                            .map(|s| format_iso_datetime(&s))
                                            .unwrap_or_else(|| "(no date)".into());
                                        let on_jump = move |_: leptos::ev::MouseEvent| {
                                            selected.set(Some(pid));
                                        };
                                        view! {
                                            <tr class="all-runs-row" on:click=on_jump>
                                                <td>{when}</td>
                                                <td>{project_name}</td>
                                                <td class="right">{r.quantity}</td>
                                                <td class="right">{r.line_count}</td>
                                            </tr>
                                        }
                                    }).collect::<Vec<_>>()
                                }</tbody>
                            </table>
                        }.into_any()
                    }
                })}
            </Suspense>
        </div>
    }
}

#[component]
fn ProjectEditor(id: i32) -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;

    // Refetch on data_version bump (BOM changes, attachment uploads, etc).
    let detail = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_project_detail(id)
    });

    view! {
        <Suspense fallback=|| view! {
            <p class="muted" style="padding:12px">"Loading project…"</p>
        }>
            {move || detail.get().map(|res| match &*res {
                Err(e) => view! {
                    <p class="muted" style="padding:12px">{format!("Error: {}", e.0)}</p>
                }.into_any(),
                Ok(d) => {
                    let d = d.clone();
                    view! { <ProjectEditorBody d=d/> }.into_any()
                }
            })}
        </Suspense>
    }
}

#[component]
fn ProjectEditorBody(d: ProjectDetail) -> impl IntoView {
    let edit_state = expect_context::<ProjectEditState>().0;
    let bom_state = expect_context::<BomLineEditState>().0;
    let run_state = expect_context::<RunProjectState>().0;

    let pid = d.id;
    let name = d.name.clone();
    let description = d.description.clone().unwrap_or_default();
    let parts_count = d.parts.len() as i64;
    let runs_count = d.runs_count;
    let any_bom = parts_count > 0;

    // Captured copies for the dialog-open closures.
    let name_for_rename = name.clone();
    let name_for_delete = name.clone();
    let name_for_run = name.clone();
    let desc_for_rename = description.clone();

    let on_rename = move |_| {
        edit_state.set(Some(ProjectEditCtx {
            mode: ProjectEditMode::Rename,
            id: pid,
            name: name_for_rename.clone(),
            description: desc_for_rename.clone(),
            parts_count,
            runs_count,
        }));
    };
    let on_delete = move |_| {
        edit_state.set(Some(ProjectEditCtx {
            mode: ProjectEditMode::Delete,
            id: pid,
            name: name_for_delete.clone(),
            description: String::new(),
            parts_count,
            runs_count,
        }));
    };
    let on_add_bom = move |_| {
        bom_state.set(Some(BomLineEditCtx {
            mode: BomLineEditMode::Add,
            project_id: pid,
            line_id: 0,
            part_id: None,
            part_name: String::new(),
            part_internal_part_number: String::new(),
            quantity: 1,
            remarks: String::new(),
            overage_type: String::new(),
            overage: 0,
            lot_number: String::new(),
        }));
    };
    let on_run = move |_| {
        run_state.set(Some(RunProjectCtx {
            project_id: pid,
            project_name: name_for_run.clone(),
        }));
    };

    let upload_path = format!("/api/projects/{pid}/attachments");
    let parts_for_section = d.parts.clone();
    let attachments = d.attachments.clone();

    view! {
        <div class="project-editor">
            <div class="toolbar">
                <h2 class="project-title">{name}</h2>
                <div class="spacer"/>
                <button class="btn-success" on:click=on_run
                    prop:disabled=move || !any_bom
                    title="Run this project: deduct BOM parts from stock and record a run">
                    "▶ Run Project"
                </button>
                <button class="btn-info" on:click=on_rename
                    title="Edit project name + description">
                    "✎ Edit"
                </button>
                <button class="btn-danger" on:click=on_delete
                    title="Delete this project (refused if it has run history)">
                    "🗑 Delete"
                </button>
            </div>
            <Show when={
                let d = description.clone();
                move || !d.is_empty()
            }>
                <p class="project-description">{description.clone()}</p>
            </Show>
            <h3 class="section-header bom-section-header">
                <span class="section-title">{format!("BOM ({} {})",
                    parts_count,
                    if parts_count == 1 { "part" } else { "parts" })}</span>
                <button class="btn-success btn-attach" on:click=on_add_bom>
                    "+ Add Part to BOM"
                </button>
            </h3>
            <BomTable project_id=pid parts=parts_for_section/>
            <RunHistorySection project_id=pid runs_count=runs_count/>
            <AttachmentsSection
                kind="ProjectAttachment"
                upload_path=upload_path
                attachments=attachments/>
        </div>
    }
}

#[component]
fn RunHistorySection(project_id: i32, runs_count: i64) -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let runs = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_run_history(project_id)
    });
    view! {
        <h3 class="section-header bom-section-header">
            <span class="section-title">{format!("Run history ({} {})",
                runs_count,
                if runs_count == 1 { "run" } else { "runs" })}</span>
        </h3>
        <Suspense fallback=|| view! {
            <p class="muted" style:padding="6px 0">"Loading run history…"</p>
        }>
            {move || runs.get().map(|res| match &*res {
                Err(e) => view! {
                    <p class="muted" style:padding="6px 0">{format!("Error: {}", e.0)}</p>
                }.into_any(),
                Ok(rows) => {
                    if rows.is_empty() {
                        return view! {
                            <p class="muted" style:padding="6px 0">
                                "No runs yet. Click ▶ Run Project to record one."
                            </p>
                        }.into_any();
                    }
                    let items = rows.clone();
                    view! {
                        <div class="run-history">
                            {items.into_iter().map(|r| view! { <RunCard project_id=project_id r=r/> }).collect::<Vec<_>>()}
                        </div>
                    }.into_any()
                }
            })}
        </Suspense>
    }
}

#[component]
fn RunCard(project_id: i32, r: RunHistoryEntry) -> impl IntoView {
    let delete_state = expect_context::<RunDeleteState>().0;
    let run_id = r.run.id;
    let when = r.run.run_date_time.clone()
        .map(|s| format_iso_datetime(&s))
        .unwrap_or_else(|| "(no date)".into());
    let when_for_dialog = when.clone();
    let qty = r.run.quantity;
    let line_count = r.lines.len();
    let lines = r.lines.clone();

    let on_delete = move |_: leptos::ev::MouseEvent| {
        delete_state.set(Some(RunDeleteCtx {
            project_id,
            run_id,
            when: when_for_dialog.clone(),
            run_qty: qty,
            line_count,
        }));
    };

    view! {
        <div class="run-card">
            <div class="run-card-head">
                <span class="run-card-when">{when}</span>
                <span class="run-card-meta muted">{format!(
                    "× {qty} build{} · {line_count} line{}",
                    if qty == 1 { "" } else { "s" },
                    if line_count == 1 { "" } else { "s" },
                )}</span>
                <div class="spacer"/>
                <button class="tree-act tree-act-del" title="Delete this run"
                    on:click=on_delete>"🗑"</button>
            </div>
            <table class="parts run-card-lines">
                <tbody>{
                    lines.into_iter().map(|ln| {
                        let part = ln.part_name.unwrap_or_else(|| "(missing part)".into());
                        let lot_disp = if ln.lot_number.is_empty() {
                            "—".to_string()
                        } else { ln.lot_number };
                        view! {
                            <tr>
                                <td>{part}</td>
                                <td class="right">{ln.quantity}</td>
                                <td class="muted">{lot_disp}</td>
                            </tr>
                        }
                    }).collect::<Vec<_>>()
                }</tbody>
            </table>
        </div>
    }
}

/// Trim "T" out of an ISO-8601 datetime so it reads naturally. We don't
/// pull a date library for this; the strings come from chrono::naive
/// serialization (`YYYY-MM-DDTHH:MM:SS[.fff…]`).
fn format_iso_datetime(s: &str) -> String {
    let trimmed = s.split('.').next().unwrap_or(s);
    trimmed.replacen('T', " ", 1)
}

#[component]
fn BomTable(project_id: i32, parts: Vec<ProjectPartView>) -> impl IntoView {
    if parts.is_empty() {
        return view! {
            <p class="muted" style:padding="6px 0">
                "No BOM lines yet. Click + Add Part to BOM to start the bill of materials."
            </p>
        }.into_any();
    }
    let rows: Vec<_> = parts.into_iter().map(|p| {
        view! { <BomRow project_id=project_id p=p/> }
    }).collect();
    view! {
        <table class="parts bom-table">
            <thead><tr>
                <th>"Part"</th>
                <th>"Internal #"</th>
                <th class="right">"Qty"</th>
                <th class="right">"Overage"</th>
                <th class="right">"Stock"</th>
                <th>"Lot / Remarks"</th>
                <th class="right" style="width:80px"></th>
            </tr></thead>
            <tbody>{rows}</tbody>
        </table>
    }.into_any()
}

#[component]
fn BomRow(project_id: i32, p: ProjectPartView) -> impl IntoView {
    use wasm_bindgen_futures::spawn_local;
    let bom_state = expect_context::<BomLineEditState>().0;
    let data_version = expect_context::<DataVersion>().0;
    let selected_part = expect_context::<SelectedPart>().0;

    let line_id = p.id;
    let part_id_for_click = p.part_id;
    let part_name = p.part_name.clone().unwrap_or_else(|| "(missing part)".into());
    let part_ipn = p.part_internal_part_number.clone().unwrap_or_default();
    let stock = p.part_stock_level.unwrap_or(0);
    let qty = p.quantity;
    let overage = p.overage;
    let overage_type = p.overage_type.clone();
    let lot_number = p.lot_number.clone();
    let remarks = p.remarks.clone().unwrap_or_default();

    let overage_disp = match (overage, overage_type.as_str()) {
        (0, _) => "—".to_string(),
        (n, "percent") => format!("+{n}%"),
        (n, _)         => format!("+{n}"),
    };
    let lot_remarks = match (lot_number.is_empty(), remarks.is_empty()) {
        (true,  true)  => String::new(),
        (false, true)  => format!("Lot: {lot_number}"),
        (true,  false) => remarks.clone(),
        (false, false) => format!("Lot: {lot_number} · {remarks}"),
    };

    let part_id_for_edit = p.part_id;
    let part_name_for_edit = part_name.clone();
    let part_ipn_for_edit = part_ipn.clone();
    let lot_for_edit = lot_number.clone();
    let remarks_for_edit = remarks.clone();
    let overage_type_for_edit = overage_type.clone();

    let on_edit = move |_| {
        bom_state.set(Some(BomLineEditCtx {
            mode: BomLineEditMode::Edit,
            project_id,
            line_id,
            part_id: part_id_for_edit,
            part_name: part_name_for_edit.clone(),
            part_internal_part_number: part_ipn_for_edit.clone(),
            quantity: qty,
            remarks: remarks_for_edit.clone(),
            overage_type: overage_type_for_edit.clone(),
            overage,
            lot_number: lot_for_edit.clone(),
        }));
    };

    let part_name_for_confirm = part_name.clone();
    let on_delete = move |_: leptos::ev::MouseEvent| {
        let confirm_msg = format!(
            "Remove \"{}\" from this BOM?",
            part_name_for_confirm,
        );
        let confirmed = web_sys::window()
            .and_then(|w| w.confirm_with_message(&confirm_msg).ok())
            .unwrap_or(false);
        if !confirmed { return; }
        spawn_local(async move {
            match api::delete_bom_line(project_id, line_id).await {
                Ok(()) => data_version.update(|v| *v += 1),
                Err(e) => {
                    let _ = web_sys::window()
                        .and_then(|w| w.alert_with_message(&format!("Delete failed: {}", e.0)).ok());
                }
            }
        });
    };

    // Highlight stock that won't cover qty (cosmetic — we warn-and-allow at run time).
    let stock_class = if stock < qty { "right warn-cell" } else { "right" };

    let on_open_part = move |_: leptos::ev::MouseEvent| {
        if let Some(pid) = part_id_for_click {
            selected_part.set(Some(pid));
        }
    };

    let name_cell = if part_id_for_click.is_some() {
        view! {
            <a class="project-link" href="javascript:void(0)"
                on:click=on_open_part>{part_name.clone()}</a>
        }.into_any()
    } else {
        view! { <span class="muted">{part_name.clone()}</span> }.into_any()
    };

    view! {
        <tr>
            <td>{name_cell}</td>
            <td class="muted">{part_ipn}</td>
            <td class="right">{qty}</td>
            <td class="right">{overage_disp}</td>
            <td class={stock_class}>{stock}</td>
            <td class="muted">{lot_remarks}</td>
            <td class="right">
                <button class="tree-act tree-act-edit" title="Edit BOM line"
                    on:click=on_edit>"✎"</button>
                <button class="tree-act tree-act-del" title="Remove BOM line"
                    on:click=on_delete>"🗑"</button>
            </td>
        </tr>
    }.into_any()
}
