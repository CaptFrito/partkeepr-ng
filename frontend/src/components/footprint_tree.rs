//! Footprints tree (slice 5c-3). Mirrors StorageTree but with
//! FootprintCategory folders + Footprint leaves.

use leptos::prelude::*;

use crate::api;
use crate::types::{FootprintLite, FootprintTreeNode};
use crate::{
    DataVersion, FootprintCatEditCtx, FootprintCatEditMode, FootprintCatEditState,
    FootprintLeafEditCtx, FootprintLeafEditMode, FootprintLeafEditState, FootprintMoveCtx,
    FootprintMoveState, FootprintSelection, SelectedFootprint, TreeExpanded,
};

/// Levels expanded by default. Same convention as the other trees.
const DEFAULT_EXPAND_THROUGH_LVL: i32 = 1;

#[component]
pub fn FootprintTree() -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let tree_resource = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_footprint_tree()
    });

    let selected_footprint = expect_context::<SelectedFootprint>().0;

    view! {
        <Suspense fallback=|| view! { <p class="muted">"Loading footprints…"</p> }>
            {move || tree_resource.get().map(|res| match &*res {
                Ok(roots) => view! {
                    <div>
                        <div class="tree-node"
                            class:selected=move || selected_footprint.get() == FootprintSelection::None
                            on:click=move |_| selected_footprint.set(FootprintSelection::None)>
                            <span class="chev"></span>
                            <span class="tree-label">"(all footprints)"</span>
                        </div>
                        <For each={
                            let rs = roots.clone();
                            move || rs.clone()
                        }
                             key=|n: &FootprintTreeNode| n.id
                             let:node>
                            <FolderNode node=node/>
                        </For>
                    </div>
                }.into_any(),
                Err(e) => view! {
                    <p class="muted">{format!("Error loading footprints: {}", e.0)}</p>
                }.into_any(),
            })}
        </Suspense>
    }
}

#[component]
fn FolderNode(node: FootprintTreeNode) -> AnyView {
    let cat_edit = expect_context::<FootprintCatEditState>().0;
    let leaf_edit = expect_context::<FootprintLeafEditState>().0;
    let move_state = expect_context::<FootprintMoveState>().0;
    let tree_expanded = expect_context::<TreeExpanded>().0;
    let selected_footprint = expect_context::<SelectedFootprint>().0;

    let id = node.id;
    let name = node.name.clone();
    let lvl = node.lvl;
    let children = node.children.clone();
    let footprints = node.footprints.clone();
    let has_visible_kids = !children.is_empty() || !footprints.is_empty();
    let is_root = lvl == 0;
    let default_open = lvl <= DEFAULT_EXPAND_THROUGH_LVL;
    let child_count = children.len() as i64;
    let footprint_count = footprints.len() as i64;

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
        if !has_visible_kids { return ""; }
        if is_expanded() { "▾" } else { "▸" }
    };

    let is_selected = move || selected_footprint.get() == FootprintSelection::Folder(id);

    let on_add_sub = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            cat_edit.set(Some(FootprintCatEditCtx {
                mode: FootprintCatEditMode::CreateChild,
                id, name: n.clone(), description: String::new(),
                child_count: 0, footprint_count: 0,
            }));
        }
    };
    let on_add_fp = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            leaf_edit.set(Some(FootprintLeafEditCtx {
                mode: FootprintLeafEditMode::Create,
                id, name: n.clone(), description: String::new(), part_count: 0,
            }));
        }
    };
    let on_rename = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            cat_edit.set(Some(FootprintCatEditCtx {
                mode: FootprintCatEditMode::Rename,
                id, name: n.clone(), description: String::new(),
                child_count: 0, footprint_count: 0,
            }));
        }
    };
    let on_move = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            move_state.set(Some(FootprintMoveCtx::MoveCat { id, name: n.clone() }));
        }
    };
    let on_delete = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            cat_edit.set(Some(FootprintCatEditCtx {
                mode: FootprintCatEditMode::Delete,
                id, name: n.clone(), description: String::new(),
                child_count, footprint_count,
            }));
        }
    };

    view! {
        <div>
            <div class="tree-node tree-node-folder"
                class:selected=is_selected
                on:click=move |_| selected_footprint.set(FootprintSelection::Folder(id))>
                <span class="chev"
                    on:click={move |e: leptos::ev::MouseEvent| {
                        e.stop_propagation();
                        if has_visible_kids { toggle_expand(); }
                    }}>{chev}</span>
                <span class="tree-label">{name}</span>
                <span class="tree-actions">
                    {folder_actions(is_root, on_add_sub, on_add_fp, on_rename, on_move, on_delete)}
                </span>
            </div>
            <Show when={move || has_visible_kids}>
                <div class="tree-children"
                    style:display={move || if is_expanded() { "block" } else { "none" }}>
                    <For each={
                        let cs = children.clone();
                        move || cs.clone()
                    }
                         key=|n: &FootprintTreeNode| n.id
                         let:child>
                        <FolderNode node=child/>
                    </For>
                    <For each={
                        let fs = footprints.clone();
                        move || fs.clone()
                    }
                         key=|f: &FootprintLite| f.id
                         let:fp>
                        <FootprintNode fp=fp/>
                    </For>
                </div>
            </Show>
        </div>
    }
    .into_any()
}

#[component]
fn FootprintNode(fp: FootprintLite) -> AnyView {
    let leaf_edit = expect_context::<FootprintLeafEditState>().0;
    let move_state = expect_context::<FootprintMoveState>().0;
    let selected_footprint = expect_context::<SelectedFootprint>().0;

    let id = fp.id;
    let name = fp.name.clone();
    let description = fp.description.clone().unwrap_or_default();
    let part_count = fp.part_count;

    let is_selected = move || selected_footprint.get() == FootprintSelection::Footprint(id);

    let on_rename = {
        let n = name.clone();
        let d = description.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            leaf_edit.set(Some(FootprintLeafEditCtx {
                mode: FootprintLeafEditMode::Rename,
                id, name: n.clone(), description: d.clone(), part_count: 0,
            }));
        }
    };
    let on_move = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            move_state.set(Some(FootprintMoveCtx::MoveFootprint { id, name: n.clone() }));
        }
    };
    let on_delete = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            leaf_edit.set(Some(FootprintLeafEditCtx {
                mode: FootprintLeafEditMode::Delete,
                id, name: n.clone(), description: String::new(), part_count,
            }));
        }
    };

    view! {
        <div class="tree-node tree-node-leaf"
            class:selected=is_selected
            on:click=move |_| selected_footprint.set(FootprintSelection::Footprint(id))>
            <span class="chev"></span>
            <span class="tree-label">{name}</span>
            <span class="tree-actions">
                <button class="tree-act tree-act-edit"
                    title="Rename / edit description" on:click=on_rename>"✎"</button>
                <button class="tree-act tree-act-move"
                    title="Move to…" on:click=on_move>"⇄"</button>
                <button class="tree-act tree-act-del"
                    title="Delete" on:click=on_delete>"🗑"</button>
            </span>
        </div>
    }
    .into_any()
}

fn folder_actions(
    is_root: bool,
    on_add_sub: impl FnMut(leptos::ev::MouseEvent) + 'static,
    on_add_fp: impl FnMut(leptos::ev::MouseEvent) + 'static,
    on_rename: impl FnMut(leptos::ev::MouseEvent) + 'static,
    on_move: impl FnMut(leptos::ev::MouseEvent) + 'static,
    on_delete: impl FnMut(leptos::ev::MouseEvent) + 'static,
) -> AnyView {
    if is_root {
        view! {
            <>
                <button class="tree-act tree-act-add"
                    title="Add subfolder" on:click=on_add_sub>"+"</button>
                <button class="tree-act tree-act-add"
                    title="Add footprint" on:click=on_add_fp>"⊕"</button>
            </>
        }.into_any()
    } else {
        view! {
            <>
                <button class="tree-act tree-act-add"
                    title="Add subfolder" on:click=on_add_sub>"+"</button>
                <button class="tree-act tree-act-add"
                    title="Add footprint" on:click=on_add_fp>"⊕"</button>
                <button class="tree-act tree-act-edit"
                    title="Rename" on:click=on_rename>"✎"</button>
                <button class="tree-act tree-act-move"
                    title="Move to…" on:click=on_move>"⇄"</button>
                <button class="tree-act tree-act-del"
                    title="Delete" on:click=on_delete>"🗑"</button>
            </>
        }.into_any()
    }
}
