use leptos::prelude::*;

use crate::api;
use crate::types::CategoryNode;
use crate::{
    CategoryEditCtx, CategoryEditMode, CategoryEditState, CategoryMoveCtx, CategoryMoveState,
    DataVersion, SelectedCategory, TreeExpanded,
};

/// Levels expanded by default. lvl 0 = Root; lvl 1 = top-level categories.
/// Anything deeper stays collapsed until the user clicks its chevron.
const DEFAULT_EXPAND_THROUGH_LVL: i32 = 1;

/// Top-level category tree. Refetches whenever DataVersion bumps so
/// CRUD operations reflect immediately. Hover-revealed action buttons on
/// each node drive the create/rename/move/delete dialogs.
#[component]
pub fn CategoryTree() -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let tree_resource = LocalResource::new(move || {
        // Tracked dependency — rerun on every bump.
        let _ = data_version.get();
        api::fetch_category_tree()
    });

    let selected = expect_context::<SelectedCategory>().0;

    view! {
        <Suspense fallback=|| view! { <p class="muted">"Loading categories…"</p> }>
            {move || {
                tree_resource.get().map(|res| match &*res {
                    Ok(roots) => view! {
                        <div>
                            <div class="tree-node"
                                class:selected=move || selected.get().is_none()
                                on:click=move |_| selected.set(None)>
                                <span class="chev"></span>
                                <span class="tree-label">"(all categories)"</span>
                            </div>
                            <For each={
                                let roots = roots.clone();
                                move || roots.clone()
                            }
                                 key=|n: &CategoryNode| n.id
                                 let:node>
                                <TreeNodeView node=node />
                            </For>
                        </div>
                    }.into_any(),
                    Err(e) => view! {
                        <p class="muted">{format!("Error loading tree: {}", e.0)}</p>
                    }.into_any(),
                })
            }}
        </Suspense>
    }
}

#[component]
fn TreeNodeView(node: CategoryNode) -> AnyView {
    let selected = expect_context::<SelectedCategory>().0;
    let edit_state = expect_context::<CategoryEditState>().0;
    let move_state = expect_context::<CategoryMoveState>().0;
    let tree_expanded = expect_context::<TreeExpanded>().0;

    let id = node.id;
    let name = node.name.clone();
    let lvl = node.lvl;
    let part_count = node.part_count;
    let children = node.children.clone();
    let has_children = !children.is_empty();
    let child_count = children.len() as i64;
    // Root = lvl 0, parent_id NULL. We use lvl since we don't get
    // parent_id back in the tree response. Root has no edit / move /
    // delete — only "+ add child".
    let is_root = lvl == 0;
    let default_open = lvl <= DEFAULT_EXPAND_THROUGH_LVL;

    // Expand state lives in a context-level HashMap so it survives the
    // tree resource refetch that fires after every category mutation.
    // Absence = use default; Some(bool) = explicit user choice.
    let is_expanded = move || {
        tree_expanded.with(|m| m.get(&id).copied().unwrap_or(default_open))
    };
    let toggle_expand = move || {
        tree_expanded.update(|m| {
            let cur = m.get(&id).copied().unwrap_or(default_open);
            m.insert(id, !cur);
        });
    };

    let chev = move || {
        if !has_children { return "" }
        if is_expanded() { "▾" } else { "▸" }
    };

    // Each handler owns a clone of `name` and re-clones inside, so the
    // closure is `Fn` (callable repeatedly) rather than `FnOnce`. Leptos's
    // <Show> wants `Fn` for its children fragment.
    let on_add = {
        let name = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            edit_state.set(Some(CategoryEditCtx {
                mode: CategoryEditMode::CreateChild,
                id,
                name: name.clone(),
                description: String::new(),
                part_count: 0,
                child_count: 0,
            }));
        }
    };
    let on_rename = {
        let name = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            edit_state.set(Some(CategoryEditCtx {
                mode: CategoryEditMode::Rename,
                id,
                name: name.clone(),
                // Description isn't carried in the tree response. Dialog
                // opens with empty description; user types if they want
                // to set it. (Fetching the row's existing description
                // would require another GET endpoint we haven't needed
                // yet — defer until someone complains.)
                description: String::new(),
                part_count: 0,
                child_count: 0,
            }));
        }
    };
    let on_delete = {
        let name = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            edit_state.set(Some(CategoryEditCtx {
                mode: CategoryEditMode::Delete,
                id,
                name: name.clone(),
                description: String::new(),
                part_count,
                child_count,
            }));
        }
    };
    let on_move = {
        let name = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            move_state.set(Some(CategoryMoveCtx {
                id,
                name: name.clone(),
            }));
        }
    };

    view! {
        <div>
            <div class="tree-node"
                class:selected={move || selected.get() == Some(id)}
                on:click={move |_| selected.set(Some(id))}>
                <span class="chev"
                    on:click={move |e: leptos::ev::MouseEvent| {
                        e.stop_propagation();
                        if has_children { toggle_expand(); }
                    }}>{chev}</span>
                <span class="tree-label">{name}</span>
                <span class="tree-actions">
                    {actions_for_node(is_root, on_add, on_rename, on_move, on_delete)}
                </span>
            </div>
            <Show when={move || has_children}>
                <div class="tree-children"
                    style:display={move || if is_expanded() { "block" } else { "none" }}>
                    <For each={
                        let cs = children.clone();
                        move || cs.clone()
                    }
                         key=|n: &CategoryNode| n.id
                         let:child>
                        <TreeNodeView node=child />
                    </For>
                </div>
            </Show>
        </div>
    }
    .into_any()
}

/// Build the per-node action buttons. Root gets only "+ add child";
/// every other node gets the full set. Doing this at view-construction
/// time (rather than via `<Show>`) means each on_X closure is consumed
/// exactly once and we don't need them to be `Fn`.
fn actions_for_node(
    is_root: bool,
    on_add: impl FnMut(leptos::ev::MouseEvent) + 'static,
    on_rename: impl FnMut(leptos::ev::MouseEvent) + 'static,
    on_move: impl FnMut(leptos::ev::MouseEvent) + 'static,
    on_delete: impl FnMut(leptos::ev::MouseEvent) + 'static,
) -> AnyView {
    if is_root {
        view! {
            <button class="tree-act tree-act-add"
                title="Add subcategory"
                on:click=on_add>"+"</button>
        }.into_any()
    } else {
        view! {
            <>
                <button class="tree-act tree-act-add"
                    title="Add subcategory"
                    on:click=on_add>"+"</button>
                <button class="tree-act tree-act-edit"
                    title="Rename"
                    on:click=on_rename>"✎"</button>
                <button class="tree-act tree-act-move"
                    title="Move to…"
                    on:click=on_move>"⇄"</button>
                <button class="tree-act tree-act-del"
                    title="Delete"
                    on:click=on_delete>"🗑"</button>
            </>
        }.into_any()
    }
}
