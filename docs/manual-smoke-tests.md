# Manual smoke-test checklist

partkeepr-ng has no automated frontend test suite — Webix is a desktop-app
toolkit, the UI is heavy on click-flows, and the overhead of standing up
Playwright isn't justified for a one-developer workshop tool. This checklist
is the substitute: a concrete walk-through to run after risky changes (big
refactors, dependency upgrades, Webix version bumps).

## When to run

- After a vanilla-JS refactor that moves functions across files.
- After a Webix version bump.
- After a backend handler refactor that touches multiple endpoints.
- Before publishing a new release.

## How to use

Walk the list end-to-end. **Don't skip sections that look unrelated** —
shared globals (lookupsCache, currentPart, the scan-overlay capture-phase
listener) cut across feature boundaries and a refactor in one area can
break another invisibly.

Mark each item ✓ as you go. If something is broken, file an issue or fix
on the spot — don't continue past a regression.

Tested against backend at `http://localhost:8080/`, hard-refresh
(Ctrl+Shift+R) before starting. Login: `admin` / `admin` (dev DB).

---

## §1 — Login + logout

- [ ] Load `/`. Login dialog appears with title "Sign in to PartKeepr-ng".
- [ ] Wrong password → "invalid credentials" error.
- [ ] Right password → main shell loads, banner shows logo + "PartKeepr-ng".
- [ ] User badge top-right shows username, ADMIN flag if admin.
- [ ] Click Logout → returns to login dialog without page reload.

## §2 — Header + scan input

- [ ] 🔍 Scan / search box accepts text and Enter triggers search.
- [ ] 📷 Scan button opens the capture overlay (full-screen dim, status bar).
- [ ] Pressing Esc on the overlay cancels and returns to main shell.
- [ ] (If a scanner is attached) scan a Digi-Key 2D label → overlay
      decodes, parts grid filters or scan-receive dialog opens.

## §3 — Parts grid (center pane)

- [ ] Default load shows up to 500 parts, header reads "N parts".
- [ ] Click a column header → ascending sort indicator appears, rows reorder.
- [ ] Click again → descending. Third click clears sort.
- [ ] Type into the filter box → grid filters live; clear → restored.
- [ ] Page through results (if >500): pagination works.
- [ ] Click a row → right-pane detail panel populates within ~300ms.
- [ ] Multi-select with shift+click works for bulk actions (if exposed).

## §4 — Left pane — Categories tree

- [ ] Tabbar shows Categories / Storage / Footprints / Lookups; switching tabs preserves grid filter state.
- [ ] Categories tab: tree loads, ✦ root collapses/expands.
- [ ] Click a category → grid filters to that category's parts.
- [ ] Toolbar: ➕ Add → dialog opens, save → tree refreshes with new node.
- [ ] ✏ Edit → dialog pre-fills, save → tree refreshes.
- [ ] 🗑 Delete (on empty category) → confirmation, removed.
- [ ] 🗑 Delete (on category with children) → server returns error, tree intact.
- [ ] ⇅ Move → picker dialog opens, moving updates tree.

## §5 — Left pane — Storage tree

Repeat §4 for Storage tab. Additionally:

- [ ] (NOWHERE) bin appears under root, **cannot** be deleted (server
      returns 409 with `protected:true`, UI shows error toast).
- [ ] Adding a leaf storage location creates the location, not a category.
- [ ] Storage location with images → image renders inline in the tree
      (or thumb in the editor dialog).

## §6 — Left pane — Footprints tree

Repeat §4 for Footprints tab. Additionally:

- [ ] Footprint detail dialog shows image preview if present.
- [ ] Upload an image to a footprint → preview updates without reload.

## §7 — Left pane — Lookups admin

- [ ] Lookups tab shows segmented control: Manufacturers / Distributors /
      Units / SI Prefixes / Part Units.
- [ ] Each section: list loads, ➕ Add → dialog → row appears.
- [ ] Edit a row → save → list reflects change.
- [ ] Manufacturers: "merge into" action works (drops one row, repoints
      PartManufacturer FKs to target).
- [ ] Same for Distributors merge.

## §8 — Part detail panel (right pane)

Click a part with rich data (e.g. one with stock, packaging rows,
distributors, parameters). Verify each section renders if data is
present:

- [ ] **Header**: name + IPN + edit/delete buttons.
- [ ] **Classification**: category + footprint as breadcrumb links.
- [ ] **Stock**: on-hand, avg price, low-stock indicator, min level.
- [ ] **Packaging**: per-row form/qty/storage; "matches stock level"
      indicator green when sum matches; orange ⚠ otherwise; **🔻 Consume
      button per row** with quantity > 0.
- [ ] **Manufacturers**: each row shows manufacturer + MPN; logo image
      if present.
- [ ] **Distributors**: each row shows distributor + SKU + price + pkg.
- [ ] **Parameters**: numeric and string parameters render.
- [ ] **Recent stock activity**: last few StockEntry rows with date/Δ/price/by.
- [ ] **Receipts by sales order**: aggregated rows from positive
      StockEntry rows attributed to a (distributor, SO#).
- [ ] **Attachments**: list with download links; inline preview for images.
- [ ] **Projects this part is in**: list with click-through to project.

## §9 — Stock dialogs (add / remove / reconcile)

On a part with stock:

- [ ] **+ Add**: dialog opens, qty + price + comment fields render;
      distributor + SO# fields render; "Add packaging entry" toggle
      enables form/storage/lot/date fields. Save with attribution → row
      appears in Receipts panel after refresh.
- [ ] **− Remove**: dialog opens, qty defaults to 1, save → stock decrements.
- [ ] **Reconcile**: dialog opens, target field defaults to current
      stock; save with delta=0 → blocked with "nothing to reconcile";
      save with non-zero target → correction StockEntry inserted.
- [ ] **🔻 Consume from container** (slice 13c): on a part with ≥1
      packaging row, click 🔻 next to a row → dialog shows form/qty/
      where context, qty input, save → that row's quantity decrements,
      a StockEntry is inserted with `partStorageLocation_id` set.

## §10 — Scan workflow (slice 13b)

(Skip if no scanner physically attached.)

- [ ] Scan a Digi-Key 2D label on a known-imported part → scan-receive
      dialog opens pre-filled with form/qty/SO#/lot/date from the ANSI
      MH10.8.2 fields.
- [ ] Scan a label for a part NOT in inventory → lookup-search dialog
      opens pre-filled with the MPN.
- [ ] Scan a label that's just MPN (no qty) → grid filters to that MPN,
      detail panel opens.
- [ ] Scan a Mini-Circuits MPN-then-qty pair → second scan completes the
      receive.

## §11 — Receive Order dialog (slices 12a.2 / 12b.2 / 13d)

(Requires DK or Mouser API keys configured.)

- [ ] Click 📦 Receive Order → dialog opens, source picker visible if
      both DK + Mouser configured.
- [ ] Enter a known SO# → 🔍 Fetch → all lines render with match status.
- [ ] **Recv'd column** shows `0/N` for never-received, `M/N` orange for
      partial, `N/N ✓` green for fully received.
- [ ] **Apply qty** auto-fills to (target − already received) on partial.
- [ ] **Apply** checkbox auto-disabled on fully-received lines; manually
      checking it shows "already fully received" toast.
- [ ] **Form** richselect per line; defaults to Loose; richselect popup
      lists Reel/CutTape/Loose/Tray/Tube/Feeder/Bag/Other.
- [ ] **Storage** richselect per line; defaults to part's primary or
      `(NOWHERE)` if none.
- [ ] **Skip pkg** checkbox toggles per line.
- [ ] Click ✓ Apply → all checked lines apply; success toast shows
      `N lines stocked`; per-line PSL rows appear in each part's
      Packaging panel (unless Skip pkg was checked).
- [ ] Re-fetch the same SO# → already-received lines now show ✓ green.

## §12 — Lookup search dialog (slices 12a.1 / 12b)

(Requires DK or Mouser API keys configured.)

- [ ] Click ➕ Add via lookup → source picker visible (Mouser / DK).
- [ ] Switch source → SKU column header changes.
- [ ] Enter MPN → 🔍 → results grid populates.
- [ ] Pick a result → import dialog → save → new Part created with
      manufacturer, distributor SKU, datasheet URL, parameters.

## §13 — Parametric search (slices 11a / 11c)

- [ ] Click ⚙ Parametric → pane appears with predicate rows.
- [ ] Add a predicate (parameter / op / value) → results filter live or
      on Apply.
- [ ] Click "Pick footprints…" → shuttle dialog: Available list on left,
      Selected list on right; clicking a row in either list moves it.
- [ ] Click "Pick classes…" → category shuttle (sub-tree expansion).
- [ ] Apply → grid shows the OR of selected footprints AND/OR predicates.
- [ ] Clear → all predicates removed, grid restored.

## §14 — Part editor

Open the editor on an existing part (Edit) or new part (➕):

- [ ] Tabs: Identity, Classification, Manufacturers, Distributors,
      Parameters, Packaging, Attachments, Receipts.
- [ ] Each tab navigates without losing form state.
- [ ] **Packaging tab**: + Add row, ⇄ Split / move (on selected row),
      − Remove selected. Total indicator updates.
- [ ] **Attachments tab**: drag-and-drop upload, URL fetch, edit
      description, delete.
- [ ] Cancel → no DB changes.
- [ ] Save → parts grid + detail panel refresh.

## §15 — Projects + BOM (slice 8)

- [ ] Projects list loads.
- [ ] Create a new project → empty BOM.
- [ ] Add a part to BOM with quantity + lot number.
- [ ] Run project → preview shows shortfalls; confirm → StockEntry rows
      decrement each part's stock.
- [ ] Run history shows the run; delete a run → restores stock.

## §16 — Label printing (slice 13)

(Requires `PARTKEEPR_PTOUCH_BIN` configured + label printer connected.)

- [ ] Capabilities check returns `available: true`.
- [ ] Print preview generates correctly (QR + text).
- [ ] Send to printer → label prints.

## §17 — Cross-cutting

- [ ] Hard refresh (Ctrl+Shift+R) → app re-loads, session persists, last
      selected part still highlighted in grid.
- [ ] Open in two browser tabs simultaneously → both work, edits in one
      tab are visible in the other after refresh.
- [ ] Network blip simulation: stop the backend → click anything → user
      sees an error toast, not a silent freeze. Restart backend → app
      resumes working without forcing a reload.

---

## Refactor-specific addendum

When doing a vanilla-JS file split, after each chunk also verify:

- [ ] Browser console at boot is clean — no `ReferenceError: foo is not
      defined`.
- [ ] All `<script>` tags load (Network tab shows 200 for each).
- [ ] No function is referenced before it's defined globally — load
      order matters; helpers must come before consumers.
- [ ] Hard-reload twice (the second time tests cold cache more honestly
      than the first).

If a chunk introduces a regression, **revert the chunk and re-split
differently** — don't pile fixes on top.
