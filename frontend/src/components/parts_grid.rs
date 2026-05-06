use leptos::prelude::*;

use crate::api;
use crate::types::{CategoryNode, PartRow};
use crate::{
    DataVersion, EditorMode, EditorModeState, Offset, Search, SelectedCategory,
    SelectedPart, Sort,
};

const PAGE_SIZE: u32 = 50;

#[component]
pub fn PartsGrid() -> impl IntoView {
    let selected_category = expect_context::<SelectedCategory>().0;
    let _selected_part = expect_context::<SelectedPart>().0; // PartRowView reads
    let search = expect_context::<Search>().0;
    let offset = expect_context::<Offset>().0;
    let sort = expect_context::<Sort>().0;
    let data_version = expect_context::<DataVersion>().0;
    let editor_mode = expect_context::<EditorModeState>().0;

    // Reset pagination when category, search, or sort changes.
    Effect::new(move |prev: Option<(Option<i32>, String, (String, bool))>| {
        let cur = (selected_category.get(), search.get(), sort.get());
        if let Some(p) = prev.as_ref() {
            if *p != cur {
                offset.set(0);
            }
        }
        cur
    });

    let parts = LocalResource::new(move || {
        let cat = selected_category.get();
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
        async move { api::fetch_parts(cat, s, PAGE_SIZE, off, sort_opt, dir_opt).await }
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
    // category; render a "Filtering by category: …" with a clear button.
    let tree_resource = LocalResource::new(api::fetch_category_tree);
    let active_category_path = move || -> Option<String> {
        let cat = selected_category.get()?;
        let r = tree_resource.get()?;
        match &*r {
            Ok(roots) => find_category_path(roots, cat),
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
        <div class="parts-grid">
            <Suspense fallback=|| view! { <p class="muted" style="padding:12px">"Loading…"</p> }>
                {move || parts.get().map(|res| match &*res {
                    Err(e) => view! { <p class="muted" style="padding:12px">{format!("Error: {}", e.0)}</p> }.into_any(),
                    Ok(r) => view! {
                        <GroupedParts items=r.items.clone() />
                    }.into_any(),
                })}
            </Suspense>
        </div>
    }
}

#[component]
fn GroupedParts(items: Vec<PartRow>) -> impl IntoView {
    let mut groups: Vec<(String, Vec<PartRow>)> = Vec::new();
    for item in items {
        let path = item.category_path.clone().unwrap_or_else(|| "(uncategorized)".into());
        match groups.last_mut() {
            Some((p, rs)) if *p == path => rs.push(item),
            _ => groups.push((path, vec![item])),
        }
    }

    view! {
        <For each={
            let g = groups.clone();
            move || g.clone()
        }
            key=|(path, _)| path.clone()
            let:group>
            <CategorySection path=group.0 items=group.1 />
        </For>
    }
}

#[component]
fn CategorySection(path: String, items: Vec<PartRow>) -> impl IntoView {
    let count = items.len();
    view! {
        <div class="section-header">
            {path}
            <span class="count">{format!("  ({count} part{})", if count == 1 { "" } else { "s" })}</span>
        </div>
        <table class="parts">
            <thead><tr>
                <SortableTh label="#" col="id" width="60px" />
                <SortableTh label="Name" col="name" width="" />
                <SortableTh label="Description" col="description" width="" />
                <SortableTh label="Stock" col="stock_level" width="60px" align_right=true />
                <SortableTh label="Min" col="min_stock_level" width="50px" align_right=true />
                <SortableTh label="Status" col="status" width="80px" />
                <SortableTh label="Condition" col="part_condition" width="80px" />
                <SortableTh label="Avg Price" col="average_price" width="80px" align_right=true />
            </tr></thead>
            <tbody>
                <For each={
                    let it = items.clone();
                    move || it.clone()
                } key=|p: &PartRow| p.id let:p>
                    <PartRowView p=p />
                </For>
            </tbody>
        </table>
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

#[component]
fn PartRowView(p: PartRow) -> impl IntoView {
    let selected_part = expect_context::<SelectedPart>().0;
    let id = p.id;
    let stock_class = if p.low_stock { "right low-stock" } else { "right" };

    view! {
        <tr class:selected=move || selected_part.get() == Some(id)
            on:click=move |_| selected_part.set(Some(id))>
            <td>{p.id}</td>
            <td>{p.name}</td>
            <td>{p.description.unwrap_or_default()}</td>
            <td class=stock_class>{p.stock_level}</td>
            <td class="right muted">{p.min_stock_level}</td>
            <td>{p.status.unwrap_or_default()}</td>
            <td>{p.part_condition.unwrap_or_default()}</td>
            <td class="right">{p.average_price}</td>
        </tr>
    }
}
