use leptos::prelude::*;

mod api;
mod components;
mod types;

use components::{
    CategoryTree, DeleteConfirmDialog, MetaPartHelpDialog, ParamTypeHelpDialog,
    PartDetailPanel, PartsGrid, StockDialog,
};

// Newtype wrappers around RwSignal so context lookups (by type) don't
// collide between selected-category and selected-part.
#[derive(Clone, Copy)]
pub struct SelectedCategory(pub RwSignal<Option<i32>>);
#[derive(Clone, Copy)]
pub struct SelectedPart(pub RwSignal<Option<i32>>);
#[derive(Clone, Copy)]
pub struct Search(pub RwSignal<String>);
#[derive(Clone, Copy)]
pub struct Offset(pub RwSignal<u32>);
/// (column-name, ascending). column-name = "" means default ordering.
#[derive(Clone, Copy)]
pub struct Sort(pub RwSignal<(String, bool)>);
/// Layout state — left tree visibility, right detail panel visibility.
#[derive(Clone, Copy)]
pub struct LeftCollapsed(pub RwSignal<bool>);
#[derive(Clone, Copy)]
pub struct RightCollapsed(pub RwSignal<bool>);
/// Bumped after any mutation that affects parts (stock add/remove,
/// future part edits, etc.). Resources watching parts data track this
/// as a dependency so they refetch when it changes.
#[derive(Clone, Copy)]
pub struct DataVersion(pub RwSignal<u32>);
/// Open stock-entry dialog. None when closed.
#[derive(Clone, Copy)]
pub struct StockDialogState(pub RwSignal<Option<StockDialogCtx>>);

/// Context the dialog needs to render itself usefully — pre-fill default
/// price with the current avg, show current stock for Reconcile, etc.
#[derive(Clone, Debug, PartialEq)]
pub struct StockDialogCtx {
    pub part_id: i32,
    pub mode: StockDialogMode,
    pub current_stock: i32,
    pub avg_price: String, // string repr of Decimal, matches API JSON shape
    pub unit_short: String, // "pcs" / "g" / "m" — for display
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StockDialogMode {
    Add,
    Remove,
    Reconcile,
}

/// Right-pane editor state. View = read-only detail (default);
/// other variants take the right pane for editing/creating.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditorMode {
    View,
    Editing(i32),
    Creating,
    /// Seed from an existing part's data but save as a new row.
    DuplicatingFrom(i32),
    /// Same as Creating but starts with `meta_part = true`.
    CreatingMeta,
}
#[derive(Clone, Copy)]
pub struct EditorModeState(pub RwSignal<EditorMode>);

/// Delete-part confirmation dialog state.
#[derive(Clone, Copy)]
pub struct DeletePartState(pub RwSignal<Option<DeletePartCtx>>);

/// Whether the "what is numeric vs string?" help dialog is open. Triggered
/// from the parameter editor's type dropdown via the "Explain…" entry.
#[derive(Clone, Copy)]
pub struct ParamTypeHelpState(pub RwSignal<bool>);

/// Whether the "what is a meta-part?" help dialog is open. Triggered
/// from the editor's `Explain` button when in `CreatingMeta` mode.
#[derive(Clone, Copy)]
pub struct MetaPartHelpState(pub RwSignal<bool>);

#[derive(Clone, Debug, PartialEq)]
pub struct DeletePartCtx {
    pub part_id: i32,
    pub part_name: String,
}

#[component]
fn App() -> impl IntoView {
    let selected_category = SelectedCategory(RwSignal::new(None::<i32>));
    let selected_part = SelectedPart(RwSignal::new(None::<i32>));
    let search = Search(RwSignal::new(String::new()));
    let offset = Offset(RwSignal::new(0u32));
    let sort = Sort(RwSignal::new((String::new(), true)));
    let left_collapsed = LeftCollapsed(RwSignal::new(false));
    let right_collapsed = RightCollapsed(RwSignal::new(false));
    let data_version = DataVersion(RwSignal::new(0u32));
    let stock_dialog = StockDialogState(RwSignal::new(None));
    let editor_mode = EditorModeState(RwSignal::new(EditorMode::View));
    let delete_part = DeletePartState(RwSignal::new(None));
    let param_help = ParamTypeHelpState(RwSignal::new(false));
    let meta_help = MetaPartHelpState(RwSignal::new(false));

    provide_context(selected_category);
    provide_context(selected_part);
    provide_context(search);
    provide_context(offset);
    provide_context(sort);
    provide_context(left_collapsed);
    provide_context(right_collapsed);
    provide_context(data_version);
    provide_context(stock_dialog);
    provide_context(editor_mode);
    provide_context(delete_part);
    provide_context(param_help);
    provide_context(meta_help);

    let app_class = move || {
        let l = if left_collapsed.0.get() { " left-collapsed" } else { "" };
        let r = if right_collapsed.0.get() { " right-collapsed" } else { "" };
        format!("app{l}{r}")
    };

    view! {
        <div class=app_class>
            <header>
                <button class="panel-toggle"
                    title="Toggle category tree"
                    on:click=move |_| left_collapsed.0.update(|v| *v = !*v)>
                    {move || if left_collapsed.0.get() { "▶" } else { "◀" }}
                </button>
                <span class="title">"partkeepr-ng — Part Manager"</span>
                <div style="flex:1"/>
                <button class="panel-toggle"
                    title="Toggle detail panel"
                    on:click=move |_| right_collapsed.0.update(|v| *v = !*v)>
                    {move || if right_collapsed.0.get() { "◀" } else { "▶" }}
                </button>
            </header>
            <Show when=move || !left_collapsed.0.get()>
                <aside><CategoryTree /></aside>
            </Show>
            <div class="center"><PartsGrid /></div>
            <Show when=move || !right_collapsed.0.get()>
                <PartDetailPanel />
            </Show>
            <StockDialog />
            <DeleteConfirmDialog />
            <ParamTypeHelpDialog />
            <MetaPartHelpDialog />
        </div>
    }
}

fn main() {
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(App);
}
