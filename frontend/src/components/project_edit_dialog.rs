//! Slice 8a: project create / rename / delete dialog.
//!
//! Three modes share the same modal surface:
//! - **Create**: empty name + description; Save creates and selects the
//!   new project.
//! - **Rename**: prefilled with current values; Save updates.
//! - **Delete**: shows part/run counts; Delete is disabled when runs > 0
//!   (server enforces; we mirror upfront for clarity).

use leptos::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;
use web_sys::HtmlInputElement;

use crate::api::{self, ProjectDeleteError};
use crate::{
    DataVersion, ProjectEditCtx, ProjectEditMode, ProjectEditState, SelectedProject,
};

#[component]
pub fn ProjectEditDialog() -> impl IntoView {
    let state = expect_context::<ProjectEditState>().0;

    view! {
        <Show when=move || state.get().is_some()>
            {move || {
                let ctx = match state.get() { Some(c) => c, None => return ().into_any() };
                view! { <Body ctx=ctx/> }.into_any()
            }}
        </Show>
    }
}

#[component]
fn Body(ctx: ProjectEditCtx) -> impl IntoView {
    let state = expect_context::<ProjectEditState>().0;
    let selected = expect_context::<SelectedProject>().0;
    let data_version = expect_context::<DataVersion>().0;

    let mode = ctx.mode;
    let id = ctx.id;
    let initial_name = ctx.name.clone();
    let initial_desc = ctx.description.clone();
    let parts_count = ctx.parts_count;
    let runs_count = ctx.runs_count;

    let name = RwSignal::new(initial_name);
    let description = RwSignal::new(initial_desc);
    let saving = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);

    let close = move || state.set(None);
    let close_btn = move |_: leptos::ev::MouseEvent| close();

    let title = match mode {
        ProjectEditMode::Create => "New Project".to_string(),
        ProjectEditMode::Rename => format!("Edit \"{}\"", ctx.name),
        ProjectEditMode::Delete => format!("Delete \"{}\"?", ctx.name),
    };

    let on_save = move |_: leptos::ev::MouseEvent| {
        let n = name.get().trim().to_string();
        if n.is_empty() {
            error.set(Some("Name is required.".into()));
            return;
        }
        let d = description.get();
        let d_opt = if d.trim().is_empty() { None } else { Some(d) };
        saving.set(true);
        error.set(None);
        spawn_local(async move {
            let body = api::ProjectWrite { name: n, description: d_opt };
            let res = match mode {
                ProjectEditMode::Create => match api::post_project(body).await {
                    Ok(new_id) => {
                        selected.set(Some(new_id));
                        Ok(())
                    }
                    Err(e) => Err(e),
                },
                ProjectEditMode::Rename => api::put_project(id, body).await,
                ProjectEditMode::Delete => unreachable!("delete uses on_delete"),
            };
            saving.set(false);
            match res {
                Ok(()) => {
                    data_version.update(|v| *v += 1);
                    state.set(None);
                }
                Err(e) => error.set(Some(e.0)),
            }
        });
    };

    let on_delete = move |_: leptos::ev::MouseEvent| {
        saving.set(true);
        error.set(None);
        spawn_local(async move {
            let res = api::delete_project(id).await;
            saving.set(false);
            match res {
                Ok(()) => {
                    data_version.update(|v| *v += 1);
                    if selected.get() == Some(id) {
                        selected.set(None);
                    }
                    state.set(None);
                }
                Err(ProjectDeleteError::HasRuns(n)) => error.set(Some(format!(
                    "Cannot delete: project has {n} run{} of history.",
                    if n == 1 { "" } else { "s" },
                ))),
                Err(ProjectDeleteError::Other(e)) => error.set(Some(e.0)),
            }
        });
    };

    // Body branches by mode.
    let is_delete = matches!(mode, ProjectEditMode::Delete);
    let delete_blocked = runs_count > 0;

    view! {
        <div class="modal-backdrop" on:click=close_btn>
            <div class="modal" on:click=|e| e.stop_propagation()>
                <div class="modal-head">
                    <h3>{title}</h3>
                    <button class="modal-close" on:click=close_btn>"✕"</button>
                </div>
                <div class="modal-body">
                    <Show when=move || !is_delete>
                        <div class="form-row">
                            <label>"Name"</label>
                            <input type="text" autofocus="true"
                                prop:value={move || name.get()}
                                on:input=move |ev: leptos::ev::Event| {
                                    let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                                        .map(|e| e.value()).unwrap_or_default();
                                    name.set(v);
                                }/>
                        </div>
                        <div class="form-row">
                            <label>"Description"</label>
                            <input type="text"
                                prop:value={move || description.get()}
                                on:input=move |ev: leptos::ev::Event| {
                                    let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                                        .map(|e| e.value()).unwrap_or_default();
                                    description.set(v);
                                }/>
                        </div>
                    </Show>
                    <Show when=move || is_delete>
                        <p>{format!(
                            "This project has {} BOM line{} and {} run{} of history.",
                            parts_count, if parts_count == 1 { "" } else { "s" },
                            runs_count, if runs_count == 1 { "" } else { "s" },
                        )}</p>
                        <Show when=move || delete_blocked>
                            <p class="modal-error">
                                "Run history blocks deletion. Delete is append-only by design — \
                                 if you really need to remove this project, delete its runs \
                                 first (no UI for that yet)."
                            </p>
                        </Show>
                        <Show when=move || { !delete_blocked && parts_count > 0 }>
                            <p class="muted">
                                "BOM lines will be removed along with the project. Attachments \
                                 (if any) are dropped from the database; their files become \
                                 disk orphans (cleanup is out-of-band)."
                            </p>
                        </Show>
                    </Show>
                    <Show when=move || error.get().is_some()>
                        <div class="modal-error">
                            {move || error.get().unwrap_or_default()}
                        </div>
                    </Show>
                </div>
                <div class="modal-foot">
                    <button class="btn-secondary" on:click=close_btn>"Cancel"</button>
                    <Show when=move || !is_delete>
                        <button class="btn-success"
                            prop:disabled=move || saving.get()
                            on:click=on_save>{
                                move || if saving.get() { "Saving…" } else { "Save" }
                            }</button>
                    </Show>
                    <Show when=move || is_delete>
                        <button class="btn-danger"
                            prop:disabled=move || saving.get() || delete_blocked
                            on:click=on_delete>{
                                move || if saving.get() { "Deleting…" } else { "Delete" }
                            }</button>
                    </Show>
                </div>
            </div>
        </div>
    }
}
