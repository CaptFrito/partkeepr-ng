//! Slice 5b-3: Part editor with tabs for Basic / Manufacturers /
//! Distributors / Parameters. Sub-tables are editable: rows can be
//! added, edited inline, and removed. Save POSTs/PUTs the whole part
//! atomically (backend replaces children inside a transaction).

use std::sync::atomic::{AtomicU32, Ordering};

use leptos::prelude::*;
use wasm_bindgen_futures::spawn_local;

use crate::api::{self, LookupOption, SiPrefixOption, UnitOption};
use crate::types::{ParameterNameRow, PartDetail};
use crate::{
    DataVersion, EditorMode, EditorModeState, MetaPartHelpState,
    ParamTypeHelpState, SelectedPart,
};

#[component]
pub fn PartEditorPanel(mode: EditorMode) -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;

    // Editing/Duplicating need to fetch the source part as a seed.
    // Creating/CreatingMeta start blank — Result(None).
    let seed_id: Option<i32> = match mode {
        EditorMode::Editing(id) | EditorMode::DuplicatingFrom(id) => Some(id),
        _ => None,
    };

    let detail = LocalResource::new(move || {
        let _ = data_version.get();
        async move {
            match seed_id {
                Some(id) => api::fetch_part_detail(id).await.map(Some),
                None => Ok(None),
            }
        }
    });
    let categories = LocalResource::new(|| async { api::fetch_categories_flat().await });
    let storage_locs = LocalResource::new(|| async { api::fetch_storage_locations().await });
    let footprints = LocalResource::new(|| async { api::fetch_footprints().await });
    let part_units = LocalResource::new(|| async { api::fetch_part_units().await });
    let manufacturers = LocalResource::new(|| async { api::fetch_manufacturers().await });
    let distributors = LocalResource::new(|| async { api::fetch_distributors().await });
    let units = LocalResource::new(|| async { api::fetch_units_full().await });
    let si_prefixes = LocalResource::new(|| async { api::fetch_si_prefixes().await });

    view! {
        <div class="detail">
            <Suspense fallback=|| view! { <p class="muted" style="padding:16px">"Loading editor…"</p> }>
                {move || {
                    let bundle = (
                        detail.get(),
                        categories.get(),
                        storage_locs.get(),
                        footprints.get(),
                        part_units.get(),
                        manufacturers.get(),
                        distributors.get(),
                        units.get(),
                        si_prefixes.get(),
                    );
                    let all_ready = matches!(
                        &bundle,
                        (Some(_), Some(_), Some(_), Some(_), Some(_),
                         Some(_), Some(_), Some(_), Some(_))
                    );
                    if !all_ready {
                        return view! { <p class="muted" style="padding:16px">"Loading…"</p> }.into_any();
                    }
                    let (d, c, s, f, pu, m, di, u, sp) = bundle;
                    match (
                        (*d.unwrap()).clone(),
                        (*c.unwrap()).clone(),
                        (*s.unwrap()).clone(),
                        (*f.unwrap()).clone(),
                        (*pu.unwrap()).clone(),
                        (*m.unwrap()).clone(),
                        (*di.unwrap()).clone(),
                        (*u.unwrap()).clone(),
                        (*sp.unwrap()).clone(),
                    ) {
                        (Ok(d_opt), Ok(c), Ok(s), Ok(f), Ok(pu), Ok(m), Ok(di), Ok(u), Ok(sp)) => {
                            view! {
                                <EditorForm
                                    mode=mode
                                    seed=d_opt
                                    categories=c storage_locs=s footprints=f
                                    part_units=pu manufacturers=m distributors=di
                                    units=u si_prefixes=sp
                                />
                            }.into_any()
                        }
                        _ => view! {
                            <p class="muted" style="padding:16px">"Error loading editor data"</p>
                        }.into_any(),
                    }
                }}
            </Suspense>
        </div>
    }
}

// ---------------------------------------------------------------------------
//  Editable row state
// ---------------------------------------------------------------------------

static NEXT_KEY: AtomicU32 = AtomicU32::new(1);
fn next_key() -> u32 {
    NEXT_KEY.fetch_add(1, Ordering::Relaxed)
}

#[derive(Clone, Debug)]
struct EditableMfg {
    key: u32,
    manufacturer_id: String,
    part_number: String,
}

#[derive(Clone, Debug)]
struct EditableDist {
    key: u32,
    distributor_id: String,
    order_number: String,
    sku: String,
    price: String,
    currency: String,
    packaging_unit: String,
    ignore_for_reports: bool,
}

#[derive(Clone, Debug)]
struct EditableParam {
    key: u32,
    name: String,
    description: String,
    value_type: String, // "string" | "numeric"
    string_value: String,
    value: String,
    minimum_value: String,
    maximum_value: String,
    unit_id: String,
    si_prefix_id: String,
    min_si_prefix_id: String,
    max_si_prefix_id: String,
}

/// Slice 11c: editable criterion row. Mirrors `Predicate`'s field set
/// but in the form-string flavour (parsed to typed values on save).
#[derive(Clone, Debug)]
struct EditableCriterion {
    key: u32,
    name: String,
    op: String,
    value_type: String, // "string" | "numeric"
    string_value: String,
    value: String,
    si_prefix_id: String,
    unit_id: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EditTab { Basic, Manufacturers, Distributors, Parameters, Criteria }

// ---------------------------------------------------------------------------
//  Main editor form
// ---------------------------------------------------------------------------

#[component]
fn EditorForm(
    mode: EditorMode,
    seed: Option<PartDetail>,
    categories: Vec<LookupOption>,
    storage_locs: Vec<LookupOption>,
    footprints: Vec<LookupOption>,
    part_units: Vec<LookupOption>,
    manufacturers: Vec<LookupOption>,
    distributors: Vec<LookupOption>,
    units: Vec<UnitOption>,
    si_prefixes: Vec<SiPrefixOption>,
) -> impl IntoView {
    let editor_mode = expect_context::<EditorModeState>().0;
    let data_version = expect_context::<DataVersion>().0;
    let selected_part = expect_context::<SelectedPart>().0;
    let meta_help = expect_context::<MetaPartHelpState>().0;

    // Per-mode seed transformations:
    //   Editing(id)         — seed verbatim, save via PUT
    //   Creating            — empty form, save via POST
    //   DuplicatingFrom(id) — seed verbatim except name (suffix " (copy)")
    //                         and Local Part Number (cleared); save via POST
    //   CreatingMeta        — empty form, meta_part=true, save via POST
    let is_duplicate = matches!(mode, EditorMode::DuplicatingFrom(_));
    let initial_meta = matches!(mode, EditorMode::CreatingMeta);
    let put_target_id: Option<i32> = match mode {
        EditorMode::Editing(id) => Some(id),
        _ => None,
    };

    // Helpers to read seed fields with sensible defaults when seed is None.
    let s = seed.as_ref();
    let name_seed = s.map(|d| if is_duplicate {
        format!("{} (copy)", d.name)
    } else {
        d.name.clone()
    }).unwrap_or_default();
    let internal_pn_seed = if is_duplicate {
        String::new()
    } else {
        s.and_then(|d| d.internal_part_number.clone()).unwrap_or_default()
    };

    // ---- Top-level state ----
    let name = RwSignal::new(name_seed);
    let description = RwSignal::new(s.and_then(|d| d.description.clone()).unwrap_or_default());
    let comment = RwSignal::new(s.map(|d| d.comment.clone()).unwrap_or_default());
    let internal_pn = RwSignal::new(internal_pn_seed);
    let status = RwSignal::new(s.and_then(|d| d.status.clone()).unwrap_or_default());
    let condition = RwSignal::new(s.and_then(|d| d.part_condition.clone()).unwrap_or_default());
    let production_remarks = RwSignal::new(
        s.and_then(|d| d.production_remarks.clone()).unwrap_or_default()
    );
    let min_stock_level = RwSignal::new(
        s.map(|d| d.min_stock_level.to_string()).unwrap_or_else(|| "0".into())
    );
    let needs_review = RwSignal::new(s.map(|d| d.needs_review).unwrap_or(false));
    let category_id = RwSignal::new(opt_id_str(s.and_then(|d| d.category.as_ref().map(|c| c.id))));
    let storage_id = RwSignal::new(opt_id_str(s.and_then(|d| d.storage_location.as_ref().map(|sl| sl.id))));
    let footprint_id = RwSignal::new(opt_id_str(s.and_then(|d| d.footprint.as_ref().map(|f| f.id))));
    let part_unit_id = RwSignal::new(opt_id_str(s.and_then(|d| d.part_unit.as_ref().map(|u| u.id))));

    // ---- Sub-table state, seeded from detail (empty when seed is None) ----
    let mfg_rows: RwSignal<Vec<EditableMfg>> = RwSignal::new(
        s.map(|d| d.manufacturers.iter().map(|m| EditableMfg {
            key: next_key(),
            manufacturer_id: m.manufacturer_id.to_string(),
            part_number: m.part_number.clone().unwrap_or_default(),
        }).collect()).unwrap_or_default(),
    );
    let dist_rows: RwSignal<Vec<EditableDist>> = RwSignal::new(
        s.map(|d| d.distributors.iter().map(|dist| EditableDist {
            key: next_key(),
            distributor_id: dist.distributor_id.to_string(),
            order_number: dist.order_number.clone().unwrap_or_default(),
            sku: dist.sku.clone().unwrap_or_default(),
            price: dist.price.clone().unwrap_or_default(),
            currency: dist.currency.clone().unwrap_or_default(),
            packaging_unit: dist.packaging_unit.to_string(),
            ignore_for_reports: dist.ignore_for_reports.unwrap_or(false),
        }).collect()).unwrap_or_default(),
    );
    let param_rows: RwSignal<Vec<EditableParam>> = RwSignal::new(
        s.map(|d| d.parameters.iter().map(|p| EditableParam {
            key: next_key(),
            name: p.name.clone(),
            description: p.description.clone(),
            value_type: p.value_type.clone(),
            string_value: p.string_value.clone(),
            value: p.value.map(|v| v.to_string()).unwrap_or_default(),
            minimum_value: p.minimum_value.map(|v| v.to_string()).unwrap_or_default(),
            maximum_value: p.maximum_value.map(|v| v.to_string()).unwrap_or_default(),
            unit_id: opt_id_str(p.unit_id),
            si_prefix_id: opt_id_str(p.si_prefix_id),
            min_si_prefix_id: opt_id_str(p.min_si_prefix_id),
            max_si_prefix_id: opt_id_str(p.max_si_prefix_id),
        }).collect()).unwrap_or_default(),
    );
    let crit_rows: RwSignal<Vec<EditableCriterion>> = RwSignal::new(
        s.map(|d| d.criteria.iter().map(|c| EditableCriterion {
            key: next_key(),
            name: c.name.clone(),
            op: c.op.clone(),
            value_type: c.value_type.clone(),
            string_value: c.string_value.clone(),
            value: c.value.map(|v| v.to_string()).unwrap_or_default(),
            si_prefix_id: opt_id_str(c.si_prefix_id),
            unit_id: opt_id_str(c.unit_id),
        }).collect()).unwrap_or_default(),
    );
    let is_meta_part = initial_meta || s.map(|d| d.meta_part).unwrap_or(false);

    let active_tab = RwSignal::new(EditTab::Basic);
    let submitting = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);

    let cancel = move || editor_mode.set(EditorMode::View);

    // ---- Submit ----
    let submit = move || {
        let trimmed_name = name.get().trim().to_string();
        if trimmed_name.is_empty() {
            error.set(Some("Name is required".into()));
            active_tab.set(EditTab::Basic);
            return;
        }
        let min_stock = match min_stock_level.get().trim().parse::<i32>() {
            Ok(n) if n >= 0 => n,
            _ => {
                error.set(Some("Min stock level must be a non-negative integer".into()));
                active_tab.set(EditTab::Basic);
                return;
            }
        };

        // Build sub-arrays. Skip rows that don't have their FK set
        // (they're empty / mid-edit).
        let mut mfgs: Vec<api::PartManufacturerWrite> = Vec::new();
        for r in mfg_rows.get_untracked().iter() {
            let Some(mid) = parse_id(&r.manufacturer_id) else { continue };
            mfgs.push(api::PartManufacturerWrite {
                manufacturer_id: mid,
                part_number: empty_to_none(r.part_number.clone()),
            });
        }

        let mut dists: Vec<api::PartDistributorWrite> = Vec::new();
        for r in dist_rows.get_untracked().iter() {
            let Some(did) = parse_id(&r.distributor_id) else { continue };
            let pkg: i32 = r.packaging_unit.trim().parse().unwrap_or(1);
            dists.push(api::PartDistributorWrite {
                distributor_id: did,
                order_number: empty_to_none(r.order_number.clone()),
                price: empty_to_none(r.price.clone()),
                currency: empty_to_none(r.currency.clone()),
                sku: empty_to_none(r.sku.clone()),
                packaging_unit: pkg.max(1),
                ignore_for_reports: r.ignore_for_reports,
            });
        }

        let mut params: Vec<api::PartParameterWrite> = Vec::new();
        let mut incomplete_rows: Vec<String> = Vec::new();
        for r in param_rows.get_untracked().iter() {
            let has_name = !r.name.trim().is_empty();
            let has_type = r.value_type == "numeric" || r.value_type == "string";
            if !has_name && !has_type { continue }       // empty placeholder row
            if !has_name {
                incomplete_rows.push("(unnamed)".into());
                continue;
            }
            if !has_type {
                incomplete_rows.push(r.name.trim().to_string());
                continue;
            }
            let is_string = r.value_type == "string";
            params.push(api::PartParameterWrite {
                name: r.name.trim().to_string(),
                description: r.description.clone(),
                value_type: r.value_type.clone(),
                value: if is_string { None } else { r.value.trim().parse::<f64>().ok() },
                string_value: r.string_value.clone(),
                minimum_value: if is_string { None } else { r.minimum_value.trim().parse::<f64>().ok() },
                maximum_value: if is_string { None } else { r.maximum_value.trim().parse::<f64>().ok() },
                unit_id: parse_id(&r.unit_id),
                si_prefix_id: parse_id(&r.si_prefix_id),
                min_si_prefix_id: parse_id(&r.min_si_prefix_id),
                max_si_prefix_id: parse_id(&r.max_si_prefix_id),
            });
        }
        if !incomplete_rows.is_empty() {
            error.set(Some(format!(
                "{} parameter row(s) need both a name and a type before saving: {}",
                incomplete_rows.len(),
                incomplete_rows.join(", "),
            )));
            active_tab.set(EditTab::Parameters);
            return;
        }

        // Criteria — same skip-empty semantics as parameters (skip rows
        // missing a name or a complete value). Only meaningful for meta-
        // parts; for non-meta parts we pass an empty array (which clears
        // any stale criteria from a part that's been toggled off).
        let mut crits: Vec<api::MetaPartCriterionWrite> = Vec::new();
        for r in crit_rows.get_untracked().iter() {
            if r.name.trim().is_empty() { continue; }
            if r.value_type != "string" && r.value_type != "numeric" { continue; }
            if !matches!(r.op.as_str(), "=" | "!=" | "<" | "<=" | ">" | ">=" | "like" | "in") {
                continue;
            }
            let is_string = r.value_type == "string";
            crits.push(api::MetaPartCriterionWrite {
                name: r.name.trim().to_string(),
                op: r.op.clone(),
                value_type: r.value_type.clone(),
                string_value: if is_string {
                    Some(r.string_value.clone())
                } else { None },
                value: if is_string { None } else { r.value.trim().parse::<f64>().ok() },
                si_prefix_id: parse_id(&r.si_prefix_id),
                unit_id: parse_id(&r.unit_id),
            });
        }

        let body = api::PartWrite {
            name: trimmed_name,
            description: empty_to_none(description.get()),
            comment: comment.get(),
            category_id: parse_id(&category_id.get()),
            footprint_id: parse_id(&footprint_id.get()),
            storage_location_id: parse_id(&storage_id.get()),
            part_unit_id: parse_id(&part_unit_id.get()),
            internal_part_number: empty_to_none(internal_pn.get()),
            status: empty_to_none(status.get()),
            part_condition: empty_to_none(condition.get()),
            production_remarks: empty_to_none(production_remarks.get()),
            needs_review: needs_review.get(),
            min_stock_level: min_stock,
            meta_part: is_meta_part,
            manufacturers: Some(mfgs),
            distributors: Some(dists),
            parameters: Some(params),
            criteria: Some(crits),
        };
        submitting.set(true);
        error.set(None);
        spawn_local(async move {
            let result = match put_target_id {
                Some(id) => api::put_part(id, body).await.map(|_| id),
                None => api::post_part(body).await,
            };
            match result {
                Ok(new_or_same_id) => {
                    submitting.set(false);
                    data_version.update(|v| *v += 1);
                    if put_target_id.is_none() {
                        // Created or duplicated — select the new part so
                        // the user sees it in the read-only detail panel
                        // when we exit the editor.
                        selected_part.set(Some(new_or_same_id));
                    }
                    editor_mode.set(EditorMode::View);
                }
                Err(e) => {
                    submitting.set(false);
                    error.set(Some(e.0));
                }
            }
        });
    };

    let header_text = match (mode, seed.as_ref()) {
        (EditorMode::Editing(_), Some(d)) => {
            if d.meta_part {
                format!("Editing meta-part: {}", d.name)
            } else {
                format!("Editing: {}", d.name)
            }
        }
        (EditorMode::DuplicatingFrom(_), Some(d)) => format!("Duplicate of: {}", d.name),
        (EditorMode::Creating, _) => "New Part".to_string(),
        (EditorMode::CreatingMeta, _) => "New Meta-Part".to_string(),
        _ => "Edit Part".to_string(),
    };
    let mfg_count = move || mfg_rows.get().len();
    let dist_count = move || dist_rows.get().len();
    let param_count = move || param_rows.get().len();
    let crit_count = move || crit_rows.get().len();

    view! {
        <div class="head">
            <h2>{header_text}</h2>
            <div class="part-actions">
                <button class="btn-action btn-recon"
                    prop:disabled={move || submitting.get()}
                    on:click=move |_| submit()>{
                        move || if submitting.get() { "Saving…" } else { "Save" }
                    }</button>
                <button class="btn-action"
                    prop:disabled={move || submitting.get()}
                    on:click=move |_| cancel()>"Cancel"</button>
                // Explain-meta-parts is now surfaced inside the Basic-tab
                // banner (visible whenever is_meta_part is true, which
                // covers both Create and Edit). The toolbar copy was
                // create-only and redundant once the banner exists.
            </div>
            <Show when={move || error.get().is_some()}>
                <div class="modal-error" style="margin-top:8px">{move || error.get().unwrap_or_default()}</div>
            </Show>
        </div>

        // Tab strip layout differs for meta-parts: Criteria is THE
        // primary thing, so it sits right after Basic; Parameters is
        // hidden entirely (a meta-part has criteria, not parameters);
        // Manufacturers/Distributors stay accessible at the end but
        // are de-emphasized — usually empty for meta-parts since any
        // mfr/dist of a matching real part is implied.
        <div class="tabs">
            <button class:active={move || active_tab.get() == EditTab::Basic}
                on:click=move |_| active_tab.set(EditTab::Basic)>"Basic"</button>
            <Show when=move || is_meta_part>
                <button class:active={move || active_tab.get() == EditTab::Criteria}
                    on:click=move |_| active_tab.set(EditTab::Criteria)>
                    "Criteria (" {crit_count} ")"
                </button>
            </Show>
            <button class:active={move || active_tab.get() == EditTab::Manufacturers}
                class:tab-deemph=move || is_meta_part
                on:click=move |_| active_tab.set(EditTab::Manufacturers)>
                "Manufacturers (" {mfg_count} ")"
            </button>
            <button class:active={move || active_tab.get() == EditTab::Distributors}
                class:tab-deemph=move || is_meta_part
                on:click=move |_| active_tab.set(EditTab::Distributors)>
                "Distributors (" {dist_count} ")"
            </button>
            <Show when=move || !is_meta_part>
                <button class:active={move || active_tab.get() == EditTab::Parameters}
                    on:click=move |_| active_tab.set(EditTab::Parameters)>
                    "Parameters (" {param_count} ")"
                </button>
            </Show>
        </div>

        // All tabs always rendered, toggled via display:none. Preserves
        // input focus and signal subscriptions across tab switches.
        <div class="tab-body" style:display={move || tab_display(active_tab.get(), EditTab::Basic)}>
            <BasicTab
                is_meta_part=is_meta_part
                name=name description=description comment=comment internal_pn=internal_pn
                status=status condition=condition production_remarks=production_remarks
                min_stock_level=min_stock_level needs_review=needs_review
                category_id=category_id storage_id=storage_id footprint_id=footprint_id
                part_unit_id=part_unit_id
                categories=categories storage_locs=storage_locs footprints=footprints
                part_units=part_units
                meta_help=meta_help
            />
        </div>
        <div class="tab-body" style:display={move || tab_display(active_tab.get(), EditTab::Manufacturers)}>
            <ManufacturersTab rows=mfg_rows manufacturers=manufacturers />
        </div>
        <div class="tab-body" style:display={move || tab_display(active_tab.get(), EditTab::Distributors)}>
            <DistributorsTab rows=dist_rows distributors=distributors />
        </div>
        <div class="tab-body" style:display={move || tab_display(active_tab.get(), EditTab::Parameters)}>
            <ParametersTab rows=param_rows units=units si_prefixes=si_prefixes.clone() />
        </div>
        <Show when=move || is_meta_part>
            <div class="tab-body" style:display={move || tab_display(active_tab.get(), EditTab::Criteria)}>
                <CriteriaTab rows=crit_rows si_prefixes=si_prefixes.clone()/>
            </div>
        </Show>
    }
}

fn tab_display(active: EditTab, this: EditTab) -> &'static str {
    if active == this { "block" } else { "none" }
}

// ---------------------------------------------------------------------------
//  Basic tab
// ---------------------------------------------------------------------------

#[component]
fn BasicTab(
    is_meta_part: bool,
    name: RwSignal<String>,
    description: RwSignal<String>,
    comment: RwSignal<String>,
    internal_pn: RwSignal<String>,
    status: RwSignal<String>,
    condition: RwSignal<String>,
    production_remarks: RwSignal<String>,
    min_stock_level: RwSignal<String>,
    needs_review: RwSignal<bool>,
    category_id: RwSignal<String>,
    storage_id: RwSignal<String>,
    footprint_id: RwSignal<String>,
    part_unit_id: RwSignal<String>,
    categories: Vec<LookupOption>,
    storage_locs: Vec<LookupOption>,
    footprints: Vec<LookupOption>,
    part_units: Vec<LookupOption>,
    meta_help: RwSignal<bool>,
) -> impl IntoView {
    let name_label = if is_meta_part {
        "Meta-Part Name (required)"
    } else {
        "Name (required)"
    };
    // Build the real-part-only section once, eagerly. We can't put it
    // inside a `<Show>` because Show requires Fn children but the
    // moved `storage_locs` Vec makes the children FnOnce.
    let real_part_section: leptos::prelude::AnyView = if is_meta_part {
        ().into_any()
    } else {
        view! {
            <FormField label="Local Part Number"
                hint="Your own SKU or tracking number for cross-referencing. Optional.">
                <input type="text" prop:value={move || internal_pn.get()}
                    on:input={move |ev| internal_pn.set(event_target_value(&ev))} />
            </FormField>
            <FormField label="Min stock level" hint="">
                <input type="number" min="0" step="1" prop:value={move || min_stock_level.get()}
                    on:input={move |ev| min_stock_level.set(event_target_value(&ev))} />
            </FormField>
            <FormField label="Status" hint="">
                <input type="text" prop:value={move || status.get()}
                    on:input={move |ev| status.set(event_target_value(&ev))} />
            </FormField>
            <FormField label="Condition" hint="">
                <input type="text" prop:value={move || condition.get()}
                    on:input={move |ev| condition.set(event_target_value(&ev))} />
            </FormField>
            <FormField label="Storage location" hint="">
                <LookupSelect signal=storage_id options=storage_locs />
            </FormField>
            <FormField label="Production remarks" hint="">
                <input type="text" prop:value={move || production_remarks.get()}
                    on:input={move |ev| production_remarks.set(event_target_value(&ev))} />
            </FormField>
            <label class="field-inline" style="padding:6px 0">
                <input type="checkbox"
                    prop:checked={move || needs_review.get()}
                    on:change={move |ev| needs_review.set(event_target_checked(&ev))} />
                <span>"Needs review"</span>
            </label>
        }.into_any()
    };
    view! {
        <Show when=move || is_meta_part>
            <div class="meta-part-banner">
                <span class="meta-part-banner-icon">"ℹ"</span>
                <span class="meta-part-banner-text">
                    "A meta-part stands in for any real part whose parameters "
                    "satisfy the criteria below. Use it in BOMs when the "
                    "exact part is interchangeable."
                </span>
                <button class="btn-action btn-recon"
                    title="Longer-form explanation"
                    on:click=move |_| meta_help.set(true)>
                    "Explain meta-parts"
                </button>
            </div>
        </Show>
        <FormField label=name_label hint="">
            <input type="text" prop:value={move || name.get()}
                on:input={move |ev| name.set(event_target_value(&ev))} />
        </FormField>
        <FormField label="Description" hint="">
            <input type="text" prop:value={move || description.get()}
                on:input={move |ev| description.set(event_target_value(&ev))} />
        </FormField>
        <FormField label="Category" hint="">
            <LookupSelect signal=category_id options=categories />
        </FormField>
        <FormField label="Footprint" hint="">
            <LookupSelect signal=footprint_id options=footprints />
        </FormField>
        <FormField label="Unit" hint="">
            <LookupSelect signal=part_unit_id options=part_units />
        </FormField>
        <FormField label="Comment" hint="">
            <textarea rows="3"
                on:input={move |ev| comment.set(event_target_value(&ev))}
                prop:value={move || comment.get()}></textarea>
        </FormField>
        // Real-part-only fields. Hidden for meta-parts because they
        // describe a physical instance (stock, condition, status) or a
        // catalog hand for a specific real part (local part number,
        // production remarks). A meta-part is an abstract spec.
        {real_part_section}
    }
}

// ---------------------------------------------------------------------------
//  Manufacturers tab
// ---------------------------------------------------------------------------

#[component]
fn ManufacturersTab(
    rows: RwSignal<Vec<EditableMfg>>,
    manufacturers: Vec<LookupOption>,
) -> impl IntoView {
    let add = move |_| {
        rows.update(|v| v.push(EditableMfg {
            key: next_key(),
            manufacturer_id: String::new(),
            part_number: String::new(),
        }));
    };
    view! {
        <table class="sub edit">
            <thead><tr>
                <th>"Manufacturer"</th>
                <th>"Part #"</th>
                <th style="width:32px"></th>
            </tr></thead>
            <tbody>
                <For each=move || rows.get()
                    key=|r| r.key
                    let:row>
                    <MfgRow row=row rows=rows manufacturers=manufacturers.clone() />
                </For>
            </tbody>
        </table>
        <button class="btn-action btn-add" style="margin-top:8px" on:click=add>
            "+ Add manufacturer"
        </button>
    }
}

#[component]
fn MfgRow(
    row: EditableMfg,
    rows: RwSignal<Vec<EditableMfg>>,
    manufacturers: Vec<LookupOption>,
) -> impl IntoView {
    let key = row.key;
    let initial_mfg = row.manufacturer_id.clone();
    let initial_pn = row.part_number.clone();

    view! {
        <tr>
            <td>
                <RowSelect
                    initial=initial_mfg
                    options=manufacturers
                    on_change=move |val| rows.update(|v| {
                        if let Some(r) = v.iter_mut().find(|r| r.key == key) {
                            r.manufacturer_id = val;
                        }
                    })
                />
            </td>
            <td>
                <input type="text" prop:value=initial_pn
                    on:input=move |ev| {
                        let val = event_target_value(&ev);
                        rows.update(|v| {
                            if let Some(r) = v.iter_mut().find(|r| r.key == key) {
                                r.part_number = val;
                            }
                        });
                    } />
            </td>
            <td>
                <button class="row-remove" title="Remove row"
                    on:click=move |_| rows.update(|v| v.retain(|r| r.key != key))>"✕"</button>
            </td>
        </tr>
    }
}

// ---------------------------------------------------------------------------
//  Distributors tab
// ---------------------------------------------------------------------------

#[component]
fn DistributorsTab(
    rows: RwSignal<Vec<EditableDist>>,
    distributors: Vec<LookupOption>,
) -> impl IntoView {
    let add = move |_| {
        rows.update(|v| v.push(EditableDist {
            key: next_key(),
            distributor_id: String::new(),
            order_number: String::new(),
            sku: String::new(),
            price: String::new(),
            currency: String::new(),
            packaging_unit: "1".into(),
            ignore_for_reports: false,
        }));
    };
    view! {
        <table class="sub edit">
            <thead><tr>
                <th>"Distributor"</th>
                <th>"Order #"</th>
                <th>"SKU"</th>
                <th class="right">"Price"</th>
                <th>"Cur"</th>
                <th class="right">"Pkg"</th>
                <th title="Ignore for reports / price calcs">"Ign."</th>
                <th style="width:32px"></th>
            </tr></thead>
            <tbody>
                <For each=move || rows.get()
                    key=|r| r.key
                    let:row>
                    <DistRow row=row rows=rows distributors=distributors.clone() />
                </For>
            </tbody>
        </table>
        <button class="btn-action btn-add" style="margin-top:8px" on:click=add>
            "+ Add distributor"
        </button>
    }
}

#[component]
fn DistRow(
    row: EditableDist,
    rows: RwSignal<Vec<EditableDist>>,
    distributors: Vec<LookupOption>,
) -> impl IntoView {
    let key = row.key;

    let update_field = move |f: fn(&mut EditableDist, String)| {
        move |val: String| {
            rows.update(|v| {
                if let Some(r) = v.iter_mut().find(|r| r.key == key) { f(r, val); }
            });
        }
    };

    view! {
        <tr>
            <td>
                <RowSelect
                    initial=row.distributor_id.clone()
                    options=distributors
                    on_change=update_field(|r, v| r.distributor_id = v)
                />
            </td>
            <td>
                <input type="text" prop:value=row.order_number.clone()
                    on:input=move |ev| {
                        let val = event_target_value(&ev);
                        rows.update(|v| {
                            if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.order_number = val; }
                        });
                    } />
            </td>
            <td>
                <input type="text" prop:value=row.sku.clone()
                    on:input=move |ev| {
                        let val = event_target_value(&ev);
                        rows.update(|v| {
                            if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.sku = val; }
                        });
                    } />
            </td>
            <td>
                <input type="text" class="right" prop:value=row.price.clone() style="width:80px"
                    on:input=move |ev| {
                        let val = event_target_value(&ev);
                        rows.update(|v| {
                            if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.price = val; }
                        });
                    } />
            </td>
            <td>
                <input type="text" prop:value=row.currency.clone() style="width:50px"
                    on:input=move |ev| {
                        let val = event_target_value(&ev);
                        rows.update(|v| {
                            if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.currency = val; }
                        });
                    } />
            </td>
            <td>
                <input type="number" min="1" step="1" prop:value=row.packaging_unit.clone() style="width:60px"
                    on:input=move |ev| {
                        let val = event_target_value(&ev);
                        rows.update(|v| {
                            if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.packaging_unit = val; }
                        });
                    } />
            </td>
            <td>
                <input type="checkbox" prop:checked=row.ignore_for_reports
                    on:change=move |ev| {
                        let val = event_target_checked(&ev);
                        rows.update(|v| {
                            if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.ignore_for_reports = val; }
                        });
                    } />
            </td>
            <td>
                <button class="row-remove" title="Remove row"
                    on:click=move |_| rows.update(|v| v.retain(|r| r.key != key))>"✕"</button>
            </td>
        </tr>
    }
}

// ---------------------------------------------------------------------------
//  Parameters tab
// ---------------------------------------------------------------------------

#[component]
fn ParametersTab(
    rows: RwSignal<Vec<EditableParam>>,
    units: Vec<UnitOption>,
    si_prefixes: Vec<SiPrefixOption>,
) -> impl IntoView {
    let add = move |_| {
        rows.update(|v| v.push(EditableParam {
            key: next_key(),
            name: String::new(),
            description: String::new(),
            // Default to "" (— choose —) so the user explicitly picks
            // numeric or string rather than silently defaulting.
            value_type: String::new(),
            string_value: String::new(),
            value: String::new(),
            minimum_value: String::new(),
            maximum_value: String::new(),
            unit_id: String::new(),
            si_prefix_id: String::new(),
            min_si_prefix_id: String::new(),
            max_si_prefix_id: String::new(),
        }));
    };
    view! {
        <p class="modal-help">
            "Numeric parameters can have a single value or a min/max range; both
            sit alongside a unit and SI prefix. Switching value type preserves
            both the string and numeric values, so you can flip back if needed."
        </p>
        <For each=move || rows.get()
            key=|r| r.key
            let:row>
            <ParamRow row=row rows=rows units=units.clone() si_prefixes=si_prefixes.clone() />
        </For>
        <button class="btn-action btn-add" style="margin-top:8px" on:click=add>
            "+ Add parameter"
        </button>
    }
}

#[component]
fn ParamRow(
    row: EditableParam,
    rows: RwSignal<Vec<EditableParam>>,
    units: Vec<UnitOption>,
    si_prefixes: Vec<SiPrefixOption>,
) -> impl IntoView {
    let key = row.key;
    let value_type = row.value_type.clone();
    let help_open = expect_context::<ParamTypeHelpState>().0;
    let select_ref: NodeRef<leptos::html::Select> = NodeRef::new();

    // Compact dropdown labels — "F" for unit, "μ" for prefix. Hover shows
    // the full name via the option's title; if we want richer labels for
    // accessibility, we can render a custom dropdown later.
    let unit_opts: Vec<LookupOption> = units.iter()
        .map(|u| LookupOption {
            id: u.id,
            name: if u.symbol.is_empty() { u.name.clone() } else { u.symbol.clone() },
        }).collect();
    let prefix_opts: Vec<LookupOption> = si_prefixes.iter()
        .map(|p| LookupOption {
            id: p.id,
            // Symbol + tiny exponent hint, e.g. "μ ×10⁻⁶" or "k ×10³".
            name: format!("{} ×{}{}", p.symbol, p.base, fmt_exp(p.exponent)),
        }).collect();

    let is_string = value_type == "string";
    let is_numeric = value_type == "numeric";
    let is_unset = value_type.is_empty();

    view! {
        <div class="param-row">
            <div class="param-row-head">
                <label class="numeric-label">"Name"</label>
                <input type="text" placeholder="e.g. Capacitance, Tolerance" prop:value=row.name.clone()
                    on:input=move |ev| {
                        let val = event_target_value(&ev);
                        rows.update(|v| {
                            if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.name = val; }
                        });
                    } />
                <label class="numeric-label" title="Whether this parameter's value is a number (with unit + SI prefix) or a free-form string. Pick 'Explain…' for a longer description.">"Type"</label>
                <select node_ref=select_ref
                    on:change=move |ev| {
                        let val = event_target_value(&ev);
                        if val == "explain" {
                            // "Explain…" is an action, not a state. Open the
                            // help modal and snap the dropdown back to
                            // whatever the row's actual type is.
                            help_open.set(true);
                            let actual = rows.get_untracked().iter()
                                .find(|r| r.key == key)
                                .map(|r| r.value_type.clone())
                                .unwrap_or_default();
                            if let Some(el) = select_ref.get() {
                                el.set_value(&actual);
                            }
                            return;
                        }
                        rows.update(|v| {
                            if let Some(r) = v.iter_mut().find(|r| r.key == key) {
                                r.value_type = val;
                            }
                        });
                    }>
                    <option value="" selected=is_unset>"— choose —"</option>
                    <option value="numeric" selected=is_numeric>"numeric"</option>
                    <option value="string" selected=is_string>"string"</option>
                    <option value="_sep" disabled>"────────"</option>
                    <option value="explain">"Explain…"</option>
                </select>
                <button class="row-remove" title="Remove parameter"
                    on:click=move |_| rows.update(|v| v.retain(|r| r.key != key))>"✕"</button>
            </div>

            // String / numeric body, conditional on type. When type is
            // unset (— choose —), show a hint pointing the user at the
            // dropdown — body editor only appears once they've decided.
            {if is_unset {
                view! {
                    <p class="muted modal-help" style="margin:4px 0 0 0">
                        "Pick "<strong>"numeric"</strong>" or "<strong>"string"</strong>" above
                        to enter a value. Pick "<em>"Explain…"</em>" if you're not sure which one
                        applies."
                    </p>
                }.into_any()
            } else if is_string {
                view! {
                    <div class="string-value-row">
                        <input type="text" placeholder="String value"
                            prop:value=row.string_value.clone()
                            on:input=move |ev| {
                                let val = event_target_value(&ev);
                                rows.update(|v| {
                                    if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.string_value = val; }
                                });
                            } />
                    </div>
                }.into_any()
            } else {
                let unit_initial = row.unit_id.clone();
                let prefix_initial = row.si_prefix_id.clone();
                let min_prefix_initial = row.min_si_prefix_id.clone();
                let max_prefix_initial = row.max_si_prefix_id.clone();
                view! {
                    // Row 1: label / value / SI prefix / unit
                    <div class="numeric-row">
                        <label class="numeric-label">"Value"</label>
                        <input type="text" prop:value=row.value.clone()
                            placeholder="0.047"
                            on:input=move |ev| {
                                let val = event_target_value(&ev);
                                rows.update(|v| {
                                    if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.value = val; }
                                });
                            } />
                        <RowSelect initial=prefix_initial options=prefix_opts.clone()
                            on_change=move |val| rows.update(|v| {
                                if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.si_prefix_id = val; }
                            }) />
                        <RowSelect initial=unit_initial options=unit_opts.clone()
                            on_change=move |val| rows.update(|v| {
                                if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.unit_id = val; }
                            }) />
                    </div>
                    // Row 2: min / max in a single grid for tight alignment
                    <div class="minmax-row">
                        <label class="numeric-label">"Min"</label>
                        <input type="text" prop:value=row.minimum_value.clone()
                            on:input=move |ev| {
                                let val = event_target_value(&ev);
                                rows.update(|v| {
                                    if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.minimum_value = val; }
                                });
                            } />
                        <RowSelect initial=min_prefix_initial options=prefix_opts.clone()
                            on_change=move |val| rows.update(|v| {
                                if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.min_si_prefix_id = val; }
                            }) />
                        <label class="numeric-label max-label">"Max"</label>
                        <input type="text" prop:value=row.maximum_value.clone()
                            on:input=move |ev| {
                                let val = event_target_value(&ev);
                                rows.update(|v| {
                                    if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.maximum_value = val; }
                                });
                            } />
                        <RowSelect initial=max_prefix_initial options=prefix_opts.clone()
                            on_change=move |val| rows.update(|v| {
                                if let Some(r) = v.iter_mut().find(|r| r.key == key) { r.max_si_prefix_id = val; }
                            }) />
                    </div>
                }.into_any()
            }}
        </div>
    }
}

// ---------------------------------------------------------------------------
//  Criteria tab (slice 11c — meta-part parameter criteria)
// ---------------------------------------------------------------------------

#[component]
fn CriteriaTab(
    rows: RwSignal<Vec<EditableCriterion>>,
    si_prefixes: Vec<SiPrefixOption>,
) -> impl IntoView {
    // Load the parameter-name vocabulary once. Each row uses it to
    // populate its name dropdown so users pick from the actual set of
    // names already in use, not free-text-typed names that won't match
    // anything. (Same pattern as the slice-11b filter pane.)
    let names = LocalResource::new(|| api::fetch_parameter_names());
    let add = move |_| {
        rows.update(|v| v.push(EditableCriterion {
            key: next_key(),
            name: String::new(),
            op: "=".to_string(),
            value_type: "numeric".to_string(),
            string_value: String::new(),
            value: String::new(),
            si_prefix_id: String::new(),
            unit_id: String::new(),
        }));
    };
    view! {
        <p class="modal-help">
            "Criteria define which real parts this meta-part stands in for. "
            "Each row is a predicate against a parameter name; matches are "
            "the parts whose own parameters satisfy "<em>"all"</em>" criteria."
        </p>
        <Suspense fallback=|| view! {
            <p class="muted" style:padding="6px 0">"Loading parameter names…"</p>
        }>
            {move || names.get().map(|res| match &*res {
                Err(e) => view! {
                    <p class="muted">{format!("Error: {}", e.0)}</p>
                }.into_any(),
                Ok(name_rows) => {
                    let names_v = name_rows.clone();
                    let prefixes_v = si_prefixes.clone();
                    view! {
                        <For each=move || rows.get()
                            key=|r| r.key
                            let:row>
                            <CriterionRow row=row rows=rows
                                names=names_v.clone()
                                si_prefixes=prefixes_v.clone()/>
                        </For>
                    }.into_any()
                }
            })}
        </Suspense>
        <button class="btn-action btn-add" style="margin-top:8px" on:click=add>
            "+ Add criterion"
        </button>
    }
}

#[component]
fn CriterionRow(
    row: EditableCriterion,
    rows: RwSignal<Vec<EditableCriterion>>,
    names: Vec<ParameterNameRow>,
    si_prefixes: Vec<SiPrefixOption>,
) -> impl IntoView {
    let key = row.key;
    let is_string = row.value_type == "string";

    // Picking a parameter name updates both the name and value_type
    // (encoded in the option's value as "name|value_type" so the same
    // name appearing as both string- and numeric-typed shows up twice
    // distinguishably). Reset value-shaped fields and downgrade `like`
    // → `=` when the new type can't support it.
    let on_name = move |ev: leptos::ev::Event| {
        let raw = event_target_value(&ev);
        let (name, vtype) = match raw.split_once('|') {
            Some((n, t)) => (n.to_string(), t.to_string()),
            None => (raw, String::new()),
        };
        rows.update(|rs| if let Some(r) = rs.iter_mut().find(|r| r.key == key) {
            r.name = name;
            if !vtype.is_empty() {
                r.value_type = vtype.clone();
            }
            r.value = String::new();
            r.string_value = String::new();
            r.si_prefix_id = String::new();
            if vtype == "numeric" && r.op == "like" {
                r.op = "=".to_string();
            }
        });
    };
    let on_type = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        rows.update(|rs| if let Some(r) = rs.iter_mut().find(|r| r.key == key) {
            r.value_type = v.clone();
            // Clear value-shaped fields so an old numeric value doesn't
            // bleed into a string predicate (and vice versa). Reset op
            // to "=" if switching from string→numeric while op is "like".
            r.value = String::new();
            r.string_value = String::new();
            r.si_prefix_id = String::new();
            if v == "numeric" && r.op == "like" {
                r.op = "=".to_string();
            }
        });
    };
    let on_op = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        rows.update(|rs| if let Some(r) = rs.iter_mut().find(|r| r.key == key) { r.op = v; });
    };
    let on_string_value = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        rows.update(|rs| if let Some(r) = rs.iter_mut().find(|r| r.key == key) { r.string_value = v; });
    };
    let on_numeric_value = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        rows.update(|rs| if let Some(r) = rs.iter_mut().find(|r| r.key == key) { r.value = v; });
    };
    let on_prefix = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        rows.update(|rs| if let Some(r) = rs.iter_mut().find(|r| r.key == key) { r.si_prefix_id = v; });
    };

    let prefix_options = si_prefixes.clone();
    // Sort names alphabetically (case-insensitive) for the dropdown.
    let name_options: Vec<ParameterNameRow> = {
        let mut sorted = names.clone();
        sorted.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        sorted
    };
    // Selected option value: "name|value_type". Matches the encoding
    // we write in the options below so prop:value reliably maps back.
    let row_name_for_select = row.name.clone();
    let row_vtype_for_select = row.value_type.clone();
    let selected_value = if row_name_for_select.is_empty() {
        String::new()
    } else {
        format!("{row_name_for_select}|{row_vtype_for_select}")
    };

    view! {
        <div class="criterion-row">
            <select class="predicate-name"
                prop:value=selected_value
                on:change=on_name>
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
                prop:value=row.op.clone() on:change=on_op>
                <option value="=">"= equals"</option>
                <option value="!=">"≠ not equals"</option>
                <option value="<">"< less than"</option>
                <option value="<=">"≤ less than or equal"</option>
                <option value=">">"> greater than"</option>
                <option value=">=">"≥ greater than or equal"</option>
                {if is_string {
                    view! { <option value="like">"% matches (wildcard)"</option> }.into_any()
                } else { ().into_any() }}
                <option value="in">"∈ in list"</option>
            </select>
            <select class="predicate-prefix"
                prop:value=row.value_type.clone()
                on:change=on_type
                style="width:110px">
                <option value="numeric">"numeric"</option>
                <option value="string">"string"</option>
            </select>
            {if is_string {
                view! {
                    <span class="predicate-value-cell">
                        <input type="text" class="predicate-value-string"
                            placeholder="value (use % for 'like')"
                            prop:value=row.string_value.clone()
                            on:input=on_string_value/>
                    </span>
                }.into_any()
            } else {
                view! {
                    <span class="predicate-value-cell">
                        <input type="text" class="predicate-value"
                            placeholder="value"
                            prop:value=row.value.clone()
                            on:input=on_numeric_value/>
                        <select class="predicate-prefix"
                            prop:value=row.si_prefix_id.clone()
                            on:change=on_prefix>
                            <option value="">"(no prefix)"</option>
                            {prefix_options.into_iter().map(|p| view! {
                                <option value=p.id.to_string()>
                                    {format!("{} ×{}{}", p.symbol, p.base, fmt_exp(p.exponent))}
                                </option>
                            }).collect::<Vec<_>>()}
                        </select>
                    </span>
                }.into_any()
            }}
            <button class="row-remove" title="Remove criterion"
                on:click=move |_| rows.update(|v| v.retain(|r| r.key != key))>"✕"</button>
        </div>
    }
}

/// Format a base-10 (or base-2) exponent as a Unicode-superscript suffix:
/// `-6` → `⁻⁶`, `3` → `³`, `0` → `⁰`. Used in the SI-prefix dropdown label.
fn fmt_exp(exp: i32) -> String {
    let abs: String = exp.abs().to_string().chars().map(|c| match c {
        '0' => '⁰', '1' => '¹', '2' => '²', '3' => '³', '4' => '⁴',
        '5' => '⁵', '6' => '⁶', '7' => '⁷', '8' => '⁸', '9' => '⁹',
        _ => c,
    }).collect();
    if exp < 0 { format!("⁻{abs}") } else { abs }
}

// ---------------------------------------------------------------------------
//  Generic helpers
// ---------------------------------------------------------------------------

#[component]
fn FormField(
    label: &'static str,
    hint: &'static str,
    children: Children,
) -> impl IntoView {
    view! {
        <label class="field" style="margin-bottom:8px">
            <span>
                {label}
                {if !hint.is_empty() {
                    view! { <span class="field-hint" title=hint>" ⓘ"</span> }.into_any()
                } else { view! {}.into_any() }}
            </span>
            {children()}
        </label>
    }
}

#[component]
fn LookupSelect(signal: RwSignal<String>, options: Vec<LookupOption>) -> impl IntoView {
    let initial = signal.get_untracked();
    let none_selected = initial.is_empty();
    let opts: Vec<_> = options
        .into_iter()
        .map(|o| {
            let id_str = o.id.to_string();
            let is_sel = id_str == initial;
            view! { <option value={id_str} selected=is_sel>{o.name}</option> }.into_any()
        })
        .collect();
    view! {
        <select on:change={move |ev| signal.set(event_target_value(&ev))}>
            <option value="" selected=none_selected>"— none —"</option>
            {opts}
        </select>
    }
}

/// One-shot select where the parent owns state and gets a callback on
/// change. Used inside row components where we don't have a per-cell
/// signal but need to wire the change back to the rows Vec.
#[component]
fn RowSelect<F>(
    initial: String,
    options: Vec<LookupOption>,
    on_change: F,
) -> impl IntoView
where
    F: Fn(String) + 'static + Clone,
{
    let none_selected = initial.is_empty();
    let opts: Vec<_> = options
        .into_iter()
        .map(|o| {
            let id_str = o.id.to_string();
            let is_sel = id_str == initial;
            view! { <option value={id_str} selected=is_sel>{o.name}</option> }.into_any()
        })
        .collect();
    view! {
        <select on:change=move |ev| on_change(event_target_value(&ev))>
            <option value="" selected=none_selected>"— none —"</option>
            {opts}
        </select>
    }
}

fn empty_to_none(s: String) -> Option<String> {
    let t = s.trim();
    if t.is_empty() { None } else { Some(s) }
}

fn opt_id_str(id: Option<i32>) -> String {
    id.map(|i| i.to_string()).unwrap_or_default()
}

fn parse_id(s: &str) -> Option<i32> {
    let t = s.trim();
    if t.is_empty() { None } else { t.parse::<i32>().ok() }
}

fn event_target_checked(ev: &leptos::ev::Event) -> bool {
    use wasm_bindgen::JsCast;
    ev.target()
        .and_then(|t| t.dyn_into::<web_sys::HtmlInputElement>().ok())
        .map(|el| el.checked())
        .unwrap_or(false)
}
