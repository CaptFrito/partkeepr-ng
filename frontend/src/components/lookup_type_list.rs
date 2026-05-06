use leptos::prelude::*;

use crate::{LookupKind, SelectedLookup};

/// Sub-list shown in the left pane when LeftPaneMode is Lookups. Five
/// rows, one per supported entity type. Click sets which lookup the
/// center pane shows.
#[component]
pub fn LookupTypeList() -> impl IntoView {
    let selected = expect_context::<SelectedLookup>().0;
    let kinds = [
        (LookupKind::Manufacturers, "Manufacturers"),
        (LookupKind::Distributors,  "Distributors"),
        (LookupKind::PartUnits,     "Part Units"),
        (LookupKind::Units,         "Units"),
        (LookupKind::SiPrefixes,    "SI Prefixes"),
    ];
    view! {
        <div>
            {kinds.iter().map(|(k, label)| {
                let k = *k;
                let label = *label;
                view! {
                    <div class="tree-node"
                        class:selected=move || selected.get() == k
                        on:click=move |_| selected.set(k)>
                        <span class="chev"></span>
                        <span class="tree-label">{label}</span>
                    </div>
                }
            }).collect::<Vec<_>>()}
        </div>
    }
}
