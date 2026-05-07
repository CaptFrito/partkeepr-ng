use leptos::prelude::*;

use crate::api;
use crate::components::ParametricFilter;
use crate::types::{CategoryNode, FootprintTreeNode, PartRow, StorageTreeNode};
use crate::{
    DataVersion, EditorMode, EditorModeState, FieldFiltersState, FootprintSelection,
    LeftPaneMode, LeftPaneModeState, MetaFilter, MetaFilterState, Offset, PredicatesState,
    Search, SelectedCategory, SelectedFootprint, SelectedPart, SelectedStorage, Sort,
    StorageSelection,
};

const PAGE_SIZE: u32 = 50;

#[component]
pub fn PartsGrid() -> impl IntoView {
    let selected_category = expect_context::<SelectedCategory>().0;
    let selected_storage = expect_context::<SelectedStorage>().0;
    let selected_footprint = expect_context::<SelectedFootprint>().0;
    let pane_mode = expect_context::<LeftPaneModeState>().0;
    let _selected_part = expect_context::<SelectedPart>().0; // PartRowView reads
    let search = expect_context::<Search>().0;
    let offset = expect_context::<Offset>().0;
    let sort = expect_context::<Sort>().0;
    let data_version = expect_context::<DataVersion>().0;
    let editor_mode = expect_context::<EditorModeState>().0;
    let predicates = expect_context::<PredicatesState>().0;
    let meta_filter = expect_context::<MetaFilterState>().0;
    let field_filters = expect_context::<FieldFiltersState>().0;

    /// (category, storage_folder, storage_location, footprint_folder, footprint).
    /// Mode-sensitive: only one tab's selection is "live" at a time.
    /// Switching modes preserves all three selections independently.
    type Filter = (Option<i32>, Option<i32>, Option<i32>, Option<i32>, Option<i32>);
    let active_filter = move || -> Filter {
        match pane_mode.get() {
            LeftPaneMode::Categories => (selected_category.get(), None, None, None, None),
            LeftPaneMode::Storage => match selected_storage.get() {
                StorageSelection::None => (None, None, None, None, None),
                StorageSelection::Folder(id) => (None, Some(id), None, None, None),
                StorageSelection::Location(id) => (None, None, Some(id), None, None),
            },
            LeftPaneMode::Footprints => match selected_footprint.get() {
                FootprintSelection::None => (None, None, None, None, None),
                FootprintSelection::Folder(id) => (None, None, None, Some(id), None),
                FootprintSelection::Footprint(id) => (None, None, None, None, Some(id)),
            },
            // Lookups + Projects modes hide the parts grid entirely; no
            // filter applies. The Show in main.rs gates the grid render.
            LeftPaneMode::Lookups | LeftPaneMode::Projects => (None, None, None, None, None),
        }
    };

    // Reset pagination when any of the filter axes change. Predicate
    // count is good enough as a change-detector; the actual fetch
    // dependency tracks the full predicate state via `predicates.with`.
    Effect::new(move |prev: Option<(Filter, String, (String, bool), usize, MetaFilter, api::FieldFilters)>| {
        let cur = (
            active_filter(),
            search.get(),
            sort.get(),
            predicates.with(|v| v.len()),
            meta_filter.get(),
            field_filters.get(),
        );
        if let Some(p) = prev.as_ref() {
            if *p != cur {
                offset.set(0);
            }
        }
        cur
    });

    let parts = LocalResource::new(move || {
        let (cat, storage_folder, storage_location, footprint_folder, footprint) = active_filter();
        let s = search.get();
        let off = offset.get();
        let (sort_col, sort_asc) = sort.get();
        let _ = data_version.get(); // tracked dep — refetch after mutations
        let sort_opt = if sort_col.is_empty() { None } else { Some(sort_col) };
        let dir_opt = if sort_opt.is_some() {
            Some(if sort_asc { "asc".into() } else { "desc".into() })
        } else {
            None
        };
        // Slice 11: when any predicate has a name set, use the
        // parametric endpoint; otherwise the cheaper GET. Predicates
        // with empty names are mid-edit rows that shouldn't filter yet.
        let preds: Vec<api::Predicate> = predicates.with(|v| {
            v.iter().filter(|p| !p.name.is_empty()).cloned().collect()
        });
        let meta_only = meta_filter.get().to_meta_only();
        let fields = field_filters.get();
        async move {
            if preds.is_empty() {
                api::fetch_parts(
                    cat, storage_folder, storage_location, footprint_folder, footprint,
                    s, PAGE_SIZE, off, sort_opt, dir_opt, meta_only, &fields,
                ).await
            } else {
                let body = api::ParametricBody {
                    predicates: preds,
                    category: cat,
                    storage_folder,
                    storage_location,
                    footprint_folder,
                    footprint,
                    search: if s.is_empty() { None } else { Some(s) },
                    meta_only,
                    stock_mode: fields.stock_mode.clone(),
                    distributor_id: fields.distributor_id,
                    price_min: fields.price_min.clone(),
                    price_max: fields.price_max.clone(),
                    created_after: fields.created_after.clone(),
                    recurse_categories: fields.recurse_categories,
                    name_like: fields.name_like.clone(),
                    description_like: fields.description_like.clone(),
                    internal_part_number_like: fields.internal_part_number_like.clone(),
                    stock_min: fields.stock_min,
                    stock_max: fields.stock_max,
                    status_like: fields.status_like.clone(),
                    condition_like: fields.condition_like.clone(),
                    limit: PAGE_SIZE,
                    offset: off,
                    sort: sort_opt,
                    dir: dir_opt,
                };
                api::post_parametric(body).await
            }
        }
    });

    let total = move || parts.get()
        .and_then(|r| r.as_ref().as_ref().ok().map(|r| r.total))
        .unwrap_or(0);

    let page_of = move || {
        let off = offset.get() as i64;
        let total = total();
        if total == 0 { return "—".to_string(); }
        let cur = off / PAGE_SIZE as i64 + 1;
        let last = (total + PAGE_SIZE as i64 - 1) / PAGE_SIZE as i64;
        format!("Page {cur} of {last}")
    };

    // Active-filter banner: tree gives us the path for the selected
    // category; render a "Filtering by …" with a clear button. One
    // resource per tree-shape, looked up only when the matching mode
    // is active.
    let tree_resource = LocalResource::new(api::fetch_category_tree);
    let storage_tree_resource = LocalResource::new(api::fetch_storage_tree);
    let footprint_tree_resource = LocalResource::new(api::fetch_footprint_tree);

    let active_category_path = move || -> Option<String> {
        if pane_mode.get() != LeftPaneMode::Categories { return None; }
        let cat = selected_category.get()?;
        let r = tree_resource.get()?;
        match &*r {
            Ok(roots) => find_category_path(roots, cat),
            Err(_) => None,
        }
    };
    let active_storage_label = move || -> Option<(&'static str, String)> {
        if pane_mode.get() != LeftPaneMode::Storage { return None; }
        let sel = selected_storage.get();
        if sel == StorageSelection::None { return None; }
        let r = storage_tree_resource.get()?;
        match &*r {
            Ok(roots) => match sel {
                StorageSelection::Folder(id) => find_storage_folder_path(roots, id)
                    .map(|p| ("folder", p)),
                StorageSelection::Location(id) => find_storage_location_path(roots, id)
                    .map(|p| ("location", p)),
                StorageSelection::None => None,
            },
            Err(_) => None,
        }
    };
    let active_footprint_label = move || -> Option<(&'static str, String)> {
        if pane_mode.get() != LeftPaneMode::Footprints { return None; }
        let sel = selected_footprint.get();
        if sel == FootprintSelection::None { return None; }
        let r = footprint_tree_resource.get()?;
        match &*r {
            Ok(roots) => match sel {
                FootprintSelection::Folder(id) => find_footprint_folder_path(roots, id)
                    .map(|p| ("folder", p)),
                FootprintSelection::Footprint(id) => find_footprint_leaf_path(roots, id)
                    .map(|p| ("footprint", p)),
                FootprintSelection::None => None,
            },
            Err(_) => None,
        }
    };

    view! {
        <div class="toolbar">
            <button class="btn-action btn-add"
                title="Create a new part"
                on:click=move |_| editor_mode.set(EditorMode::Creating)>
                "+ New Part"
            </button>
            <button class="btn-action btn-add"
                title="Create a new meta-part (a virtual part defined by parameter criteria)"
                on:click=move |_| editor_mode.set(EditorMode::CreatingMeta)>
                "+ Meta-Part"
            </button>
            <div class="search-wrap">
                <input type="text" placeholder="Search name / desc / part #"
                    prop:value=move || search.get()
                    on:input=move |ev| search.set(event_target_value(&ev)) />
                <Show when=move || !search.get().is_empty()>
                    <button class="clear-btn" title="Clear search"
                        on:click=move |_| search.set(String::new())>"✕"</button>
                </Show>
            </div>
            <div class="meta-filter" title="Filter by part type">
                <button class="meta-filter-btn"
                    class:active=move || meta_filter.get() == MetaFilter::All
                    on:click=move |_| meta_filter.set(MetaFilter::All)>"All"</button>
                <button class="meta-filter-btn"
                    class:active=move || meta_filter.get() == MetaFilter::RealOnly
                    on:click=move |_| meta_filter.set(MetaFilter::RealOnly)>"Real"</button>
                <button class="meta-filter-btn"
                    class:active=move || meta_filter.get() == MetaFilter::MetaOnly
                    on:click=move |_| meta_filter.set(MetaFilter::MetaOnly)>"Meta"</button>
            </div>
            <div class="spacer" />
            <span class="total">
                {move || {
                    parts.get().and_then(|r| r.as_ref().as_ref().ok().map(|r| {
                        if r.total == 0 { return "no matches".to_string(); }
                        let from = r.offset + 1;
                        let to = r.offset + r.items.len() as u32;
                        format!("{from}–{to} of {}", r.total)
                    })).unwrap_or_default()
                }}
            </span>
            <button class="page"
                prop:disabled={move || offset.get() == 0}
                on:click={move |_| {
                    let off = offset.get();
                    if off >= PAGE_SIZE { offset.set(off - PAGE_SIZE) }
                }}>"« Prev"</button>
            <span class="page-of">{page_of}</span>
            <button class="page"
                prop:disabled={move || (offset.get() as i64) + (PAGE_SIZE as i64) >= total()}
                on:click={move |_| {
                    let off = offset.get();
                    if (off as i64) + (PAGE_SIZE as i64) < total() {
                        offset.set(off + PAGE_SIZE);
                    }
                }}>"Next »"</button>
        </div>
        <Show when=move || active_category_path().is_some()>
            <div class="active-filter">
                <span>"Filtering by category: "</span>
                <strong>{move || active_category_path().unwrap_or_default()}</strong>
                <button class="clear-filter"
                    on:click=move |_| selected_category.set(None)>"clear"</button>
            </div>
        </Show>
        <Show when=move || active_storage_label().is_some()>
            <div class="active-filter">
                {move || active_storage_label().map(|(kind, label)| view! {
                    <span>{format!("Filtering by storage {kind}: ")}</span>
                    <strong>{label}</strong>
                })}
                <button class="clear-filter"
                    on:click=move |_| selected_storage.set(StorageSelection::None)>"clear"</button>
            </div>
        </Show>
        <Show when=move || active_footprint_label().is_some()>
            <div class="active-filter">
                {move || active_footprint_label().map(|(kind, label)| view! {
                    <span>{format!("Filtering by {kind}: ")}</span>
                    <strong>{label}</strong>
                })}
                <button class="clear-filter"
                    on:click=move |_| selected_footprint.set(FootprintSelection::None)>"clear"</button>
            </div>
        </Show>
        <ParametricFilter/>
        <div class="parts-grid">
            // Single static table — thead (column titles + per-column
            // filter row) lives outside the Suspense so the filter
            // <input> elements stay mounted across data refetches.
            // Without this, every keystroke fires a refetch, recreates
            // the table, and unmounts/remounts the filter inputs (focus
            // loss after every character).
            <table class="parts">
                <thead>
                    <tr>
                        <SortableTh label="#" col="id" width="60px" align_right=true />
                        <SortableTh label="Name" col="name" width="" />
                        <SortableTh label="Description" col="description" width="" />
                        <SortableTh label="Stock" col="stock_level" width="60px" align_right=true />
                        <SortableTh label="Min" col="min_stock_level" width="50px" align_right=true />
                        <SortableTh label="Status" col="status" width="80px" />
                        <SortableTh label="Condition" col="part_condition" width="80px" />
                        <SortableTh label="Avg Price" col="average_price" width="80px" align_right=true />
                    </tr>
                    <ColumnFilterRow/>
                </thead>
                <Suspense fallback=|| view! {
                    <tbody><tr><td colspan="8" class="muted" style="padding:12px">"Loading…"</td></tr></tbody>
                }>
                    {move || parts.get().map(|res| match &*res {
                        Err(e) => view! {
                            <tbody><tr><td colspan="8" class="muted" style="padding:12px">
                                {format!("Error: {}", e.0)}
                            </td></tr></tbody>
                        }.into_any(),
                        Ok(r) => view! {
                            <GroupedTbodies items=r.items.clone() />
                        }.into_any(),
                    })}
                </Suspense>
            </table>
        </div>
    }
}

#[component]
fn GroupedTbodies(items: Vec<PartRow>) -> impl IntoView {
    // Group consecutive items by their category breadcrumb so we can
    // emit one <tbody> per category. Each <tbody> is preceded by a
    // section-header row (<tr> with colspan) instead of a separate
    // <div> — keeps everything inside one <table> so the column-filter
    // <input>s stay mounted across data refetches.
    let mut groups: Vec<(String, Vec<PartRow>)> = Vec::new();
    for item in items {
        let path = item.category_path.clone().unwrap_or_else(|| "(uncategorized)".into());
        match groups.last_mut() {
            Some((p, rs)) if *p == path => rs.push(item),
            _ => groups.push((path, vec![item])),
        }
    }

    view! {
        {groups.into_iter().map(|(path, items)| {
            let count = items.len();
            view! {
                <tbody class="category-tbody">
                    <tr class="section-header-row">
                        <td colspan="8">
                            {path}
                            <span class="count">{format!(
                                "  ({count} part{})",
                                if count == 1 { "" } else { "s" },
                            )}</span>
                        </td>
                    </tr>
                    {items.into_iter().map(|p| view! { <PartRowView p=p/> }).collect::<Vec<_>>()}
                </tbody>
            }
        }).collect::<Vec<_>>()}
    }
}

#[component]
fn SortableTh(
    label: &'static str,
    col: &'static str,
    width: &'static str,
    #[prop(optional)] align_right: bool,
) -> impl IntoView {
    let sort = expect_context::<Sort>().0;

    let style = format!(
        "{}{}",
        if width.is_empty() { String::new() } else { format!("width:{width};") },
        if align_right { "text-align:right;" } else { "" }
    );

    let (arrow_text, arrow_cls) = (
        move || {
            let (c, asc) = sort.get();
            if c == col { if asc { "▲" } else { "▼" } } else { "↕" }
        },
        move || {
            let (c, _) = sort.get();
            if c == col { "arrow active" } else { "arrow idle" }
        },
    );

    view! {
        <th class="sortable" style=style
            on:click=move |_| {
                sort.update(|s| {
                    if s.0 == col {
                        // Cycle: asc -> desc -> off
                        if s.1 { s.1 = false; }
                        else { *s = (String::new(), true); }
                    } else {
                        *s = (col.to_string(), true);
                    }
                });
            }>
            {label}<span class=arrow_cls>{arrow_text}</span>
        </th>
    }
}

/// Slice 6b — second header row with one inline filter input per
/// filterable column. Reads/writes the shared `FieldFiltersState`, so
/// inline filters and the filter pane stay in sync (where they share
/// fields, e.g. nothing — the pane has no name/description/IPN inputs).
#[component]
fn ColumnFilterRow() -> impl IntoView {
    let fields = expect_context::<FieldFiltersState>().0;

    // Generic LIKE-input cell.
    let like_cell = move |get: fn(&api::FieldFilters) -> Option<String>,
                          set: fn(&mut api::FieldFilters, Option<String>)| -> AnyView {
        let value = move || fields.with(|f| get(f)).unwrap_or_default();
        let on_input = move |ev: leptos::ev::Event| {
            let v = event_target_value(&ev);
            fields.update(|f| {
                set(f, if v.trim().is_empty() { None } else { Some(v) });
            });
        };
        view! {
            <th class="col-filter">
                <input type="text" placeholder="filter…"
                    prop:value=value on:input=on_input/>
            </th>
        }.into_any()
    };

    // Stock min/max range cell. Two tiny inputs side by side under one <th>.
    let stock_min_value = move || fields.with(|f| f.stock_min).map(|n| n.to_string()).unwrap_or_default();
    let stock_max_value = move || fields.with(|f| f.stock_max).map(|n| n.to_string()).unwrap_or_default();
    let on_stock_min = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        fields.update(|f| {
            f.stock_min = if v.trim().is_empty() { None } else { v.trim().parse().ok() };
        });
    };
    let on_stock_max = move |ev: leptos::ev::Event| {
        let v = event_target_value(&ev);
        fields.update(|f| {
            f.stock_max = if v.trim().is_empty() { None } else { v.trim().parse().ok() };
        });
    };

    view! {
        <tr class="col-filter-row">
            // # column — no filter (filtering by id is rarely useful).
            <th class="col-filter"></th>
            {like_cell(
                |f| f.name_like.clone(),
                |f, v| f.name_like = v,
            )}
            {like_cell(
                |f| f.description_like.clone(),
                |f, v| f.description_like = v,
            )}
            <th class="col-filter">
                <span class="col-filter-range">
                    <input type="number" min="0" placeholder="min"
                        prop:value=stock_min_value on:input=on_stock_min/>
                    <input type="number" min="0" placeholder="max"
                        prop:value=stock_max_value on:input=on_stock_max/>
                </span>
            </th>
            // Min column — no per-column filter (the "Stock = Low" pill
            // in the side panel does what most operators want here).
            <th class="col-filter"></th>
            {like_cell(
                |f| f.status_like.clone(),
                |f, v| f.status_like = v,
            )}
            {like_cell(
                |f| f.condition_like.clone(),
                |f, v| f.condition_like = v,
            )}
            // Avg Price — the side panel's price-range inputs cover
            // this column. Skip the inline duplicate to avoid two
            // surfaces editing the same fields.
            <th class="col-filter"></th>
        </tr>
    }
}

/// Walk the loaded category tree to find a node's full breadcrumb. Used
/// by the active-filter banner; tree is loaded once anyway.
fn find_category_path(roots: &[CategoryNode], id: i32) -> Option<String> {
    for root in roots {
        if let Some(p) = walk(root, id) {
            return Some(p);
        }
    }
    None
}

fn walk(node: &CategoryNode, id: i32) -> Option<String> {
    if node.id == id {
        return Some(node.category_path.clone());
    }
    for child in &node.children {
        if let Some(p) = walk(child, id) {
            return Some(p);
        }
    }
    None
}

fn find_storage_folder_path(roots: &[StorageTreeNode], id: i32) -> Option<String> {
    for r in roots {
        if let Some(p) = walk_storage_folder(r, id) {
            return Some(p);
        }
    }
    None
}

fn walk_storage_folder(node: &StorageTreeNode, id: i32) -> Option<String> {
    if node.id == id {
        return Some(node.category_path.clone());
    }
    for child in &node.children {
        if let Some(p) = walk_storage_folder(child, id) {
            return Some(p);
        }
    }
    None
}

fn find_storage_location_path(roots: &[StorageTreeNode], id: i32) -> Option<String> {
    for r in roots {
        if let Some(p) = walk_storage_location(r, id) {
            return Some(p);
        }
    }
    None
}

fn walk_storage_location(node: &StorageTreeNode, id: i32) -> Option<String> {
    for loc in &node.locations {
        if loc.id == id {
            return Some(format!("{} ➤ {}", node.category_path, loc.name));
        }
    }
    for child in &node.children {
        if let Some(p) = walk_storage_location(child, id) {
            return Some(p);
        }
    }
    None
}

fn find_footprint_folder_path(roots: &[FootprintTreeNode], id: i32) -> Option<String> {
    for r in roots {
        if let Some(p) = walk_footprint_folder(r, id) {
            return Some(p);
        }
    }
    None
}

fn walk_footprint_folder(node: &FootprintTreeNode, id: i32) -> Option<String> {
    if node.id == id {
        return Some(node.category_path.clone());
    }
    for child in &node.children {
        if let Some(p) = walk_footprint_folder(child, id) {
            return Some(p);
        }
    }
    None
}

fn find_footprint_leaf_path(roots: &[FootprintTreeNode], id: i32) -> Option<String> {
    for r in roots {
        if let Some(p) = walk_footprint_leaf(r, id) {
            return Some(p);
        }
    }
    None
}

fn walk_footprint_leaf(node: &FootprintTreeNode, id: i32) -> Option<String> {
    for fp in &node.footprints {
        if fp.id == id {
            return Some(format!("{} ➤ {}", node.category_path, fp.name));
        }
    }
    for child in &node.children {
        if let Some(p) = walk_footprint_leaf(child, id) {
            return Some(p);
        }
    }
    None
}

#[component]
fn PartRowView(p: PartRow) -> impl IntoView {
    let selected_part = expect_context::<SelectedPart>().0;
    let id = p.id;
    let stock_class = if p.low_stock { "right low-stock" } else { "right" };
    let is_meta = p.meta_part;
    let row_class = if is_meta { "part-row meta-part-row" } else { "part-row" };
    let name_view = if is_meta {
        view! {
            <td class="meta-part-name">
                <span>{p.name}</span>
                <span class="meta-tag" title="Meta-part: matches any real part satisfying its criteria">"(meta)"</span>
            </td>
        }.into_any()
    } else {
        view! { <td>{p.name}</td> }.into_any()
    };

    view! {
        <tr class=row_class
            class:selected=move || selected_part.get() == Some(id)
            on:click=move |_| selected_part.set(Some(id))>
            <td class="right">{p.id}</td>
            {name_view}
            <td>{p.description.unwrap_or_default()}</td>
            <td class=stock_class>{p.stock_level}</td>
            <td class="right muted">{p.min_stock_level}</td>
            <td>{p.status.unwrap_or_default()}</td>
            <td>{p.part_condition.unwrap_or_default()}</td>
            <td class="right">{p.average_price}</td>
        </tr>
    }
}
