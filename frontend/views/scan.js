// SPDX-License-Identifier: GPL-3.0-or-later
//
// Scan workflow — barcode capture overlay, ANSI MH10.8.2 / ECC200
// parser, scan-receive dialog, three-way dispatch (matched+qty /
// matched / no-match), Inateck BCST-47 ALT-mode workaround.
//
// The PartStorageLocation form ENUM and form-priority helpers used
// elsewhere (consume-from-container) live here too because they
// originated in the scan-receive flow.
//
// Loaded after api.js, before app.js. Declares SCAN_FORM_OPTIONS,
// FORM_CONSUME_PRIORITY, handleScan(), openScanCaptureOverlay(),
// preferredConsumeRow() and friends at script-tag global scope.

"use strict";

/// Form ENUM values for PartStorageLocation. Mirrors the backend
/// VALID_FORMS list in handlers/part_locations.rs.
const SCAN_FORM_OPTIONS = [
    { id: "Reel",    value: "Reel" },
    { id: "CutTape", value: "CutTape" },
    { id: "Loose",   value: "Loose" },
    { id: "Tray",    value: "Tray" },
    { id: "Tube",    value: "Tube" },
    { id: "Feeder",  value: "Feeder" },
    { id: "Bag",     value: "Bag" },
    { id: "Other",   value: "Other" },
];

/// When consuming stock from a part with multiple
/// PartStorageLocation rows, default-pick by form priority — draw
/// from already-broken-into stock first so unbroken reels stay
/// intact for the next quantity-discount order. Lower index =
/// higher priority (preferred to consume from).
const FORM_CONSUME_PRIORITY = [
    "Loose", "CutTape", "Bag", "Tray", "Tube", "Reel", "Feeder", "Other",
];

function formConsumeRank(form) {
    const i = FORM_CONSUME_PRIORITY.indexOf(form || "Loose");
    return i < 0 ? 999 : i;
}

/// Pick the row to default-target for a consume. Skips zero-qty
/// rows; among the rest, lowest form-rank wins. Ties broken by
/// quantity descending (consume from the largest broken-into row
/// first), then row id ascending.
function preferredConsumeRow(rows) {
    const eligible = (rows || []).filter((r) => (r.quantity || 0) > 0);
    if (!eligible.length) return null;
    eligible.sort((a, b) => {
        const ra = formConsumeRank(a.form), rb = formConsumeRank(b.form);
        if (ra !== rb) return ra - rb;
        if ((b.quantity || 0) !== (a.quantity || 0)) return (b.quantity || 0) - (a.quantity || 0);
        return (a.id || 0) - (b.id || 0);
    });
    return eligible[0];
}

/// Reusable scan-receive dialog. Lands a stock-in **and** creates
/// a fresh PartStorageLocation row representing the physical
/// container that arrived (a reel, a cut-tape strip, ...). Per
/// receipt = per row, so three reels of the same part land as
/// three distinct rows in the part's Locations tab.
///
/// `opts`:
///   part:          { id, name }                    required
///   quantity:      number                          required, editable in dialog
///   distributor:   { id, name } | null             optional, attribution
///   sales_order_number: string | null              optional, attribution
///   lot_number:    string | null                   from "1T" data identifier
///   date_code:     string | null                   from "9D" data identifier
///   default_form:  one of SCAN_FORM_OPTIONS ids    default "Reel"
function openScanReceiveDialog(opts) {
    const winId = "pk-scan-receive";
    if ($$(winId)) { $$(winId).destructor(); }
    const part = opts.part;
    const dist = opts.distributor;

    // Storage locations from cache. Operator-convention bin —
    // typically named "(NOWHERE)" — is the default for new
    // entries via defaultStorageLocationId().
    const storageOptions = (lookupsCache && lookupsCache.storage_locations || [])
        .map((s) => ({ id: s.id, value: s.name }));

    const distLine = dist
        ? `<div style="color:#6a7a8a;font-size:12px">From <b>${escapeHtml(dist.name)}</b>` +
          (opts.sales_order_number ? ` SO #${escapeHtml(opts.sales_order_number)}` : "") + `</div>`
        : "";

    webix.ui({
        view: "window",
        id: winId,
        modal: true,
        position: "center",
        width: 480,
        head: "Receive scanned line",
        body: {
            view: "form",
            id: "pk-scan-receive-form",
            elements: [
                {
                    view: "template",
                    height: 50,
                    borderless: true,
                    template:
                        `<div style="padding:6px 4px">` +
                        `<div style="font-size:15px"><b>${escapeHtml(part.name || "")}</b></div>` +
                        distLine +
                        `</div>`,
                },
                { view: "counter", name: "quantity", label: "Quantity", labelWidth: 130,
                  min: 1, step: 1, value: opts.quantity || 1 },
                { view: "richselect", name: "form", label: "Form", labelWidth: 130,
                  options: SCAN_FORM_OPTIONS, value: opts.default_form || "Reel" },
                { view: "richselect", name: "storage_location_id", label: "Storage", labelWidth: 130,
                  options: storageOptions,
                  value: defaultStorageLocationId() },
                { view: "text", name: "lot_number", label: "Lot", labelWidth: 130,
                  value: opts.lot_number || "" },
                { view: "text", name: "date_code", label: "Date code", labelWidth: 130,
                  value: opts.date_code || "" },
                {
                    cols: [
                        {},
                        { view: "button", value: "Cancel", width: 100,
                          click: () => $$(winId) && $$(winId).destructor() },
                        { view: "button", value: "✓ Add stock",
                          css: "pk-btn-add", width: 140, hotkey: "enter",
                          click: () => doSubmit() },
                    ],
                },
            ],
        },
    }).show();

    async function doSubmit() {
        const v = $$("pk-scan-receive-form").getValues();
        const qty = parseInt(v.quantity, 10);
        if (!Number.isFinite(qty) || qty <= 0) {
            webix.message({ type: "error", text: "Quantity must be > 0." });
            return;
        }
        const storageId = parseInt(v.storage_location_id, 10);
        const body = {
            stock_level: qty,
            comment: opts.sales_order_number && dist
                ? `${dist.name} SO #${opts.sales_order_number} (scanned)`
                : "Barcode scan",
            correction: false,
            create_storage_row: true,
            form: v.form || "Reel",
            // 0 → unbinned (null storage)
            storage_location_id: storageId > 0 ? storageId : null,
            lot_number: (v.lot_number || "").trim() || null,
            date_code: (v.date_code || "").trim() || null,
        };
        if (dist && opts.sales_order_number) {
            body.distributor_id = dist.id;
            body.sales_order_number = opts.sales_order_number;
        }
        try {
            await api.addStockEntry(part.id, body);
            $$(winId) && $$(winId).destructor();
            await loadPartDetail(part.id);
            webix.message({ type: "success", text: `+${qty} stocked` });
        } catch (e) {
            webix.message({ type: "error", text: "Stock-in failed: " + (e.message || e) });
        }
    }
}

/// Module-scoped "last scanned part" memory: set whenever
/// handleScan navigates to a part. A subsequent pure-numeric
/// scan within PENDING_TTL_MS is treated as a quantity for
/// that part, enabling the Mini-Circuits-style two-barcode
/// workflow (one Code-39 for MPN, one for quantity).
const PENDING_TTL_MS = 30_000;
let pendingScanPart = null;  // { id, name, ts }

function notePendingScanPart(part) {
    pendingScanPart = part ? {
        id: part.id, name: part.name, ts: Date.now(),
    } : null;
}
function takePendingScanPart() {
    if (!pendingScanPart) return null;
    if (Date.now() - pendingScanPart.ts > PENDING_TTL_MS) {
        pendingScanPart = null;
        return null;
    }
    const out = pendingScanPart;
    pendingScanPart = null;
    return out;
}

/// Open a focused-capture overlay that intercepts every keydown
/// at the document level, suppresses browser shortcuts (Alt+digit
/// tab switching, Ctrl+T new tab, etc.), and reconstructs the
/// original scan payload — including non-printable chars that
/// Inateck/HID scanners emit via Alt+digit ASCII-codepoint
/// emulation (e.g., GS = Alt+0, Alt+2, Alt+9 → 0x1D).
///
/// Idle timeout (250ms with no key) or Enter finalizes the buffer
/// and dispatches to handleScan. Esc or backdrop-click cancels.
///
/// Why an overlay rather than a global always-on listener: we
/// need to preventDefault on EVERY key (otherwise Alt+1 still
/// switches tabs), which would block ordinary keyboard use of
/// the app. Scoping it to a visible overlay makes the trade-off
/// explicit to the operator and reversible.
function openScanCaptureOverlay() {
    if ($$("pk-scan-capture")) return;
    let buffer = "";
    let keyEvents = 0;
    let altDigitBuf = "";  // accumulating an Alt+digit triplet
    let idleTimer = null;

    function finalize() {
        cleanup();
        // Flush any half-built Alt+digit (rare; treat as plain digits).
        const final = buffer + altDigitBuf;
        if (final.trim()) handleScan(final);
    }
    function cancel() { cleanup(); }
    function cleanup() {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        document.removeEventListener("keydown", onKey, true);
        const ov = $$("pk-scan-capture");
        if (ov) ov.destructor();
    }
    function bumpIdle() {
        if (idleTimer) clearTimeout(idleTimer);
        // 350ms idle = scan complete. Scanners type at >200 cps,
        // so the burst finishes in well under that; 350ms is safe
        // even for very long 2D codes.
        idleTimer = setTimeout(finalize, 350);
    }
    function onKey(ev) {
        // Capture-phase listener: stop everything from reaching the
        // browser's chrome / focused widget.
        ev.preventDefault();
        ev.stopPropagation();
        keyEvents++;
        updateStatus();

        if (ev.key === "Escape") { cancel(); return; }

        // Alt+digit triplet: ASCII codepoint emulation. The OS
        // doesn't render the resulting char on Linux, so we
        // reconstruct it manually from the digit sequence.
        if (ev.altKey && ev.key.length === 1 && /^\d$/.test(ev.key)) {
            altDigitBuf += ev.key;
            // Codepoints in this scheme are 1-3 decimal digits with
            // leading zero(s). Three digits = complete (000-255 range).
            if (altDigitBuf.length >= 3) {
                const cp = parseInt(altDigitBuf, 10);
                if (Number.isFinite(cp) && cp >= 0 && cp <= 255) {
                    buffer += String.fromCharCode(cp);
                }
                altDigitBuf = "";
            }
            bumpIdle();
            return;
        }

        // A non-Alt key arrived — flush any half-built triplet as
        // plain digits (we likely misread the boundary).
        if (altDigitBuf) {
            buffer += altDigitBuf;
            altDigitBuf = "";
        }

        if (ev.key === "Enter") { finalize(); return; }

        if (ev.key.length === 1) {
            buffer += ev.key;
        }
        // Non-printable plain keys (Tab, F-keys, etc.) ignored —
        // they shouldn't appear in barcode payloads.

        bumpIdle();
    }
    function updateStatus() {
        const tpl = $$("pk-scan-capture-status");
        if (tpl) tpl.setHTML(
            `<div style="text-align:center;padding:24px">` +
            `<div style="font-size:32px;margin-bottom:12px">📷</div>` +
            `<div style="font-size:18px;color:#2a6fb0">Scanning…</div>` +
            `<div style="font-size:13px;color:#6a7a8a;margin-top:8px">` +
            `${keyEvents} key${keyEvents === 1 ? "" : "s"} captured · ` +
            `${buffer.length} char${buffer.length === 1 ? "" : "s"} buffered` +
            `</div>` +
            `<div style="font-size:12px;color:#aab;margin-top:14px">` +
            `Esc to cancel · auto-finalizes after 350ms idle</div>` +
            `</div>`,
        );
    }

    document.addEventListener("keydown", onKey, true);
    webix.ui({
        view: "window",
        id: "pk-scan-capture",
        modal: true,
        position: "center",
        width: 420, height: 220,
        head: "Scan capture",
        body: {
            view: "template",
            id: "pk-scan-capture-status",
            borderless: true,
            template: "<div style='text-align:center;padding:24px'>" +
                "<div style='font-size:32px;margin-bottom:12px'>📷</div>" +
                "<div style='font-size:18px;color:#2a6fb0'>Ready — scan now</div>" +
                "<div style='font-size:12px;color:#aab;margin-top:14px'>" +
                "Esc to cancel</div></div>",
        },
    }).show();
}

/// Look up the operator's "default / not-yet-placed" storage
/// location by convention. partkeepr-ng users historically use
/// a bin called something like "NOWHERE" or "(NOWHERE)" as the
/// catch-all. Fall back to the first cached location if no such
/// bin exists. Used as the default for new packaging entries
/// across the scan-receive, + Add stock, Split / move, and part
/// editor flows so an operator never has to pick "where does
/// this go" just to record stock.
function defaultStorageLocationId() {
    const list = (lookupsCache && lookupsCache.storage_locations) || [];
    if (list.length === 0) return null;
    const m = list.find((s) => /(^|\b|\()NOWHERE(\b|\))/i.test(s.name || ""));
    if (m) return m.id;
    return list[0].id;
}

/// Some HID scanners (Inateck BCST-47 in default mode) emit
/// non-printable chars (GS, RS, EOT) as ESC + decimal-digits-of-
/// the-codepoint. Reverse that so the rest of the parser sees
/// proper control bytes. Pattern is `\x1b<d1>\x1b<d2>\x1b<d3>`
/// where d1..d3 form a decimal codepoint (e.g., \x1b 0 \x1b 2 \x1b 9
/// → \x1d, GS). A two-digit form (\x1b 0 \x1b 4 → \x04, EOT) and
/// a one-digit form are also possible; greedy-match longest first.
function decodeAltModeChars(s) {
    // Replace longest first: 3-digit, 2-digit, 1-digit ESC sequences.
    // Each ESC+digit means "next digit of the decimal codepoint".
    return s
        .replace(/\x1b(\d)\x1b(\d)\x1b(\d)/g, (_, a, b, c) =>
            String.fromCharCode(parseInt(a + b + c, 10)))
        .replace(/\x1b(\d)\x1b(\d)/g, (_, a, b) =>
            String.fromCharCode(parseInt(a + b, 10)))
        .replace(/\x1b(\d)/g, (_, a) =>
            String.fromCharCode(parseInt(a, 10)));
}

/// Parse an ANSI MH10.8.2 / ECC200 barcode payload (the format
/// Digi-Key, Mouser, Newark, etc. all use on packing slips and
/// per-reel labels). Returns a flat object with the fields we
/// care about. Tolerates missing GS delimiters by walking the
/// known data-identifier prefixes; with GS present, splits cleanly
/// on GS first and parses each segment.
///
/// Data identifier reference (subset we use):
///   P    Customer item code (Digi-Key SKU)
///   1P   Supplier item code (manufacturer P/N)
///   30P  Additional item identification
///   Q    Quantity
///   K    Customer PO / order number
///   1K   Sales order number  ← canonical SO# we attribute on
///   10K  Invoice number
///   11K  Document number
///   9D   Date code
///   1T   Lot code
///   4L   Country of origin
function parseAnsiBarcode(payload) {
    const out = {
        digikey_pn: null, mpn: null, additional_pn: null,
        quantity: null, customer_po: null, sales_order_number: null,
        invoice_id: null, document_id: null, date_code: null,
        lot_code: null, country_of_origin: null,
    };
    // Strip the format header. ANSI standard is "[)>RS06GS<fields>"
    // but with stripped delimiters it'll be "[)>06<fields>".
    let body = payload;
    if (body.startsWith("[)>")) body = body.slice(3);
    body = body.replace(/^\x1e?06\x1d?/, "");  // strip "[RS]06[GS]"
    // Trim trailing terminator (RS EOT, optional).
    body = body.replace(/\x1e?\x04?$/, "");

    // Field segmentation: prefer GS-split when delimiters survive,
    // otherwise walk identifier prefixes. ANSI identifiers are 1-3
    // chars: digit-digit-letter, digit-letter, or just letter.
    // Order: try longest match first.
    const ids = ["30P","11K","10K", "1P","1K","1T", "4L","9D",
                 "P","Q","K","Z"];
    const segs = body.includes("\x1d")
        ? body.split("\x1d").filter(Boolean)
        : walkIdentifiers(body, ids);

    for (const seg of segs) {
        // Match the longest known prefix.
        const id = ids.find((p) => seg.startsWith(p));
        if (!id) continue;
        const v = seg.slice(id.length);
        switch (id) {
            case "P":   out.digikey_pn = v; break;
            case "1P":  out.mpn = v; break;
            case "30P": out.additional_pn = v; break;
            case "Q":   { const n = parseInt(v, 10); if (Number.isFinite(n) && n > 0) out.quantity = n; } break;
            case "K":   out.customer_po = v; break;
            case "1K":  out.sales_order_number = v; break;
            case "10K": out.invoice_id = v; break;
            case "11K": out.document_id = v; break;
            case "9D":  out.date_code = v; break;
            case "1T":  out.lot_code = v; break;
            case "4L":  out.country_of_origin = v; break;
            // "Z" (mutually defined) and unknown identifiers ignored.
        }
    }
    return out;
}

/// Greedy walker for delimiter-stripped barcodes. Given the body
/// after the format header, slice it into logical segments by
/// finding the next identifier prefix. Skip the terminator zeros
/// run that DK sometimes pads with at the end.
function walkIdentifiers(body, ids) {
    const out = [];
    let i = 0;
    while (i < body.length) {
        // Sentinel: long zero run (DK pads with 60+ zeros) ends parse.
        if (/^0{30,}$/.test(body.slice(i))) break;
        // Find the next identifier prefix from position i.
        let prefix = null;
        for (const p of ids) {
            if (body.startsWith(p, i)) { prefix = p; break; }
        }
        if (!prefix) { i++; continue; }
        // Find where this segment ends: the start of the next
        // identifier prefix.
        const start = i + prefix.length;
        let end = body.length;
        for (let j = start; j < body.length; j++) {
            for (const p of ids) {
                if (body.startsWith(p, j)) { end = j; break; }
            }
            if (end !== body.length) break;
        }
        out.push(body.slice(i, end));
        i = end;
    }
    return out;
}

/// Scan input dispatcher. Barcode scanners are HID keyboards that
/// type the value followed by Enter, so this gets called on every
/// scan as well as manual typing+Enter.
///
/// Four payload kinds, dispatched in order:
///  1. Distributor 2D codes (Digi-Key / Mouser packing slips and
///     per-reel labels): structured ANSI MH10.8.2 data → parse
///     locally → match against PartDistributor → stock-in or import
///  2. Pure-numeric scan after a recent part scan (Mini-Circuits-
///     style two-code reels: MPN barcode, then qty barcode) →
///     prompt to receive that quantity into the pending part.
///  3. Our own QR labels: "<host>/#/part/<id>" → jump to part by id
///  4. Plain text → existing IPN / MPN / SKU / name LIKE search
async function handleScan(raw) {
    const value = (raw || "").trim();
    if (!value) return;

    // Pattern 2: pure-digit follow-up to a recent part scan. Mini-
    // Circuits reels and others pair an MPN Code-39 with a separate
    // quantity Code-39; this lets the operator scan both in
    // sequence without typing. Bound: 1-5 digits, value 1-99999,
    // and a part scan within PENDING_TTL_MS. Distributor 2D codes
    // get checked first (they may also be all-digit-ish if RS
    // chars stripped out), and UPCs/EANs (12-13 digits) won't
    // qualify thanks to the length cap.
    if (/^\d{1,5}$/.test(value)) {
        const pending = takePendingScanPart();
        if (pending) {
            const qty = parseInt(value, 10);
            if (qty > 0) {
                openScanReceiveDialog({
                    part: pending,
                    quantity: qty,
                    distributor: null,           // mfr-only barcode pair, no SO
                    sales_order_number: null,
                    lot_number: null,
                    date_code: null,
                    default_form: "Reel",        // most likely on a reel
                });
                return;
            }
        }
        // No pending part — fall through to plain search (it'll
        // probably miss; that's OK).
    }

    // Pattern 1: distributor 2D barcode. Detect by ANSI MH10.8.2
    // header "[)>" with or without delimiters surviving the
    // scanner's HID encoding. Inateck's default ALT-mode emits
    // ESC+digits triplets in place of GS/RS — decodeAltModeChars
    // reverses that. After decoding, parse data identifiers
    // locally and match against PartDistributor via the existing
    // search endpoint.
    const decodedScan = decodeAltModeChars(value);
    if (decodedScan.startsWith("[)>")) {
        try {
            const fields = parseAnsiBarcode(decodedScan);
            await dispatchAnsiBarcode(fields);
        } catch (e) {
            console.error("ansi barcode parse failed", e);
            webix.message({ type: "error", text: "Barcode parse failed: " + (e.message || e) });
        }
        return;
    }

    // Pattern 2: our own QR-code URL ("/#/part/<id>"). Match either
    // a full URL or just the hash fragment, since some scanners
    // strip the host portion (URL Mode quirk on Inateck etc.).
    const hashMatch = value.match(/(?:#\/)part\/(\d+)$/);
    if (hashMatch) {
        const targetId = parseInt(hashMatch[1], 10);
        try {
            if ($$("pk-left-tabbar")) $$("pk-left-tabbar").setValue("tab-categories");
            const cell = $$("centerpane-grid");
            if (cell) cell.show();
            // Make sure target is in the grid — clear filters and load.
            await loadParts({ search: "" });
            const grid = $$("pk-parts-grid");
            if (grid && !grid.exists(targetId)) {
                // Fall back to a per-id detail load if grid filtering hides it.
            }
            if (grid && grid.exists(targetId)) {
                grid.select(targetId);
                grid.showItem(targetId);
            }
            await loadPartDetail(targetId);
            notePendingScanPart({ id: targetId, name: `part #${targetId}` });
            webix.message({ type: "success", text: `Scanned label → part #${targetId}` });
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Scan-to-part failed: " + (e.message || e) });
        }
        return;
    }

    try {
        // Pattern 3: plain IPN / name. Use the existing parts list
        // endpoint with a `search` term — backend already does
        // LIKE on name/description/IPN. Take the first hit.
        const resp = await api.parts({ search: value, limit: 5 });
        if (resp.items && resp.items.length) {
            const hit = resp.items[0];
            // If there's exactly one hit OR the first hit's IPN
            // matches the input exactly, jump straight to it.
            const exact = resp.items.find((p) => (p.internal_part_number || "") === value);
            const target = exact || hit;
            // Switch to parts mode + scroll-to-and-select.
            if ($$("pk-left-tabbar")) $$("pk-left-tabbar").setValue("tab-categories");
            const cell = $$("centerpane-grid");
            if (cell) cell.show();
            await loadParts({ search: "" });  // clear filters; ensure target is in the grid
            const grid = $$("pk-parts-grid");
            if (grid) {
                if (!grid.exists(target.id)) {
                    // Re-load parts targeted by id-search to make sure it's in view
                    await loadParts({ search: target.internal_part_number || target.name });
                }
                if (grid.exists(target.id)) {
                    grid.select(target.id);
                    grid.showItem(target.id);
                }
            }
            await loadPartDetail(target.id);
            notePendingScanPart(target);
            webix.message({ type: "success", text: `Found: ${target.name}` });
            return;
        }
        // No hit. If this looks like a numeric-only or short
        // alphanumeric vendor barcode, suggest the right next
        // step rather than just saying "not found".
        const isBareCode = /^[0-9]{8,}$|^[A-Z0-9]{6,12}$/.test(value);
        const hint = isBareCode
            ? ` — looks like a vendor barcode. If it was the small line code on a packing slip, scan the larger 2D code instead.`
            : "";
        webix.message({ type: "error", text: `No part for "${value}"${hint}` });
    } catch (e) {
        console.error(e);
        webix.message({ type: "error", text: "Scan failed: " + (e.message || e) });
    }
}

/// Infer which distributor a scanned barcode comes from. The two
/// signals we use:
///  - Canonical DK SKU suffix is "-ND". If P ends in "-ND" → DK.
///  - Mouser per-reel labels put the MPN in the P field (no Mouser
///    SKU on reel labels — only on packing slips). So when P
///    equals 1P, or starts with a "<digits>-" prefix, classify
///    as Mouser.
///  - Otherwise null and the dialog falls back to the user's
///    last-used source.
/// `sku` is the value of the `P` data identifier; `mpn` is `1P`.
function inferSourceFromSku(sku, mpn) {
    if (!sku) return null;
    if (/-ND$/.test(sku)) return "digikey";
    if (mpn && sku === mpn) return "mouser";
    if (/^\d{2,4}-/.test(sku)) return "mouser";
    return null;
}

/// Dispatch a locally-parsed ANSI MH10.8.2 barcode (the output of
/// parseAnsiBarcode). Uses the parts search endpoint (which now
/// LIKE-matches PartDistributor.orderNumber + PartManufacturer.partNumber)
/// to find the local part. Three-way dispatch: stock-in for matched +
/// qty, navigate for matched + no qty, import dialog for no match.
async function dispatchAnsiBarcode(fields) {
    const sku = (fields.digikey_pn || "").trim();
    const mpn = (fields.mpn || "").trim();
    const so  = (fields.sales_order_number || fields.customer_po || "").trim();

    // Resolve distributor + part from the SKU directly. This nails
    // attribution: a Mouser scan tags the StockEntry as Mouser, a
    // Digi-Key scan as Digi-Key, etc., without guessing from
    // SKU-prefix patterns.
    let matched = null;
    let distributor = null;  // { id, name } when SKU matched a PartDistributor row
    if (sku) {
        try {
            const hit = await api.partByDistributorSku(sku);
            if (hit) {
                matched = { id: hit.part_id, name: hit.part_name, stock_level: hit.stock_level };
                distributor = { id: hit.distributor_id, name: hit.distributor_name };
            }
        } catch (e) { console.warn("sku lookup failed:", e); }
    }
    // Fallback: free-form search by SKU then MPN (catches matches
    // where the part has the MPN but no PartDistributor row yet).
    if (!matched) {
        for (const probe of [sku, mpn]) {
            if (!probe) continue;
            const resp = await api.parts({ search: probe, limit: 5 });
            if (resp.items && resp.items.length) { matched = resp.items[0]; break; }
        }
    }

    if (matched) {
        try {
            if ($$("pk-left-tabbar")) $$("pk-left-tabbar").setValue("tab-categories");
            const cell = $$("centerpane-grid");
            if (cell) cell.show();
            await loadParts({ search: "" });
            const grid = $$("pk-parts-grid");
            if (grid && grid.exists(matched.id)) {
                grid.select(matched.id); grid.showItem(matched.id);
            }
            await loadPartDetail(matched.id);
            notePendingScanPart(matched);
        } catch (_) {}

        if (fields.quantity && fields.quantity > 0) {
            openScanReceiveDialog({
                part: matched,
                quantity: fields.quantity,
                distributor: distributor,         // null if SKU didn't match a distributor row
                sales_order_number: so || null,
                lot_number: fields.lot_code || null,
                date_code: fields.date_code || null,
                // PackList2D codes carry SO# + qty → packing slip
                // line; the physical container is *probably* a
                // reel but operator can flip to CutTape/Loose.
                default_form: "Reel",
            });
        } else {
            const bits = [];
            if (fields.lot_code)  bits.push(`lot ${fields.lot_code}`);
            if (fields.date_code) bits.push(`date ${fields.date_code}`);
            if (fields.country_of_origin) bits.push(fields.country_of_origin);
            webix.message({
                type: "success",
                text: `Found ${escapeHtml(matched.name || "")}` +
                    (bits.length ? ` · ${bits.join(" · ")}` : ""),
            });
        }
        return;
    }

    if (!sku && !mpn) {
        webix.message({ type: "error", text: "Barcode parsed but no MPN/SKU recognized." });
        return;
    }
    // Infer source from SKU pattern so the import dialog opens
    // with the right distributor pre-selected — otherwise a
    // Mouser scan would import through the Digi-Key search and
    // mis-attribute the PartDistributor row.
    // SKU-pattern inference, with last-used source as fallback so
    // ambiguous scans honor the operator's recent context.
    const lastSourceKey = `pk:lookup:last-source:${currentUser ? currentUser.username : "anon"}`;
    const lastUsed = localStorage.getItem(lastSourceKey);
    const inferredSource = inferSourceFromSku(sku, mpn)
        || (lastUsed === "mouser" || lastUsed === "digikey" ? lastUsed : "digikey");
    const sourceLabel = inferredSource === "mouser" ? "Mouser" : "Digi-Key";
    webix.message({
        type: "info",
        text: `Scanned ${sku || mpn} — not in inventory yet, opening ${sourceLabel} import dialog.`,
    });
    // Force the distributor SKU into the imported PartDistributor
    // row only when P is *demonstrably* a distributor SKU — not
    // when it's just the MPN (Mouser reel labels put the MPN in P
    // and don't carry a Mouser SKU). Otherwise the search result's
    // own SKU value lands correctly via the normal import path.
    const skuLooksLikeSku = sku && sku !== mpn
        && (/-ND$/.test(sku) || /^\d{2,4}-/.test(sku));
    const forceSku = skuLooksLikeSku ? sku : "";

    openLookupSearchDialog({
        prefillSource: inferredSource,
        prefillMpn: mpn || sku,
        forceDistributorPn: forceSku,
        onImported: async (resp) => {
            try { await loadParts({ search: "" }); } catch (_) {}
            if (fields.quantity && fields.quantity > 0 && resp && resp.part_id) {
                const distName = sourceLabel.toLowerCase();
                const dist = (lookupsCache && lookupsCache.distributors || [])
                    .find((d) => (d.name || "").toLowerCase() === distName);
                openScanReceiveDialog({
                    part: { id: resp.part_id, name: mpn || sku },
                    quantity: fields.quantity,
                    distributor: dist || null,
                    sales_order_number: so || null,
                    lot_number: fields.lot_code || null,
                    date_code: fields.date_code || null,
                    default_form: "Reel",
                });
            }
        },
    });
}

/// (Older) After /api/lookup/digikey/barcode decodes a 2D scan, dispatch
/// based on whether we found a local match:
///  - matched + has quantity (PackList2D from a packing slip):
///      jump to part, prompt to add the qty to stock with SO#
///      attribution.
///  - matched + no quantity (Product2D from a per-reel label):
///      jump to part. Lot/date/country code shown as toast for
///      reference (no auto-stock — operator decides what to do).
///  - no match: open lookup-import dialog pre-filled with the
///      scanned MPN + force the imported PartDistributor's
///      orderNumber to the scanned DK SKU.
async function dispatchBarcodeResult(decoded) {
    const skuLabel = decoded.digikey_pn ? ` ${decoded.digikey_pn}` : "";
    if (decoded.part_id) {
        // Navigate to part.
        try {
            if ($$("pk-left-tabbar")) $$("pk-left-tabbar").setValue("tab-categories");
            const cell = $$("centerpane-grid");
            if (cell) cell.show();
            await loadParts({ search: "" });
            const grid = $$("pk-parts-grid");
            if (grid && grid.exists(decoded.part_id)) {
                grid.select(decoded.part_id);
                grid.showItem(decoded.part_id);
            }
            await loadPartDetail(decoded.part_id);
        } catch (e) {
            console.warn("post-decode navigation:", e);
        }
        // Offer stock-in if the barcode carries a quantity (i.e.
        // it was a PackList2D scan from a packing slip).
        if (decoded.quantity && decoded.quantity > 0) {
            const so = decoded.sales_order_number ? ` from SO #${decoded.sales_order_number}` : "";
            webix.confirm({
                title: "Receive scanned line",
                text: `Add <b>+${decoded.quantity}</b> to <b>${escapeHtml(decoded.part_name || "")}</b>${so}?`,
                ok: "Add stock", cancel: "Skip",
            }).then(async (yes) => {
                if (!yes) return;
                try {
                    const body = {
                        stock_level: decoded.quantity,
                        comment: decoded.sales_order_number
                            ? `Digi-Key SO #${decoded.sales_order_number} (scanned)`
                            : "Digi-Key barcode scan",
                        correction: false,
                    };
                    if (decoded.sales_order_number) {
                        // Resolve Digi-Key distributor_id from cache.
                        const dk = (lookupsCache && lookupsCache.distributors || [])
                            .find((d) => (d.name || "").toLowerCase() === "digi-key");
                        if (dk) {
                            body.distributor_id = dk.id;
                            body.sales_order_number = decoded.sales_order_number;
                        }
                    }
                    await api.addStockEntry(decoded.part_id, body);
                    await loadPartDetail(decoded.part_id);
                    webix.message({ type: "success", text: `+${decoded.quantity} stocked` });
                } catch (e) {
                    webix.message({ type: "error", text: "Stock-in failed: " + (e.message || e) });
                }
            });
        } else {
            // Per-reel label — just surface the traceability fields.
            const bits = [];
            if (decoded.lot_code)  bits.push(`lot ${decoded.lot_code}`);
            if (decoded.date_code) bits.push(`date ${decoded.date_code}`);
            if (decoded.country_of_origin) bits.push(decoded.country_of_origin);
            webix.message({
                type: "success",
                text: `Found ${escapeHtml(decoded.part_name || "")}` +
                    (bits.length ? ` · ${bits.join(" · ")}` : ""),
            });
        }
    } else {
        // No local match — offer to import via the lookup dialog.
        const mpn = (decoded.mpn || "").trim();
        if (!mpn && !decoded.digikey_pn) {
            webix.message({ type: "error", text: "Barcode decoded but no MPN/SKU returned." });
            return;
        }
        webix.message({
            type: "info",
            text: `Scanned${skuLabel} — opening import dialog…`,
        });
        openLookupSearchDialog({
            prefillSource: "digikey",
            prefillMpn: mpn || decoded.digikey_pn,
            forceDistributorPn: decoded.digikey_pn || "",
            onImported: async () => {
                // After import, refresh parts grid; if the barcode
                // also had a quantity, prompt to stock it now.
                try { await loadParts({ search: "" }); } catch (_) {}
                if (decoded.quantity && decoded.quantity > 0 && decoded.digikey_pn) {
                    // Quietly re-decode to pick up the freshly-matched part_id.
                    try {
                        const re = await api.digikeyBarcode(decoded.raw || decoded.digikey_pn);
                        if (re.part_id) await dispatchBarcodeResult(re);
                    } catch (_) {}
                }
            },
        });
    }
}

