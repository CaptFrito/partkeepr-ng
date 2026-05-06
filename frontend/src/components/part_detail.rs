use leptos::prelude::*;

use crate::api;
use crate::types::{
    MetaPartCriterionView, PartAttachmentView, PartDetail, PartDistributorView,
    PartManufacturerView, PartParameterView, PartProjectRef, PartRunRef, PartRow,
    StockEntryView,
};
use crate::components::{AttachmentsSection, PartEditorPanel};
use crate::{
    DataVersion, DeletePartCtx, DeletePartState, EditorMode, EditorModeState, LeftPaneMode,
    LeftPaneModeState, SelectedPart, SelectedProject, StockDialogCtx, StockDialogMode,
    StockDialogState,
};

#[component]
pub fn PartDetailPanel() -> impl IntoView {
    let selected_part = expect_context::<SelectedPart>().0;
    let data_version = expect_context::<DataVersion>().0;
    let editor_mode = expect_context::<EditorModeState>().0;

    // Dispatch: when the editor is open for a part, render the editor;
    // otherwise render the read-only detail. The editor is its own
    // top-level panel (not embedded inside DetailBody) to keep the form
    // state lifecycle clean.
    let detail = LocalResource::new(move || {
        let id = selected_part.get();
        let _ = data_version.get(); // tracked dep — refetch after mutations
        async move {
            match id {
                Some(i) => Some(api::fetch_part_detail(i).await),
                None => None,
            }
        }
    });

    view! {
        {move || match editor_mode.get() {
            // Any non-View mode: editor takes the right pane regardless
            // of what selected_part is.
            EditorMode::Editing(_) | EditorMode::Creating
            | EditorMode::DuplicatingFrom(_) | EditorMode::CreatingMeta => view! {
                <PartEditorPanel mode=editor_mode.get() />
            }.into_any(),
            EditorMode::View => match selected_part.get() {
                Some(_) => view! {
                    <div class="detail">
                        <Suspense fallback=|| view! { <p class="muted" style="padding:16px">"Loading…"</p> }>
                            {move || detail.get().and_then(|r| (*r).clone()).map(|res| match res {
                                Err(e) => view! { <p class="muted" style="padding:16px">{format!("Error: {}", e.0)}</p> }.into_any(),
                                Ok(d) => view! { <DetailBody detail=d /> }.into_any(),
                            })}
                        </Suspense>
                    </div>
                }.into_any(),
                None => view! {
                    <div class="detail">
                        <p class="empty">"Click a part above to see its details."</p>
                    </div>
                }.into_any(),
            },
        }}
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab { Details, StockHistory }

#[component]
fn DetailBody(detail: PartDetail) -> impl IntoView {
    let stock_dialog = expect_context::<StockDialogState>().0;
    let editor_mode = expect_context::<EditorModeState>().0;
    let delete_part = expect_context::<DeletePartState>().0;
    let tab = RwSignal::new(Tab::Details);
    let category_path = detail
        .category
        .as_ref()
        .and_then(|c| c.category_path.clone())
        .unwrap_or_default();
    let part_id = detail.id;
    let part_name = detail.name.clone();
    let current_stock = detail.stock_level;
    let avg_price = detail.average_price.clone();
    let unit_short = detail.part_unit.as_ref()
        .map(|u| u.short_name.clone())
        .unwrap_or_else(|| "pcs".into());

    let open_dialog = move |mode: StockDialogMode| {
        let ctx = StockDialogCtx {
            part_id,
            mode,
            current_stock,
            avg_price: avg_price.clone(),
            unit_short: unit_short.clone(),
        };
        stock_dialog.set(Some(ctx));
    };
    let open_add = open_dialog.clone();
    let open_remove = open_dialog.clone();
    let open_recon = open_dialog;

    let part_name_for_delete = part_name.clone();
    let open_delete = move |_| {
        delete_part.set(Some(DeletePartCtx {
            part_id,
            part_name: part_name_for_delete.clone(),
        }));
    };
    let start_edit = move |_| editor_mode.set(EditorMode::Editing(part_id));
    let start_duplicate = move |_| editor_mode.set(EditorMode::DuplicatingFrom(part_id));

    view! {
        <div class="head">
            <h2>{part_name}</h2>
            <div class="crumb">{category_path}</div>
            <div class="part-actions">
                <button class="btn-action btn-add"
                    on:click=move |_| open_add(StockDialogMode::Add)>
                    "+ Add Stock"
                </button>
                <button class="btn-action btn-remove"
                    on:click=move |_| open_remove(StockDialogMode::Remove)>
                    "− Remove Stock"
                </button>
                <button class="btn-action btn-recon"
                    title="Set on-hand quantity from a recount; doesn't change avg price"
                    on:click=move |_| open_recon(StockDialogMode::Reconcile)>
                    "⇄ Reconcile"
                </button>
                <button class="btn-action btn-recon"
                    on:click=start_edit>
                    "✎ Edit Part"
                </button>
                <button class="btn-action btn-recon"
                    title="Open a new-part editor pre-filled from this part"
                    on:click=start_duplicate>
                    "⎘ Duplicate"
                </button>
                <button class="btn-action btn-remove"
                    on:click=open_delete>
                    "🗑 Delete"
                </button>
            </div>
        </div>
        <div class="tabs">
            <button class:active=move || tab.get() == Tab::Details
                on:click=move |_| tab.set(Tab::Details)>"Part Details"</button>
            <button class:active=move || tab.get() == Tab::StockHistory
                on:click=move |_| tab.set(Tab::StockHistory)>{
                    let n = detail.stock_entries.len();
                    format!("Stock History ({n})")
                }</button>
        </div>
        <div class="tab-body">
            {move || match tab.get() {
                Tab::Details => view! { <DetailsTab detail=detail.clone() /> }.into_any(),
                Tab::StockHistory => view! { <StockTab entries=detail.stock_entries.clone() /> }.into_any(),
            }}
        </div>
    }
}

#[component]
fn DetailsTab(detail: PartDetail) -> impl IntoView {
    let storage_name = detail.storage_location.as_ref().map(|s| s.name.clone()).unwrap_or_default();
    let storage_path = detail.storage_location.as_ref().and_then(|s| s.category_path.clone()).unwrap_or_default();
    let footprint = detail.footprint.as_ref().map(|f| f.name.clone()).unwrap_or_default();
    let unit = detail.part_unit.as_ref()
        .map(|u| format!("{} ({})", u.name, u.short_name))
        .unwrap_or_default();

    // Pull the related collections into local bindings up-front so the
    // Show's `when` (Fn) and For's `each` (Fn) closures can capture them
    // without partial moves out of `detail`. The view! macro wraps Show's
    // children as ChildrenFn, requiring `Fn`; without these locals,
    // accessing `detail.<field>` in multiple captured closures makes the
    // closure FnOnce.
    let mfgs = detail.manufacturers;
    let dists = detail.distributors;
    let params = detail.parameters;
    let attaches = detail.attachments;
    // Plain Part fields used in the kv block.
    let id = detail.id;
    let description = detail.description.clone().unwrap_or_default();
    let internal_pn = detail.internal_part_number.clone().unwrap_or_default();
    let stock_line = format!("{} (min {})", detail.stock_level, detail.min_stock_level);
    let avg_price = detail.average_price.clone();
    let status = detail.status.clone().unwrap_or_default();
    let condition = detail.part_condition.clone().unwrap_or_default();
    let comment = detail.comment.clone();

    let mfg_title = format!("Manufacturers ({})", mfgs.len());
    let dist_title = format!("Distributors ({})", dists.len());
    let param_title = format!("Parameters ({})", params.len());
    // (Attachments title is built inside AttachmentsSection from the
    // length of `attaches` — it owns the live count display.)

    // Eagerly-built row views. Each section is rendered once when this
    // function runs — it's not reactive, so we can produce a Vec<AnyView>
    // and drop it into the view tree wholesale. This avoids the
    // <For each=closure> pattern that was fighting Show's ChildrenFn.
    let mfgs_empty = mfgs.is_empty();
    let mfg_rows: Vec<_> = mfgs.into_iter().map(|m| view! {
        <tr>
            <td>{m.manufacturer_name}</td>
            <td>{m.part_number.unwrap_or_default()}</td>
        </tr>
    }.into_any()).collect();

    let dists_empty = dists.is_empty();
    let dist_rows: Vec<_> = dists.into_iter().map(|d| view! {
        <tr>
            <td>{d.distributor_name}</td>
            <td>{d.order_number.unwrap_or_default()}</td>
            <td>{d.sku.unwrap_or_default()}</td>
            <td class="right">{d.price.unwrap_or_default()}</td>
            <td class="right">{d.packaging_unit}</td>
        </tr>
    }.into_any()).collect();

    let params_empty = params.is_empty();
    let param_rows: Vec<_> = params.into_iter().map(|p| {
        let value = render_parameter_value(&p);
        let prefix = p.si_prefix_symbol.unwrap_or_default();
        let unit_sym = p.unit_symbol.unwrap_or_default();
        view! {
            <tr>
                <td>{p.name}</td>
                <td>{value}</td>
                <td>{prefix}{unit_sym}</td>
            </tr>
        }.into_any()
    }).collect();

    // Attachments are rendered live by AttachmentsSection below — it
    // owns the upload control + delete buttons. Keep the existing
    // `attaches` Vec as the source of truth (came from the part-detail
    // fetch) and pass it in.
    let upload_path = format!("/api/parts/{id}/attachments");

    view! {
        <dl class="kv">
            <dt>"ID"</dt><dd>{id}</dd>
            <dt>"Description"</dt><dd>{description}</dd>
            <dt>"Local Part Number"</dt><dd>{internal_pn}</dd>
            <dt>"Stock"</dt><dd>{stock_line}</dd>
            <dt>"Avg price"</dt><dd>{avg_price}</dd>
            <dt>"Status"</dt><dd>{status}</dd>
            <dt>"Condition"</dt><dd>{condition}</dd>
            <dt>"Storage"</dt><dd>
                {storage_name}
                {if storage_path.is_empty() { "".into() } else { format!(" — {storage_path}") }}
            </dd>
            <dt>"Footprint"</dt><dd>{footprint}</dd>
            <dt>"Unit"</dt><dd>{unit}</dd>
            <dt>"Comment"</dt><dd>{comment}</dd>
        </dl>

        {(!mfgs_empty).then(|| view! {
            <CollapsibleSection title=mfg_title>
                <table class="sub">
                    <thead><tr><th>"Manufacturer"</th><th>"Part #"</th></tr></thead>
                    <tbody>{mfg_rows}</tbody>
                </table>
            </CollapsibleSection>
        })}

        {(!dists_empty).then(|| view! {
            <CollapsibleSection title=dist_title>
                <table class="sub">
                    <thead><tr>
                        <th>"Distributor"</th><th>"Order #"</th><th>"SKU"</th>
                        <th class="right">"Price"</th><th class="right">"Pkg"</th>
                    </tr></thead>
                    <tbody>{dist_rows}</tbody>
                </table>
            </CollapsibleSection>
        })}

        {(!params_empty).then(|| view! {
            <CollapsibleSection title=param_title>
                <table class="sub">
                    <thead><tr><th>"Name"</th><th>"Value"</th><th>"Unit"</th></tr></thead>
                    <tbody>{param_rows}</tbody>
                </table>
            </CollapsibleSection>
        })}

        <AttachmentsSection kind="PartAttachment" upload_path=upload_path attachments=attaches/>
        <PartProjectsSection part_id=id/>
        <PartRunsSection part_id=id/>
        <Show when=move || detail.meta_part>
            <CriteriaSection criteria=detail.criteria.clone()/>
            <MatchesSection part_id=id/>
        </Show>
    }
}

#[component]
fn CriteriaSection(criteria: Vec<MetaPartCriterionView>) -> impl IntoView {
    let count = criteria.len();
    let title = format!("Criteria ({count})");
    if count == 0 {
        return view! {
            <CollapsibleSection title=title>
                <p class="muted" style:padding="6px 0">
                    "No criteria yet. Edit this meta-part and add criteria on the Criteria tab."
                </p>
            </CollapsibleSection>
        }.into_any();
    }
    let rows: Vec<_> = criteria.into_iter().map(|c| {
        let value = format_criterion_value(&c);
        view! {
            <tr>
                <td>{c.name}</td>
                <td class="right tabular-nums">{c.op}</td>
                <td>{value}</td>
            </tr>
        }
    }).collect();
    view! {
        <CollapsibleSection title=title>
            <table class="sub">
                <thead><tr>
                    <th>"Parameter"</th>
                    <th class="right">"Op"</th>
                    <th>"Value"</th>
                </tr></thead>
                <tbody>{rows}</tbody>
            </table>
        </CollapsibleSection>
    }.into_any()
}

fn format_criterion_value(c: &MetaPartCriterionView) -> String {
    if c.value_type == "string" {
        if c.string_value.is_empty() { "—".into() } else { c.string_value.clone() }
    } else {
        let v = c.value.map(|n| n.to_string()).unwrap_or_else(|| "—".into());
        let prefix = c.si_prefix_symbol.clone().unwrap_or_default();
        let unit = c.unit_symbol.clone().unwrap_or_default();
        match (prefix.is_empty(), unit.is_empty()) {
            (true,  true)  => v,
            (false, true)  => format!("{v} {prefix}"),
            (true,  false) => format!("{v} {unit}"),
            (false, false) => format!("{v} {prefix}{unit}"),
        }
    }
}

#[component]
fn MatchesSection(part_id: i32) -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let resource = LocalResource::new(move || {
        let _ = data_version.get();
        async move { api::fetch_part_matches(part_id, 50, 0).await }
    });
    view! {
        <Suspense fallback=|| view! {
            <p class="muted" style:padding="6px 0">"Computing matches…"</p>
        }>
            {move || resource.get().map(|res| match &*res {
                Err(e) => view! {
                    <p class="muted" style:padding="6px 0">{format!("Error: {}", e.0)}</p>
                }.into_any(),
                Ok(resp) => {
                    let total = resp.total;
                    let items = resp.items.clone();
                    let title = format!("Matching parts ({total})");
                    if total == 0 {
                        return view! {
                            <CollapsibleSection title=title>
                                <p class="muted" style:padding="6px 0">
                                    "No real parts currently match this meta-part's criteria."
                                </p>
                            </CollapsibleSection>
                        }.into_any();
                    }
                    let shown = items.len();
                    view! {
                        <CollapsibleSection title=title>
                            <p class="muted" style:padding="2px 0">{
                                if (shown as i64) < total {
                                    format!("Showing first {shown}.")
                                } else { String::new() }
                            }</p>
                            <table class="sub">
                                <thead><tr>
                                    <th>"Name"</th>
                                    <th>"Description"</th>
                                    <th class="right">"Stock"</th>
                                </tr></thead>
                                <tbody>{
                                    items.into_iter().map(|r| view! { <MatchRow r=r/> }).collect::<Vec<_>>()
                                }</tbody>
                            </table>
                        </CollapsibleSection>
                    }.into_any()
                }
            })}
        </Suspense>
    }
}

#[component]
fn MatchRow(r: PartRow) -> impl IntoView {
    let selected_part = expect_context::<SelectedPart>().0;
    let id = r.id;
    let name = r.name.clone();
    let description = r.description.clone().unwrap_or_default();
    let stock = r.stock_level;
    view! {
        <tr class="match-row" on:click=move |_| selected_part.set(Some(id))>
            <td><a class="project-link" href="javascript:void(0)">{name}</a></td>
            <td class="muted">{description}</td>
            <td class="right">{stock}</td>
        </tr>
    }
}

#[component]
fn PartProjectsSection(part_id: i32) -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let resource = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_part_projects(part_id)
    });
    view! {
        <Suspense fallback=|| ()>
            {move || resource.get().map(|res| match &*res {
                Err(_) => ().into_any(),
                Ok(rows) if rows.is_empty() => ().into_any(),
                Ok(rows) => {
                    let title = format!("Used in projects ({})", rows.len());
                    let items = rows.clone();
                    view! {
                        <CollapsibleSection title=title>
                            <table class="sub">
                                <thead><tr>
                                    <th>"Project"</th>
                                    <th class="right">"Qty/build"</th>
                                    <th class="right">"Overage"</th>
                                    <th>"Remarks"</th>
                                </tr></thead>
                                <tbody>{
                                    items.into_iter().map(|r| view! {
                                        <PartProjectRow r=r/>
                                    }).collect::<Vec<_>>()
                                }</tbody>
                            </table>
                        </CollapsibleSection>
                    }.into_any()
                }
            })}
        </Suspense>
    }
}

#[component]
fn PartProjectRow(r: PartProjectRef) -> impl IntoView {
    let pane_mode = expect_context::<LeftPaneModeState>().0;
    let selected_project = expect_context::<SelectedProject>().0;
    let project_id = r.project_id;
    let project_name = r.project_name.clone();
    let qty = r.quantity;
    let overage_disp = match (r.overage, r.overage_type.as_str()) {
        (0, _)         => "—".to_string(),
        (n, "percent") => format!("+{n}%"),
        (n, _)         => format!("+{n}"),
    };
    let remarks = r.remarks.clone().unwrap_or_default();

    let on_jump = move |_: leptos::ev::MouseEvent| {
        selected_project.set(Some(project_id));
        pane_mode.set(LeftPaneMode::Projects);
    };

    view! {
        <tr>
            <td>
                <a class="project-link" href="javascript:void(0)" on:click=on_jump>
                    {project_name}
                </a>
            </td>
            <td class="right">{qty}</td>
            <td class="right">{overage_disp}</td>
            <td class="muted">{remarks}</td>
        </tr>
    }
}

#[component]
fn PartRunsSection(part_id: i32) -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let resource = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_part_runs(part_id)
    });
    view! {
        <Suspense fallback=|| ()>
            {move || resource.get().map(|res| match &*res {
                Err(_) => ().into_any(),
                Ok(rows) if rows.is_empty() => ().into_any(),
                Ok(rows) => {
                    let title = format!("Recent project runs ({})", rows.len());
                    let items = rows.clone();
                    view! {
                        <CollapsibleSection title=title>
                            <table class="sub">
                                <thead><tr>
                                    <th>"When"</th>
                                    <th>"Project"</th>
                                    <th class="right">"Deducted"</th>
                                    <th>"Lot"</th>
                                </tr></thead>
                                <tbody>{
                                    items.into_iter().map(|r| view! {
                                        <PartRunRow r=r/>
                                    }).collect::<Vec<_>>()
                                }</tbody>
                            </table>
                        </CollapsibleSection>
                    }.into_any()
                }
            })}
        </Suspense>
    }
}

#[component]
fn PartRunRow(r: PartRunRef) -> impl IntoView {
    let pane_mode = expect_context::<LeftPaneModeState>().0;
    let selected_project = expect_context::<SelectedProject>().0;
    let project_id = r.project_id;
    let when = r.run_date_time.clone()
        .map(|s| trim_iso(&s))
        .unwrap_or_else(|| "(no date)".into());
    let project_name = r.project_name.clone();
    let deducted = r.deducted_quantity;
    let lot = if r.lot_number.is_empty() { "—".to_string() } else { r.lot_number.clone() };

    let on_jump = move |_: leptos::ev::MouseEvent| {
        selected_project.set(Some(project_id));
        pane_mode.set(LeftPaneMode::Projects);
    };

    view! {
        <tr>
            <td class="run-when">{when}</td>
            <td>
                <a class="project-link" href="javascript:void(0)" on:click=on_jump>
                    {project_name}
                </a>
            </td>
            <td class="right">{deducted}</td>
            <td class="muted">{lot}</td>
        </tr>
    }
}

fn trim_iso(s: &str) -> String {
    s.split('.').next().unwrap_or(s).replacen('T', " ", 1)
}

#[component]
fn CollapsibleSection(
    title: String,
    children: Children,
) -> impl IntoView {
    let open = RwSignal::new(true);
    // Evaluate children once; toggle the wrapper's display via CSS so we
    // don't re-render (which would require ChildrenFn).
    let rendered = children();
    view! {
        <h3 class="collapsible"
            on:click=move |_| open.update(|v| *v = !*v)>
            <span class="chev">{move || if open.get() { "▼" } else { "▶" }}</span>
            {title}
        </h3>
        <div style:display=move || if open.get() { "block" } else { "none" }>
            {rendered}
        </div>
    }
}

#[component]
fn StockTab(entries: Vec<StockEntryView>) -> impl IntoView {
    if entries.is_empty() {
        return view! { <p class="muted">"No stock history."</p> }.into_any();
    }
    view! {
        <table class="sub">
            <thead><tr>
                <th>"When"</th>
                <th>"By"</th>
                <th class="right">"Δ"</th>
                <th class="right">"Price"</th>
                <th>"Comment"</th>
            </tr></thead>
            <tbody>
                <For each={
                    let v = entries.clone();
                    move || v.clone()
                } key=|x: &StockEntryView| x.id let:s>
                    <tr>
                        <td class="muted">{s.date_time.clone().unwrap_or_else(|| "—".into())}</td>
                        <td>{s.username.clone().unwrap_or_default()}</td>
                        <td class={
                            if s.stock_level < 0 { "right delta-neg" } else { "right delta-pos" }
                        }>{
                            if s.stock_level >= 0 { format!("+{}", s.stock_level) }
                            else { s.stock_level.to_string() }
                        }</td>
                        <td class="right muted">{s.price.clone().unwrap_or_default()}</td>
                        <td class="muted">{s.comment.clone().unwrap_or_default()}</td>
                    </tr>
                </For>
            </tbody>
        </table>
    }.into_any()
}

fn render_parameter_value(p: &PartParameterView) -> String {
    if p.value_type == "string" {
        p.string_value.clone()
    } else if let Some(v) = p.value {
        format!("{v}")
    } else if let (Some(mn), Some(mx)) = (p.minimum_value, p.maximum_value) {
        format!("{mn} … {mx}")
    } else {
        String::from("—")
    }
}

// Note: format_bytes used to live here for the attachments section.
// It's now in components/attachments_section.rs where the section
// renders itself. Remove once we're sure nothing else needs it.
