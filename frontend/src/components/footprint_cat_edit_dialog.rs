use leptos::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;
use web_sys::HtmlInputElement;

use crate::api;
use crate::{
    DataVersion, FootprintCatEditCtx, FootprintCatEditMode, FootprintCatEditState,
};

#[component]
pub fn FootprintCatEditDialog() -> impl IntoView {
    let dialog_state = expect_context::<FootprintCatEditState>().0;
    let data_version = expect_context::<DataVersion>().0;

    let name = RwSignal::new(String::new());
    let description = RwSignal::new(String::new());
    let submitting = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);
    let blocked = RwSignal::new(None::<api::FootprintCatDeleteConflict>);

    Effect::new(move |prev: Option<bool>| {
        let now_open = dialog_state.get().is_some();
        if now_open && prev != Some(true) {
            error.set(None);
            blocked.set(None);
            submitting.set(false);
            if let Some(ctx) = dialog_state.get() {
                match ctx.mode {
                    FootprintCatEditMode::CreateChild => {
                        name.set(String::new());
                        description.set(String::new());
                    }
                    FootprintCatEditMode::Rename => {
                        name.set(ctx.name.clone());
                        description.set(ctx.description.clone());
                    }
                    FootprintCatEditMode::Delete => {}
                }
            }
        }
        now_open
    });

    let close = move || dialog_state.set(None);
    let mode = move || dialog_state.get().map(|c| c.mode);
    let target_name = move || dialog_state.get().map(|c| c.name).unwrap_or_default();

    let title = move || match mode() {
        Some(FootprintCatEditMode::CreateChild) => "Add Footprint Folder",
        Some(FootprintCatEditMode::Rename) => "Rename Footprint Folder",
        Some(FootprintCatEditMode::Delete) => "Delete Footprint Folder",
        None => "",
    };

    let submit_create = move |ctx: FootprintCatEditCtx| {
        let body = api::FootprintCatCreate {
            parent_id: ctx.id,
            name: name.get().trim().to_string(),
            description: { let d = description.get(); if d.trim().is_empty() { None } else { Some(d) } },
        };
        if body.name.is_empty() { error.set(Some("Name is required.".into())); return; }
        submitting.set(true); error.set(None);
        spawn_local(async move {
            match api::post_footprint_cat(body).await {
                Ok(_) => { submitting.set(false); data_version.update(|v| *v += 1); dialog_state.set(None); }
                Err(e) => { submitting.set(false); error.set(Some(e.0)); }
            }
        });
    };

    let submit_rename = move |ctx: FootprintCatEditCtx| {
        let trimmed = name.get().trim().to_string();
        if trimmed.is_empty() { error.set(Some("Name is required.".into())); return; }
        let body = api::FootprintCatUpdate {
            name: trimmed,
            description: { let d = description.get(); if d.trim().is_empty() { None } else { Some(d) } },
        };
        submitting.set(true); error.set(None);
        let id = ctx.id;
        spawn_local(async move {
            match api::put_footprint_cat(id, body).await {
                Ok(()) => { submitting.set(false); data_version.update(|v| *v += 1); dialog_state.set(None); }
                Err(e) => { submitting.set(false); error.set(Some(e.0)); }
            }
        });
    };

    let submit_delete = move |ctx: FootprintCatEditCtx| {
        submitting.set(true); error.set(None); blocked.set(None);
        let id = ctx.id;
        spawn_local(async move {
            match api::delete_footprint_cat(id).await {
                Ok(()) => { submitting.set(false); data_version.update(|v| *v += 1); dialog_state.set(None); }
                Err(api::FootprintCatDeleteError::Conflict(c)) => { submitting.set(false); blocked.set(Some(c)); }
                Err(api::FootprintCatDeleteError::Other(msg)) => { submitting.set(false); error.set(Some(msg)); }
            }
        });
    };

    let submit = move || {
        let Some(ctx) = dialog_state.get() else { return; };
        match ctx.mode {
            FootprintCatEditMode::CreateChild => submit_create(ctx),
            FootprintCatEditMode::Rename => submit_rename(ctx),
            FootprintCatEditMode::Delete => submit_delete(ctx),
        }
    };

    view! {
        <Show when=move || dialog_state.get().is_some()>
            <div class="modal-backdrop" on:click=move |_| close()>
                <div class="modal" on:click=move |e: leptos::ev::MouseEvent| { e.stop_propagation(); }>
                    <div class="modal-head">
                        <h3>{title}</h3>
                        <button class="modal-close" on:click=move |_| close()>"✕"</button>
                    </div>
                    <div class="modal-body">
                        <Show when=move || matches!(mode(), Some(FootprintCatEditMode::CreateChild))>
                            <p class="modal-help">"Adding a subfolder under: "<strong>{target_name}</strong></p>
                            <NameDescFields name=name description=description/>
                        </Show>
                        <Show when=move || matches!(mode(), Some(FootprintCatEditMode::Rename))>
                            <p class="modal-help">
                                "Renaming this folder. The breadcrumb path will be
                                recomputed for it and all its descendants."
                            </p>
                            <NameDescFields name=name description=description/>
                        </Show>
                        <Show when=move || matches!(mode(), Some(FootprintCatEditMode::Delete))>
                            {move || {
                                let ctx = dialog_state.get()?;
                                let blocked_now = ctx.child_count > 0 || ctx.footprint_count > 0;
                                Some(view! {
                                    <p>{
                                        if blocked_now {
                                            format!("Cannot delete \"{}\".", ctx.name)
                                        } else {
                                            format!("This will permanently delete \"{}\".", ctx.name)
                                        }
                                    }</p>
                                    <Show when=move || blocked_now>
                                        <p>{format!(
                                            "Folder contains {} subfolder{} and {} footprint{}.",
                                            ctx.child_count,
                                            if ctx.child_count == 1 {""} else {"s"},
                                            ctx.footprint_count,
                                            if ctx.footprint_count == 1 {""} else {"s"})}</p>
                                        <p class="modal-help">
                                            "Move or delete the contents first, then delete the folder."
                                        </p>
                                    </Show>
                                    <Show when=move || !blocked_now>
                                        <p class="modal-help">"The folder is empty — safe to delete."</p>
                                    </Show>
                                })
                            }}
                            <Show when=move || blocked.get().is_some()>
                                {move || blocked.get().map(|c| view! {
                                    <p class="modal-error">{format!(
                                        "Server reports {} subfolder{} and {} footprint{} — counts may have changed since the page loaded.",
                                        c.child_count,
                                        if c.child_count == 1 {""} else {"s"},
                                        c.footprint_count,
                                        if c.footprint_count == 1 {""} else {"s"})}</p>
                                })}
                            </Show>
                        </Show>
                        <Show when=move || error.get().is_some()>
                            <div class="modal-error">{move || error.get().unwrap_or_default()}</div>
                        </Show>
                    </div>
                    <div class="modal-foot">
                        <button class="btn-secondary"
                            prop:disabled={move || submitting.get()}
                            on:click=move |_| close()>"Cancel"</button>
                        <Show when=move || matches!(mode(), Some(FootprintCatEditMode::Delete))>
                            <button class="btn-danger"
                                prop:disabled={move || {
                                    if submitting.get() { return true; }
                                    let Some(ctx) = dialog_state.get() else { return true; };
                                    ctx.child_count > 0 || ctx.footprint_count > 0
                                }}
                                on:click=move |_| submit()>{
                                    move || if submitting.get() { "Deleting…" } else { "Delete" }
                                }</button>
                        </Show>
                        <Show when=move || matches!(mode(), Some(FootprintCatEditMode::CreateChild))>
                            <button class="btn-success"
                                prop:disabled={move || submitting.get()}
                                on:click=move |_| submit()>{
                                    move || if submitting.get() { "Saving…" } else { "Add Folder" }
                                }</button>
                        </Show>
                        <Show when=move || matches!(mode(), Some(FootprintCatEditMode::Rename))>
                            <button class="btn-info"
                                prop:disabled={move || submitting.get()}
                                on:click=move |_| submit()>{
                                    move || if submitting.get() { "Saving…" } else { "Save" }
                                }</button>
                        </Show>
                    </div>
                </div>
            </div>
        </Show>
    }
}

#[component]
fn NameDescFields(
    name: RwSignal<String>,
    description: RwSignal<String>,
) -> impl IntoView {
    view! {
        <label class="form-row">
            <span>"Name"</span>
            <input type="text"
                prop:value={move || name.get()}
                on:input=move |ev: leptos::ev::Event| {
                    let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                        .map(|e| e.value()).unwrap_or_default();
                    name.set(v);
                }/>
        </label>
        <label class="form-row">
            <span>"Description"</span>
            <input type="text"
                prop:value={move || description.get()}
                on:input=move |ev: leptos::ev::Event| {
                    let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                        .map(|e| e.value()).unwrap_or_default();
                    description.set(v);
                }/>
        </label>
    }
}
