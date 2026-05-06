use leptos::prelude::*;
use wasm_bindgen_futures::spawn_local;

use crate::api;
use crate::{DataVersion, FootprintMoveCtx, FootprintMoveState};

/// Combined move-to picker for footprint entities (folder OR leaf
/// footprint). Mirror of StorageMoveDialog.
#[component]
pub fn FootprintMoveDialog() -> impl IntoView {
    let dialog_state = expect_context::<FootprintMoveState>().0;
    let data_version = expect_context::<DataVersion>().0;

    let categories =
        LocalResource::new(|| async { api::fetch_footprint_cats_flat_full().await });
    let chosen_parent = RwSignal::new(None::<i32>);
    let submitting = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);

    Effect::new(move |prev: Option<bool>| {
        let now_open = dialog_state.get().is_some();
        if now_open && prev != Some(true) {
            chosen_parent.set(None);
            error.set(None);
            submitting.set(false);
            categories.refetch();
        }
        now_open
    });

    let close = move || dialog_state.set(None);

    let submit = move || {
        let Some(ctx) = dialog_state.get() else { return; };
        let Some(parent) = chosen_parent.get() else {
            error.set(Some("Pick a destination folder.".into()));
            return;
        };
        submitting.set(true);
        error.set(None);
        spawn_local(async move {
            let res = match ctx {
                FootprintMoveCtx::MoveCat { id, .. } => api::move_footprint_cat(id, parent).await,
                FootprintMoveCtx::MoveFootprint { id, .. } => api::move_footprint(id, parent).await,
            };
            match res {
                Ok(()) => {
                    submitting.set(false);
                    data_version.update(|v| *v += 1);
                    dialog_state.set(None);
                }
                Err(e) => {
                    submitting.set(false);
                    error.set(Some(e.0));
                }
            }
        });
    };

    let title = move || dialog_state.get().map(|c| match c {
        FootprintMoveCtx::MoveCat { name, .. } => format!("Move folder \"{name}\"…"),
        FootprintMoveCtx::MoveFootprint { name, .. } => format!("Move footprint \"{name}\"…"),
    }).unwrap_or_default();

    view! {
        <Show when=move || dialog_state.get().is_some()>
            <div class="modal-backdrop" on:click=move |_| close()>
                <div class="modal modal-tall" on:click=move |e: leptos::ev::MouseEvent| { e.stop_propagation(); }>
                    <div class="modal-head">
                        <h3>{title}</h3>
                        <button class="modal-close" on:click=move |_| close()>"✕"</button>
                    </div>
                    <div class="modal-body">
                        <p class="modal-help">
                            "Pick the destination folder. For folder moves, the moved
                            folder and its descendants are hidden — you can't move a
                            folder into its own subtree."
                        </p>
                        <Suspense fallback=|| view! { <p class="muted">"Loading…"</p> }>
                            {move || {
                                let ctx = dialog_state.get();
                                categories.get().map(|res| match (&*res, ctx) {
                                    (Ok(rows), Some(FootprintMoveCtx::MoveCat { id, .. })) => {
                                        let bounds = rows.iter().find(|r| r.id == id).map(|r| (r.lft, r.rgt));
                                        match bounds {
                                            Some((lft, rgt)) => {
                                                let valid: Vec<_> = rows.iter()
                                                    .filter(|r| !(r.lft >= lft && r.rgt <= rgt))
                                                    .cloned().collect();
                                                view! { <PickerTree rows=valid chosen=chosen_parent/> }.into_any()
                                            }
                                            None => view! {
                                                <p class="modal-error">"Source folder not found in fetched list."</p>
                                            }.into_any(),
                                        }
                                    }
                                    (Ok(rows), Some(FootprintMoveCtx::MoveFootprint { .. })) => {
                                        view! { <PickerTree rows=rows.clone() chosen=chosen_parent/> }.into_any()
                                    }
                                    (Err(e), _) => view! {
                                        <p class="modal-error">{format!("Error: {}", e.0)}</p>
                                    }.into_any(),
                                    _ => view! { <p/> }.into_any(),
                                })
                            }}
                        </Suspense>
                        <Show when=move || error.get().is_some()>
                            <div class="modal-error">{move || error.get().unwrap_or_default()}</div>
                        </Show>
                    </div>
                    <div class="modal-foot">
                        <button class="btn-secondary"
                            prop:disabled={move || submitting.get()}
                            on:click=move |_| close()>"Cancel"</button>
                        <button class="btn-info"
                            prop:disabled={move || submitting.get() || chosen_parent.get().is_none()}
                            on:click=move |_| submit()>{
                                move || if submitting.get() { "Moving…" } else { "Move" }
                            }</button>
                    </div>
                </div>
            </div>
        </Show>
    }
}

#[component]
fn PickerTree(
    rows: Vec<api::CategoryFlatOption>,
    chosen: RwSignal<Option<i32>>,
) -> impl IntoView {
    let min_lvl = rows.iter().map(|r| r.lvl).min().unwrap_or(0);
    let row_count = rows.len();

    view! {
        <div class="category-picker">
            <For each={
                let rs = rows.clone();
                move || rs.clone()
            }
                 key=|r: &api::CategoryFlatOption| r.id
                 let:r>
                <PickerRow row=r min_lvl=min_lvl chosen=chosen/>
            </For>
            <Show when=move || row_count == 0>
                <p class="muted">"No legal targets."</p>
            </Show>
        </div>
    }
}

#[component]
fn PickerRow(
    row: api::CategoryFlatOption,
    min_lvl: i32,
    chosen: RwSignal<Option<i32>>,
) -> impl IntoView {
    let id = row.id;
    let name = row.name.clone();
    let depth = (row.lvl - min_lvl).max(0);
    let indent_px = depth * 16;
    view! {
        <div class="picker-row"
            class:selected={move || chosen.get() == Some(id)}
            style:padding-left={format!("{indent_px}px")}
            on:click=move |_| chosen.set(Some(id))>
            {name}
        </div>
    }
}
