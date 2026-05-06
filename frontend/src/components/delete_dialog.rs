use leptos::prelude::*;
use wasm_bindgen_futures::spawn_local;

use crate::api;
use crate::{DataVersion, DeletePartState, SelectedPart};

/// Confirm-and-delete dialog for parts. Triggered by setting
/// `DeletePartState` from the detail toolbar's Delete button.
#[component]
pub fn DeleteConfirmDialog() -> impl IntoView {
    let dialog_state = expect_context::<DeletePartState>().0;
    let data_version = expect_context::<DataVersion>().0;
    let selected_part = expect_context::<SelectedPart>().0;

    let submitting = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);

    let close = move || dialog_state.set(None);

    // Reset error on (re-)open.
    Effect::new(move |prev: Option<bool>| {
        let now_open = dialog_state.get().is_some();
        if now_open && prev != Some(true) {
            error.set(None);
            submitting.set(false);
        }
        now_open
    });

    let submit = move || {
        let Some(ctx) = dialog_state.get() else { return; };
        submitting.set(true);
        error.set(None);
        let part_id = ctx.part_id;
        spawn_local(async move {
            match api::delete_part(part_id).await {
                Ok(()) => {
                    submitting.set(false);
                    selected_part.set(None);
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

    let part_name = move || dialog_state.get().map(|c| c.part_name).unwrap_or_default();

    view! {
        <Show when=move || dialog_state.get().is_some()>
            <div class="modal-backdrop" on:click=move |_| close()>
                <div class="modal" on:click=move |e: leptos::ev::MouseEvent| { e.stop_propagation(); }>
                    <div class="modal-head">
                        <h3>"Delete Part"</h3>
                        <button class="modal-close" on:click=move |_| close()>"✕"</button>
                    </div>
                    <div class="modal-body">
                        <p>"This will permanently delete "<strong>{part_name}</strong>
                            ", along with its manufacturers, distributors, parameters,
                            attachments, and stock history."</p>
                        <p class="modal-help">
                            "Project / report references aren't auto-cleaned — if this
                            part is used by any project or report, the delete will fail
                            with a 400 and you'll need to remove those references first."
                        </p>
                        <Show when={move || error.get().is_some()}>
                            <div class="modal-error">{move || error.get().unwrap_or_default()}</div>
                        </Show>
                    </div>
                    <div class="modal-foot">
                        <button class="btn-secondary"
                            prop:disabled={move || submitting.get()}
                            on:click=move |_| close()>"Cancel"</button>
                        <button class="btn-danger"
                            prop:disabled={move || submitting.get()}
                            on:click=move |_| submit()>{
                                move || if submitting.get() { "Deleting…" } else { "Delete" }
                            }</button>
                    </div>
                </div>
            </div>
        </Show>
    }
}
