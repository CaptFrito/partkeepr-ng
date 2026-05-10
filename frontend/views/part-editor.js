// SPDX-License-Identifier: GPL-3.0-or-later
//
// Part editor — the big tabbed dialog for creating or editing a
// Part record. Tabs: Identity / Classification / Manufacturers /
// Distributors / Parameters / Packaging / Attachments / Receipts.
//
// Also bundles two adjacent concerns:
//   - lookupsCache: lazy-loaded categories/footprints/storage
//     locations, used to populate dropdowns across many editors.
//   - The built-in Common Parameters library (~30 EE templates)
//     used by the "📋 Templates" button on Parameters tab.
//
// Loaded after api.js, before app.js. Declares openPartEditor(),
// ensureLookups(), lookupsCache, COMMON_PARAMS at script-tag
// global scope.

"use strict";

// ============================================================
//  Lookups cache (categories, footprints, etc.) — lazy-loaded
//  on first editor open and reused.
// ============================================================

let lookupsCache = null;

async function ensureLookups() {
    if (!lookupsCache) lookupsCache = await api.lookups();
    return lookupsCache;
}

// Flatten the category tree into a list of {id, value: breadcrumb}
// so a Webix combo can render it linearly while still showing the path.
function flattenCategoryTree(tree) {
    const out = [];
    function walk(nodes, depth) {
        // Sort siblings alphabetically (case-insensitive); preserves
        // hierarchy while making it easier to find a category by
        // name in long lists.
        const sorted = nodes.slice().sort((a, b) =>
            (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
        );
        for (const n of sorted) {
            // value = bare name (drives closed-selector display);
            // depth = drives indent in the open list via the
            // dropdown body template (see categoryOptionTemplate).
            out.push({ id: n.id, value: n.name, depth: depth });
            if (n.children && n.children.length) walk(n.children, depth + 1);
        }
    }
    walk(tree, 0);
    return out;
}

/// Body template for richselect dropdowns whose options came from
/// `flattenCategoryTree`. Emits `&nbsp;` entities for indent —
/// HTML entities survive Webix's whitespace handling, where
/// regular spaces and even raw U+00A0 don't reliably make it
/// through to the rendered output. Four NBSPs per depth level.
function categoryOptionTemplate(o) {
    const depth = o && o.depth ? o.depth : 0;
    const indent = new Array(depth + 1).join("&nbsp;&nbsp;&nbsp;&nbsp;");
    return indent + escapeHtml(o.value || "");
}

// ============================================================
//  Part editor (Identity / Classification / Manufacturers /
//  Distributors / Parameters tabs)
// ============================================================

function editorAddRow(tableId, defaults) {
    const table = $$(tableId);
    if (!table) return;
    const row = Object.assign({ id: webix.uid() }, defaults || {});
    table.add(row);
    table.select(row.id);
    table.editCell(row.id, table.config.columns[0].id);
}

function editorRemoveRow(tableId) {
    const table = $$(tableId);
    if (!table) return;
    const sel = table.getSelectedId();
    if (sel) table.remove(sel);
}

/// Live-recompute the Locations tab status label: "Total: N" with
/// a colored chip when the sum drifts from Part.stockLevel. Called
/// on every onAfterEditStop / onAfterAdd / row removal.
/// "Split / move" dialog for the part editor's Containers tab.
/// Pulls N pcs out of the selected row and inserts a new row with
/// the chosen Form / Storage / Lot. Net stock unchanged — this is
/// a re-labeling, not a stock event. Operator's typical workflow:
///   - "100 pcs show as loose but they're actually on a reel"
///     → split N=100 from Loose row into a new Reel row.
///   - "1200 pcs total, just moved 1000 onto a reel"
///     → split N=1000 from the Loose row, leaving 200 behind.
/// Saves on the part editor's Save button (we don't write to the
/// DB here — the operator can still cancel everything via the
/// dialog's Cancel).
function openSplitContainerDialog(seed, formOptions, storageOptions) {
    const grid = $$("pk-edit-locations");
    if (!grid) return;
    const sel = grid.getSelectedId();
    if (!sel) {
        webix.message({ type: "error", text: "Select a packaging row first." });
        return;
    }
    const src = grid.getItem(sel);
    const srcQty = parseInt(src.quantity, 10) || 0;
    if (srcQty <= 0) {
        webix.message({ type: "error", text: "Selected row has no quantity to move." });
        return;
    }

    const winId = "pk-split-container-dialog";
    if ($$(winId)) { $$(winId).destructor(); }

    const srcFormLabel = src.form || "Loose";
    const srcStorageLabel = (function () {
        if (!src.storage_location_id) return "(unset)";
        const m = (lookupsCache && lookupsCache.storage_locations || [])
            .find((s) => s.id == src.storage_location_id);
        return m ? m.name : `#${src.storage_location_id}`;
    })();

    webix.ui({
        view: "window",
        id: winId,
        modal: true,
        position: "center",
        width: 480,
        head: "Split / move packaging",
        body: {
            view: "form",
            id: "pk-split-container-form",
            elements: [
                {
                    view: "template", borderless: true, height: 50,
                    template:
                        `<div style="padding:6px 4px">` +
                        `<div style="font-size:13px;color:#6a7a8a">From:</div>` +
                        `<div style="font-size:14px"><b>${escapeHtml(srcFormLabel)}</b> · ` +
                        `${escapeHtml(srcStorageLabel)} · ` +
                        `qty <b>${srcQty}</b>` +
                        (src.lot_number ? ` · lot ${escapeHtml(src.lot_number)}` : "") +
                        `</div></div>`,
                },
                { view: "counter", name: "qty", label: "Move quantity", labelWidth: 130,
                  min: 1, max: srcQty, step: 1, value: srcQty },
                { view: "richselect", name: "form", label: "Into form", labelWidth: 130,
                  options: formOptions, value: src.form === "Reel" ? "Loose" : "Reel" },
                { view: "richselect", name: "storage_location_id", label: "Into storage", labelWidth: 130,
                  options: storageOptions,
                  value: src.storage_location_id || defaultStorageLocationId() },
                { view: "text", name: "lot_number", label: "Lot", labelWidth: 130,
                  value: src.lot_number || "" },
                { view: "text", name: "comment", label: "Comment", labelWidth: 130,
                  value: "" },
                {
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 100,
                          click: () => $$(winId) && $$(winId).destructor() },
                        { view: "button", value: "✓ Split", css: "pk-btn-add", width: 110,
                          hotkey: "enter",
                          click: () => doSplit() },
                    ],
                },
            ],
        },
    }).show();

    function doSplit() {
        const v = $$("pk-split-container-form").getValues();
        const n = parseInt(v.qty, 10);
        if (!Number.isFinite(n) || n <= 0 || n > srcQty) {
            webix.message({ type: "error", text: `Quantity must be 1..${srcQty}.` });
            return;
        }
        // Storage is optional now; null = unbinned. The form
        // schema (richselect over storageOptions which includes
        // an "(unbinned)" id=0 option) coerces empty selection
        // to null already.
        // 1. Subtract from source row (or remove entirely when N == srcQty).
        const remaining = srcQty - n;
        if (remaining === 0) {
            grid.remove(sel);
        } else {
            grid.updateItem(sel, { quantity: remaining });
        }
        // 2. Add a new row with the moved quantity.
        const storageId = parseInt(v.storage_location_id, 10);
        const newRow = {
            id: webix.uid(),
            form: v.form || "Loose",
            storage_location_id: storageId > 0 ? storageId : null,
            quantity: n,
            lot_number: (v.lot_number || "").trim(),
            comment: (v.comment || "").trim(),
        };
        grid.add(newRow);
        grid.select(newRow.id);
        updateLocationsTotal(seed);
        $$(winId) && $$(winId).destructor();
        webix.message({ type: "success", text: `Moved ${n} into ${newRow.form}` });
    }
}

/// Consume N units from a specific PartStorageLocation
/// row. Posts a negative-delta StockEntry with `part_storage_location_id`
/// set, which the backend uses to (a) decrement that PSL row's
/// quantity in the same transaction and (b) record traceability on
/// the StockEntry itself. Per the user's "warn-and-allow" memory,
/// over-consumption (qty > row.quantity) is permitted with a warning
/// — the operator may be reconciling against an actually-empty reel.
function openConsumeContainerDialog(part, row) {
    if (!part || !row) return;
    const winId = "pk-consume-container-dialog";
    if ($$(winId)) { $$(winId).destructor(); }
    const formLabel = row.form || "Loose";
    const storageLabel = row.storage_location_name || "(unset)";
    const onHand = row.quantity || 0;
    const lotBit = row.lot_number ? ` · lot ${escapeHtml(row.lot_number)}` : "";
    webix.ui({
        view: "window",
        id: winId,
        modal: true,
        position: "center",
        width: 460,
        head: `Consume from ${formLabel}`,
        body: {
            view: "form",
            id: "pk-consume-container-form",
            elements: [
                {
                    view: "template", borderless: true, height: 60,
                    template:
                        `<div style="padding:6px 4px">` +
                        `<div class="pk-dialog-part-name">${escapeHtml(part.name)}</div>` +
                        `<div class="pk-dialog-subtitle">` +
                        `<b>${escapeHtml(formLabel)}</b> · ${escapeHtml(storageLabel)} · ` +
                        `on hand <b>${onHand}</b>${lotBit}` +
                        `</div></div>`,
                },
                { view: "counter", name: "qty", label: "Consume quantity", labelWidth: 150,
                  min: 1, value: 1, step: 1 },
                { view: "textarea", name: "comment", label: "Comment", labelWidth: 150, height: 60 },
                {
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 100,
                          click: () => $$(winId) && $$(winId).destructor() },
                        { view: "button", value: "🔻 Consume", css: "pk-btn-remove", width: 130,
                          hotkey: "enter",
                          click: () => doConsume() },
                    ],
                },
            ],
        },
    }).show();

    async function doConsume() {
        const v = $$("pk-consume-container-form").getValues();
        const n = parseInt(v.qty, 10);
        if (!Number.isFinite(n) || n <= 0) {
            webix.message({ type: "error", text: "Quantity must be at least 1." });
            return;
        }
        if (n > onHand) {
            // Warn-and-allow: operator may be reconciling against
            // an actually-empty reel. Persist anyway.
            webix.message({ type: "warning",
                text: `Consuming ${n} from a row holding ${onHand} — quantity will go negative.` });
        }
        try {
            await api.addStockEntry(part.id, {
                stock_level: -n,
                comment: (v.comment || "").trim() || null,
                correction: false,
                part_storage_location_id: row.id,
            });
            $$(winId) && $$(winId).destructor();
            await loadPartDetail(part.id);
            await loadParts({});
            const grid = $$("pk-parts-grid");
            if (grid && grid.exists(part.id)) {
                grid.select(part.id);
                grid.showItem(part.id);
            }
            webix.message({ type: "success", text: `Consumed ${n} from ${formLabel}` });
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Consume failed: " + (e.message || e) });
        }
    }
}

function updateLocationsTotal(seed) {
    const grid = $$("pk-edit-locations");
    const status = $$("pk-edit-locations-status");
    if (!grid || !status) return;
    let sum = 0;
    grid.data.each((r) => { sum += parseInt(r.quantity, 10) || 0; });
    const stockLevel = seed && seed.stock_level != null ? seed.stock_level : 0;
    let html;
    if (sum === stockLevel) {
        html = `<span class="pk-stock-add">Total: <b>${sum}</b> · matches stock level</span>`;
    } else {
        const diff = sum - stockLevel;
        const sign = diff > 0 ? "+" : "";
        html = `<span class="pk-stock-remove">Total: <b>${sum}</b> ⚠ stock level = ${stockLevel} (off by ${sign}${diff})</span>`;
    }
    status.define("label", html);
    status.refresh();
}

// ============================================================
//  Common Parameters library — built-in EE template list
//
//  Each entry maps a familiar identifier (R, C, L, Vmax, etc.)
//  to a parameter shape: numeric vs string, unit symbol, default
//  prefix. Unit and prefix symbols are resolved against the
//  install's lookupsCache at insertion time — if the install
//  doesn't have a unit with that symbol the row falls back to
//  unit_id=null and the operator can pick one manually.
//
//  Library is additive — operators can also type free-form names
//  in the parameter editor; we never auto-detect or auto-type
//  parameters from a part's data because plenty of parts aren't
//  electrical.
// ============================================================

const COMMON_PARAMETERS = [
    // Passives — primary value
    { group: "Passives",      name: "C",          description: "Capacitance",           type: "numeric", unit: "F",  prefix: "μ"  },
    { group: "Passives",      name: "R",          description: "Resistance",            type: "numeric", unit: "Ω",  prefix: "k"  },
    { group: "Passives",      name: "L",          description: "Inductance",            type: "numeric", unit: "H",  prefix: "μ"  },
    { group: "Passives",      name: "Q",          description: "Quality factor",        type: "numeric", unit: "",   prefix: ""   },
    { group: "Passives",      name: "ESR",        description: "Equivalent series resistance", type: "numeric", unit: "Ω", prefix: "m" },
    // Voltage / current / power
    { group: "V/I/P",         name: "Vdc",        description: "DC voltage",            type: "numeric", unit: "V",  prefix: ""   },
    { group: "V/I/P",         name: "Vac",        description: "AC voltage (RMS)",      type: "numeric", unit: "V",  prefix: ""   },
    { group: "V/I/P",         name: "Vmax",       description: "Maximum voltage rating",type: "numeric", unit: "V",  prefix: ""   },
    { group: "V/I/P",         name: "Vf",         description: "Forward voltage",       type: "numeric", unit: "V",  prefix: ""   },
    { group: "V/I/P",         name: "Idc",        description: "DC current",            type: "numeric", unit: "A",  prefix: "m"  },
    { group: "V/I/P",         name: "Iac",        description: "AC current",            type: "numeric", unit: "A",  prefix: "m"  },
    { group: "V/I/P",         name: "Imax",       description: "Maximum current rating",type: "numeric", unit: "A",  prefix: "m"  },
    { group: "V/I/P",         name: "P",          description: "Power rating",          type: "numeric", unit: "W",  prefix: ""   },
    { group: "V/I/P",         name: "Rds(on)",    description: "FET on-state resistance",type:"numeric", unit: "Ω",  prefix: "m"  },
    // Frequency / timing
    { group: "Timing",        name: "f",          description: "Frequency",             type: "numeric", unit: "Hz", prefix: "M"  },
    { group: "Timing",        name: "fmin",       description: "Minimum frequency",     type: "numeric", unit: "Hz", prefix: "M"  },
    { group: "Timing",        name: "fmax",       description: "Maximum frequency",     type: "numeric", unit: "Hz", prefix: "M"  },
    { group: "Timing",        name: "tr",         description: "Rise time",             type: "numeric", unit: "s",  prefix: "n"  },
    { group: "Timing",        name: "tf",         description: "Fall time",             type: "numeric", unit: "s",  prefix: "n"  },
    // Temperature
    { group: "Temperature",   name: "Tmin",       description: "Min operating temperature", type: "numeric", unit: "°C", prefix: "" },
    { group: "Temperature",   name: "Tmax",       description: "Max operating temperature", type: "numeric", unit: "°C", prefix: "" },
    { group: "Temperature",   name: "Top",        description: "Operating temperature", type: "numeric", unit: "°C", prefix: ""   },
    // Tolerance
    { group: "Tolerance",     name: "Tol",        description: "Tolerance",             type: "numeric", unit: "%",  prefix: ""   },
    { group: "Tolerance",     name: "Tol+",       description: "Positive tolerance",    type: "numeric", unit: "%",  prefix: ""   },
    { group: "Tolerance",     name: "Tol-",       description: "Negative tolerance",    type: "numeric", unit: "%",  prefix: ""   },
    // Generic strings
    { group: "Generic",       name: "Package",    description: "Physical package",      type: "string"   },
    { group: "Generic",       name: "Dielectric", description: "Capacitor dielectric (X7R, NP0…)",  type: "string" },
    { group: "Generic",       name: "Material",   description: "Material",              type: "string"   },
    { group: "Generic",       name: "Color",      description: "Color",                 type: "string"   },
    { group: "Generic",       name: "Mount",      description: "Mount type (SMD / THT)",type: "string"   },
];

function commonParamLookupSymbol(list, sym) {
    if (!sym || !list) return null;
    const found = list.find((x) => x.symbol === sym);
    return found ? found.id : null;
}

/// Translate a COMMON_PARAMETERS entry to a row shape compatible
/// with the parameter / criteria editor datatables. Resolves
/// unit/prefix symbols against lookupsCache.
function commonParamToRow(entry) {
    const unit_id = entry.unit
        ? commonParamLookupSymbol(lookupsCache && lookupsCache.units, entry.unit)
        : null;
    const si_prefix_id = entry.prefix
        ? commonParamLookupSymbol(lookupsCache && lookupsCache.prefixes, entry.prefix)
        : null;
    return {
        id: webix.uid(),
        name: entry.name,
        description: entry.description || "",
        value_type: entry.type === "string" ? "string" : "numeric",
        value: "",
        string_value: "",
        unit_id: unit_id,
        si_prefix_id: si_prefix_id,
        // criteria editor adds an `op` column too — let
        // editorAddRow's per-call defaults supply that.
    };
}

/// Open the templates picker. `targetTableId` is the datatable
/// receiving new rows (pk-edit-params or pk-edit-criteria).
/// `extraDefaults` is merged into each new row (used by criteria
/// editor to set op="=").
function openCommonParamsDialog(targetTableId, extraDefaults) {
    // Lookups should already be loaded — the part editor
    // depends on them too. If not, surface the failure.
    if (!lookupsCache) {
        webix.message({ type: "error", text: "Lookup data not loaded yet." });
        return;
    }
    // Annotate each library entry with the live install's
    // unit/prefix labels so the operator can see what they'll
    // get — including the "(install lacks unit X)" case.
    const annotated = COMMON_PARAMETERS.map((p) => {
        let unitLabel = "—", unitOk = true;
        if (p.unit) {
            const u = lookupsCache.units.find((x) => x.symbol === p.unit);
            if (u) unitLabel = p.unit;
            else { unitLabel = `${p.unit} (missing)`; unitOk = false; }
        } else if (p.type === "string") {
            unitLabel = "(string)";
        }
        let prefLabel = "";
        if (p.prefix) {
            const pf = lookupsCache.prefixes.find((x) => x.symbol === p.prefix);
            prefLabel = pf ? p.prefix : `${p.prefix}?`;
        }
        return Object.assign({ id: "tpl_" + p.name, _ok: unitOk, _unit: unitLabel, _prefix: prefLabel }, p);
    });

    webix.ui({
        view: "window",
        id: "pk-common-params",
        modal: true,
        position: "center",
        width: 720,
        height: 540,
        head: "Common Parameter Templates",
        body: {
            rows: [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 40,
                    cols: [
                        { view: "label", label: "Filter:", width: 60, css: "pk-pane-title" },
                        {
                            view: "search",
                            id: "pk-common-params-filter",
                            placeholder: "name or description…",
                            width: 280,
                            on: {
                                onTimedKeyPress: function () {
                                    const q = (this.getValue() || "").toLowerCase().trim();
                                    const dt = $$("pk-common-params-grid");
                                    if (!dt) return;
                                    if (!q) { dt.filter(); return; }
                                    dt.filter((row) => {
                                        return (row.name || "").toLowerCase().includes(q)
                                            || (row.description || "").toLowerCase().includes(q)
                                            || (row.group || "").toLowerCase().includes(q);
                                    });
                                },
                            },
                        },
                        {},
                        { view: "label", label: '<span class="pk-help-hint">Ctrl/Shift+click for multi-select · "(missing)" = this install lacks that unit</span>' },
                    ],
                },
                {
                    view: "datatable",
                    id: "pk-common-params-grid",
                    css: "pk-grid",
                    select: "row",
                    multiselect: true,
                    data: annotated,
                    columns: [
                        { id: "group", header: "Group", width: 110 },
                        { id: "name", header: "Name", width: 100 },
                        { id: "description", header: "Description", fillspace: true },
                        { id: "type", header: "Type", width: 75 },
                        {
                            id: "_unit",
                            header: "Unit",
                            width: 110,
                            template: function (o) {
                                if (o._unit && o._unit.includes("missing")) {
                                    return `<span style="color:#b03030">${escapeHtml(o._unit)}</span>`;
                                }
                                return escapeHtml(o._unit || "");
                            },
                        },
                        { id: "_prefix", header: "Prefix", width: 70 },
                    ],
                },
                {
                    view: "toolbar",
                    css: "pk-dialog-actions",
                    height: 50,
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 100, click: () => $$("pk-common-params").close() },
                        {
                            view: "button",
                            value: "+ Add selected",
                            width: 160,
                            css: "pk-btn-add",
                            click: function () {
                                const dt = $$("pk-common-params-grid");
                                const sel = dt ? dt.getSelectedItem(true) : [];
                                const items = Array.isArray(sel) ? sel : (sel ? [sel] : []);
                                if (!items.length) {
                                    webix.message({ type: "error", text: "Select at least one row" });
                                    return;
                                }
                                const target = $$(targetTableId);
                                if (!target) return;
                                let added = 0;
                                for (const it of items) {
                                    const row = Object.assign(commonParamToRow(it), extraDefaults || {});
                                    target.add(row);
                                    added++;
                                }
                                $$("pk-common-params").close();
                                webix.message({ type: "success", text: `Added ${added} parameter${added === 1 ? "" : "s"}` });
                            },
                        },
                    ],
                },
            ],
        },
    }).show();
}


async function openPartEditor(mode, opts) {
    opts = opts || {};
    if ((mode === "edit" || mode === "duplicate") && !currentPart) {
        webix.message({ type: "error", text: "Select a part first." });
        return;
    }

    let lookups;
    try {
        lookups = await ensureLookups();
    } catch (e) {
        webix.message({ type: "error", text: "Failed to load lookups: " + (e.message || e) });
        return;
    }

    const categoryOptions = flattenCategoryTree(lookups.categories_tree);
    const footprintOptions = lookups.footprints.map((f) => ({ id: f.id, value: f.name }));
    // Storage locations from cache. Operator convention is to use
    // a "(NOWHERE)" bin as the catch-all for not-yet-placed parts;
    // defaultStorageLocationId() returns its id.
    const storageOptions = lookups.storage_locations.map((s) => ({ id: s.id, value: s.name }));
    const partUnitOptions = lookups.part_units.map((u) => ({
        id: u.id, value: u.name + (u.short_name ? ` (${u.short_name})` : ""),
    }));

    // Seed values:
    //   edit       — start from currentPart, save via PUT
    //   new        — blank (or {meta_part: true} when opts.metaPart)
    //   duplicate  — copy of currentPart, name gets " (copy)" suffix,
    //                save via POST so a new id is assigned
    let seed;
    if (mode === "edit") {
        seed = currentPart;
    } else if (mode === "duplicate") {
        seed = Object.assign({}, currentPart, {
            name: (currentPart.name || "") + " (copy)",
            internal_part_number: "",
        });
    } else {
        seed = opts.metaPart ? { meta_part: true } : {};
    }

    // Sub-table seed rows (W4.3). Webix datatable rows need a stable
    // local id; we mint one with webix.uid() so add/remove works
    // even before the row has a server-side id.
    const mfgRows = (seed.manufacturers || []).map((m) => ({
        id: webix.uid(),
        manufacturer_id: m.manufacturer_id,
        part_number: m.part_number || "",
    }));
    const distRows = (seed.distributors || []).map((d) => ({
        id: webix.uid(),
        distributor_id: d.distributor_id,
        order_number: d.order_number || "",
        price: d.price != null ? String(d.price) : "",
        currency: d.currency || "",
        sku: d.sku || "",
        packaging_unit: d.packaging_unit != null ? d.packaging_unit : 1,
        ignore_for_reports: !!d.ignore_for_reports,
    }));
    const paramRows = (seed.parameters || []).map((p) => ({
        id: webix.uid(),
        name: p.name || "",
        description: p.description || "",
        value_type: p.value_type || "numeric",
        value: p.value != null ? String(p.value) : "",
        string_value: p.string_value || "",
        unit_id: p.unit_id || null,
        si_prefix_id: p.si_prefix_id || null,
    }));
    const criteriaRows = (seed.criteria || []).map((c) => ({
        id: webix.uid(),
        name: c.name || "",
        op: c.op || "=",
        value_type: c.value_type || "numeric",
        value: c.value != null ? String(c.value) : "",
        string_value: c.string_value || "",
        unit_id: c.unit_id || null,
        si_prefix_id: c.si_prefix_id || null,
    }));
    const locationRows = (seed.locations || []).map((l) => ({
        id: webix.uid(),
        form: l.form || "Loose",
        storage_location_id: l.storage_location_id || null,
        quantity: l.quantity != null ? String(l.quantity) : "0",
        lot_number: l.lot_number || "",
        comment: l.comment || "",
    }));

    const mfgOptions = lookups.manufacturers.map((m) => ({ id: m.id, value: m.name }));
    const distOptions = lookups.distributors.map((d) => ({ id: d.id, value: d.name }));
    const unitOptions = [{ id: "", value: "(none)" }].concat(
        lookups.units.map((u) => ({ id: u.id, value: u.name + " (" + u.symbol + ")" }))
    );
    const prefixOptions = [{ id: "", value: "(none)" }].concat(
        lookups.prefixes.map((p) => ({ id: p.id, value: p.symbol + " — " + p.prefix }))
    );
    const valueTypeOptions = [{ id: "numeric", value: "numeric" }, { id: "string", value: "string" }];
    // Multi-location form enum — mirrors backend VALID_FORMS in
    // handlers/part_locations.rs.
    const formOptions = [
        { id: "Loose",    value: "Loose" },
        { id: "Reel",     value: "Reel" },
        { id: "CutTape",  value: "CutTape" },
        { id: "Tray",     value: "Tray" },
        { id: "Tube",     value: "Tube" },
        { id: "Feeder",   value: "Feeder" },
        { id: "Bag",      value: "Bag" },
        { id: "Other",    value: "Other" },
    ];
    // (storageOptions already defined above for the part-level field)
    const storageLocNameById = new Map(lookups.storage_locations.map((s) => [String(s.id), s.name]));
    const opOptions = [
        { id: "=", value: "=" },
        { id: "!=", value: "≠" },
        { id: "<", value: "<" },
        { id: "<=", value: "≤" },
        { id: ">", value: ">" },
        { id: ">=", value: "≥" },
        { id: "like", value: "like" },
    ];

    // Pre-built lookup maps keyed by stringified id — Webix's richselect
    // editor returns the option's id back into the row, but the type
    // (string vs number) is not stable across edits. Doing String(...)
    // on both sides of the lookup makes the cell render reliably.
    const mfgNameById = new Map(lookups.manufacturers.map((m) => [String(m.id), m.name]));
    const distNameById = new Map(lookups.distributors.map((d) => [String(d.id), d.name]));
    const unitLabelById = new Map(lookups.units.map((u) => [String(u.id), u.name + " (" + u.symbol + ")"]));
    const prefixSymbolById = new Map(lookups.prefixes.map((p) => [String(p.id), p.symbol]));

    const initial = {
        name: seed.name || "",
        description: seed.description || "",
        internal_part_number: seed.internal_part_number || "",
        comment: seed.comment || "",
        category_id: seed.category_id || (categoryOptions[0] && categoryOptions[0].id) || null,
        footprint_id: seed.footprint_id || null,
        storage_location_id: seed.storage_location_id || null,
        part_unit_id: seed.part_unit_id || (partUnitOptions[0] && partUnitOptions[0].id) || null,
        min_stock_level: seed.min_stock_level || 0,
        status: seed.status || "",
        part_condition: seed.part_condition || "",
        production_remarks: seed.production_remarks || "",
        needs_review: !!seed.needs_review,
        meta_part: !!seed.meta_part,
    };

    const titleText =
        mode === "edit" ? `Edit part: ${escapeHtml(seed.name)}` :
        mode === "duplicate" ? `Duplicate from: ${escapeHtml(currentPart.name)}` :
        opts.metaPart ? "New meta-part" :
        "New part";

    webix.ui({
        view: "window",
        id: "pk-editor",
        modal: true,
        position: "center",
        width: 820,
        height: 620,
        css: "pk-editor-window",
        head: titleText,
        body: {
            view: "form",
            id: "pk-editor-form",
            elements: [
                {
                    view: "tabview",
                    cells: [
                        {
                            header: "Identity",
                            body: {
                                rows: [
                                    { view: "text", name: "name", label: "Name", labelWidth: 130, required: true },
                                    { view: "text", name: "internal_part_number", label: "IPN", labelWidth: 130 },
                                    { view: "textarea", name: "description", label: "Description", labelWidth: 130, height: 60 },
                                    { view: "textarea", name: "comment", label: "Comment", labelWidth: 130, height: 60 },
                                    { view: "text", name: "status", label: "Status", labelWidth: 130 },
                                    { view: "text", name: "part_condition", label: "Condition", labelWidth: 130 },
                                    { view: "textarea", name: "production_remarks", label: "Production remarks", labelWidth: 130, height: 50 },
                                    {
                                        cols: [
                                            { view: "checkbox", name: "needs_review", labelRight: "Needs review", labelWidth: 130, width: 280 },
                                            { view: "checkbox", name: "meta_part", labelRight: "Meta-part", labelWidth: 0, width: 200 },
                                            {},
                                        ],
                                    },
                                ],
                            },
                        },
                        {
                            header: "Classification",
                            body: {
                                rows: [
                                    {
                                        view: "richselect",
                                        name: "category_id",
                                        label: "Category",
                                        labelWidth: 130,
                                        options: { data: categoryOptions, body: { template: categoryOptionTemplate } },
                                    },
                                    {
                                        view: "richselect",
                                        name: "footprint_id",
                                        label: "Footprint",
                                        labelWidth: 130,
                                        options: footprintOptions,
                                    },
                                    {
                                        view: "richselect",
                                        name: "storage_location_id",
                                        label: "Storage location",
                                        labelWidth: 130,
                                        options: storageOptions,
                                    },
                                    {
                                        view: "richselect",
                                        name: "part_unit_id",
                                        label: "Part unit",
                                        labelWidth: 130,
                                        options: partUnitOptions,
                                    },
                                    { view: "counter", name: "min_stock_level", label: "Min stock", labelWidth: 130, value: 0, min: 0 },
                                    {},
                                ],
                            },
                        },
                        {
                            header: "Manufacturers",
                            body: {
                                rows: [
                                    {
                                        view: "toolbar",
                                        css: "pk-pane-toolbar",
                                        height: 32,
                                        cols: [
                                            { view: "button", value: "+ Add row", css: "pk-btn-add", width: 100, click: () => editorAddRow("pk-edit-mfgs") },
                                            { view: "button", value: "− Remove selected", css: "pk-btn-remove", width: 160, click: () => editorRemoveRow("pk-edit-mfgs") },
                                            {},
                                        ],
                                    },
                                    {
                                        view: "datatable",
                                        id: "pk-edit-mfgs",
                                        editable: true,
                                        editaction: "click",
                                        select: "row",
                                        data: mfgRows,
                                        columns: [
                                            {
                                                id: "manufacturer_id",
                                                header: "Manufacturer",
                                                width: 280,
                                                editor: "richselect",
                                                options: mfgOptions,
                                                template: function (o) {
                                                    const name = mfgNameById.get(String(o.manufacturer_id));
                                                    return name ? escapeHtml(name) : '<span class="pk-pick-prompt">— pick —</span>';
                                                },
                                            },
                                            { id: "part_number", header: "MPN", fillspace: true, editor: "text" },
                                        ],
                                    },
                                ],
                            },
                        },
                        {
                            header: "Distributors",
                            body: {
                                rows: [
                                    {
                                        view: "toolbar",
                                        css: "pk-pane-toolbar",
                                        height: 32,
                                        cols: [
                                            { view: "button", value: "+ Add row", css: "pk-btn-add", width: 100, click: () => editorAddRow("pk-edit-dists", { packaging_unit: 1 }) },
                                            { view: "button", value: "− Remove selected", css: "pk-btn-remove", width: 160, click: () => editorRemoveRow("pk-edit-dists") },
                                            {},
                                        ],
                                    },
                                    {
                                        view: "datatable",
                                        id: "pk-edit-dists",
                                        editable: true,
                                        editaction: "click",
                                        select: "row",
                                        data: distRows,
                                        columns: [
                                            {
                                                id: "distributor_id",
                                                header: "Distributor",
                                                width: 200,
                                                editor: "richselect",
                                                options: distOptions,
                                                template: function (o) {
                                                    const name = distNameById.get(String(o.distributor_id));
                                                    return name ? escapeHtml(name) : '<span class="pk-pick-prompt">— pick —</span>';
                                                },
                                            },
                                            { id: "order_number", header: "Order #", width: 130, editor: "text" },
                                            { id: "price", header: "Price", width: 80, editor: "text", css: "pk-numeric" },
                                            { id: "currency", header: "Cur", width: 60, editor: "text" },
                                            { id: "sku", header: "SKU", width: 100, editor: "text" },
                                            { id: "packaging_unit", header: "Pkg", width: 70, editor: "text", css: "pk-numeric" },
                                            {
                                                id: "ignore_for_reports",
                                                header: "Skip",
                                                width: 50,
                                                template: "{common.checkbox()}",
                                                checkValue: true,
                                                uncheckValue: false,
                                            },
                                        ],
                                        on: {
                                            onCheck: function (rowId, _colId, state) {
                                                const row = this.getItem(rowId);
                                                if (row) row.ignore_for_reports = state;
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                        {
                            header: "Criteria",
                            body: {
                                rows: [
                                    {
                                        view: "toolbar",
                                        css: "pk-pane-toolbar",
                                        height: 32,
                                        cols: [
                                            { view: "button", value: "+ Add row", css: "pk-btn-add", width: 100, click: () => editorAddRow("pk-edit-criteria", { value_type: "numeric", op: "=" }) },
                                            { view: "button", value: "📋 Templates", width: 110, click: () => openCommonParamsDialog("pk-edit-criteria", { op: "=" }) },
                                            { view: "button", value: "− Remove selected", css: "pk-btn-remove", width: 160, click: () => editorRemoveRow("pk-edit-criteria") },
                                            {},
                                            { view: "label", label: '<span class="pk-help-hint">Match real parts whose parameters satisfy ALL these predicates · only used when "Meta-part" is checked</span>' },
                                        ],
                                    },
                                    {
                                        view: "datatable",
                                        id: "pk-edit-criteria",
                                        editable: true,
                                        editaction: "click",
                                        select: "row",
                                        data: criteriaRows,
                                        columns: [
                                            { id: "name", header: "Parameter", width: 160, editor: "text" },
                                            {
                                                id: "op",
                                                header: "Op",
                                                width: 70,
                                                editor: "richselect",
                                                options: opOptions,
                                            },
                                            {
                                                id: "value_type",
                                                header: "Type",
                                                width: 90,
                                                editor: "richselect",
                                                options: valueTypeOptions,
                                            },
                                            { id: "value", header: "Value", width: 90, editor: "text", css: "pk-numeric" },
                                            {
                                                id: "si_prefix_id",
                                                header: "Prefix",
                                                width: 100,
                                                editor: "richselect",
                                                options: prefixOptions,
                                                template: function (o) {
                                                    if (!o.si_prefix_id) return "";
                                                    const sym = prefixSymbolById.get(String(o.si_prefix_id));
                                                    return sym ? escapeHtml(sym) : "";
                                                },
                                            },
                                            {
                                                id: "unit_id",
                                                header: "Unit",
                                                width: 130,
                                                editor: "richselect",
                                                options: unitOptions,
                                                template: function (o) {
                                                    if (!o.unit_id) return "";
                                                    const label = unitLabelById.get(String(o.unit_id));
                                                    return label ? escapeHtml(label) : "";
                                                },
                                            },
                                            { id: "string_value", header: "String value", fillspace: true, editor: "text" },
                                        ],
                                    },
                                ],
                            },
                        },
                        {
                            header: "Attachments",
                            body: buildAttachmentsSection({
                                tableId: "pk-edit-attachments",
                                uploaderId: "pk-edit-attachments-uploader",
                                kind: "PartAttachment",
                                getParentId: () => (mode === "edit" && currentPart ? currentPart.id : null),
                            }),
                        },
                        {
                            header: "Parameters",
                            body: {
                                rows: [
                                    {
                                        view: "toolbar",
                                        css: "pk-pane-toolbar",
                                        height: 32,
                                        cols: [
                                            { view: "button", value: "+ Add row", css: "pk-btn-add", width: 100, click: () => editorAddRow("pk-edit-params", { value_type: "numeric" }) },
                                            { view: "button", value: "📋 Templates", width: 110, click: () => openCommonParamsDialog("pk-edit-params") },
                                            { view: "button", value: "− Remove selected", css: "pk-btn-remove", width: 160, click: () => editorRemoveRow("pk-edit-params") },
                                            {},
                                            { view: "label", label: '<span class="pk-help-hint">Numeric: fill Value + Unit + Prefix · String: fill String value</span>' },
                                        ],
                                    },
                                    {
                                        view: "datatable",
                                        id: "pk-edit-params",
                                        editable: true,
                                        editaction: "click",
                                        select: "row",
                                        data: paramRows,
                                        columns: [
                                            { id: "name", header: "Name", width: 160, editor: "text" },
                                            {
                                                id: "value_type",
                                                header: "Type",
                                                width: 90,
                                                editor: "richselect",
                                                options: valueTypeOptions,
                                            },
                                            { id: "value", header: "Value", width: 100, editor: "text", css: "pk-numeric" },
                                            {
                                                id: "si_prefix_id",
                                                header: "Prefix",
                                                width: 110,
                                                editor: "richselect",
                                                options: prefixOptions,
                                                template: function (o) {
                                                    if (!o.si_prefix_id) return "";
                                                    const sym = prefixSymbolById.get(String(o.si_prefix_id));
                                                    return sym ? escapeHtml(sym) : "";
                                                },
                                            },
                                            {
                                                id: "unit_id",
                                                header: "Unit",
                                                width: 130,
                                                editor: "richselect",
                                                options: unitOptions,
                                                template: function (o) {
                                                    if (!o.unit_id) return "";
                                                    const label = unitLabelById.get(String(o.unit_id));
                                                    return label ? escapeHtml(label) : "";
                                                },
                                            },
                                            { id: "string_value", header: "String value", fillspace: true, editor: "text" },
                                        ],
                                    },
                                ],
                            },
                        },
                        {
                            header: "Packaging",
                            body: {
                                rows: [
                                    {
                                        view: "toolbar",
                                        css: "pk-pane-toolbar",
                                        height: 32,
                                        cols: [
                                            { view: "button", value: "+ Add row", css: "pk-btn-add", width: 100,
                                              click: () => editorAddRow("pk-edit-locations", { form: "Loose", quantity: "0" }) },
                                            { view: "button", value: "⇄ Split / move", width: 130,
                                              tooltip: "Take N pcs out of the selected packaging and move them into a new packaging entry with a different form (e.g., 1000 pcs from Loose → Reel). Total stock is unchanged.",
                                              click: () => openSplitContainerDialog(seed, formOptions, storageOptions) },
                                            { view: "button", value: "− Remove selected", css: "pk-btn-remove", width: 160,
                                              click: () => { editorRemoveRow("pk-edit-locations"); updateLocationsTotal(seed); } },
                                            {},
                                            { view: "label", id: "pk-edit-locations-status", label: "" },
                                        ],
                                    },
                                    {
                                        view: "datatable",
                                        id: "pk-edit-locations",
                                        editable: true,
                                        editaction: "click",
                                        select: "row",
                                        data: locationRows,
                                        on: {
                                            onBeforeEditStart: function (state) {
                                                if (state && state.row) this.select(state.row);
                                            },
                                            onAfterEditStop: function () { updateLocationsTotal(seed); },
                                            onAfterAdd: function () { updateLocationsTotal(seed); },
                                        },
                                        columns: [
                                            {
                                                id: "form", header: "Form", width: 110,
                                                editor: "richselect",
                                                options: formOptions,
                                            },
                                            { id: "quantity", header: { text: "Qty", css: "pk-th-numeric" },
                                              width: 80, css: "pk-numeric", editor: "text" },
                                            {
                                                id: "storage_location_id", header: "Where", fillspace: true,
                                                editor: "richselect",
                                                options: storageOptions,
                                                template: function (o) {
                                                    if (!o.storage_location_id) return "";
                                                    const name = storageLocNameById.get(String(o.storage_location_id));
                                                    return name ? escapeHtml(name) : "";
                                                },
                                            },
                                            // lot_number + comment are still on the row data and saved by
                                            // the scan-receive flow, but not editable from this grid —
                                            // keeps the row tight. The detail panel doesn't show them
                                            // either; full traceability lives on the StockEntry / Receipts
                                            // history.
                                        ],
                                    },
                                ],
                            },
                        },
                        {
                            header: "Receipts",
                            body: {
                                rows: [
                                    {
                                        view: "toolbar",
                                        css: "pk-pane-toolbar",
                                        height: 32,
                                        cols: [
                                            { view: "label", id: "pk-edit-receipts-status",
                                              label: "Stock receipts attributed to a distributor sales order.", css: "pk-help-hint" },
                                            {},
                                        ],
                                    },
                                    {
                                        view: "datatable",
                                        id: "pk-edit-receipts",
                                        editable: false,
                                        select: false,
                                        data: [],
                                        columns: [
                                            { id: "distributor_name", header: "Distributor", width: 130 },
                                            { id: "sales_order_number", header: "SO #", width: 140 },
                                            { id: "units_added", header: { text: "Units", css: "pk-th-numeric" },
                                              width: 90, css: "pk-numeric",
                                              template: (o) => "+" + o.units_added },
                                            { id: "_unit_price", header: { text: "Unit price", css: "pk-th-numeric" },
                                              width: 130, css: "pk-numeric",
                                              template: function (o) {
                                                  if (!o.avg_unit_price) return "";
                                                  return escapeHtml(o.avg_unit_price + " " + (o.currency || ""));
                                              } },
                                            { id: "_last_date", header: "Last received", width: 130,
                                              template: (o) => (o.last_date || "").substring(0, 10) },
                                            { id: "entry_count", header: { text: "Entries", css: "pk-th-numeric" },
                                              width: 90, css: "pk-numeric" },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                },
                {
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 100, click: () => $$("pk-editor").close() },
                        {
                            view: "button",
                            value: mode === "edit" ? "Save" : "Create",
                            width: 110,
                            css: mode === "edit" ? "webix_primary" : "pk-btn-add",
                            hotkey: "ctrl+s",
                            click: () => submitPartEditor(mode === "edit" ? "edit" : "new"),
                        },
                    ],
                },
            ],
        },
    }).show();
    $$("pk-editor-form").setValues(initial);

    // Initial render of the Locations status label (sum vs stockLevel).
    setTimeout(() => updateLocationsTotal(seed), 0);

    // Populate the Attachments tab — only meaningful when editing
    // an existing part (new-mode parts have no id yet).
    if (mode === "edit" && currentPart) {
        refreshAttachments({
            tableId: "pk-edit-attachments",
            kind: "PartAttachment",
            getParentId: () => currentPart.id,
        });
        // Receipts tab is read-only; populate from the same endpoint
        // the part-detail panel uses.
        (async () => {
            try {
                const receipts = await api.partReceipts(currentPart.id);
                const grid = $$("pk-edit-receipts");
                if (grid) {
                    grid.clearAll();
                    grid.parse((receipts || []).map((r, i) => Object.assign({ id: i + 1 }, r)));
                }
                const status = $$("pk-edit-receipts-status");
                if (status) {
                    const n = (receipts || []).length;
                    const txt = n
                        ? `${n} order${n === 1 ? "" : "s"} contributed to this part's stock.`
                        : "No distributor-attributed receipts yet. Use the 📦 Receive DK Order button on the parts grid to import an order.";
                    status.define("label", txt);
                    status.refresh();
                }
            } catch (e) {
                console.warn("part receipts load failed:", e);
            }
        })();
    }
}

async function submitPartEditor(mode) {
    const form = $$("pk-editor-form");
    if (!form.validate()) {
        webix.message({ type: "error", text: "Name is required." });
        return;
    }
    const v = form.getValues();
    // Coerce richselect ids to int, empty strings to null.
    const idOrNull = (x) => (x === "" || x == null ? null : parseInt(x, 10));
    const body = {
        name: v.name.trim(),
        description: (v.description || "").trim() || null,
        internal_part_number: (v.internal_part_number || "").trim() || null,
        comment: (v.comment || "").trim(),
        status: (v.status || "").trim() || null,
        part_condition: (v.part_condition || "").trim() || null,
        production_remarks: (v.production_remarks || "").trim() || null,
        needs_review: !!v.needs_review,
        meta_part: !!v.meta_part,
        min_stock_level: parseInt(v.min_stock_level, 10) || 0,
        category_id: idOrNull(v.category_id),
        footprint_id: idOrNull(v.footprint_id),
        storage_location_id: idOrNull(v.storage_location_id),
        part_unit_id: idOrNull(v.part_unit_id),
    };

    // Sub-tables: gather rows. Drop rows missing a required FK
    // (manufacturer_id / distributor_id / param name) so half-typed
    // rows don't poison the save.
    const mfgGrid = $$("pk-edit-mfgs");
    body.manufacturers = mfgGrid
        ? mfgGrid.serialize()
            .filter((r) => r.manufacturer_id)
            .map((r) => ({
                manufacturer_id: parseInt(r.manufacturer_id, 10),
                part_number: (r.part_number || "").trim() || null,
            }))
        : [];
    const distGrid = $$("pk-edit-dists");
    body.distributors = distGrid
        ? distGrid.serialize()
            .filter((r) => r.distributor_id)
            .map((r) => ({
                distributor_id: parseInt(r.distributor_id, 10),
                order_number: (r.order_number || "").trim() || null,
                price: r.price !== "" && r.price != null ? String(r.price) : null,
                currency: (r.currency || "").trim() || null,
                sku: (r.sku || "").trim() || null,
                packaging_unit: parseInt(r.packaging_unit, 10) || 1,
                ignore_for_reports: !!r.ignore_for_reports,
            }))
        : [];
    const paramGrid = $$("pk-edit-params");
    body.parameters = paramGrid
        ? paramGrid.serialize()
            .filter((r) => (r.name || "").trim())
            .map((r) => ({
                name: r.name.trim(),
                description: (r.description || "").trim(),
                value_type: r.value_type === "string" ? "string" : "numeric",
                value: r.value !== "" && r.value != null && !isNaN(parseFloat(r.value))
                    ? parseFloat(r.value)
                    : null,
                string_value: (r.string_value || "").trim(),
                minimum_value: null,
                maximum_value: null,
                unit_id: r.unit_id ? parseInt(r.unit_id, 10) : null,
                si_prefix_id: r.si_prefix_id ? parseInt(r.si_prefix_id, 10) : null,
                min_si_prefix_id: null,
                max_si_prefix_id: null,
            }))
        : [];
    const criteriaGrid = $$("pk-edit-criteria");
    body.criteria = criteriaGrid
        ? criteriaGrid.serialize()
            .filter((r) => (r.name || "").trim())
            .map((r) => ({
                name: r.name.trim(),
                op: r.op || "=",
                value_type: r.value_type === "string" ? "string" : "numeric",
                value: r.value !== "" && r.value != null && !isNaN(parseFloat(r.value))
                    ? parseFloat(r.value)
                    : null,
                string_value: (r.string_value || "").trim() || null,
                unit_id: r.unit_id ? parseInt(r.unit_id, 10) : null,
                si_prefix_id: r.si_prefix_id ? parseInt(r.si_prefix_id, 10) : null,
            }))
        : [];
    const locationsGrid = $$("pk-edit-locations");
    body.locations = locationsGrid
        ? locationsGrid.serialize()
            // Drop only abandoned / empty rows. (unassigned) storage
            // is a legitimate state now (null storageLocation_id), so
            // we no longer require it. The bar for "real row": a form
            // is set AND quantity > 0, OR a lot/comment was filled in.
            .filter((r) => {
                const qty = parseInt(r.quantity, 10) || 0;
                const lot = (r.lot_number || "").trim();
                const cmt = (r.comment || "").trim();
                return (r.form && qty > 0) || lot || cmt;
            })
            .map((r) => {
                const sid = parseInt(r.storage_location_id, 10);
                return {
                    // null = "(unassigned)" — schema column is now nullable.
                    storage_location_id: Number.isFinite(sid) && sid > 0 ? sid : null,
                    form: r.form || "Loose",
                    quantity: parseInt(r.quantity, 10) || 0,
                    lot_number: (r.lot_number || "").trim() || null,
                    comment: (r.comment || "").trim() || null,
                };
            })
        : [];
    try {
        let savedId;
        if (mode === "edit") {
            await api.updatePart(currentPart.id, body);
            savedId = currentPart.id;
        } else {
            const result = await api.createPart(body);
            savedId = result.id;
        }
        $$("pk-editor").close();
        await loadParts({});
        // Re-select the saved part so detail refreshes too.
        const grid = $$("pk-parts-grid");
        if (grid && savedId != null && grid.exists(savedId)) {
            grid.select(savedId);
            grid.showItem(savedId);
        } else if (savedId != null) {
            await loadPartDetail(savedId);
        }
        webix.message({ text: mode === "edit" ? "Part saved" : "Part created", type: "success" });
    } catch (e) {
        console.error(e);
        webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
    }
}

