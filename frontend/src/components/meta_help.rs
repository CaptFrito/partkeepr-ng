use leptos::prelude::*;

use crate::MetaPartHelpState;

/// "What is a meta-part?" help modal. Triggered from the New Meta-Part
/// editor's Explain button. Read-only single-action dismiss.
#[component]
pub fn MetaPartHelpDialog() -> impl IntoView {
    let open = expect_context::<MetaPartHelpState>().0;
    let close = move || open.set(false);

    view! {
        <Show when=move || open.get()>
            <div class="modal-backdrop" on:click=move |_| close()>
                <div class="modal modal-help-wide"
                    on:click=move |e: leptos::ev::MouseEvent| { e.stop_propagation(); }>
                    <div class="modal-head">
                        <h3>"Meta-parts: virtual parts defined by criteria"</h3>
                        <button class="modal-close" on:click=move |_| close()>"✕"</button>
                    </div>
                    <div class="modal-body modal-help-body">
                        <p>
                            "A "<strong>"meta-part"</strong>" is a virtual part — an entry that
                            represents "<em>"any real part matching a set of parameter
                            criteria"</em>", not a specific physical SKU. It's a way to
                            decouple your design intent from a particular vendor's part
                            number."
                        </p>

                        <h4>"What it's for"</h4>
                        <p>"Suppose your circuit calls for a 1 kΩ ±5% 0603 resistor. You don't
                            care if it's the Yageo, Vishay, or Panasonic version — any in-stock
                            part meeting those specs works. Instead of pinning the BOM to one
                            vendor part, you reference a meta-part:"</p>
                        <p class="muted modal-help-examples">
                            "Meta-part "<code>"R-1k-0603-5%"</code>" matches: footprint = 0603,
                            R = 1k ±0%, Tolerance ≤ 5%."
                        </p>
                        <p>"At BOM-build time the system finds the real parts that satisfy
                            those criteria, and you can pick any of them — based on stock,
                            price, or whatever else."</p>

                        <h4>"How it works in PartKeepr"</h4>
                        <p>"A meta-part is a normal Part row with the "<code>"meta_part"</code>
                            " flag set, plus a list of "<code>"MetaPartParameterCriteria"</code>
                            " rows. Each criterion compares a parameter against a value:"</p>
                        <ul>
                            <li><code>"R = 1000 Ω"</code></li>
                            <li><code>"Tolerance < 5 %"</code></li>
                            <li><code>"Tmax ≥ 85 °C"</code></li>
                        </ul>
                        <p>"Numeric criteria use the normalized value (so "<code>"1k Ω"</code>
                            " matches "<code>"0.001 MΩ"</code>" too). String criteria use exact
                            or substring match."</p>

                        <h4>"What's available now (slice 5b-4)"</h4>
                        <p>"You can create a meta-part via "<strong>"+ Meta-Part"</strong>" —
                            it sets the flag and saves like any other part. The "<strong>
                            "criteria editor"</strong>" UI hasn't been built yet, so for now a
                            meta-part is mostly an empty placeholder. Editing the criteria will
                            land alongside the parametric filter (slice 11) since both reuse the
                            same predicate machinery."</p>
                        <p class="muted">"Until then: create a meta-part if you want to reserve
                            the name and basic fields. Filling in its criteria will need a
                            future slice."</p>
                    </div>
                    <div class="modal-foot">
                        <button class="btn-primary" on:click=move |_| close()>"Got it"</button>
                    </div>
                </div>
            </div>
        </Show>
    }
}
