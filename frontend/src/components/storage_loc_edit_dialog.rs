use leptos::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;
use web_sys::HtmlInputElement;

use crate::api;
use crate::components::attachments_section::AttachmentsSelfLoader;
use crate::{
    DataVersion, StorageLocEditCtx, StorageLocEditMode, StorageLocEditState,
};

/// Storage-location (leaf) dialog. Three modes (Create / Rename /
/// Delete). Locations have only a name — no description.
#[component]
pub fn StorageLocEditDialog() -> impl IntoView {
    let dialog_state = expect_context::<StorageLocEditState>().0;
    let data_version = expect_context::<DataVersion>().0;

    let name = RwSignal::new(String::new());
    let submitting = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);
    let blocked = RwSignal::new(None::<api::StorageLocDeleteConflict>);

    Effect::new(move |prev: Option<bool>| {
        let now_open = dialog_state.get().is_some();
        if now_open && prev != Some(true) {
            error.set(None);
            blocked.set(None);
            submitting.set(false);
            if let Some(ctx) = dialog_state.get() {
                match ctx.mode {
                    StorageLocEditMode::Create => name.set(String::new()),
                    StorageLocEditMode::Rename => name.set(ctx.name.clone()),
                    StorageLocEditMode::Delete => {}
                }
            }
        }
        now_open
    });

    let close = move || dialog_state.set(None);
    let mode = move || dialog_state.get().map(|c| c.mode);
    let target_name = move || dialog_state.get().map(|c| c.name).unwrap_or_default();

    let title = move || match mode() {
        Some(StorageLocEditMode::Create) => "Add Storage Location",
        Some(StorageLocEditMode::Rename) => "Rename Storage Location",
        Some(StorageLocEditMode::Delete) => "Delete Storage Location",
        None => "",
    };

    let submit_create = move |ctx: StorageLocEditCtx| {
        let trimmed = name.get().trim().to_string();
        if trimmed.is_empty() {
            error.set(Some("Name is required.".into()));
            return;
        }
        let body = api::StorageLocCreate {
            category_id: ctx.id,
            name: trimmed,
        };
        submitting.set(true);
        error.set(None);
        spawn_local(async move {
            match api::post_storage_loc(body).await {
                Ok(_) => {
                    submitting.set(false);
                    data_version.update(|v| *v += 1);
                    dialog_state.set(None);
                }
                Err(e) => { submitting.set(false); error.set(Some(e.0)); }
            }
        });
    };

    let submit_rename = move |ctx: StorageLocEditCtx| {
        let trimmed = name.get().trim().to_string();
        if trimmed.is_empty() {
            error.set(Some("Name is required.".into()));
            return;
        }
        let body = api::StorageLocUpdate { name: trimmed };
        submitting.set(true);
        error.set(None);
        let id = ctx.id;
        spawn_local(async move {
            match api::put_storage_loc(id, body).await {
                Ok(()) => {
                    submitting.set(false);
                    data_version.update(|v| *v += 1);
                    dialog_state.set(None);
                }
                Err(e) => { submitting.set(false); error.set(Some(e.0)); }
            }
        });
    };

    let submit_delete = move |ctx: StorageLocEditCtx| {
        submitting.set(true);
        error.set(None);
        blocked.set(None);
        let id = ctx.id;
        spawn_local(async move {
            match api::delete_storage_loc(id).await {
                Ok(()) => {
                    submitting.set(false);
                    data_version.update(|v| *v += 1);
                    dialog_state.set(None);
                }
                Err(api::StorageLocDeleteError::Conflict(c)) => {
                    submitting.set(false);
                    blocked.set(Some(c));
                }
                Err(api::StorageLocDeleteError::Other(msg)) => {
                    submitting.set(false);
                    error.set(Some(msg));
                }
            }
        });
    };

    let submit = move || {
        let Some(ctx) = dialog_state.get() else { return; };
        match ctx.mode {
            StorageLocEditMode::Create => submit_create(ctx),
            StorageLocEditMode::Rename => submit_rename(ctx),
            StorageLocEditMode::Delete => submit_delete(ctx),
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
                        <Show when=move || matches!(mode(), Some(StorageLocEditMode::Create))>
                            <p class="modal-help">
                                "Adding a storage location inside: "<strong>{target_name}</strong>
                            </p>
                            <LocNameField name=name/>
                        </Show>
                        <Show when=move || matches!(mode(), Some(StorageLocEditMode::Rename))>
                            <LocNameField name=name/>
                            {move || dialog_state.get().map(|ctx| {
                                let id = ctx.id;
                                view! {
                                    <AttachmentsSelfLoader
                                        kind="StorageLocationImage"
                                        list_path=format!("/api/storage_locations/{id}/images")
                                        upload_path=format!("/api/storage_locations/{id}/images")/>
                                }
                            })}
                        </Show>
                        <Show when=move || matches!(mode(), Some(StorageLocEditMode::Delete))>
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
                                        <p>{format!("This location is referenced by {} part{}.",
                                            ctx.part_count,
                                            if ctx.part_count == 1 {""} else {"s"})}</p>
                                        <p class="modal-help">
                                            "Reassign or remove those parts first."
                                        </p>
                                    </Show>
                                    <Show when=move || !blocked_now>
                                        <p class="modal-help">
                                            "No parts reference this location — safe to delete."
                                        </p>
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
                        <Show when=move || matches!(mode(), Some(StorageLocEditMode::Delete)) && blocked.get().is_some()>
                            <button class="btn-secondary" on:click=move |_| close()>"OK"</button>
                        </Show>
                        <Show when=move || !(matches!(mode(), Some(StorageLocEditMode::Delete)) && blocked.get().is_some())>
                            <button class="btn-secondary"
                                prop:disabled={move || submitting.get()}
                                on:click=move |_| close()>"Cancel"</button>
                            <Show when=move || matches!(mode(), Some(StorageLocEditMode::Delete))>
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
                            <Show when=move || matches!(mode(), Some(StorageLocEditMode::Create))>
                                <button class="btn-success"
                                    prop:disabled={move || submitting.get()}
                                    on:click=move |_| submit()>{
                                        move || if submitting.get() { "Saving…" } else { "Add Location" }
                                    }</button>
                            </Show>
                            <Show when=move || matches!(mode(), Some(StorageLocEditMode::Rename))>
                                <button class="btn-info"
                                    prop:disabled={move || submitting.get()}
                                    on:click=move |_| submit()>{
                                        move || if submitting.get() { "Saving…" } else { "Save" }
                                    }</button>
                            </Show>
                        </Show>
                    </div>
                </div>
            </div>
        </Show>
    }
}

#[component]
fn LocNameField(name: RwSignal<String>) -> impl IntoView {
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
    }
}
