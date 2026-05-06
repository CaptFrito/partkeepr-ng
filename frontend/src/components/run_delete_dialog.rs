//! Slice 8b follow-up: delete a single project run.
//!
//! Runs are normally append-only; this is the admin escape hatch for
//! mistakes and test/staging cleanup. The dialog offers a checkbox to
//! restore the stock that the run originally deducted — when checked,
//! the backend inserts compensating positive `StockEntry` rows for each
//! line so the per-part stock log stays honest.

use leptos::prelude::*;
use wasm_bindgen_futures::spawn_local;

use crate::api;
use crate::{DataVersion, RunDeleteCtx, RunDeleteState};

#[component]
pub fn RunDeleteDialog() -> impl IntoView {
    let state = expect_context::<RunDeleteState>().0;
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
fn Body(ctx: RunDeleteCtx) -> impl IntoView {
    let state = expect_context::<RunDeleteState>().0;
    let data_version = expect_context::<DataVersion>().0;

    let project_id = ctx.project_id;
    let run_id = ctx.run_id;
    let when = ctx.when.clone();
    let run_qty = ctx.run_qty;
    let line_count = ctx.line_count;

    let restore_stock = RwSignal::new(false);
    let saving = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);

    let close = move || state.set(None);
    let close_btn = move |_: leptos::ev::MouseEvent| close();

    let on_delete = move |_: leptos::ev::MouseEvent| {
        let r = restore_stock.get();
        saving.set(true);
        error.set(None);
        spawn_local(async move {
            let res = api::delete_run(project_id, run_id, r).await;
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

    view! {
        <div class="modal-backdrop" on:click=close_btn>
            <div class="modal" on:click=|e| e.stop_propagation()>
                <div class="modal-head">
                    <h3>{format!("Delete run from {}?", when)}</h3>
                    <button class="modal-close" on:click=close_btn>"✕"</button>
                </div>
                <div class="modal-body">
                    <p>{format!(
                        "This run recorded × {} build{} across {} BOM line{}.",
                        run_qty, if run_qty == 1 { "" } else { "s" },
                        line_count, if line_count == 1 { "" } else { "s" },
                    )}</p>
                    <label class="run-delete-restore">
                        <input type="checkbox"
                            prop:checked={move || restore_stock.get()}
                            on:change=move |ev: leptos::ev::Event| {
                                use wasm_bindgen::JsCast;
                                let v = ev.target()
                                    .and_then(|t| t.dyn_into::<web_sys::HtmlInputElement>().ok())
                                    .map(|e| e.checked()).unwrap_or(false);
                                restore_stock.set(v);
                            }/>
                        " Also restore the stock this run deducted "
                        <span class="muted">"(creates compensating positive stock entries; "
                        "leave unchecked to delete the run only and preserve the stock log)"</span>
                    </label>
                    <p class="muted">
                        "Run history is normally append-only. Deleting a run is for fixing "
                        "mistakes or removing test runs — the original "
                        "stock entries are not retroactively edited."
                    </p>
                    <Show when=move || error.get().is_some()>
                        <div class="modal-error">
                            {move || error.get().unwrap_or_default()}
                        </div>
                    </Show>
                </div>
                <div class="modal-foot">
                    <button class="btn-secondary" on:click=close_btn>"Cancel"</button>
                    <button class="btn-danger"
                        prop:disabled=move || saving.get()
                        on:click=on_delete>{
                            move || if saving.get() { "Deleting…" } else { "Delete run" }
                        }</button>
                </div>
            </div>
        </div>
    }
}
