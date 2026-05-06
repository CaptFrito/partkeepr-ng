use leptos::prelude::*;

use crate::api;
use crate::types::{
    PartAttachmentView, PartDetail, PartDistributorView, PartManufacturerView,
    PartParameterView, StockEntryView,
};
use crate::components::PartEditorPanel;
use crate::{
    DataVersion, DeletePartCtx, DeletePartState, EditorMode, EditorModeState,
    SelectedPart, StockDialogCtx, StockDialogMode, StockDialogState,
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
    let attach_title = format!("Attachments ({})", attaches.len());

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

    let attaches_empty = attaches.is_empty();
    let attach_rows: Vec<_> = attaches.into_iter().map(|a| {
        let display_name = a.original_filename.unwrap_or_else(|| a.filename.clone());
        view! {
            <tr>
                <td>{display_name}</td>
                <td class="muted">{a.mimetype}</td>
                <td class="right muted">{format_bytes(a.size)}</td>
            </tr>
        }.into_any()
    }).collect();

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

        {(!attaches_empty).then(|| view! {
            <CollapsibleSection title=attach_title>
                <table class="sub">
                    <thead><tr><th>"Filename"</th><th>"MIME"</th><th class="right">"Size"</th></tr></thead>
                    <tbody>{attach_rows}</tbody>
                </table>
            </CollapsibleSection>
        })}
    }
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

fn format_bytes(n: i32) -> String {
    let n = n as f64;
    if n < 1024.0 { format!("{n:.0} B") }
    else if n < 1024.0 * 1024.0 { format!("{:.1} KB", n / 1024.0) }
    else { format!("{:.1} MB", n / 1024.0 / 1024.0) }
}
