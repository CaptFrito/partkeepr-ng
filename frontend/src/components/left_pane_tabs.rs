use leptos::prelude::*;

use crate::{LeftPaneMode, LeftPaneModeState};

/// Segmented control at the top of the left pane that toggles which tree
/// is shown. Selected-category state is preserved across switches so the
/// active part filter doesn't get lost when peeking at storage.
#[component]
pub fn LeftPaneTabs() -> impl IntoView {
    let mode = expect_context::<LeftPaneModeState>().0;

    let is_cats = move || mode.get() == LeftPaneMode::Categories;
    let is_storage = move || mode.get() == LeftPaneMode::Storage;
    let is_footprints = move || mode.get() == LeftPaneMode::Footprints;
    let is_lookups = move || mode.get() == LeftPaneMode::Lookups;
    let is_projects = move || mode.get() == LeftPaneMode::Projects;

    view! {
        <div class="left-tabs">
            <button class="left-tab"
                class:active=is_cats
                on:click=move |_| mode.set(LeftPaneMode::Categories)>
                "Categories"
            </button>
            <button class="left-tab"
                class:active=is_storage
                on:click=move |_| mode.set(LeftPaneMode::Storage)>
                "Storage"
            </button>
            <button class="left-tab"
                class:active=is_footprints
                on:click=move |_| mode.set(LeftPaneMode::Footprints)>
                "Footprints"
            </button>
            <button class="left-tab"
                class:active=is_lookups
                on:click=move |_| mode.set(LeftPaneMode::Lookups)>
                "Lookups"
            </button>
            <button class="left-tab"
                class:active=is_projects
                on:click=move |_| mode.set(LeftPaneMode::Projects)>
                "Projects"
            </button>
        </div>
    }
}
