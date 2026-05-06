use leptos::prelude::*;
use wasm_bindgen_futures::spawn_local;

use crate::api;
use crate::{DataVersion, StockDialogCtx, StockDialogMode, StockDialogState};

/// Three-mode stock-entry dialog: Add, Remove, Reconcile.
///
/// - **Add**: enter qty + price (defaults to current avg so saving without
///   editing preserves the avg cost basis). Posts a positive delta.
/// - **Remove**: enter qty. No price field — removes don't carry a per-piece
///   cost in this app's model. Posts a negative delta.
/// - **Reconcile**: shows current stock; user enters new on-hand total.
///   Frontend computes the delta and posts it with `correction=true`.
///   Backend treats correction entries as quantity-only (avg price unchanged).
#[component]
pub fn StockDialog() -> impl IntoView {
    let dialog_state = expect_context::<StockDialogState>().0;
    let data_version = expect_context::<DataVersion>().0;

    // Form state — common across modes; not all fields are used by all modes.
    let qty = RwSignal::new(String::new());
    let price = RwSignal::new(String::new());
    let comment = RwSignal::new(String::new());
    let submitting = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);

    // When the dialog opens (state goes None→Some), seed the form per mode.
    Effect::new(move |prev: Option<Option<StockDialogCtx>>| {
        let cur = dialog_state.get();
        let was_open = prev.flatten().is_some();
        let now_open = cur.is_some();
        if now_open && !was_open {
            if let Some(ctx) = cur.as_ref() {
                match ctx.mode {
                    StockDialogMode::Add => {
                        qty.set("1".into());
                        price.set(ctx.avg_price.clone());
                    }
                    StockDialogMode::Remove => {
                        qty.set("1".into());
                        price.set(String::new());
                    }
                    StockDialogMode::Reconcile => {
                        // For reconcile, qty = the new on-hand total.
                        qty.set(ctx.current_stock.to_string());
                        price.set(String::new());
                    }
                }
                comment.set(String::new());
                error.set(None);
            }
        }
        cur
    });

    let close = move || dialog_state.set(None);

    let submit = move || {
        let Some(ctx) = dialog_state.get() else { return; };
        let qty_input: i32 = match qty.get().trim().parse::<i32>() {
            Ok(n) => n,
            Err(_) => {
                error.set(Some("Quantity must be a whole number".into()));
                return;
            }
        };

        // Compute the actual delta and the correction flag based on mode.
        let (delta, correction, price_value) = match ctx.mode {
            StockDialogMode::Add => {
                if qty_input <= 0 {
                    error.set(Some("Quantity must be positive".into()));
                    return;
                }
                let p = price.get().trim().to_string();
                let p = if p.is_empty() { None } else { Some(p) };
                (qty_input, false, p)
            }
            StockDialogMode::Remove => {
                if qty_input <= 0 {
                    error.set(Some("Quantity must be positive".into()));
                    return;
                }
                if qty_input > ctx.current_stock {
                    error.set(Some(format!(
                        "Cannot remove more than current stock ({})", ctx.current_stock
                    )));
                    return;
                }
                (-qty_input, false, None)
            }
            StockDialogMode::Reconcile => {
                if qty_input < 0 {
                    error.set(Some("On-hand total can't be negative".into()));
                    return;
                }
                let delta = qty_input - ctx.current_stock;
                if delta == 0 {
                    error.set(Some("New total matches current stock — nothing to record".into()));
                    return;
                }
                (delta, true, None)
            }
        };

        let comment_value: Option<String> = {
            let s = comment.get().trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        };
        let body = api::StockChange {
            stock_level: delta,
            price: price_value,
            comment: comment_value,
            correction,
        };
        let part_id = ctx.part_id;
        submitting.set(true);
        error.set(None);
        spawn_local(async move {
            match api::post_stock_entry(part_id, body).await {
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

    let title = move || match dialog_state.get().map(|c| c.mode) {
        Some(StockDialogMode::Add) => "Add Stock",
        Some(StockDialogMode::Remove) => "Remove Stock",
        Some(StockDialogMode::Reconcile) => "Reconcile Stock (Recount)",
        None => "",
    };
    let mode = move || dialog_state.get().map(|c| c.mode);
    let unit_short = move || dialog_state.get().map(|c| c.unit_short).unwrap_or_default();
    let current_stock = move || dialog_state.get().map(|c| c.current_stock).unwrap_or(0);
    let avg_price_display = move || dialog_state.get().map(|c| c.avg_price).unwrap_or_default();

    view! {
        <Show when=move || dialog_state.get().is_some()>
            <div class="modal-backdrop" on:click=move |_| close()>
                <div class="modal" on:click=move |e: leptos::ev::MouseEvent| { e.stop_propagation(); }>
                    <div class="modal-head">
                        <h3>{title}</h3>
                        <button class="modal-close" on:click=move |_| close()>"✕"</button>
                    </div>
                    <div class="modal-body">
                        <div class="modal-context">
                            <span>"Current stock: "<strong>{current_stock} " " {unit_short.clone()}</strong></span>
                            <span>"Avg price: "<strong>{avg_price_display}</strong></span>
                        </div>

                        <Show when={move || mode() == Some(StockDialogMode::Add)}>
                            <p class="modal-help">
                                "Add new pieces of this part. The price defaults to the
                                current avg cost — leave it as-is to preserve the avg, or
                                edit it to record a different cost."
                            </p>
                        </Show>
                        <Show when={move || mode() == Some(StockDialogMode::Remove)}>
                            <p class="modal-help">
                                "Remove pieces (consumed by a project, scrapped, etc).
                                Doesn't carry a price — avg cost basis stays the same."
                            </p>
                        </Show>
                        <Show when={move || mode() == Some(StockDialogMode::Reconcile)}>
                            <p class="modal-help">
                                "Use this for a recount — enter the actual on-hand total.
                                The avg cost stays the same; only the quantity changes."
                            </p>
                        </Show>

                        <label class="field">
                            <span>{move || match mode() {
                                Some(StockDialogMode::Reconcile) => "On-hand total",
                                _ => "Quantity",
                            }}</span>
                            <input type="number" min="0" step="1"
                                prop:value={move || qty.get()}
                                on:input={move |ev| qty.set(event_target_value(&ev))} />
                        </label>

                        <Show when={move || mode() == Some(StockDialogMode::Add)}>
                            <label class="field">
                                <span>"Price (per piece)"</span>
                                <input type="text" placeholder="0.00"
                                    prop:value={move || price.get()}
                                    on:input={move |ev| price.set(event_target_value(&ev))} />
                            </label>
                        </Show>

                        <label class="field">
                            <span>"Comment (optional)"</span>
                            <input type="text"
                                prop:value={move || comment.get()}
                                on:input={move |ev| comment.set(event_target_value(&ev))} />
                        </label>

                        <Show when={move || error.get().is_some()}>
                            <div class="modal-error">{move || error.get().unwrap_or_default()}</div>
                        </Show>
                    </div>
                    <div class="modal-foot">
                        <button class="btn-secondary"
                            prop:disabled={move || submitting.get()}
                            on:click=move |_| close()>"Cancel"</button>
                        <button class="btn-primary"
                            prop:disabled={move || submitting.get()}
                            on:click=move |_| submit()>{
                                move || if submitting.get() { "Saving…" } else { "Save" }
                            }</button>
                    </div>
                </div>
            </div>
        </Show>
    }
}
