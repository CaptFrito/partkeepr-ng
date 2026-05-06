//! Storage Locations tree (slice 5c-2). Mirrors CategoryTree but renders
//! folders + their leaf storage locations in one unified tree.

use leptos::prelude::*;

use crate::api;
use crate::types::{StorageLocationLite, StorageTreeNode};
use crate::{
    DataVersion, SelectedStorage, StorageCatEditCtx, StorageCatEditMode,
    StorageCatEditState, StorageLocEditCtx, StorageLocEditMode, StorageLocEditState,
    StorageMoveCtx, StorageMoveState, StorageSelection, TreeExpanded,
};

/// Levels expanded by default. Same convention as CategoryTree:
/// Root + immediate children open; deeper folders collapsed.
const DEFAULT_EXPAND_THROUGH_LVL: i32 = 1;

/// Negative offset prevents id collisions between StorageLocationCategory
/// and StorageLocation when storing expand state in the shared
/// TreeExpanded map. We share the map with CategoryTree because the per-
/// id keying is cheap and there's no observable downside; only matters
/// that storage-cat ids and storage-loc ids don't accidentally collide
/// here. Using `-id` for locations gives us safe segregation.
fn loc_key(id: i32) -> i32 { -id }

#[component]
pub fn StorageTree() -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let tree_resource = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_storage_tree()
    });

    let selected_storage = expect_context::<SelectedStorage>().0;

    view! {
        <Suspense fallback=|| view! { <p class="muted">"Loading storage…"</p> }>
            {move || tree_resource.get().map(|res| match &*res {
                Ok(roots) => view! {
                    <div>
                        <div class="tree-node"
                            class:selected=move || selected_storage.get() == StorageSelection::None
                            on:click=move |_| selected_storage.set(StorageSelection::None)>
                            <span class="chev"></span>
                            <span class="tree-label">"(all storage)"</span>
                        </div>
                        <For each={
                            let rs = roots.clone();
                            move || rs.clone()
                        }
                             key=|n: &StorageTreeNode| n.id
                             let:node>
                            <FolderNode node=node/>
                        </For>
                    </div>
                }.into_any(),
                Err(e) => view! {
                    <p class="muted">{format!("Error loading storage: {}", e.0)}</p>
                }.into_any(),
            })}
        </Suspense>
    }
}

#[component]
fn FolderNode(node: StorageTreeNode) -> AnyView {
    let cat_edit = expect_context::<StorageCatEditState>().0;
    let loc_edit = expect_context::<StorageLocEditState>().0;
    let move_state = expect_context::<StorageMoveState>().0;
    let tree_expanded = expect_context::<TreeExpanded>().0;

    let id = node.id;
    let name = node.name.clone();
    let lvl = node.lvl;
    let children = node.children.clone();
    let locations = node.locations.clone();
    let has_visible_kids = !children.is_empty() || !locations.is_empty();
    let is_root = lvl == 0;
    // Counts shown in the delete dialog and used to gate the Delete button.
    let child_count = children.len() as i64;
    let location_count = locations.len() as i64;
    let default_open = lvl <= DEFAULT_EXPAND_THROUGH_LVL;

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

    // Hover actions on a folder node:
    //   + sub  : add subcategory  (CreateChild)
    //   + loc  : add storage location  (loc Create)
    //   ✎      : rename folder
    //   ⇄      : move folder (root excluded)
    //   🗑     : delete folder (root excluded)
    let on_add_sub = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            cat_edit.set(Some(StorageCatEditCtx {
                mode: StorageCatEditMode::CreateChild,
                id, name: n.clone(), description: String::new(),
                child_count: 0, location_count: 0,
            }));
        }
    };
    let on_add_loc = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            loc_edit.set(Some(StorageLocEditCtx {
                mode: StorageLocEditMode::Create,
                id, name: n.clone(), part_count: 0,
            }));
        }
    };
    let on_rename = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            cat_edit.set(Some(StorageCatEditCtx {
                mode: StorageCatEditMode::Rename,
                id, name: n.clone(), description: String::new(),
                child_count: 0, location_count: 0,
            }));
        }
    };
    let on_move = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            move_state.set(Some(StorageMoveCtx::MoveCat { id, name: n.clone() }));
        }
    };
    let on_delete = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            cat_edit.set(Some(StorageCatEditCtx {
                mode: StorageCatEditMode::Delete,
                id, name: n.clone(), description: String::new(),
                child_count, location_count,
            }));
        }
    };

    let selected_storage = expect_context::<SelectedStorage>().0;
    let is_selected = move || selected_storage.get() == StorageSelection::Folder(id);

    view! {
        <div>
            <div class="tree-node tree-node-folder"
                class:selected=is_selected
                on:click=move |_| selected_storage.set(StorageSelection::Folder(id))>
                <span class="chev"
                    on:click={move |e: leptos::ev::MouseEvent| {
                        e.stop_propagation();
                        if has_visible_kids { toggle_expand(); }
                    }}>{chev}</span>
                <span class="tree-label">{name}</span>
                <span class="tree-actions">
                    {folder_actions(is_root, on_add_sub, on_add_loc, on_rename, on_move, on_delete)}
                </span>
            </div>
            <Show when={move || has_visible_kids}>
                <div class="tree-children"
                    style:display={move || if is_expanded() { "block" } else { "none" }}>
                    // Folders first
                    <For each={
                        let cs = children.clone();
                        move || cs.clone()
                    }
                         key=|n: &StorageTreeNode| n.id
                         let:child>
                        <FolderNode node=child/>
                    </For>
                    // Then leaf locations
                    <For each={
                        let ls = locations.clone();
                        move || ls.clone()
                    }
                         key=|l: &StorageLocationLite| l.id
                         let:loc>
                        <LocationNode loc=loc/>
                    </For>
                </div>
            </Show>
        </div>
    }
    .into_any()
}

#[component]
fn LocationNode(loc: StorageLocationLite) -> AnyView {
    let loc_edit = expect_context::<StorageLocEditState>().0;
    let move_state = expect_context::<StorageMoveState>().0;
    let _ = loc_key(loc.id); // reserved for future use

    let id = loc.id;
    let name = loc.name.clone();
    let part_count = loc.part_count;

    let on_rename = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            loc_edit.set(Some(StorageLocEditCtx {
                mode: StorageLocEditMode::Rename,
                id, name: n.clone(), part_count: 0,
            }));
        }
    };
    let on_move = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            move_state.set(Some(StorageMoveCtx::MoveLoc { id, name: n.clone() }));
        }
    };
    let on_delete = {
        let n = name.clone();
        move |e: leptos::ev::MouseEvent| {
            e.stop_propagation();
            loc_edit.set(Some(StorageLocEditCtx {
                mode: StorageLocEditMode::Delete,
                id, name: n.clone(), part_count,
            }));
        }
    };

    let selected_storage = expect_context::<SelectedStorage>().0;
    let is_selected = move || selected_storage.get() == StorageSelection::Location(id);

    view! {
        <div class="tree-node tree-node-leaf"
            class:selected=is_selected
            on:click=move |_| selected_storage.set(StorageSelection::Location(id))>
            <span class="chev"></span>
            <span class="tree-label">{name}</span>
            <span class="tree-actions">
                <button class="tree-act tree-act-edit"
                    title="Rename" on:click=on_rename>"✎"</button>
                <button class="tree-act tree-act-move"
                    title="Move to…" on:click=on_move>"⇄"</button>
                <button class="tree-act tree-act-del"
                    title="Delete" on:click=on_delete>"🗑"</button>
            </span>
        </div>
    }
    .into_any()
}

/// Per-folder action buttons. Constructed at view-build time so the
/// non-Copy on_X closures don't have to satisfy `Fn`.
fn folder_actions(
    is_root: bool,
    on_add_sub: impl FnMut(leptos::ev::MouseEvent) + 'static,
    on_add_loc: impl FnMut(leptos::ev::MouseEvent) + 'static,
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
                    title="Add storage location" on:click=on_add_loc>"⊕"</button>
            </>
        }.into_any()
    } else {
        view! {
            <>
                <button class="tree-act tree-act-add"
                    title="Add subfolder" on:click=on_add_sub>"+"</button>
                <button class="tree-act tree-act-add"
                    title="Add storage location" on:click=on_add_loc>"⊕"</button>
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
