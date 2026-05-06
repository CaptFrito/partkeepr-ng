use leptos::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;
use web_sys::HtmlInputElement;

use crate::api;
use crate::components::attachments_section::AttachmentsSelfLoader;
use crate::{
    DataVersion, FootprintLeafEditCtx, FootprintLeafEditMode, FootprintLeafEditState,
};

/// Footprint (leaf) dialog. Three modes (Create / Rename / Delete).
/// Footprints carry both name AND description (unlike StorageLocation
/// which had only name), so the form has two fields.
#[component]
pub fn FootprintLeafEditDialog() -> impl IntoView {
    let dialog_state = expect_context::<FootprintLeafEditState>().0;
    let data_version = expect_context::<DataVersion>().0;

    let name = RwSignal::new(String::new());
    let description = RwSignal::new(String::new());
    let submitting = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);
    let blocked = RwSignal::new(None::<api::FootprintDeleteConflict>);

    Effect::new(move |prev: Option<bool>| {
        let now_open = dialog_state.get().is_some();
        if now_open && prev != Some(true) {
            error.set(None);
            blocked.set(None);
            submitting.set(false);
            if let Some(ctx) = dialog_state.get() {
                match ctx.mode {
                    FootprintLeafEditMode::Create => {
                        name.set(String::new());
                        description.set(String::new());
                    }
                    FootprintLeafEditMode::Rename => {
                        name.set(ctx.name.clone());
                        description.set(ctx.description.clone());
                    }
                    FootprintLeafEditMode::Delete => {}
                }
            }
        }
        now_open
    });

    let close = move || dialog_state.set(None);
    let mode = move || dialog_state.get().map(|c| c.mode);
    let target_name = move || dialog_state.get().map(|c| c.name).unwrap_or_default();

    let title = move || match mode() {
        Some(FootprintLeafEditMode::Create) => "Add Footprint",
        Some(FootprintLeafEditMode::Rename) => "Edit Footprint",
        Some(FootprintLeafEditMode::Delete) => "Delete Footprint",
        None => "",
    };

    let submit_create = move |ctx: FootprintLeafEditCtx| {
        let trimmed = name.get().trim().to_string();
        if trimmed.is_empty() { error.set(Some("Name is required.".into())); return; }
        let body = api::FootprintCreate {
            category_id: ctx.id,
            name: trimmed,
            description: { let d = description.get(); if d.trim().is_empty() { None } else { Some(d) } },
        };
        submitting.set(true); error.set(None);
        spawn_local(async move {
            match api::post_footprint(body).await {
                Ok(_) => { submitting.set(false); data_version.update(|v| *v += 1); dialog_state.set(None); }
                Err(e) => { submitting.set(false); error.set(Some(e.0)); }
            }
        });
    };

    let submit_rename = move |ctx: FootprintLeafEditCtx| {
        let trimmed = name.get().trim().to_string();
        if trimmed.is_empty() { error.set(Some("Name is required.".into())); return; }
        let body = api::FootprintUpdate {
            name: trimmed,
            description: { let d = description.get(); if d.trim().is_empty() { None } else { Some(d) } },
        };
        submitting.set(true); error.set(None);
        let id = ctx.id;
        spawn_local(async move {
            match api::put_footprint(id, body).await {
                Ok(()) => { submitting.set(false); data_version.update(|v| *v += 1); dialog_state.set(None); }
                Err(e) => { submitting.set(false); error.set(Some(e.0)); }
            }
        });
    };

    let submit_delete = move |ctx: FootprintLeafEditCtx| {
        submitting.set(true); error.set(None); blocked.set(None);
        let id = ctx.id;
        spawn_local(async move {
            match api::delete_footprint(id).await {
                Ok(()) => { submitting.set(false); data_version.update(|v| *v += 1); dialog_state.set(None); }
                Err(api::FootprintDeleteError::Conflict(c)) => { submitting.set(false); blocked.set(Some(c)); }
                Err(api::FootprintDeleteError::Other(msg)) => { submitting.set(false); error.set(Some(msg)); }
            }
        });
    };

    let submit = move || {
        let Some(ctx) = dialog_state.get() else { return; };
        match ctx.mode {
            FootprintLeafEditMode::Create => submit_create(ctx),
            FootprintLeafEditMode::Rename => submit_rename(ctx),
            FootprintLeafEditMode::Delete => submit_delete(ctx),
        }
    };

    view! {
        <Show when=move || dialog_state.get().is_some()>
            <div class="modal-backdrop" on:click=move |_| close()>
                <div class="modal modal-tall" on:click=move |e: leptos::ev::MouseEvent| { e.stop_propagation(); }>
                    <div class="modal-head">
                        <h3>{title}</h3>
                        <button class="modal-close" on:click=move |_| close()>"✕"</button>
                    </div>
                    <div class="modal-body">
                        <Show when=move || matches!(mode(), Some(FootprintLeafEditMode::Create))>
                            <p class="modal-help">"Adding a footprint inside: "<strong>{target_name}</strong></p>
                            <NameDescFields name=name description=description/>
                        </Show>
                        <Show when=move || matches!(mode(), Some(FootprintLeafEditMode::Rename))>
                            <NameDescFields name=name description=description/>
                            {move || dialog_state.get().map(|ctx| {
                                let id = ctx.id;
                                view! {
                                    <h4 class="modal-subhead">"Images"</h4>
                                    <AttachmentsSelfLoader
                                        kind="FootprintImage"
                                        list_path=format!("/api/footprints/{id}/images")
                                        upload_path=format!("/api/footprints/{id}/images")/>
                                    <h4 class="modal-subhead">"Attachments"</h4>
                                    <AttachmentsSelfLoader
                                        kind="FootprintAttachment"
                                        list_path=format!("/api/footprints/{id}/attachments")
                                        upload_path=format!("/api/footprints/{id}/attachments")/>
                                }
                            })}
                        </Show>
                        <Show when=move || matches!(mode(), Some(FootprintLeafEditMode::Delete))>
                            {move || {
                                let ctx = dialog_state.get()?;
                                let blocked_now = ctx.part_count > 0;
                                Some(view! {
                                    <p>{
                                        if blocked_now {
                                            format!("Cannot delete \"{}\".", ctx.name)
                                        } else {
                                            format!("This will permanently delete \"{}\".", ctx.name)
                                        }
                                    }</p>
                                    <Show when=move || blocked_now>
                                        <p>{format!("This footprint is referenced by {} part{}.",
                                            ctx.part_count,
                                            if ctx.part_count == 1 {""} else {"s"})}</p>
                                        <p class="modal-help">"Reassign or remove those parts first."</p>
                                    </Show>
                                    <Show when=move || !blocked_now>
                                        <p class="modal-help">"No parts reference this footprint — safe to delete."</p>
                                    </Show>
                                })
                            }}
                            <Show when=move || blocked.get().is_some()>
                                {move || blocked.get().map(|c| view! {
                                    <p class="modal-error">{format!(
                                        "Server reports {} part{} — counts may have changed since the page loaded.",
                                        c.part_count,
                                        if c.part_count == 1 {""} else {"s"})}</p>
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
                        <Show when=move || matches!(mode(), Some(FootprintLeafEditMode::Delete))>
                            <button class="btn-danger"
                                prop:disabled={move || {
                                    if submitting.get() { return true; }
                                    let Some(ctx) = dialog_state.get() else { return true; };
                                    ctx.part_count > 0
                                }}
                                on:click=move |_| submit()>{
                                    move || if submitting.get() { "Deleting…" } else { "Delete" }
                                }</button>
                        </Show>
                        <Show when=move || matches!(mode(), Some(FootprintLeafEditMode::Create))>
                            <button class="btn-success"
                                prop:disabled={move || submitting.get()}
                                on:click=move |_| submit()>{
                                    move || if submitting.get() { "Saving…" } else { "Add Footprint" }
                                }</button>
                        </Show>
                        <Show when=move || matches!(mode(), Some(FootprintLeafEditMode::Rename))>
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
