use leptos::prelude::*;

use crate::ParamTypeHelpState;

/// "Numeric vs string parameters — what's the difference?" help modal.
/// Triggered from the parameter editor's type dropdown when the user
/// picks "Explain…". Read-only; single "Got it" button to close.
#[component]
pub fn ParamTypeHelpDialog() -> impl IntoView {
    let open = expect_context::<ParamTypeHelpState>().0;
    let close = move || open.set(false);

    view! {
        <Show when=move || open.get()>
            <div class="modal-backdrop" on:click=move |_| close()>
                <div class="modal modal-help-wide"
                    on:click=move |e: leptos::ev::MouseEvent| { e.stop_propagation(); }>
                    <div class="modal-head">
                        <h3>"Parameter type: numeric vs string"</h3>
                        <button class="modal-close" on:click=move |_| close()>"✕"</button>
                    </div>
                    <div class="modal-body modal-help-body">
                        <p>
                            "Every parameter on a part has a "<strong>"type"</strong>" — either
                            "<em>"numeric"</em>" or "<em>"string"</em>". The choice changes both
                            how you enter the value and how the system can search and filter on
                            it later."
                        </p>

                        <h4>"Numeric"</h4>
                        <p>"A measurable quantity with a unit. The value is a number; the unit
                            is what it's measured in (Farad, Ohm, Volt, °C); the SI prefix
                            scales it (μ, m, k, M)."</p>
                        <ul>
                            <li>"Editor shows: value input + SI prefix dropdown + unit dropdown,
                                plus optional min / max for ranges (each with its own prefix)."</li>
                            <li>"Saved as a "<code>"DOUBLE"</code>" plus the unit and prefix IDs.
                                Also auto-computes a "<code>"normalizedValue"</code>" — the
                                same number expressed in the bare unit (so "<code>"0.047 μF"</code>
                                " stores "<code>"4.7e-8 F"</code>")."</li>
                            <li>"Filterable by "<code>"="</code>", "<code>"<"</code>", "<code>">"</code>
                                ", and "<code>"BETWEEN"</code>" against "<code>"normalizedValue"</code>
                                ". Means "<em>"all caps under 1 nF"</em>" finds 500 pF parts too — the
                                comparison works across SI prefixes automatically."</li>
                            <li>"Sorted numerically."</li>
                        </ul>
                        <p class="muted modal-help-examples">
                            "Examples: capacitance C, resistance R, inductance L, DC voltage Vdc,
                            DC current Idc, frequency f, temperature Tmin/Tmax, tolerance Tol+/Tol-."
                        </p>

                        <h4>"String"</h4>
                        <p>"A categorical / enum / coded label. No unit, no scale — it's just text."</p>
                        <ul>
                            <li>"Editor shows: a single text input."</li>
                            <li>"Saved as a "<code>"VARCHAR"</code>"."</li>
                            <li>"Filterable by exact match, "<code>"LIKE"</code>" / contains,
                                or "<code>"IN (set)"</code>"."</li>
                            <li>"Sorted alphabetically."</li>
                        </ul>
                        <p class="muted modal-help-examples">
                            "Examples: dielectric (X7R, NP0), package material, mounting style
                            (SMD / through-hole), polarized (yes/no), color, certification level,
                            non-electrical attributes (material, finish, country of origin)."
                        </p>

                        <h4>"How to choose"</h4>
                        <p>"Rule of thumb: "<strong>"if you'd ever want to ask 'show me parts where
                            this parameter is between A and B', make it numeric"</strong>". If the
                            question is 'where this parameter equals X' or 'contains X', make it
                            string. When in doubt, numeric is more flexible — you can always coerce
                            to a string later by reading the value as text."</p>
                        <p class="muted">
                            "Switching the type later doesn't lose your data. Both the numeric
                            and string fields are stored on every parameter row; the type just
                            controls which one is the source of truth and what the editor lets
                            you fill in."</p>
                    </div>
                    <div class="modal-foot">
                        <button class="btn-primary" on:click=move |_| close()>"Got it"</button>
                    </div>
                </div>
            </div>
        </Show>
    }
}
