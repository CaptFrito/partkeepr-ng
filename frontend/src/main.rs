use leptos::prelude::*;

mod api;
mod components;
mod types;

/// Predicate ↔ URL hash round-trip. Hash format:
/// `#filters=<base64-encoded-json>`. Base64 keeps `,`/`&`/`=` from
/// colliding with future hash params, and dodges URL-encoding pain.
/// Empty / unparseable hash returns an empty predicate vec.
fn read_predicates_from_hash() -> Vec<api::Predicate> {
    let win = match web_sys::window() { Some(w) => w, None => return Vec::new() };
    let hash = win.location().hash().unwrap_or_default();
    let stripped = hash.strip_prefix('#').unwrap_or(&hash);
    for part in stripped.split('&') {
        if let Some(b64) = part.strip_prefix("filters=") {
            if b64.is_empty() { return Vec::new(); }
            if let Ok(bytes) = base64_url_decode(b64) {
                if let Ok(s) = String::from_utf8(bytes) {
                    if let Ok(preds) = serde_json::from_str::<Vec<api::Predicate>>(&s) {
                        return preds;
                    }
                }
            }
        }
    }
    Vec::new()
}

fn write_predicates_to_hash(preds: &[api::Predicate]) {
    let win = match web_sys::window() { Some(w) => w, None => return };
    let new_hash = if preds.is_empty() {
        String::new()
    } else {
        let json = serde_json::to_string(preds).unwrap_or_else(|_| "[]".to_string());
        format!("#filters={}", base64_url_encode(json.as_bytes()))
    };
    let _ = win.location().set_hash(&new_hash);
}

/// URL-safe base64 (RFC 4648 §5) without padding. Tiny inline impl —
/// pulling a crate just for this would be excessive.
fn base64_url_encode(input: &[u8]) -> String {
    const ALPHA: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((input.len() * 4 + 2) / 3);
    let mut chunks = input.chunks_exact(3);
    for c in chunks.by_ref() {
        let n = ((c[0] as u32) << 16) | ((c[1] as u32) << 8) | (c[2] as u32);
        out.push(ALPHA[((n >> 18) & 0x3F) as usize] as char);
        out.push(ALPHA[((n >> 12) & 0x3F) as usize] as char);
        out.push(ALPHA[((n >> 6) & 0x3F) as usize] as char);
        out.push(ALPHA[(n & 0x3F) as usize] as char);
    }
    let rem = chunks.remainder();
    match rem.len() {
        1 => {
            let n = (rem[0] as u32) << 16;
            out.push(ALPHA[((n >> 18) & 0x3F) as usize] as char);
            out.push(ALPHA[((n >> 12) & 0x3F) as usize] as char);
        }
        2 => {
            let n = ((rem[0] as u32) << 16) | ((rem[1] as u32) << 8);
            out.push(ALPHA[((n >> 18) & 0x3F) as usize] as char);
            out.push(ALPHA[((n >> 12) & 0x3F) as usize] as char);
            out.push(ALPHA[((n >> 6) & 0x3F) as usize] as char);
        }
        _ => {}
    }
    out
}

fn base64_url_decode(s: &str) -> Result<Vec<u8>, ()> {
    fn val(c: u8) -> Result<u32, ()> {
        match c {
            b'A'..=b'Z' => Ok((c - b'A') as u32),
            b'a'..=b'z' => Ok((c - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((c - b'0' + 52) as u32),
            b'-' => Ok(62),
            b'_' => Ok(63),
            _ => Err(()),
        }
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    let chunks = bytes.chunks(4);
    for c in chunks {
        let mut n: u32 = 0;
        for &b in c {
            n = (n << 6) | val(b)?;
        }
        match c.len() {
            4 => {
                out.push(((n >> 16) & 0xFF) as u8);
                out.push(((n >> 8) & 0xFF) as u8);
                out.push((n & 0xFF) as u8);
            }
            3 => {
                let n = n << 6;
                out.push(((n >> 16) & 0xFF) as u8);
                out.push(((n >> 8) & 0xFF) as u8);
            }
            2 => {
                let n = n << 12;
                out.push(((n >> 16) & 0xFF) as u8);
            }
            _ => return Err(()),
        }
    }
    Ok(out)
}

use components::{
    BomLineDialog, CategoryEditDialog, CategoryMoveDialog, CategoryTree, DeleteConfirmDialog,
    FootprintCatEditDialog, FootprintLeafEditDialog, FootprintMoveDialog, FootprintTree,
    LeftPaneTabs, LookupEditDialog, LookupTypeList, LookupsPanel, MetaPartHelpDialog,
    ParamTypeHelpDialog, PartDetailPanel, PartsGrid, ProjectEditDialog, ProjectPanel,
    ProjectsList, RunDeleteDialog, RunProjectDialog, StockDialog, StorageCatEditDialog,
    StorageLocEditDialog, StorageMoveDialog, StorageTree,
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

/// Active parametric predicates. When this Vec is non-empty, the parts
/// grid swaps from `GET /api/parts` to `POST /api/parts/parametric`.
/// The shape mirrors `api::Predicate` so we don't have a second wire-vs-
/// state translation layer — the panel writes directly into this Vec.
#[derive(Clone, Copy)]
pub struct PredicatesState(pub RwSignal<Vec<api::Predicate>>);

/// Slice 11 follow-up: meta-part filter for the parts grid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MetaFilter {
    All,
    RealOnly,
    MetaOnly,
}

impl MetaFilter {
    pub fn to_meta_only(self) -> Option<bool> {
        match self {
            MetaFilter::All => None,
            MetaFilter::RealOnly => Some(false),
            MetaFilter::MetaOnly => Some(true),
        }
    }
}

#[derive(Clone, Copy)]
pub struct MetaFilterState(pub RwSignal<MetaFilter>);
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

/// Category edit-dialog state. Single context covers create-child, rename
/// and delete-confirm flows because they share the same modal surface.
#[derive(Clone, Copy)]
pub struct CategoryEditState(pub RwSignal<Option<CategoryEditCtx>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CategoryEditMode {
    /// Create a new subcategory under `id` (the parent).
    CreateChild,
    /// Rename `id`.
    Rename,
    /// Delete `id` (after confirmation, with hard-block on non-empty).
    Delete,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CategoryEditCtx {
    pub mode: CategoryEditMode,
    pub id: i32,
    /// For CreateChild this is the parent's name; for Rename/Delete it is
    /// the target's name. Used to give the dialog a clear title.
    pub name: String,
    /// Pre-fill description when renaming. Empty for create/delete flows.
    pub description: String,
    /// For Delete: direct part count + immediate child count, shown in
    /// the dialog body and used to disable Delete when non-zero. Both
    /// zero for non-delete modes.
    pub part_count: i64,
    pub child_count: i64,
}

/// Move-to picker state. None when closed.
#[derive(Clone, Copy)]
pub struct CategoryMoveState(pub RwSignal<Option<CategoryMoveCtx>>);

/// Per-id expand state for the category tree. Lifted out of TreeNodeView
/// so it survives the tree-resource refetch that fires on every category
/// mutation. `Some(true)/Some(false)` = explicit user choice; absence
/// means "fall back to default (lvl <= 1 expanded)".
#[derive(Clone, Copy)]
pub struct TreeExpanded(pub RwSignal<std::collections::HashMap<i32, bool>>);

/// Which tree the left pane is showing. Selection contexts (category,
/// storage, footprint) are independent and persist across mode switches
/// — toggling away and back doesn't lose the active part filter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LeftPaneMode {
    Categories,
    Storage,
    Footprints,
    /// Flat-lookup admin: Manufacturers, Distributors, etc. The center
    /// pane swaps from the parts grid to a lookup table.
    Lookups,
    /// Projects + BOMs. Left pane shows the project list; center pane
    /// shows the project editor (name/description/parts/attachments).
    Projects,
}
#[derive(Clone, Copy)]
pub struct LeftPaneModeState(pub RwSignal<LeftPaneMode>);

/// Which lookup-table is currently shown in Lookups mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LookupKind {
    Manufacturers,
    Distributors,
    PartUnits,
    Units,
    SiPrefixes,
}
#[derive(Clone, Copy)]
pub struct SelectedLookup(pub RwSignal<LookupKind>);

/// Active storage filter that drives the parts grid when LeftPaneMode is
/// Storage. Folder-mode filters via the category's nested-set subtree;
/// Location-mode is an exact id.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StorageSelection {
    None,
    Folder(i32),
    Location(i32),
}
#[derive(Clone, Copy)]
pub struct SelectedStorage(pub RwSignal<StorageSelection>);

/// Storage-category dialog state — same three-mode shape as
/// CategoryEditState but for the StorageLocationCategory entity.
#[derive(Clone, Copy)]
pub struct StorageCatEditState(pub RwSignal<Option<StorageCatEditCtx>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StorageCatEditMode {
    CreateChild,
    Rename,
    Delete,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StorageCatEditCtx {
    pub mode: StorageCatEditMode,
    pub id: i32,
    pub name: String,
    pub description: String,
    /// For Delete: child folders + direct storage locations.
    pub child_count: i64,
    pub location_count: i64,
}

/// Storage-location dialog state. Note Create takes a parent category
/// id (not "child of self"), so the ctx carries the parent_id when
/// mode = Create.
#[derive(Clone, Copy)]
pub struct StorageLocEditState(pub RwSignal<Option<StorageLocEditCtx>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StorageLocEditMode {
    /// Create a new storage location; `id` is the parent category id.
    Create,
    /// Rename the location with id=`id`.
    Rename,
    /// Delete the location with id=`id`.
    Delete,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StorageLocEditCtx {
    pub mode: StorageLocEditMode,
    /// For Create: parent category id. For Rename/Delete: the location's own id.
    pub id: i32,
    /// For Create: parent category name (for the dialog header).
    /// For Rename/Delete: the location's own name.
    pub name: String,
    /// For Delete: how many parts reference this location.
    pub part_count: i64,
}

/// Move-to picker for storage entities. `MoveCat` reparents a folder
/// (with subtree-pruning); `MoveLoc` reparents a leaf storage location
/// (no pruning).
#[derive(Clone, Copy)]
pub struct StorageMoveState(pub RwSignal<Option<StorageMoveCtx>>);

#[derive(Clone, Debug, PartialEq)]
pub enum StorageMoveCtx {
    MoveCat { id: i32, name: String },
    MoveLoc { id: i32, name: String },
}

// ---------------------------------------------------------------------------
//  Slice 5c-3: Footprints
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FootprintSelection {
    None,
    Folder(i32),
    Footprint(i32),
}
#[derive(Clone, Copy)]
pub struct SelectedFootprint(pub RwSignal<FootprintSelection>);

#[derive(Clone, Copy)]
pub struct FootprintCatEditState(pub RwSignal<Option<FootprintCatEditCtx>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FootprintCatEditMode {
    CreateChild,
    Rename,
    Delete,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FootprintCatEditCtx {
    pub mode: FootprintCatEditMode,
    pub id: i32,
    pub name: String,
    pub description: String,
    pub child_count: i64,
    pub footprint_count: i64,
}

#[derive(Clone, Copy)]
pub struct FootprintLeafEditState(pub RwSignal<Option<FootprintLeafEditCtx>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FootprintLeafEditMode {
    /// Create a new footprint; `id` is the parent category id.
    Create,
    /// Rename the footprint with id=`id`.
    Rename,
    /// Delete the footprint with id=`id`.
    Delete,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FootprintLeafEditCtx {
    pub mode: FootprintLeafEditMode,
    pub id: i32,
    pub name: String,
    pub description: String,
    /// For Delete: how many parts reference this footprint.
    pub part_count: i64,
}

/// Move-to picker for footprint entities — same enum-of-kind shape as
/// StorageMoveCtx.
#[derive(Clone, Copy)]
pub struct FootprintMoveState(pub RwSignal<Option<FootprintMoveCtx>>);

#[derive(Clone, Debug, PartialEq)]
pub enum FootprintMoveCtx {
    MoveCat { id: i32, name: String },
    MoveFootprint { id: i32, name: String },
}

// ---------------------------------------------------------------------------
//  Slice 5c-4: Lookups (Manufacturer / Distributor / PartUnit / Unit / SiPrefix)
// ---------------------------------------------------------------------------

/// Single context for all lookup-edit dialogs. Each variant carries its
/// entity-specific fields. Mode tags Create vs Edit vs Delete.
#[derive(Clone, Copy)]
pub struct LookupEditState(pub RwSignal<Option<LookupEditCtx>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LookupEditMode {
    Create,
    Edit,
    Delete,
}

/// The entity-specific payload for an open lookup-edit dialog. Mode is
/// orthogonal (Create/Edit/Delete) and stored alongside.
#[derive(Clone, Debug, PartialEq)]
pub struct LookupEditCtx {
    pub mode: LookupEditMode,
    pub kind: LookupKind,
    /// Existing row id for Edit/Delete; 0 for Create (kind tells us the
    /// target table).
    pub id: i32,
    /// Display name shown in the dialog header (for Edit/Delete) or
    /// blank for Create.
    pub name: String,
    /// All fields, JSON-encoded — each dialog branches on `kind` to
    /// deserialize into its own typed view. This keeps the context-state
    /// surface flat without one giant variant per entity.
    pub data: serde_json::Value,
    /// For Delete: count of references that block. Different entities
    /// have different "what blocks" semantics — store as a list of
    /// (label, count) pairs.
    pub block_counts: Vec<(String, i64)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CategoryMoveCtx {
    pub id: i32,
    pub name: String,
}

// ---------------------------------------------------------------------------
//  Slice 8a: Projects + BOMs
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
pub struct SelectedProject(pub RwSignal<Option<i32>>);

/// Project edit dialog state. Mode determines what fields are editable
/// and what action the Save button takes.
#[derive(Clone, Copy)]
pub struct ProjectEditState(pub RwSignal<Option<ProjectEditCtx>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectEditMode {
    Create,
    Rename,
    Delete,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProjectEditCtx {
    pub mode: ProjectEditMode,
    /// 0 for Create; the project id otherwise.
    pub id: i32,
    pub name: String,
    pub description: String,
    /// For Delete: how many BOM lines exist (informational; server is
    /// the authority on whether delete actually proceeds).
    pub parts_count: i64,
    /// For Delete: how many runs exist. Non-zero means the server will
    /// reject the delete.
    pub runs_count: i64,
}

/// Run-project dialog state. None when closed; Some carries which
/// project is being run (the dialog fetches its own preview).
#[derive(Clone, Copy)]
pub struct RunProjectState(pub RwSignal<Option<RunProjectCtx>>);

#[derive(Clone, Debug, PartialEq)]
pub struct RunProjectCtx {
    pub project_id: i32,
    pub project_name: String,
}

/// Delete-run dialog state. Used by the per-run 🗑 button on the run
/// history cards. Carries enough info to render an informative confirm
/// without re-fetching.
#[derive(Clone, Copy)]
pub struct RunDeleteState(pub RwSignal<Option<RunDeleteCtx>>);

#[derive(Clone, Debug, PartialEq)]
pub struct RunDeleteCtx {
    pub project_id: i32,
    pub run_id: i32,
    pub when: String,
    pub run_qty: i32,
    pub line_count: usize,
}

/// BOM line edit-dialog state. Single context for add + edit; mode
/// determines whether we POST or PUT.
#[derive(Clone, Copy)]
pub struct BomLineEditState(pub RwSignal<Option<BomLineEditCtx>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BomLineEditMode {
    Add,
    Edit,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BomLineEditCtx {
    pub mode: BomLineEditMode,
    pub project_id: i32,
    /// 0 for Add; the line id otherwise.
    pub line_id: i32,
    pub part_id: Option<i32>,
    pub part_name: String,
    pub part_internal_part_number: String,
    pub quantity: i32,
    pub remarks: String,
    pub overage_type: String, // "" | "absolute" | "percent"
    pub overage: i32,
    pub lot_number: String,
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
    let category_edit = CategoryEditState(RwSignal::new(None));
    let category_move = CategoryMoveState(RwSignal::new(None));
    let tree_expanded = TreeExpanded(RwSignal::new(std::collections::HashMap::new()));
    let left_pane_mode = LeftPaneModeState(RwSignal::new(LeftPaneMode::Categories));
    let storage_cat_edit = StorageCatEditState(RwSignal::new(None));
    let storage_loc_edit = StorageLocEditState(RwSignal::new(None));
    let storage_move = StorageMoveState(RwSignal::new(None));
    let selected_storage = SelectedStorage(RwSignal::new(StorageSelection::None));
    let footprint_cat_edit = FootprintCatEditState(RwSignal::new(None));
    let footprint_leaf_edit = FootprintLeafEditState(RwSignal::new(None));
    let footprint_move = FootprintMoveState(RwSignal::new(None));
    let selected_footprint = SelectedFootprint(RwSignal::new(FootprintSelection::None));
    let selected_lookup = SelectedLookup(RwSignal::new(LookupKind::Manufacturers));
    let lookup_edit = LookupEditState(RwSignal::new(None));
    let selected_project = SelectedProject(RwSignal::new(None::<i32>));
    let project_edit = ProjectEditState(RwSignal::new(None));
    let bom_line_edit = BomLineEditState(RwSignal::new(None));
    let run_project = RunProjectState(RwSignal::new(None));
    let run_delete = RunDeleteState(RwSignal::new(None));
    let predicates = PredicatesState(RwSignal::new(read_predicates_from_hash()));
    let meta_filter = MetaFilterState(RwSignal::new(MetaFilter::All));

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
    provide_context(category_edit);
    provide_context(category_move);
    provide_context(tree_expanded);
    provide_context(left_pane_mode);
    provide_context(storage_cat_edit);
    provide_context(storage_loc_edit);
    provide_context(storage_move);
    provide_context(selected_storage);
    provide_context(footprint_cat_edit);
    provide_context(footprint_leaf_edit);
    provide_context(footprint_move);
    provide_context(selected_footprint);
    provide_context(selected_lookup);
    provide_context(lookup_edit);
    provide_context(selected_project);
    provide_context(project_edit);
    provide_context(bom_line_edit);
    provide_context(run_project);
    provide_context(run_delete);
    provide_context(predicates);
    provide_context(meta_filter);

    // Push predicate changes into the URL hash so a filtered view is
    // shareable / reload-survivable. Reads happen once on mount above.
    Effect::new(move |_| {
        let preds = predicates.0.get();
        write_predicates_to_hash(&preds);
    });

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
                <aside>
                    <LeftPaneTabs/>
                    <Show when=move || left_pane_mode.0.get() == LeftPaneMode::Categories>
                        <CategoryTree/>
                    </Show>
                    <Show when=move || left_pane_mode.0.get() == LeftPaneMode::Storage>
                        <StorageTree/>
                    </Show>
                    <Show when=move || left_pane_mode.0.get() == LeftPaneMode::Footprints>
                        <FootprintTree/>
                    </Show>
                    <Show when=move || left_pane_mode.0.get() == LeftPaneMode::Lookups>
                        <LookupTypeList/>
                    </Show>
                    <Show when=move || left_pane_mode.0.get() == LeftPaneMode::Projects>
                        <ProjectsList/>
                    </Show>
                </aside>
            </Show>
            <div class="center">
                <Show when=move || matches!(
                    left_pane_mode.0.get(),
                    LeftPaneMode::Categories
                        | LeftPaneMode::Storage
                        | LeftPaneMode::Footprints
                )>
                    <PartsGrid/>
                </Show>
                <Show when=move || left_pane_mode.0.get() == LeftPaneMode::Lookups>
                    <LookupsPanel/>
                </Show>
                <Show when=move || left_pane_mode.0.get() == LeftPaneMode::Projects>
                    <ProjectPanel/>
                </Show>
            </div>
            <Show when=move ||
                !right_collapsed.0.get()
                && left_pane_mode.0.get() != LeftPaneMode::Lookups>
                <PartDetailPanel />
            </Show>
            <StockDialog />
            <DeleteConfirmDialog />
            <ParamTypeHelpDialog />
            <MetaPartHelpDialog />
            <CategoryEditDialog />
            <CategoryMoveDialog />
            <StorageCatEditDialog />
            <StorageLocEditDialog />
            <StorageMoveDialog />
            <FootprintCatEditDialog />
            <FootprintLeafEditDialog />
            <FootprintMoveDialog />
            <LookupEditDialog />
            <ProjectEditDialog />
            <BomLineDialog />
            <RunProjectDialog />
            <RunDeleteDialog />
        </div>
    }
}

fn main() {
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(App);
}
