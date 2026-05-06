use leptos::prelude::*;
use wasm_bindgen_futures::spawn_local;
use web_sys::HtmlInputElement;

use crate::api;
use crate::{
    CategoryEditCtx, CategoryEditMode, CategoryEditState, DataVersion, SelectedCategory,
};

/// Combined create-child / rename / delete dialog for PartCategory. The
/// three modes share one modal surface because they all operate on a
/// single category and produce a single mutation each.
#[component]
pub fn CategoryEditDialog() -> impl IntoView {
    let dialog_state = expect_context::<CategoryEditState>().0;
    let data_version = expect_context::<DataVersion>().0;
    let selected_category = expect_context::<SelectedCategory>().0;

    // Form state.
    let name = RwSignal::new(String::new());
    let description = RwSignal::new(String::new());
    let submitting = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);
    // Delete-blocked state. Some(...) when a 409 came back; the modal
    // switches to a "cannot delete" view with counts.
    let blocked = RwSignal::new(None::<api::DeleteConflict>);

    // (Re-)initialize fields whenever the dialog opens.
    Effect::new(move |prev: Option<bool>| {
        let now_open = dialog_state.get().is_some();
        if now_open && prev != Some(true) {
            error.set(None);
            blocked.set(None);
            submitting.set(false);
            if let Some(ctx) = dialog_state.get() {
                match ctx.mode {
                    CategoryEditMode::CreateChild => {
                        name.set(String::new());
                        description.set(String::new());
                    }
                    CategoryEditMode::Rename => {
                        name.set(ctx.name.clone());
                        description.set(ctx.description.clone());
                    }
                    CategoryEditMode::Delete => {
                        // delete view doesn't use name/description fields
                    }
                }
            }
        }
        now_open
    });

    let close = move || dialog_state.set(None);

    let mode = move || dialog_state.get().map(|c| c.mode);
    let target_name = move || dialog_state.get().map(|c| c.name).unwrap_or_default();

    let title = move || match mode() {
        Some(CategoryEditMode::CreateChild) => "Add Subcategory",
        Some(CategoryEditMode::Rename) => "Rename Category",
        Some(CategoryEditMode::Delete) => "Delete Category",
        None => "",
    };

    let submit_create = move |ctx: CategoryEditCtx| {
        let body = api::CategoryCreate {
            parent_id: ctx.id,
            name: name.get().trim().to_string(),
            description: {
                let d = description.get();
                if d.trim().is_empty() { None } else { Some(d) }
            },
        };
        if body.name.is_empty() {
            error.set(Some("Name is required.".into()));
            return;
        }
        submitting.set(true);
        error.set(None);
        spawn_local(async move {
            match api::post_category(body).await {
                Ok(_) => {
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

    let submit_rename = move |ctx: CategoryEditCtx| {
        let trimmed = name.get().trim().to_string();
        if trimmed.is_empty() {
            error.set(Some("Name is required.".into()));
            return;
        }
        let body = api::CategoryUpdate {
            name: trimmed,
            description: {
                let d = description.get();
                if d.trim().is_empty() { None } else { Some(d) }
            },
        };
        submitting.set(true);
        error.set(None);
        let id = ctx.id;
        spawn_local(async move {
            match api::put_category(id, body).await {
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

    let submit_delete = move |ctx: CategoryEditCtx| {
        submitting.set(true);
        error.set(None);
        blocked.set(None);
        let id = ctx.id;
        spawn_local(async move {
            match api::delete_category(id).await {
                Ok(()) => {
                    submitting.set(false);
                    data_version.update(|v| *v += 1);
                    // If the user was filtering by the deleted category,
                    // clear the filter so the grid shows something useful.
                    if selected_category.get() == Some(id) {
                        selected_category.set(None);
                    }
                    dialog_state.set(None);
                }
                Err(api::CategoryDeleteError::Conflict(c)) => {
                    submitting.set(false);
                    blocked.set(Some(c));
                }
                Err(api::CategoryDeleteError::Other(msg)) => {
                    submitting.set(false);
                    error.set(Some(msg));
                }
            }
        });
    };

    let submit = move || {
        let Some(ctx) = dialog_state.get() else { return; };
        match ctx.mode {
            CategoryEditMode::CreateChild => submit_create(ctx),
            CategoryEditMode::Rename => submit_rename(ctx),
            CategoryEditMode::Delete => submit_delete(ctx),
        }
    };

    // "Show affected parts" — set the global category filter to the
    // blocked id and close the dialog. The parts grid is already
    // category-aware (filters to that node + descendants).
    let show_parts = move || {
        if let Some(ctx) = dialog_state.get() {
            selected_category.set(Some(ctx.id));
            dialog_state.set(None);
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
                        <Show when=move || matches!(mode(), Some(CategoryEditMode::CreateChild))>
                            <p class="modal-help">
                                "Adding a subcategory under: "<strong>{target_name}</strong>
                            </p>
                            <NameDescFields name=name description=description/>
                        </Show>
                        <Show when=move || matches!(mode(), Some(CategoryEditMode::Rename))>
                            <p class="modal-help">
                                "Renaming category. The breadcrumb path will be recomputed for
                                this category and all its descendants."
                            </p>
                            <NameDescFields name=name description=description/>
                        </Show>
                        <Show when=move || matches!(mode(), Some(CategoryEditMode::Delete))>
                            {move || {
                                let ctx = dialog_state.get()?;
                                let blocked_now = ctx.child_count > 0 || ctx.part_count > 0;
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
                                            "Contains {} subcategor{} and {} part{} directly under it.",
                                            ctx.child_count,
                                            if ctx.child_count == 1 { "y" } else { "ies" },
                                            ctx.part_count,
                                            if ctx.part_count == 1 { "" } else { "s" })}</p>
                                        <p class="modal-help">
                                            "Re-home or delete the contents first, then delete the category."
                                        </p>
                                    </Show>
                                    <Show when=move || !blocked_now>
                                        <p class="modal-help">
                                            "The category is empty — safe to delete."
                                        </p>
                                    </Show>
                                })
                            }}
                            // Defense-in-depth: backend's 409 response. Counts may
                            // be stale between fetch and click, so still surface
                            // a server-side block if it fires.
                            <Show when=move || blocked.get().is_some()>
                                {move || blocked.get().map(|c| view! {
                                    <p class="modal-error">{format!(
                                        "Server reports {} subcategor{} and {} part{} — counts may have changed since the page loaded.",
                                        c.child_count,
                                        if c.child_count == 1 { "y" } else { "ies" },
                                        c.part_count,
                                        if c.part_count == 1 { "" } else { "s" })}</p>
                                })}
                            </Show>
                        </Show>
                        <Show when=move || error.get().is_some()>
                            <div class="modal-error">{move || error.get().unwrap_or_default()}</div>
                        </Show>
                    </div>
                    <div class="modal-foot">
                        // Blocked-delete branch swaps the buttons.
                        <Show when=move || matches!(mode(), Some(CategoryEditMode::Delete)) && blocked.get().is_some()>
                            <button class="btn-secondary" on:click=move |_| close()>"OK"</button>
                            <Show when=move || blocked.get().is_some_and(|c| c.part_count > 0)>
                                <button class="btn-info" on:click=move |_| show_parts()>
                                    "Show affected parts"
                                </button>
                            </Show>
                        </Show>
                        // Normal create/rename/delete-confirm buttons.
                        <Show when=move || !(matches!(mode(), Some(CategoryEditMode::Delete)) && blocked.get().is_some())>
                            <button class="btn-secondary"
                                prop:disabled={move || submitting.get()}
                                on:click=move |_| close()>"Cancel"</button>
                            <Show when=move || matches!(mode(), Some(CategoryEditMode::Delete))>
                                <button class="btn-danger"
                                    prop:disabled={move || {
                                        if submitting.get() { return true; }
                                        let Some(ctx) = dialog_state.get() else { return true; };
                                        ctx.child_count > 0 || ctx.part_count > 0
                                    }}
                                    on:click=move |_| submit()>{
                                        move || if submitting.get() { "Deleting…" } else { "Delete" }
                                    }</button>
                            </Show>
                            <Show when=move || matches!(mode(), Some(CategoryEditMode::CreateChild))>
                                <button class="btn-success"
                                    prop:disabled={move || submitting.get()}
                                    on:click=move |_| submit()>{
                                        move || if submitting.get() { "Saving…" } else { "Add Subcategory" }
                                    }</button>
                            </Show>
                            <Show when=move || matches!(mode(), Some(CategoryEditMode::Rename))>
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
fn NameDescFields(
    name: RwSignal<String>,
    description: RwSignal<String>,
) -> impl IntoView {
    use wasm_bindgen::JsCast;
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
