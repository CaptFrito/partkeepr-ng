// SPDX-License-Identifier: GPL-3.0-or-later
//
// Modal dialogs that aren't tightly coupled to the parts grid:
//   - Stock dialog (add / remove / reconcile)
//   - Label printing (Brother PT-D410 via ptouch-print)
//   - Distributor lookup dialog (Mouser + Digi-Key search/import)
//   - Receive Order dialog (DK + Mouser, partial-shipment aware)
//
// Loaded after api.js, before app.js. Each dialog declares its
// open* entry function at script-tag global scope so callers in
// app.js / trees.js / etc. can invoke them by name.

"use strict";

// ============================================================
//  Stock dialog (add / remove / reconcile)
// ============================================================

async function openStockDialog(mode) {
    if (!currentPart) return;
    // Make sure distributor / storage_location caches are loaded
    // before we render — richselect popups won't have data
    // otherwise.
    try { await ensureLookups(); }
    catch (e) {
        webix.message({ type: "error", text: "Failed to load lookups: " + (e.message || e) });
        return;
    }
    const titles = { add: "Add stock", remove: "Remove stock", reconcile: "Reconcile stock" };
    const subtitle =
        `<div class="pk-dialog-subtitle">` +
        `On hand: <b>${currentPart.stock_level}</b>` +
        (currentPart.average_price && parseFloat(currentPart.average_price) > 0
            ? ` &middot; Avg price: <b>${escapeHtml(currentPart.average_price)}</b>`
            : "") +
        `</div>`;

    const elements = [
        {
            view: "template",
            template:
                `<div class="pk-dialog-part-name">${escapeHtml(currentPart.name)}</div>` +
                subtitle,
            height: 50,
            borderless: true,
            css: "pk-dialog-header",
        },
    ];

    if (mode === "reconcile") {
        elements.push({
            view: "counter",
            id: "pk-stock-target",
            label: "New on-hand total",
            labelWidth: 150,
            value: currentPart.stock_level,
            step: 1,
        });
    } else {
        elements.push({
            view: "counter",
            id: "pk-stock-qty",
            label: mode === "add" ? "Add quantity" : "Remove quantity",
            labelWidth: 150,
            value: 1,
            min: 1,
            step: 1,
        });
    }

    if (mode === "add") {
        elements.push({
            view: "text",
            id: "pk-stock-price",
            label: "Price (per piece)",
            labelWidth: 150,
            value: currentPart.average_price || "",
        });
        // Optional distributor + SO# attribution. Populates the
        // structured StockEntry.(distributor_id, salesOrderNumber)
        // columns so this receipt shows up in the part's Receipts
        // tab. Universally useful — Mouser, Newark, Arrow, surplus,
        // any vendor without an API integration.
        const distOptions = [{ id: 0, value: "— none —" }].concat(
            ((lookupsCache && lookupsCache.distributors) || [])
                .map((d) => ({ id: d.id, value: d.name }))
        );
        // Default: when the part has exactly one PartDistributor
        // row, preselect that distributor — most-likely guess.
        const defaultDistId = (currentPart.distributors && currentPart.distributors.length === 1)
            ? currentPart.distributors[0].distributor_id : 0;
        elements.push({
            view: "richselect",
            id: "pk-stock-dist",
            label: "Distributor",
            labelWidth: 150,
            value: defaultDistId,
            options: distOptions,
        });
        elements.push({
            view: "text",
            id: "pk-stock-so",
            label: "Sales order #",
            labelWidth: 150,
            value: "",
            placeholder: "Optional. Enables Receipts tracking.",
        });
        // Optional Container fields. Off by default; toggling on
        // creates a fresh PartStorageLocation row alongside the
        // StockEntry — same as the scan-receive flow.
        elements.push({
            view: "checkbox", id: "pk-stock-container-toggle",
            labelRight: "Add a packaging entry (reel, strip, …)",
            labelWidth: 150, label: "",
            on: {
                onChange: function (newVal) {
                    // disable rather than hide — webix richselect
                    // popups don't always re-init cleanly after
                    // hide()/show(), which would leave the storage
                    // dropdown unresponsive.
                    ["pk-stock-form", "pk-stock-storage", "pk-stock-lot", "pk-stock-date"]
                        .forEach((id) => {
                            const v = $$(id);
                            if (!v) return;
                            if (newVal) v.enable(); else v.disable();
                        });
                },
            },
        });
        const formOpts = SCAN_FORM_OPTIONS.slice();  // Reel/CutTape/Loose/...
        const storageOpts = (lookupsCache && lookupsCache.storage_locations || [])
            .map((s) => ({ id: s.id, value: s.name }));
        // Default storage = part's primary location if set, else
        // the operator's "(NOWHERE)"-style catch-all bin.
        const defaultStorage = (currentPart.storage_location_id
            && storageOpts.some((s) => s.id === currentPart.storage_location_id))
            ? currentPart.storage_location_id
            : defaultStorageLocationId();
        elements.push({
            view: "richselect", id: "pk-stock-form", label: "Form", labelWidth: 150,
            disabled: true, options: formOpts, value: "Loose",
        });
        elements.push({
            view: "richselect", id: "pk-stock-storage", label: "Storage", labelWidth: 150,
            disabled: true, options: storageOpts, value: defaultStorage,
        });
        elements.push({
            view: "text", id: "pk-stock-lot", label: "Lot", labelWidth: 150,
            disabled: true, value: "",
        });
        elements.push({
            view: "text", id: "pk-stock-date", label: "Date code", labelWidth: 150,
            disabled: true, value: "",
        });
    }

    elements.push({
        view: "textarea",
        id: "pk-stock-comment",
        label: "Comment",
        labelWidth: 150,
        height: 60,
    });

    elements.push({
        cols: [
            {},
            {
                view: "button",
                value: "Cancel",
                width: 90,
                click: () => $$("pk-stock-dialog").close(),
            },
            {
                view: "button",
                value: "Save",
                width: 90,
                css:
                    mode === "add" ? "pk-btn-add" :
                    mode === "remove" ? "pk-btn-remove" :
                    "webix_primary",
                hotkey: "enter",
                click: () => submitStock(mode),
            },
        ],
    });

    webix.ui({
        view: "window",
        id: "pk-stock-dialog",
        modal: true,
        position: "center",
        width: 440,
        head: titles[mode],
        css: "pk-stock-dialog",
        body: { view: "form", id: "pk-stock-form", elements },
    }).show();
}

async function submitStock(mode) {
    if (!currentPart) return;
    const partId = currentPart.id;
    let body;

    if (mode === "reconcile") {
        const target = $$("pk-stock-target").getValue();
        const delta = target - currentPart.stock_level;
        if (delta === 0) {
            webix.message({ type: "error", text: "Target equals current level — nothing to reconcile." });
            return;
        }
        body = {
            stock_level: delta,
            comment: $$("pk-stock-comment").getValue() || null,
            correction: true,
        };
    } else {
        const qty = $$("pk-stock-qty").getValue();
        if (qty <= 0) {
            webix.message({ type: "error", text: "Quantity must be at least 1." });
            return;
        }
        body = {
            stock_level: mode === "add" ? qty : -qty,
            comment: $$("pk-stock-comment").getValue() || null,
            correction: false,
        };
        if (mode === "add") {
            const price = $$("pk-stock-price").getValue();
            if (price && parseFloat(price) >= 0) body.price = price;
            const dist = parseInt($$("pk-stock-dist").getValue(), 10);
            const so = ($$("pk-stock-so").getValue() || "").trim();
            if (dist && so) {
                body.distributor_id = dist;
                body.sales_order_number = so;
            } else if (dist || so) {
                // Operator gave one but not the other — silently drop.
                // Both are needed to populate the structured tracking;
                // otherwise it'd half-attribute and confuse the
                // Receipts aggregation. Comment field is still free
                // for ad-hoc notes.
            }
            // Optional Container row creation. Off by default;
            // operator opts in via the toggle. Same shape as the
            // scan-receive dialog's payload.
            const wantContainer = !!$$("pk-stock-container-toggle").getValue();
            if (wantContainer) {
                const storageId = parseInt($$("pk-stock-storage").getValue(), 10);
                body.create_storage_row = true;
                body.form = $$("pk-stock-form").getValue() || "Loose";
                // 0 sentinel → leave NULL (unbinned).
                body.storage_location_id = storageId > 0 ? storageId : null;
                const lot = ($$("pk-stock-lot").getValue() || "").trim();
                const dc  = ($$("pk-stock-date").getValue() || "").trim();
                if (lot) body.lot_number = lot;
                if (dc)  body.date_code = dc;
            }
        }
    }

    try {
        await api.addStockEntry(partId, body);
        $$("pk-stock-dialog").close();
        // Refresh detail (stock entries + level + avg) and parts grid (stock column).
        await loadPartDetail(partId);
        await loadParts({});
        // Re-select the row so the highlight stays consistent.
        const grid = $$("pk-parts-grid");
        if (grid && grid.exists(partId)) {
            grid.select(partId);
            grid.showItem(partId);
        }
    } catch (e) {
        console.error(e);
        webix.message({ type: "error", text: "Stock save failed: " + (e.message || e) });
    }
}

// ============================================================
//  Label printing (Brother PT-D410 via ptouch-print)
//
//  Renderer (Canvas + bwip-js) is universal: any browser, any
//  OS, no backend needed for the "Download PNG" path. The
//  "Print to D410" button is only rendered when the backend
//  reports `ptouch.available=true` (i.e. PARTKEEPR_PTOUCH_BIN
//  is set and the binary exists).
// ============================================================

/// Default DPI of PT-D series printers. The renderer outputs at
/// this DPI so the preview is 1:1 with what ptouch-print sends
/// to the printhead.
const PT_DPI = 180;

/// Printable height in pixels per tape width, for the PT-D410.
/// These are the **actual printable** values ptouch-print
/// expects — not the geometric tape width × DPI. The unprintable
/// margins along each long edge of the tape eat the rest.
/// Confirmed via `ptouch-print --info` against the real device:
///   6mm  → 32 px
///   9mm  → 52 px
///   12mm → 76 px
/// 3.5mm wasn't measured; geometric estimate of 24 px stands.
const TAPE_PRINTABLE_PX = {
    3.5: 24,
    6:   32,
    9:   52,
    12:  76,
};

function tapeHeightPx(width_mm) {
    const w = parseFloat(width_mm) || 12;
    return TAPE_PRINTABLE_PX[w] || Math.round(w * PT_DPI / 25.4);
}

const LABEL_TEMPLATES = {
    Part: {
        label: "Part",
        seedFields: (s) => [
            s.name || "",
            s.internal_part_number ? `IPN: ${s.internal_part_number}` : "",
            "",
        ],
        qrPayloadFor: (s) => s.id ? `${location.origin}/#/part/${s.id}` : "",
    },
    StorageBin: {
        label: "Storage Bin",
        seedFields: (s) => [
            s.name || "",
            s.path || s.category_path || "",
            "",
        ],
        qrPayloadFor: (s) => s.id ? `${location.origin}/#/storage/${s.id}` : "",
    },
    ReelFeeder: {
        label: "Reel/Feeder",
        seedFields: (s) => [
            s.part_name || s.name || "",
            s.internal_part_number ? `IPN: ${s.internal_part_number}` : "",
            [
                s.form ? s.form : "",
                s.quantity != null ? `Qty: ${s.quantity}` : "",
                s.lot_number ? `Lot: ${s.lot_number}` : "",
            ].filter(Boolean).join("  ·  "),
        ],
        qrPayloadFor: (s) => s.part_id ? `${location.origin}/#/part/${s.part_id}` : "",
    },
    Custom: {
        label: "Custom",
        seedFields: (s) => [s.line1 || "", s.line2 || "", s.line3 || ""],
        qrPayloadFor: (s) => s.qr || "",
    },
};

/// Trailing whitespace at the right edge of every label, so
/// content doesn't run flush to the cutter. 2 mm = ~14 px at
/// 180 dpi.
const TRAILING_MARGIN_MM = 2;

/// Text and QR sizes as fractions of the tape's printable
/// height. Text takes 80% of the tape height (scaled down by
/// line count), QR takes 90%, both centered vertically. Picked
/// to leave ~10–20% breathing room top/bottom so content
/// doesn't visually run into the tape's unprintable margins.
const TEXT_HEIGHT_FRACTION = 0.80;
const QR_HEIGHT_FRACTION   = 0.90;

/// Pure renderer: take a normalized spec, return a Canvas. The
/// same canvas drives the live preview AND the PNG-blob output.
/// Spec shape: {width_mm, length_mm, lines: [string, ...], qr: string|null}
function renderLabel(spec) {
    const heightPx = tapeHeightPx(spec.width_mm || 12);
    const widthPx = Math.max(160, Math.round((spec.length_mm || 50) * PT_DPI / 25.4));
    // Trailing margin reserved at the right edge (after content,
    // before the cutter). User-facing 2mm default.
    const trailingPx = Math.round(TRAILING_MARGIN_MM * PT_DPI / 25.4);
    const contentRight = widthPx - trailingPx;

    const canvas = document.createElement("canvas");
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, widthPx, heightPx);

    // QR / barcode area: a square at QR_HEIGHT_FRACTION of the
    // tape's printable height, centered vertically.
    let qrSizePx = 0;
    if (spec.qr) {
        qrSizePx = Math.floor(heightPx * QR_HEIGHT_FRACTION);
        try {
            // bwip-js writes directly into a temporary canvas;
            // copy into ours at the right spot.
            const tmp = document.createElement("canvas");
            window.bwipjs.toCanvas(tmp, {
                bcid: "qrcode",
                text: spec.qr,
                scale: Math.max(1, Math.floor(qrSizePx / 30)),
                paddingwidth: 0,
                paddingheight: 0,
            });
            const qrY = Math.max(0, Math.floor((heightPx - qrSizePx) / 2));
            ctx.drawImage(tmp, contentRight - qrSizePx, qrY, qrSizePx, qrSizePx);
        } catch (e) {
            console.warn("QR render failed:", e);
            qrSizePx = 0;
        }
    }

    // Text lines on the left.
    // Font sizing — two modes:
    //   spec.font_px > 0: explicit operator override
    //   spec.font_px == 0 (default): all text lines together
    //     occupy TEXT_HEIGHT_FRACTION of the tape's printable
    //     height, divided by line count (with 1.15 leading).
    // Either mode is still subject to horizontal-overflow
    // shrink so long text never clips at print time.
    const textLines = (spec.lines || []).filter(Boolean);
    const textWidthPx = contentRight - (qrSizePx ? (qrSizePx + 8) : 0);  // 8px gap when QR present
    if (textLines.length > 0 && textWidthPx > 20) {
        const lineHeightFactor = 1.15;
        let fontPx;
        if (spec.font_px && spec.font_px > 0) {
            fontPx = Math.max(6, Math.min(spec.font_px, heightPx - 2));
        } else {
            const totalTextHeight = heightPx * TEXT_HEIGHT_FRACTION;
            fontPx = Math.floor(totalTextHeight / (textLines.length * lineHeightFactor));
            fontPx = Math.max(6, fontPx);
        }

        // Always honor horizontal fit.
        ctx.font = `${fontPx}px sans-serif`;
        let widest = 0;
        for (const l of textLines) widest = Math.max(widest, ctx.measureText(l).width);
        if (widest > textWidthPx) {
            fontPx = Math.max(6, Math.floor(fontPx * textWidthPx / widest));
            ctx.font = `${fontPx}px sans-serif`;
        }

        ctx.fillStyle = "#000";
        ctx.textBaseline = "top";
        const lineH = fontPx * lineHeightFactor;
        const totalH = lineH * textLines.length;
        let y = Math.max(0, Math.floor((heightPx - totalH) / 2));
        for (const l of textLines) {
            ctx.fillText(l, 4, y);
            y += lineH;
        }
    }

    return canvas;
}

/// Open the label dialog seeded from the given context. `seed`
/// fields recognized: {template, name, internal_part_number, id,
/// part_id, part_name, path, category_path, form, quantity,
/// lot_number, line1, line2, line3, qr}. All optional.
async function openLabelDialog(seed) {
    seed = seed || {};
    const initialTemplate = seed.template && LABEL_TEMPLATES[seed.template]
        ? seed.template
        : "Custom";
    const tpl = LABEL_TEMPLATES[initialTemplate];
    const seedLines = tpl.seedFields(seed);
    const seedQr = tpl.qrPayloadFor(seed);

    // Fetch live printer info up front. This is the source of
    // truth for whether the Print button shows AND for the
    // currently-loaded tape width. Best-effort: if the call
    // fails, fall back to "no printer" — Download PNG still
    // works.
    let pinfo = null;
    try {
        pinfo = await api.printerInfo();
    } catch (e) {
        console.warn("printerInfo failed:", e);
    }
    const printAvailable = !!(pinfo && pinfo.available);
    const initialWidth = (pinfo && pinfo.current_tape_width_mm != null)
        ? String(pinfo.current_tape_width_mm)
        : "12";

    const widthOptions = [
        { id: "3.5", value: "3.5 mm" },
        { id: "6", value: "6 mm" },
        { id: "9", value: "9 mm" },
        { id: "12", value: "12 mm" },
    ];
    const tplOptions = Object.entries(LABEL_TEMPLATES).map(([k, v]) => ({ id: k, value: v.label }));

    const renderPreview = () => {
        const f = $$("pk-label-form").getValues();
        const canvas = renderLabel({
            width_mm: parseFloat(f.width_mm) || 12,
            length_mm: parseFloat(f.length_mm) || 50,
            lines: [f.line1 || "", f.line2 || "", f.line3 || ""],
            qr: f.include_qr ? (f.qr || "") : null,
            font_px: parseInt(f.font_px, 10) || 0,
        });
        const host = $$("pk-label-preview");
        if (!host || !host.$view) return;
        host.$view.innerHTML = "";
        // Center the canvas in its slot, give it a thin border so
        // the operator can see the actual tape boundary.
        canvas.style.border = "1px solid #b0b8be";
        canvas.style.background = "#fff";
        canvas.style.display = "block";
        canvas.style.margin = "0 auto";
        host.$view.appendChild(canvas);
        // Stash the canvas on the dialog for the export buttons.
        $$("pk-label-dialog").$labelCanvas = canvas;
    };

    webix.ui({
        view: "window",
        id: "pk-label-dialog",
        modal: true,
        position: "center",
        width: 760,
        height: 560,
        head: "Print Label",
        body: {
            rows: [
                {
                    view: "form",
                    id: "pk-label-form",
                    elementsConfig: { labelWidth: 110 },
                    elements: [
                        // Top row: each cell stacks label-above-field so
                        // it's unambiguous which label belongs to which
                        // input. labelPosition:"top" handles that for
                        // every field in this row.
                        {
                            cols: [
                                {
                                    view: "richselect", name: "template", label: "Template",
                                    labelPosition: "top",
                                    options: tplOptions,
                                    on: {
                                        onChange: function (newKey) {
                                            const t = LABEL_TEMPLATES[newKey];
                                            if (!t) return;
                                            const lines = t.seedFields(seed);
                                            $$("pk-label-form").setValues({
                                                line1: lines[0] || "",
                                                line2: lines[1] || "",
                                                line3: lines[2] || "",
                                                qr: t.qrPayloadFor(seed),
                                            }, true);
                                            renderPreview();
                                        },
                                    },
                                },
                                { view: "richselect", name: "width_mm", label: "Tape width",
                                  labelPosition: "top", options: widthOptions,
                                  on: { onChange: renderPreview } },
                                { view: "counter", name: "length_mm", label: "Label length (mm)",
                                  labelPosition: "top",
                                  min: 10, max: 200, step: 5,
                                  tooltip: "How far the printer feeds the tape, in mm. 50mm ≈ 2 inches." },
                                { view: "counter", name: "font_px", label: "Font (px, 0=auto)",
                                  labelPosition: "top",
                                  min: 0, max: 80, step: 1,
                                  tooltip: "0 = auto-fit by tape height + text length. Set to override; horizontal overflow still shrinks to fit.",
                                  on: { onChange: function () {
                                      // counter doesn't tag onTimedKeyPress;
                                      // we get explicit onChange events instead.
                                      renderPreview();
                                  } } },
                            ],
                        },
                        {
                            cols: [
                                {
                                    rows: [
                                        { view: "text", name: "line1", label: "Line 1",
                                          on: { onTimedKeyPress: renderPreview } },
                                        { view: "text", name: "line2", label: "Line 2",
                                          on: { onTimedKeyPress: renderPreview } },
                                        { view: "text", name: "line3", label: "Line 3",
                                          on: { onTimedKeyPress: renderPreview } },
                                        { view: "checkbox", name: "include_qr", labelRight: "Include QR", labelWidth: 0, label: "",
                                          on: { onChange: renderPreview } },
                                        { view: "text", name: "qr", label: "QR payload",
                                          on: { onTimedKeyPress: renderPreview } },
                                    ],
                                },
                                {
                                    rows: [
                                        { template: '<div class="pk-detail-section-title" style="padding:0 8px">Live preview</div>',
                                          height: 24, borderless: true },
                                        { view: "template", id: "pk-label-preview", template: "",
                                          borderless: true, css: "pk-label-preview" },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                // Loaded-tape chip lives in its own row above the action
                // toolbar so it's always visible, never clipped by the
                // preview area's checkered background.
                { view: "template", id: "pk-label-tape-status",
                  template: "", height: 30, borderless: true, css: "pk-help-hint" },
                {
                    view: "toolbar",
                    css: "pk-dialog-actions",
                    height: 50,
                    cols: [
                        {},
                        { view: "button", value: "Close", width: 100, click: () => $$("pk-label-dialog").close() },
                        { view: "button", value: "⬇ Download PNG", width: 160, css: "pk-btn-add", click: function () {
                            const canvas = $$("pk-label-dialog").$labelCanvas;
                            if (!canvas) return;
                            canvas.toBlob((blob) => {
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                const f = $$("pk-label-form").getValues();
                                const slug = (f.line1 || "label").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 30) || "label";
                                a.download = `label-${slug}.png`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                            }, "image/png");
                        }},
                        (printAvailable
                            ? { view: "button", value: "🖨 Print to D410", width: 170, css: "webix_primary", click: async function () {
                                  const canvas = $$("pk-label-dialog").$labelCanvas;
                                  if (!canvas) return;
                                  try {
                                      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
                                      const buf = await blob.arrayBuffer();
                                      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                                      const f = $$("pk-label-form").getValues();
                                      await api.printLabel({ png_b64: b64, label_kind: f.template });
                                      webix.message({ type: "success", text: "Sent to printer" });
                                  } catch (e) {
                                      webix.message({ type: "error", text: "Print failed: " + (e.message || e) });
                                  }
                              }}
                            : { width: 0 }
                        ),
                    ],
                },
            ],
        },
    }).show();

    // Initial values + first render. initialWidth comes from the
    // live `ptouch-print --info` we already awaited above; if
    // the printer is off / not configured it's "12".
    $$("pk-label-form").setValues({
        template: initialTemplate,
        width_mm: initialWidth,
        length_mm: 50,
        font_px: 0,
        line1: seedLines[0] || "",
        line2: seedLines[1] || "",
        line3: seedLines[2] || "",
        include_qr: !!seedQr,
        qr: seedQr,
    });
    setTimeout(renderPreview, 0);

    // Loaded-tape chip below the preview. Three states:
    //  - green: ptouch reported a tape — we synced the picker
    //  - yellow: ptouch is configured but errored / printer is off
    //  - hidden: ptouch isn't configured at all
    const statusView = $$("pk-label-tape-status");
    if (statusView) {
        if (pinfo && pinfo.current_tape_width_mm != null) {
            statusView.setHTML(
                `<span style="padding:4px 8px;color:#1e7e34">Loaded: <b>${escapeHtml(pinfo.status || (initialWidth + " mm"))}</b></span>`
            );
        } else if (pinfo && pinfo.status) {
            statusView.setHTML(
                `<span style="padding:4px 8px;color:#b09a3e">⚠ ${escapeHtml(pinfo.status)}</span>`
            );
        } else if (!printAvailable) {
            // Printing not configured — leave the chip blank.
            statusView.setHTML("");
        }
    }
}

// ============================================================
//  Distributor lookup dialog (Mouser + Digi-Key search/import)
//
//  Capabilities are fetched on shell mount; the toolbar button
//  is unhidden when caps.mouser.available is true. The dialog
//  itself: search input + results datatable + category/unit
//  pickers + Import. Backend handles the heavy lifting (auto-
//  create manufacturer, fetch datasheet/image via slice-7's
//  by-URL pipeline).
// ============================================================

let lookupCapsCache = null;

/// Returns the list of source ids that the backend reports as
/// available right now. Order is the order we want to render
/// in the source picker.
function availableLookupSources() {
    if (!lookupCapsCache) return [];
    const sources = [];
    if (lookupCapsCache.digikey && lookupCapsCache.digikey.available) sources.push("digikey");
    if (lookupCapsCache.mouser && lookupCapsCache.mouser.available)   sources.push("mouser");
    return sources;
}

/// Pull capabilities once after the shell mounts. Reveal the
/// "🔎 Add via lookup" button when any source is available, and
/// re-label it to be source-specific when only one is.
async function refreshLookupCapabilities() {
    try {
        lookupCapsCache = await api.lookupCapabilities();
    } catch (e) {
        console.warn("lookupCapabilities failed:", e);
        return;
    }
    const btn = $$("pk-lookup-button");
    const sources = availableLookupSources();
    if (btn && sources.length > 0) {
        if (sources.length === 1) {
            const label = sources[0] === "digikey" ? "🔎 Add via Digi-Key" : "🔎 Add via Mouser";
            btn.define("value", label);
            btn.refresh();
        }
        btn.show();
    }
    // Unified receive button — shown whenever ≥1 source has
    // order_status_available. Source picker lives inside the dialog.
    const recvBtn = $$("pk-receive-button");
    const recvSources = availableReceiveSources();
    if (recvBtn && recvSources.length >= 1) {
        recvBtn.show();
    }
    // 💲 Compare distributors button — TrustedParts.com live aggregator.
    // Lives on the part-detail action toolbar; revealed here.
    const cmpBtn = $$("pk-detail-compare-btn");
    if (cmpBtn && lookupCapsCache && lookupCapsCache.trustedparts
        && lookupCapsCache.trustedparts.available) {
        cmpBtn.show();
    }
}

/// Sources that have `order_status_available: true`. Independent of
/// search availability — Mouser has two distinct keys.
function availableReceiveSources() {
    const out = [];
    if (lookupCapsCache && lookupCapsCache.digikey
        && lookupCapsCache.digikey.order_status_available) out.push("digikey");
    if (lookupCapsCache && lookupCapsCache.mouser
        && lookupCapsCache.mouser.order_status_available) out.push("mouser");
    return out;
}

function defaultReceiveSource() {
    const sources = availableReceiveSources();
    if (sources.length === 0) return "digikey";  // shouldn't open anyway
    // Per-user persistence so re-opens default to last choice.
    const key = `pk:receive:last-source:${currentUser ? currentUser.username : "anon"}`;
    const saved = localStorage.getItem(key);
    if (saved && sources.includes(saved)) return saved;
    return sources[0];
}

/// Optional opts:
///   prefillSource:      "digikey" | "mouser" — force the active source
///   prefillMpn:         string — pre-fills the search box and runs an
///                       immediate "by MPN" search
///   forceDistributorPn: string — overwrite the search result's
///                       distributor_pn before import. Required for
///                       the receive flow's "🔎 Import" path: the
///                       order line carries the *real* distributor
///                       SKU (e.g. "617-21348000380010"), but
///                       Mouser's Search API may return "N/A" for
///                       MouserPartNumber on some MPNs. Without
///                       this override the imported PartDistributor
///                       has the wrong orderNumber and the receive
///                       dialog won't match the line on re-fetch.
///   onImported:         async (importResp) => void — called after a
///                       successful import. When provided, the dialog
///                       skips its default post-import behavior so
///                       the caller controls what happens next.
async function openLookupSearchDialog(opts) {
    opts = opts || {};
    // Make sure lookupsCache is loaded — categories + part_units
    // power the two dropdowns at the bottom of the dialog. Same
    // pattern as openPartEditor / openCommonParamsDialog.
    try {
        await ensureLookups();
    } catch (e) {
        webix.message({ type: "error", text: "Failed to load lookups: " + (e.message || e) });
        return;
    }
    const categoryOptions = flattenCategoryTree(lookupsCache.categories_tree);
    const partUnitOptions = lookupsCache.part_units.map((u) => ({
        id: u.id,
        value: u.name + (u.short_name ? ` (${u.short_name})` : ""),
    }));
    // Prefer the is_default=true row if present.
    const defaultPartUnit = lookupsCache.part_units.find((u) => u.is_default)
        || lookupsCache.part_units[0];
    // Prefer whatever category the operator has selected in the
    // left tree pane (so "I'm in Resistors → click Add via lookup
    // → search → Import" lands in Resistors, not the root). Falls
    // back to the first category in the list.
    const selectedCatId = (function () {
        const tree = $$("pk-cat-tree");
        if (!tree) return null;
        const id = tree.getSelectedId && tree.getSelectedId();
        // The tree carries non-category rows too (storage etc.);
        // only use the selection if it matches a category.
        if (id && categoryOptions.some((c) => String(c.id) === String(id))) {
            return id;
        }
        return null;
    })();
    const defaultCategoryId = selectedCatId || (categoryOptions[0] && categoryOptions[0].id) || null;

    // Track the selected result + its source.
    let lastSearchItems = [];
    let selectedResult = null;

    // Source picker: persist last choice per-user in localStorage.
    const sources = availableLookupSources();
    const sourcePersistKey = `pk:lookup:last-source:${currentUser ? currentUser.username : "anon"}`;
    let activeSource = (function () {
        // Caller-supplied source wins (e.g., DK Receive flow forces digikey).
        if (opts.prefillSource && sources.includes(opts.prefillSource)) {
            return opts.prefillSource;
        }
        const saved = localStorage.getItem(sourcePersistKey);
        if (saved && sources.includes(saved)) return saved;
        // Default: digikey first (richer data), else mouser.
        return sources[0] || "mouser";
    })();
    const sourceOptions = sources.map((s) => ({
        id: s,
        value: s === "digikey" ? "Digi-Key" : "Mouser",
    }));

    const winId = "pk-lookup-dialog";

    // The header reflects whichever source is currently active.
    const headFor = (s) => s === "digikey" ? "Add part via Digi-Key" : "Add part via Mouser";

    webix.ui({
        view: "window",
        id: winId,
        modal: true,
        position: "center",
        width: 980,
        height: 640,
        head: headFor(activeSource),
        body: {
            rows: [
                // Source picker — shown only when 2+ sources available.
                sources.length >= 2
                    ? {
                        view: "toolbar",
                        css: "pk-pane-toolbar",
                        height: 40,
                        cols: [
                            { view: "label", label: "Source:", width: 75, css: "pk-pane-title" },
                            {
                                view: "segmented",
                                id: "pk-lookup-source",
                                value: activeSource,
                                width: 320,
                                options: sourceOptions,
                                on: {
                                    onChange: function (newSrc) {
                                        activeSource = newSrc;
                                        localStorage.setItem(sourcePersistKey, newSrc);
                                        const win = $$(winId);
                                        if (win) win.config.head = headFor(newSrc);
                                        // Clear results — they're stale.
                                        const grid = $$("pk-lookup-results");
                                        if (grid) grid.clearAll();
                                        $$("pk-lookup-import-btn").disable();
                                        selectedResult = null;
                                        updateSelectedLabel();
                                    },
                                },
                            },
                            {},
                        ],
                    }
                    : { hidden: true, height: 0 },
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 50,
                    cols: [
                        {
                            view: "segmented",
                            id: "pk-lookup-by",
                            value: "partnumber",
                            width: 280,
                            options: [
                                { id: "partnumber", value: "By MPN" },
                                { id: "keyword",    value: "By keyword" },
                            ],
                        },
                        {
                            view: "search",
                            id: "pk-lookup-q",
                            placeholder: "MPN or keyword…",
                            on: {
                                onEnter: function () { runLookupSearch(); },
                                onSearchIconClick: function () { runLookupSearch(); },
                            },
                        },
                        { view: "button", value: "🔎 Search", width: 110, css: "webix_primary",
                          click: () => runLookupSearch() },
                    ],
                },
                {
                    view: "datatable",
                    id: "pk-lookup-results",
                    css: "pk-grid",
                    select: "row",
                    columns: [
                        { id: "mpn", header: "MPN", width: 200 },
                        { id: "manufacturer_name", header: "Manufacturer", width: 180 },
                        { id: "description", header: "Description", fillspace: true },
                        { id: "_stock", header: "Stock", width: 90, css: "pk-numeric",
                          template: (o) => {
                              const m = (o.availability || "").match(/(\d[\d,]*)/);
                              return m ? m[1] : "";
                          } },
                        { id: "_price", header: "Price (1)", width: 90, css: "pk-numeric",
                          template: (o) => {
                              const pb = (o.price_breaks || [])[0];
                              return pb ? `${pb.price} ${pb.currency}` : "";
                          } },
                        { id: "_params", header: "Params", width: 70, css: "pk-numeric",
                          template: (o) => (o.parameters || []).length || "" },
                        { id: "distributor_pn", header: "Distributor P/N", width: 140 },
                    ],
                    on: {
                        onAfterSelect: function (sel) {
                            const item = this.getItem(sel.id);
                            selectedResult = item || null;
                            updateSelectedLabel();
                            $$("pk-lookup-import-btn").enable();
                        },
                    },
                },
                {
                    view: "template",
                    id: "pk-lookup-selected",
                    height: 26,
                    borderless: true,
                    template: '<span style="padding:0 12px;color:#6a7a8a">Pick a result, then choose category + unit and click Import.</span>',
                },
                {
                    view: "form",
                    id: "pk-lookup-form",
                    height: 70,
                    elementsConfig: { labelWidth: 90 },
                    elements: [
                        {
                            cols: [
                                { view: "richselect", name: "category_id", label: "Category",
                                  options: { data: categoryOptions, body: { template: categoryOptionTemplate } },
                                  value: defaultCategoryId },
                                { view: "richselect", name: "part_unit_id", label: "Unit",
                                  options: partUnitOptions, width: 280,
                                  value: defaultPartUnit ? defaultPartUnit.id : null },
                            ],
                        },
                    ],
                },
                {
                    view: "toolbar",
                    css: "pk-dialog-actions",
                    height: 50,
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 100, click: () => $$(winId).close() },
                        {
                            view: "button",
                            id: "pk-lookup-import-btn",
                            value: "Import",
                            width: 130,
                            css: "pk-btn-add",
                            disabled: true,
                            click: () => importSelected(),
                        },
                    ],
                },
            ],
        },
    }).show();

    function updateSelectedLabel() {
        const t = $$("pk-lookup-selected");
        if (!t) return;
        if (!selectedResult) {
            t.setHTML('<span style="padding:0 12px;color:#6a7a8a">Pick a result, then choose category + unit and click Import.</span>');
            return;
        }
        const paramCount = (selectedResult.parameters || []).length;
        const paramHint = paramCount ? ` <span style="color:#6a7a8a">(${paramCount} parameters)</span>` : "";
        t.setHTML(`<span style="padding:0 12px;color:#1f2933">Selected: <b>${escapeHtml(selectedResult.mpn)}</b> — ${escapeHtml(selectedResult.manufacturer_name)}${paramHint}</span>`);
    }

    async function runLookupSearch() {
        const q = ($$("pk-lookup-q").getValue() || "").trim();
        const by = $$("pk-lookup-by").getValue() || "partnumber";
        if (!q) {
            webix.message({ type: "error", text: "Type something to search" });
            return;
        }
        const grid = $$("pk-lookup-results");
        if (grid) grid.clearAll();
        $$("pk-lookup-import-btn").disable();
        selectedResult = null;
        updateSelectedLabel();
        try {
            const resp = await api.lookupSearch(activeSource, q, by);
            lastSearchItems = (resp.items || []).map((it, i) => Object.assign({ id: i + 1 }, it));
            if (grid) grid.parse(lastSearchItems);
            if (resp.errors && resp.errors.length) {
                webix.message({ type: "warning", text: resp.errors.join(" · ") });
            }
            if (lastSearchItems.length === 0) {
                webix.message({ type: "info", text: "No results" });
            }
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Search failed: " + (e.message || e) });
        }
    }

    async function importSelected() {
        if (!selectedResult) return;
        const v = $$("pk-lookup-form").getValues();
        const categoryId = parseInt(v.category_id, 10);
        const partUnitId = parseInt(v.part_unit_id, 10);
        if (!categoryId || !partUnitId) {
            webix.message({ type: "error", text: "Pick a category and a unit" });
            return;
        }
        const result = Object.assign({}, selectedResult);
        delete result.id;
        // Caller-supplied SKU override — see opts.forceDistributorPn
        // doc above. Empty string fails-safe: leave search result intact.
        if (opts.forceDistributorPn && opts.forceDistributorPn.trim()) {
            result.distributor_pn = opts.forceDistributorPn.trim();
        }
        try {
            const resp = await api.lookupImport(activeSource, result, categoryId, partUnitId);
            $$(winId).close();
            const bits = [`Imported ${selectedResult.mpn}`];
            const paramCount = (selectedResult.parameters || []).length;
            if (paramCount) bits.push(`${paramCount} parameters`);
            if (resp.datasheet_attachment_id) bits.push("datasheet ✓");
            else if (resp.datasheet_error) bits.push("datasheet ⚠");
            if (resp.logo_attachment_id) bits.push("logo ✓");
            else if (resp.logo_error) bits.push("logo ⚠");
            webix.message({ type: "success", text: bits.join(" · ") });
            if (resp.datasheet_error) console.warn("datasheet fetch failed:", resp.datasheet_error);
            if (resp.logo_error) console.warn("logo fetch failed:", resp.logo_error);
            if (opts.onImported) {
                // Caller-driven flow (e.g., DK Receive): they handle
                // the parts-grid refresh themselves.
                try { await opts.onImported(resp); }
                catch (cbErr) { console.error("onImported callback failed:", cbErr); }
            } else {
                await loadParts({ search: "" });
                const grid = $$("pk-parts-grid");
                if (grid && grid.exists(resp.part_id)) {
                    grid.select(resp.part_id);
                    grid.showItem(resp.part_id);
                }
                await loadPartDetail(resp.part_id);
            }
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Import failed: " + (e.message || e) });
        }
    }

    // Auto-run the initial search if the caller pre-filled an MPN.
    if (opts.prefillMpn) {
        const qBox = $$("pk-lookup-q");
        const byBox = $$("pk-lookup-by");
        if (qBox) qBox.setValue(opts.prefillMpn);
        if (byBox) byBox.setValue("partnumber");
        // Defer so the dialog finishes mounting before we fire.
        setTimeout(() => runLookupSearch(), 50);
    }
}

// ============================================================
//  Receive Order dialog (DK + Mouser, partial-shipment aware)
//
//  Operator types a Digi-Key Sales Order #, hits Fetch. We call
//  /order-status which fetches the order via Digi-Key OrderStatus
//  API and joins line items against PartDistributor on
//  (distributor=Digi-Key, orderNumber=line.distributor_pn). Each line
//  shows: ✓ apply | DK PN | MPN | qty shipped | unit price |
//  match status. Operator unchecks lines they don't want, edits
//  per-line quantity (defaults to qty_shipped), clicks Apply.
//
//  Apply POSTs the operator-confirmed lines to /order-receive,
//  which inserts a StockEntry per line with a comment of
//  "Digi-Key SO #{n} line {k}" — searchable in stock history.
//  Receiving the same SO twice is permitted (operator-permissive
//  per project policy); the duplicate stock-ins are visible in
//  the per-part history.
// ============================================================

/// Source-agnostic receive dialog. Both Digi-Key and Mouser hit
/// the same backend shapes (`OrderStatusResponse` / `OrderReceive*`),
/// just at different URL prefixes.
async function openOrderReceiveDialog(source) {
    const winId = "pk-dk-receive-dialog";
    if ($$(winId)) { $$(winId).destructor(); }

    // Lookups (storage locations) needed for the per-line
    // Storage picker. Must be loaded *before* the grid renders or
    // the richselect popups won't have data.
    try { await ensureLookups(); }
    catch (e) {
        webix.message({ type: "error", text: "Failed to load lookups: " + (e.message || e) });
        return;
    }
    const storageOptions = (lookupsCache && lookupsCache.storage_locations || [])
        .map((s) => ({ id: s.id, value: s.name }));
    const formOptions = SCAN_FORM_OPTIONS.slice();

    const sourceLabel = (s) => s === "mouser" ? "Mouser" : "Digi-Key";
    const skuHeaderFor = (s) => s === "mouser" ? "Mouser P/N" : "DK P/N";

    let preview = null;  // OrderStatusResponse from the last fetch
    // Per-line state — packaging + skip flag.
    //   apply:                 include this line in the apply batch
    //   quantity:              units to apply (residual on partial lines)
    //   form:                  PSL form to mint with (default Loose)
    //   storage_location_id:   PSL storage (default part's primary, fallback (NOWHERE))
    //   skip_psl_row:          don't mint a PSL row (already scanned)
    //   received:              units already received against this SO# (display)
    //   fully_received:        true → row greyed, apply forced false
    let lineState = [];

    const headTpl = (sid) => sid
        ? `Receive ${sourceLabel(source)} Sales Order #${sid}`
        : `Receive ${sourceLabel(source)} Sales Order`;

    webix.ui({
        view: "window",
        id: winId,
        modal: true,
        position: "center",
        width: 1320,
        height: 640,
        head: headTpl(null),
        body: {
            rows: [
                // Source picker — shown only when 2+ sources are configured.
                (function () {
                    const sources = availableReceiveSources();
                    if (sources.length < 2) return { hidden: true, height: 0 };
                    return {
                        view: "toolbar",
                        css: "pk-pane-toolbar",
                        height: 40,
                        cols: [
                            { view: "label", label: "Source:", width: 75, css: "pk-pane-title" },
                            {
                                view: "segmented",
                                id: "pk-rcv-source",
                                value: source,
                                width: 320,
                                options: sources.map((s) => ({
                                    id: s,
                                    value: s === "digikey" ? "Digi-Key" : "Mouser",
                                })),
                                on: {
                                    onChange: function (newSrc) {
                                        source = newSrc;
                                        // Persist + reset transient state.
                                        const k = `pk:receive:last-source:${currentUser ? currentUser.username : "anon"}`;
                                        localStorage.setItem(k, newSrc);
                                        preview = null;
                                        lineState = [];
                                        $$("pk-dk-rcv-grid").clearAll();
                                        $$("pk-dk-rcv-status").define("label", "");
                                        $$("pk-dk-rcv-status").refresh();
                                        const win = $$(winId);
                                        if (win) win.config.head = headTpl(null);
                                        // Update the SKU column header live.
                                        const grid = $$("pk-dk-rcv-grid");
                                        if (grid) {
                                            grid.config.columns.find(c => c.id === "distributor_pn").header = skuHeaderFor(newSrc);
                                            grid.refreshColumns();
                                        }
                                        refreshSummary();
                                    },
                                },
                            },
                            {},
                        ],
                    };
                })(),
                // Row 1: SO# input + Fetch.
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 50,
                    cols: [
                        { view: "label", label: "Sales order #:", width: 130, css: "pk-pane-title" },
                        {
                            view: "text",
                            id: "pk-dk-rcv-id",
                            placeholder: "e.g. 81234567",
                            width: 220,
                            on: {
                                onEnter: function () { runFetch(); },
                            },
                        },
                        { view: "button", value: "🔍 Fetch", width: 100, css: "webix_primary",
                          click: () => runFetch() },
                        {},
                        {
                            view: "label",
                            id: "pk-dk-rcv-status",
                            label: "",
                            width: 380,
                            css: "pk-pane-title",
                        },
                    ],
                },
                // Row 2: results datatable. Apply checkbox + editable qty.
                {
                    view: "datatable",
                    id: "pk-dk-rcv-grid",
                    css: "pk-grid",
                    editable: true,
                    editaction: "click",
                    select: false,
                    columns: [
                        {
                            id: "_apply",
                            header: { text: "Apply", css: "right" },
                            tooltip: "Include this line in the Apply stock-in batch",
                            width: 64,
                            template: "{common.checkbox()}",
                            checkValue: true,
                            uncheckValue: false,
                            css: "right",
                        },
                        { id: "line_number", header: "Line", width: 56, css: "right" },
                        { id: "distributor_pn", header: skuHeaderFor(source), width: 150 },
                        { id: "mpn", header: "MPN", width: 170 },
                        {
                            id: "_match",
                            header: "Match",
                            width: 270,
                            template: function (o) {
                                if (o.part_id) {
                                    const stock = (o.current_stock != null) ? ` (stock ${o.current_stock})` : "";
                                    return `<span style="color:#2a8a2a">✓ #${o.part_id} ${escapeHtml(o.part_name || "")}${stock}</span>`;
                                }
                                return `<span style="color:#aa6b2a">⚠ no match</span> ` +
                                    `<span class="pk-dk-rcv-import webix_link" style="cursor:pointer;color:#2a6fb0">🔎 Import</span>`;
                            },
                        },
                        { id: "quantity_shipped", header: "Qty shipped", width: 90, css: "right" },
                        {
                            // How many units already received against this SO#.
                            // Pulls from StockEntry rows attributed to (distributor, SO#).
                            // Green = full, orange = partial, neutral = zero.
                            id: "_received",
                            header: "Recv'd",
                            width: 80,
                            css: "right",
                            template: function (o) {
                                if (o.units_already_received == null) return "";
                                const r = o.units_already_received;
                                const target = o.quantity_shipped > 0 ? o.quantity_shipped : o.quantity_ordered;
                                if (r <= 0) return `<span style="color:#7f8c8d">0/${target}</span>`;
                                if (r >= target) return `<span style="color:#2a8a2a">${r}/${target} ✓</span>`;
                                return `<span style="color:#aa6b2a">${r}/${target}</span>`;
                            },
                        },
                        {
                            id: "_qty",
                            header: "Apply qty",
                            width: 90,
                            editor: "text",
                            css: "right",
                        },
                        // Per-line packaging defaults.
                        {
                            id: "_form",
                            header: "Form",
                            width: 110,
                            editor: "richselect",
                            options: formOptions,
                        },
                        {
                            id: "_storage",
                            header: "Storage",
                            width: 160,
                            editor: "richselect",
                            options: storageOptions,
                            template: function (o) {
                                if (!o._storage) return `<span style="color:#7f8c8d">(NOWHERE)</span>`;
                                const m = storageOptions.find((s) => s.id == o._storage);
                                return m ? escapeHtml(m.value) : `#${o._storage}`;
                            },
                        },
                        {
                            id: "_skip",
                            header: "Skip pkg",
                            tooltip: "Skip the per-line packaging row — use when the operator already scanned this reel separately",
                            width: 80,
                            template: "{common.checkbox()}",
                            checkValue: true,
                            uncheckValue: false,
                            css: "right",
                        },
                        {
                            id: "_price",
                            header: "Unit price",
                            width: 100,
                            css: "right",
                            template: function (o) {
                                if (!o.unit_price) return "";
                                return o.unit_price.toFixed(4) + " " + (preview && preview.currency || "");
                            },
                        },
                        { id: "description", header: "Description", fillspace: true, minWidth: 180 },
                    ],
                    onClick: {
                        "pk-dk-rcv-import": function (ev, rid) {
                            const idx = this.getIndexById(rid);
                            if (idx == null) return false;
                            importLine(idx);
                            return false;  // suppress row-click side effects
                        },
                    },
                    on: {
                        onCheck: function (rid, cid, val) {
                            const idx = this.getIndexById(rid);
                            if (!lineState[idx]) return;
                            if (cid === "_apply") {
                                // Don't let the operator re-enable a fully-received line
                                // by clicking the box (would double-count).
                                if (lineState[idx].fully_received && val) {
                                    this.updateItem(rid, { _apply: false });
                                    webix.message({ type: "info",
                                        text: "Line already fully received against this SO#." });
                                    return;
                                }
                                lineState[idx].apply = !!val;
                            } else if (cid === "_skip") {
                                lineState[idx].skip_psl_row = !!val;
                            }
                            refreshSummary();
                        },
                        onAfterEditStop: function (state, ed) {
                            const idx = this.getIndexById(ed.row);
                            if (!lineState[idx]) return;
                            if (ed.column === "_qty") {
                                const n = parseInt(state.value, 10);
                                if (!Number.isFinite(n) || n < 0) {
                                    this.updateItem(ed.row, { _qty: lineState[idx].quantity });
                                    return;
                                }
                                lineState[idx].quantity = n;
                                refreshSummary();
                            } else if (ed.column === "_form") {
                                lineState[idx].form = state.value || "Loose";
                            } else if (ed.column === "_storage") {
                                const sid = parseInt(state.value, 10);
                                lineState[idx].storage_location_id = sid > 0 ? sid : null;
                            }
                        },
                    },
                },
                // Row 3: summary + apply buttons.
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 48,
                    cols: [
                        {
                            view: "template",
                            id: "pk-dk-rcv-summary",
                            borderless: true,
                            template: '<span style="padding:0 12px;color:#6a7a8a">Fetch a sales order to see lines.</span>',
                        },
                        { view: "button", value: "Cancel", width: 110,
                          click: () => $$(winId) && $$(winId).destructor() },
                        { view: "button", id: "pk-dk-rcv-apply", value: "✓ Apply stock-in",
                          css: "pk-btn-add", width: 170, disabled: true,
                          click: () => runApply() },
                    ],
                },
            ],
        },
    }).show();
    $$("pk-dk-rcv-id").focus();

    function refreshSummary() {
        const grid = $$("pk-dk-rcv-grid");
        const sum = $$("pk-dk-rcv-summary");
        const applyBtn = $$("pk-dk-rcv-apply");
        if (!preview || !grid || !sum || !applyBtn) return;
        let lines = 0, units = 0, skipped = 0, noMatch = 0, alreadyDone = 0;
        grid.eachRow(function (rid) {
            const idx = grid.getIndexById(rid);
            const item = grid.getItem(rid);
            const st = lineState[idx];
            if (!st) { skipped++; return; }
            if (st.fully_received) { alreadyDone++; return; }
            if (!st.apply) { skipped++; return; }
            if (!item.part_id) { noMatch++; return; }
            if (!st.quantity || st.quantity <= 0) { skipped++; return; }
            lines++;
            units += st.quantity;
        });
        const txt = `${lines} line${lines === 1 ? "" : "s"} → +${units} unit${units === 1 ? "" : "s"} ` +
            `· ${skipped} skipped` +
            (alreadyDone ? ` · ${alreadyDone} already received` : "") +
            (noMatch ? ` · ${noMatch} no-match (will skip)` : "");
        sum.setHTML(`<span style="padding:0 12px">${escapeHtml(txt)}</span>`);
        applyBtn.define("disabled", lines === 0);
        applyBtn.refresh();
    }

    async function runFetch() {
        const idStr = ($$("pk-dk-rcv-id").getValue() || "").trim();
        const oid = parseInt(idStr, 10);
        if (!Number.isFinite(oid) || oid <= 0) {
            webix.message({ type: "error", text: "Enter a valid sales order #." });
            return;
        }
        const status = $$("pk-dk-rcv-status");
        status.define("label", "Fetching…");
        status.refresh();
        try {
            preview = await api.lookupOrderStatus(source, oid);
        } catch (e) {
            preview = null;
            lineState = [];
            $$("pk-dk-rcv-grid").clearAll();
            status.define("label", "");
            status.refresh();
            refreshSummary();
            webix.message({ type: "error", text: "Fetch failed: " + (e.message || e) });
            return;
        }
        const win = $$(winId);
        if (win) win.config.head = headTpl(preview.sales_order_id);
        // Per-line state init. Rules:
        //   target           = quantity_shipped or quantity_ordered (fallback)
        //   already_received = StockEntry sum for this (distributor, SO#)
        //   residual         = max(target - already_received, 0)
        //   fully_received   = already_received >= target
        //   apply default    = matched && residual > 0 && !fully_received
        //   quantity default = residual (so partial shipments pre-fill correctly)
        //   form default     = "Loose"  (operator picks per-line if it's actually a Reel)
        //   storage default  = part's primary, fall back to (NOWHERE)
        //   skip default     = false  (mint a PSL row by default)
        lineState = preview.lines.map((li) => {
            const target = li.quantity_shipped > 0 ? li.quantity_shipped : li.quantity_ordered;
            const already = li.units_already_received || 0;
            const residual = Math.max(target - already, 0);
            const fully = !!li.part_id && already >= target && target > 0;
            return {
                apply: !!li.part_id && residual > 0 && !fully,
                quantity: residual,
                form: "Loose",
                storage_location_id: li.default_storage_location_id || null,
                skip_psl_row: false,
                received: already,
                fully_received: fully,
            };
        });
        const rows = preview.lines.map((li, i) => Object.assign({}, li, {
            id: i + 1,
            _apply: lineState[i].apply,
            _qty: lineState[i].quantity,
            _form: lineState[i].form,
            _storage: lineState[i].storage_location_id || 0,
            _skip: lineState[i].skip_psl_row,
        }));
        const grid = $$("pk-dk-rcv-grid");
        grid.clearAll();
        grid.parse(rows);
        const matched = preview.lines.filter((li) => li.part_id).length;
        const total = preview.lines.length;
        const shipped = preview.lines.filter((li) => li.quantity_shipped > 0).length;
        status.define("label", `${total} line${total === 1 ? "" : "s"} · ${matched} matched · ${shipped} shipped`);
        status.refresh();
        refreshSummary();
    }

    /// Open the lookup-import dialog pre-filled with this line's
    /// MPN; after a successful import, re-run Fetch so the receive
    /// dialog's match column updates.
    function importLine(idx) {
        const li = preview && preview.lines[idx];
        if (!li) return;
        const mpn = (li.mpn || li.distributor_pn || "").trim();
        if (!mpn) {
            webix.message({ type: "error", text: "No MPN/SKU on this line." });
            return;
        }
        openLookupSearchDialog({
            prefillSource: source,  // mouser → mouser; digikey → digikey
            prefillMpn: mpn,
            // Force the imported PartDistributor.orderNumber to be the
            // *order line's* distributor SKU. Without this, Mouser
            // sometimes returns MouserPartNumber="N/A" and the line
            // never matches on re-fetch.
            forceDistributorPn: li.distributor_pn,
            onImported: async () => {
                // Refresh the parts grid so future stock-entries can land.
                try { await loadParts({ search: "" }); } catch (_) {}
                // Re-fetch the order so the just-imported line shows
                // matched. Cheaper than tracking partial state.
                if (preview) {
                    $$("pk-dk-rcv-id").setValue(String(preview.sales_order_id));
                    await runFetch();
                }
            },
        });
    }

    async function runApply() {
        if (!preview) return;
        const lines = [];
        preview.lines.forEach((li, i) => {
            const st = lineState[i];
            if (!st || !st.apply) return;
            if (!li.part_id) return;  // belt-and-braces; row hidden anyway
            if (!st.quantity || st.quantity <= 0) return;
            lines.push({
                part_id: li.part_id,
                quantity: st.quantity,
                price: li.unit_price ? li.unit_price.toFixed(4) : null,
                comment: null,
                // Per-line packaging metadata.
                form: st.form || "Loose",
                storage_location_id: st.storage_location_id || null,
                skip_psl_row: !!st.skip_psl_row,
            });
        });
        if (lines.length === 0) {
            webix.message({ type: "info", text: "No lines selected." });
            return;
        }
        const applyBtn = $$("pk-dk-rcv-apply");
        applyBtn.disable();
        try {
            const resp = await api.lookupOrderReceive(source, preview.sales_order_id, lines);
            webix.message({
                type: "success",
                text: `Stocked ${resp.applied} line${resp.applied === 1 ? "" : "s"} from SO #${preview.sales_order_id}.`,
            });
            $$(winId) && $$(winId).destructor();
            // Refresh the parts grid so updated stock levels show.
            await loadParts({ search: "" });
            // If a stock-changed part is currently selected, refresh detail too.
            const grid = $$("pk-parts-grid");
            if (grid) {
                const sel = grid.getSelectedId();
                if (sel && resp.results.some((r) => r.part_id === sel)) {
                    await loadPartDetail(sel);
                }
            }
        } catch (e) {
            applyBtn.enable();
            console.error(e);
            webix.message({ type: "error", text: "Apply failed: " + (e.message || e) });
        }
    }
}


// ============================================================
//  Compare distributors (TrustedParts.com)
// ============================================================

// Per-(MPN, mfg) in-memory cache with a 1-hour TTL. Stays well inside
// the TrustedParts.com 7-day storage cap, but lets a repeat-open of
// the same part within a session render instantly instead of round-
// tripping. Cache lives only as long as the page does — no persistence.
const _tpCompareCache = new Map();
const _TP_CACHE_TTL_MS = 60 * 60 * 1000;

function _tpCacheKey(mpn, manufacturer) {
    return `${(mpn || "").trim().toLowerCase()}|${(manufacturer || "").trim().toLowerCase()}`;
}

/// Open the "💲 Compare distributors" modal for a given part. Hits the
/// TrustedParts.com live aggregator via the backend and renders a grid
/// of authorized-distributor offers (stock / MOQ / pricing / links).
/// Results are not persisted to the local DB — TrustedParts.com TOS
/// forbids storing API data beyond 7 days. The grid disappears when
/// the modal closes.
async function openCompareDistributorsDialog(part) {
    if (!part || !part.id) {
        webix.message({ type: "error", text: "No part selected." });
        return;
    }
    const mpn = part.manufacturers && part.manufacturers[0] && part.manufacturers[0].part_number
        ? part.manufacturers[0].part_number.trim()
        : (part.name || "").trim();
    const manufacturer = part.manufacturers && part.manufacturers[0]
        ? (part.manufacturers[0].manufacturer_name || "").trim()
        : "";
    if (!mpn) {
        webix.message({ type: "error",
            text: "Part has no manufacturer part number — add one on the Manufacturers tab first." });
        return;
    }

    const winId = "pk-compare-dialog";
    if ($$(winId)) { $$(winId).destructor(); }

    webix.ui({
        view: "window",
        id: winId,
        modal: true,
        position: "center",
        width: 1180,
        height: 600,
        head: `Compare distributors — ${mpn}${manufacturer ? " · " + manufacturer : ""}`,
        body: {
            rows: [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 40,
                    cols: [
                        { view: "label", id: "pk-compare-status",
                          label: "Querying TrustedParts.com…", css: "pk-pane-title" },
                        {},
                        { view: "button", value: "↻ Refresh", width: 110,
                          tooltip: "Bypass the in-memory cache and re-query upstream",
                          click: () => runCompare(true) },
                    ],
                },
                {
                    view: "datatable",
                    id: "pk-compare-grid",
                    css: "pk-grid",
                    select: false,
                    columns: [
                        { id: "distributor_name", header: "Distributor", width: 200 },
                        { id: "sku", header: "SKU", width: 160,
                          template: function (o) {
                              if (!o.product_url) return escapeHtml(o.sku || "");
                              return `<a href="${escapeHtml(o.product_url)}" target="_blank" rel="noopener">${escapeHtml(o.sku || "")}</a>`;
                          },
                        },
                        { id: "stock_qty", header: { text: "Stock", css: "pk-th-numeric" },
                          width: 100, css: "pk-numeric",
                          template: function (o) {
                              if (o.stock_qty != null && o.stock_qty > 0) {
                                  return `<span class="pk-stock-add">${Math.round(o.stock_qty).toLocaleString()}</span>`;
                              }
                              if (o.stock_availability) return `<span class="pk-help-hint">${escapeHtml(o.stock_availability)}</span>`;
                              return `<span class="pk-stock-remove">—</span>`;
                          },
                        },
                        { id: "min_qty", header: { text: "MOQ", css: "pk-th-numeric" },
                          width: 80, css: "pk-numeric",
                          template: (o) => o.min_qty != null ? o.min_qty : "" },
                        { id: "_price1", header: { text: "Unit @1", css: "pk-th-numeric" },
                          width: 110, css: "pk-numeric",
                          template: function (o) {
                              const p = (o.price_breaks || [])[0];
                              if (!p) return "";
                              return escapeHtml(p.formatted || `${p.amount.toFixed(4)} ${o.currency || ""}`);
                          },
                        },
                        { id: "_price100", header: { text: "Unit @100+", css: "pk-th-numeric" },
                          width: 120, css: "pk-numeric",
                          template: function (o) {
                              const breaks = o.price_breaks || [];
                              // Find the break at qty >= 100 (or the largest qty available).
                              const target = breaks.find((b) => b.quantity >= 100)
                                  || breaks[breaks.length - 1];
                              if (!target) return "";
                              return escapeHtml(target.formatted || `${target.amount.toFixed(4)} ${o.currency || ""}`);
                          },
                        },
                        { id: "_links", header: "Links", width: 130,
                          template: function (o) {
                              const bits = [];
                              if (o.datasheet_url) {
                                  bits.push(`<a href="${escapeHtml(o.datasheet_url)}" target="_blank" rel="noopener">📄 datasheet</a>`);
                              }
                              if (o.product_url) {
                                  bits.push(`<a href="${escapeHtml(o.product_url)}" target="_blank" rel="noopener">🛒 open</a>`);
                              }
                              return bits.join(" · ");
                          },
                        },
                        { id: "_packaging", header: "Packaging", fillspace: true,
                          template: function (o) {
                              return (o.packaging || []).map(p =>
                                  `${escapeHtml(p.package_type || "")}${p.min_order_qty ? " (MOQ " + p.min_order_qty + ")" : ""}`
                              ).join(" · ");
                          },
                        },
                    ],
                    data: [],
                },
                {
                    view: "template",
                    id: "pk-compare-footer",
                    borderless: true,
                    height: 28,
                    css: "pk-help-hint",
                    template: '<div style="padding:6px 12px;font-size:11px;color:#6a7a8a"></div>',
                },
                {
                    cols: [
                        {},
                        { view: "button", value: "Close", width: 100,
                          click: () => $$(winId) && $$(winId).destructor() },
                    ],
                },
            ],
        },
    }).show();

    runCompare(false);

    async function runCompare(bypassCache) {
        const status = $$("pk-compare-status");
        const grid = $$("pk-compare-grid");
        const footer = $$("pk-compare-footer");
        if (!status || !grid || !footer) return;
        status.define("label", "Querying TrustedParts.com…");
        status.refresh();

        const cacheKey = _tpCacheKey(mpn, manufacturer);
        const now = Date.now();
        if (!bypassCache) {
            const hit = _tpCompareCache.get(cacheKey);
            if (hit && (now - hit.ts) < _TP_CACHE_TTL_MS) {
                renderResults(hit.resp, "cached");
                return;
            }
        }

        try {
            const resp = await api.lookupTrustedPartsCompare(mpn, manufacturer || null);
            _tpCompareCache.set(cacheKey, { ts: now, resp });
            renderResults(resp, "live");
        } catch (e) {
            console.error(e);
            grid.clearAll();
            status.define("label", "Query failed");
            status.refresh();
            footer.setHTML(`<div style="padding:6px 12px;font-size:11px;color:#aa2a2a">${escapeHtml(e.message || String(e))}</div>`);
        }
    }

    function renderResults(resp, kind) {
        const status = $$("pk-compare-status");
        const grid = $$("pk-compare-grid");
        const footer = $$("pk-compare-footer");
        if (!status || !grid || !footer) return;
        // Tag rows with synthetic ids so the datatable doesn't reject duplicates.
        const rows = (resp.offers || []).map((o, i) => Object.assign({ id: i + 1 }, o));
        grid.clearAll();
        grid.parse(rows);
        const tariffNote = resp.is_affected_by_tariff
            ? ` <span style="color:#aa6b2a">⚠ tariff-affected</span>` : "";
        status.define("label",
            `${rows.length} offer${rows.length === 1 ? "" : "s"} ` +
            `across ${resp.distributor_count} distributor${resp.distributor_count === 1 ? "" : "s"}` +
            (kind === "cached" ? " · cached" : "") + tariffNote);
        status.refresh();
        footer.setHTML(`<div style="padding:6px 12px;font-size:11px;color:#6a7a8a">${resp.attribution_html || ""}</div>`);
    }
}
