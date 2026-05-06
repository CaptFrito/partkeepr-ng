use leptos::prelude::*;

use crate::api;
use crate::types::CategoryNode;
use crate::SelectedCategory;

/// Top-level category tree. Fetches once and renders recursively.
/// Uses context to get/set the selected category id.
#[component]
pub fn CategoryTree() -> impl IntoView {
    let tree_resource = LocalResource::new(api::fetch_category_tree);

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
                                "(all categories)"
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
    let id = node.id;
    let name = node.name.clone();
    let lvl = node.lvl;
    let children = node.children.clone();
    let has_children = !children.is_empty();

    // Per-node expanded state. Default: only the top-level (lvl 0) is open;
    // deeper levels stay collapsed until clicked. Persisting which nodes
    // are open across page reloads is a future polish (slice 5+).
    let expanded = RwSignal::new(lvl == 0);

    let chev = move || {
        if !has_children { return "" }
        if expanded.get() { "▾" } else { "▸" }
    };

    view! {
        <div>
            <div class="tree-node"
                class:selected={move || selected.get() == Some(id)}
                on:click={move |_| selected.set(Some(id))}>
                <span class="chev"
                    on:click={move |e: leptos::ev::MouseEvent| {
                        // Don't bubble to the row click (which would select
                        // the category); this click only toggles expand.
                        e.stop_propagation();
                        if has_children { expanded.update(|v| *v = !*v); }
                    }}>{chev}</span>
                {name}
            </div>
            <Show when={move || has_children}>
                <div class="tree-children"
                    style:display={move || if expanded.get() { "block" } else { "none" }}>
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
