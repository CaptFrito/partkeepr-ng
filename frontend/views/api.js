// SPDX-License-Identifier: GPL-3.0-or-later
//
// API client. Wraps every fetch() call to the backend.
// Loaded before app.js — declares `api` at script-tag global
// scope so all subsequent scripts can reference it by name.

"use strict";

// ============================================================
//  API client
// ============================================================

const api = {
    async me() {
        const r = await fetch("/api/me");
        if (r.status === 401) return null;
        if (!r.ok) throw new Error(`/api/me failed: ${r.status}`);
        return r.json();
    },
    async login(username, password) {
        const r = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });
        if (r.status === 401) return { ok: false, reason: "bad-credentials" };
        if (!r.ok) return { ok: false, reason: "server-error", status: r.status };
        return { ok: true, body: await r.json() };
    },
    async logout() {
        await fetch("/api/logout", { method: "POST" });
    },
    async categoryTree() {
        const r = await fetch("/api/part_categories/tree");
        if (!r.ok) throw new Error(`category tree failed: ${r.status}`);
        return r.json();
    },
    async parts({ filter, search, byField, predicates, footprint_ids, category_ids, limit = 500, offset = 0 } = {}) {
        // Switch to the parametric endpoint when predicates OR a
        // footprint OR a category multi-select is set. Any of
        // these alone is a valid query.
        const hasPreds = predicates && predicates.length;
        const hasFps   = footprint_ids && footprint_ids.length;
        const hasCats  = category_ids && category_ids.length;
        if (hasPreds || hasFps || hasCats) {
            const body = { predicates: predicates || [], limit, offset };
            if (hasFps)  body.footprint_ids = footprint_ids;
            if (hasCats) body.category_ids = category_ids;
            // Legacy single-id filter from a left-tree click. Tree
            // ids come back as strings ("83"), but the backend
            // ParametricBody expects i32 — coerce.
            if (filter && filter.kind && filter.id != null) {
                const n = parseInt(filter.id, 10);
                body[filter.kind] = Number.isFinite(n) ? n : filter.id;
            }
            if (search) body.search = search;
            if (byField) Object.assign(body, byField);
            const r = await fetch("/api/parts/parametric", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`parametric search failed: ${r.status} ${await r.text()}`);
            return r.json();
        }
        const p = new URLSearchParams();
        if (filter && filter.kind && filter.id != null) {
            p.set(filter.kind, String(filter.id));
        }
        if (search) p.set("search", search);
        if (byField) {
            if (byField.stock_mode) p.set("stock_mode", byField.stock_mode);
            if (byField.meta_only != null) p.set("meta_only", String(byField.meta_only));
            if (byField.distributor_id) p.set("distributor_id", String(byField.distributor_id));
            if (byField.price_min != null && byField.price_min !== "") p.set("price_min", String(byField.price_min));
            if (byField.price_max != null && byField.price_max !== "") p.set("price_max", String(byField.price_max));
        }
        p.set("limit", String(limit));
        p.set("offset", String(offset));
        const r = await fetch("/api/parts?" + p.toString());
        if (!r.ok) throw new Error(`parts list failed: ${r.status}`);
        return r.json();
    },
    async parametricNames() {
        const r = await fetch("/api/part_parameters/names");
        if (!r.ok) throw new Error(`names failed: ${r.status}`);
        return r.json();
    },
    async storageTree() {
        const r = await fetch("/api/storage_tree");
        if (!r.ok) throw new Error(`storage tree failed: ${r.status}`);
        return r.json();
    },
    async footprintTree() {
        const r = await fetch("/api/footprint_tree");
        if (!r.ok) throw new Error(`footprint tree failed: ${r.status}`);
        return r.json();
    },
    async createPartCategory(body) {
        const r = await fetch("/api/part_categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`create category failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async updatePartCategory(id, body) {
        const r = await fetch(`/api/part_categories/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`update category failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async deletePartCategory(id) {
        const r = await fetch(`/api/part_categories/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete category failed: ${r.status} ${await r.text()}`);
    },
    async movePartCategory(id, newParentId) {
        const r = await fetch(`/api/part_categories/${id}/move`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ new_parent_id: newParentId }),
        });
        if (!r.ok) throw new Error(`move category failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async partCategoryById(id) {
        // No GET-by-id endpoint; the tree returns only name/path. We
        // need the description for the edit dialog, so fetch from a
        // helper endpoint. If it doesn't exist, fall back to "" — the
        // backend update accepts an empty description.
        const r = await fetch("/api/part_categories");
        if (!r.ok) return null;
        const flat = await r.json();
        return flat.find((c) => c.id === id) || null;
    },
    async part(id) {
        const r = await fetch("/api/parts/" + id);
        if (!r.ok) throw new Error(`part ${id} failed: ${r.status}`);
        return r.json();
    },
    async addStockEntry(partId, body) {
        const r = await fetch(`/api/parts/${partId}/stock-entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const txt = await r.text();
            throw new Error(`stock save failed: ${r.status} ${txt}`);
        }
        return r.json();
    },
    async deletePart(id) {
        const r = await fetch(`/api/parts/${id}`, { method: "DELETE" });
        if (!r.ok) {
            const txt = await r.text();
            throw new Error(`delete failed: ${r.status} ${txt}`);
        }
    },
    async updatePart(id, body) {
        const r = await fetch(`/api/parts/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const txt = await r.text();
            throw new Error(`update failed: ${r.status} ${txt}`);
        }
        return r.json();
    },
    async createPart(body) {
        const r = await fetch("/api/parts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const txt = await r.text();
            throw new Error(`create failed: ${r.status} ${txt}`);
        }
        return r.json();
    },
    async lookups() {
        const fetchJson = (u) => fetch(u).then((r) => {
            if (!r.ok) throw new Error(`${u} failed: ${r.status}`);
            return r.json();
        });
        const [categories_tree, footprints, manufacturers, distributors, storage_locations, part_units, units, prefixes] =
            await Promise.all([
                fetchJson("/api/part_categories/tree"),
                fetchJson("/api/footprints"),
                fetchJson("/api/manufacturers"),
                fetchJson("/api/distributors"),
                fetchJson("/api/storage_locations"),
                fetchJson("/api/part_measurement_units"),
                fetchJson("/api/units"),
                fetchJson("/api/si_prefixes"),
            ]);
        return { categories_tree, footprints, manufacturers, distributors, storage_locations, part_units, units, prefixes };
    },

    // Storage location categories
    async createStorageCategory(body) {
        const r = await fetch("/api/storage_location_categories", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`create storage cat failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async updateStorageCategory(id, body) {
        const r = await fetch(`/api/storage_location_categories/${id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`update storage cat failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async deleteStorageCategory(id) {
        const r = await fetch(`/api/storage_location_categories/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete storage cat failed: ${r.status} ${await r.text()}`);
    },
    async moveStorageCategory(id, newParentId) {
        const r = await fetch(`/api/storage_location_categories/${id}/move`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ new_parent_id: newParentId }),
        });
        if (!r.ok) throw new Error(`move storage cat failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async storageCategoryById(id) {
        const r = await fetch("/api/storage_location_categories");
        if (!r.ok) return null;
        const flat = await r.json();
        return flat.find((c) => c.id === id) || null;
    },

    // Storage locations (leaves)
    async createStorageLocation(body) {
        const r = await fetch("/api/storage_locations", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`create storage location failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async updateStorageLocation(id, body) {
        const r = await fetch(`/api/storage_locations/${id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`update storage location failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async deleteStorageLocation(id) {
        const r = await fetch(`/api/storage_locations/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete storage location failed: ${r.status} ${await r.text()}`);
    },
    async moveStorageLocation(id, newCategoryId) {
        const r = await fetch(`/api/storage_locations/${id}/move`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ new_category_id: newCategoryId }),
        });
        if (!r.ok) throw new Error(`move storage location failed: ${r.status} ${await r.text()}`);
        return r.json();
    },

    // Footprint categories
    async createFootprintCategory(body) {
        const r = await fetch("/api/footprint_categories", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`create footprint cat failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async updateFootprintCategory(id, body) {
        const r = await fetch(`/api/footprint_categories/${id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`update footprint cat failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async deleteFootprintCategory(id) {
        const r = await fetch(`/api/footprint_categories/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete footprint cat failed: ${r.status} ${await r.text()}`);
    },
    async moveFootprintCategory(id, newParentId) {
        const r = await fetch(`/api/footprint_categories/${id}/move`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ new_parent_id: newParentId }),
        });
        if (!r.ok) throw new Error(`move footprint cat failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async footprintCategoryById(id) {
        const r = await fetch("/api/footprint_categories");
        if (!r.ok) return null;
        const flat = await r.json();
        return flat.find((c) => c.id === id) || null;
    },

    // Footprints (leaves)
    async createFootprint(body) {
        const r = await fetch("/api/footprints", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`create footprint failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async updateFootprint(id, body) {
        const r = await fetch(`/api/footprints/${id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`update footprint failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async deleteFootprint(id) {
        const r = await fetch(`/api/footprints/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete footprint failed: ${r.status} ${await r.text()}`);
    },
    async moveFootprint(id, newCategoryId) {
        const r = await fetch(`/api/footprints/${id}/move`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ new_category_id: newCategoryId }),
        });
        if (!r.ok) throw new Error(`move footprint failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async footprintById(id) {
        const r = await fetch("/api/footprints");
        if (!r.ok) return null;
        const flat = await r.json();
        return flat.find((f) => f.id === id) || null;
    },

    // Generic CRUD for the 5 flat lookups. URL paths and write shapes
    // are configured in the LOOKUP_TYPES table below.
    async lookupList(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${url} failed: ${r.status}`);
        return r.json();
    },
    async lookupCreate(url, body) {
        const r = await fetch(url, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`create failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async lookupUpdate(url, id, body) {
        const r = await fetch(`${url}/${id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`update failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async lookupMerge(url, sourceId, targetId) {
        const r = await fetch(`${url}/${sourceId}/merge_into`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_id: targetId }),
        });
        if (!r.ok) throw new Error(`merge failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async lookupDelete(url, id) {
        const r = await fetch(`${url}/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete failed: ${r.status} ${await r.text()}`);
    },

    // Attachments
    async listAttachments(kind, parentId) {
        const path = ATTACHMENT_KINDS[kind].listPath(parentId);
        const r = await fetch(path);
        if (!r.ok) throw new Error(`list attachments failed: ${r.status}`);
        return r.json();
    },
    async fetchAttachmentByUrl(kind, parentId, url, filename) {
        const path = ATTACHMENT_KINDS[kind].listPath(parentId) + "/by-url";
        const body = { url };
        if (filename) body.filename = filename;
        const r = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`fetch by URL failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async updateAttachmentDescription(kind, id, description) {
        const r = await fetch(`/api/attachments/${kind}/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: description || null }),
        });
        if (!r.ok) throw new Error(`update description failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async deleteAttachment(kind, id) {
        const r = await fetch(`/api/attachments/${kind}/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete attachment failed: ${r.status} ${await r.text()}`);
    },

    // Projects
    async listProjects() {
        const r = await fetch("/api/projects");
        if (!r.ok) throw new Error(`projects list failed: ${r.status}`);
        return r.json();
    },
    async projectById(id) {
        const r = await fetch(`/api/projects/${id}`);
        if (!r.ok) throw new Error(`project ${id} failed: ${r.status}`);
        return r.json();
    },
    async createProject(body) {
        const r = await fetch("/api/projects", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`create project failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async updateProject(id, body) {
        const r = await fetch(`/api/projects/${id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`update project failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async deleteProject(id) {
        const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete project failed: ${r.status} ${await r.text()}`);
    },
    async addBomLine(projectId, body) {
        const r = await fetch(`/api/projects/${projectId}/parts`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`add BOM line failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async updateBomLine(projectId, ppid, body) {
        const r = await fetch(`/api/projects/${projectId}/parts/${ppid}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`update BOM line failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async deleteBomLine(projectId, ppid) {
        const r = await fetch(`/api/projects/${projectId}/parts/${ppid}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete BOM line failed: ${r.status} ${await r.text()}`);
    },
    async runPreview(projectId, quantity) {
        const r = await fetch(`/api/projects/${projectId}/runs/preview?quantity=${quantity}`);
        if (!r.ok) throw new Error(`run preview failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async runProject(projectId, body) {
        const r = await fetch(`/api/projects/${projectId}/runs`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`run project failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async listRuns(projectId) {
        const r = await fetch(`/api/projects/${projectId}/runs`);
        if (!r.ok) throw new Error(`list runs failed: ${r.status}`);
        return r.json();
    },
    async deleteRun(projectId, runId, restoreStock) {
        const url = `/api/projects/${projectId}/runs/${runId}` + (restoreStock ? "?restore_stock=true" : "");
        const r = await fetch(url, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete run failed: ${r.status} ${await r.text()}`);
    },
    async partProjects(partId) {
        const r = await fetch(`/api/parts/${partId}/projects`);
        if (!r.ok) throw new Error(`part-projects failed: ${r.status}`);
        return r.json();
    },
    async partRuns(partId) {
        const r = await fetch(`/api/parts/${partId}/runs`);
        if (!r.ok) throw new Error(`part-runs failed: ${r.status}`);
        return r.json();
    },
    async partByDistributorSku(sku) {
        const r = await fetch(`/api/parts/by_distributor_sku?sku=${encodeURIComponent(sku)}`);
        if (!r.ok) throw new Error(`sku lookup failed: ${r.status}`);
        return r.json();  // SkuLookupHit | null
    },
    async partReceipts(partId) {
        const r = await fetch(`/api/parts/${partId}/stock-receipts`);
        if (!r.ok) throw new Error(`part-receipts failed: ${r.status}`);
        const data = await r.json();
        return data.receipts || [];
    },
    async partLocations(partId) {
        const r = await fetch(`/api/parts/${partId}/locations`);
        if (!r.ok) throw new Error(`locations list failed: ${r.status}`);
        return r.json();
    },
    async createPartLocation(partId, body) {
        const r = await fetch(`/api/parts/${partId}/locations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`create location failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async updatePartLocation(partId, lid, body) {
        const r = await fetch(`/api/parts/${partId}/locations/${lid}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`update location failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async deletePartLocation(partId, lid) {
        const r = await fetch(`/api/parts/${partId}/locations/${lid}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete location failed: ${r.status} ${await r.text()}`);
    },
    async printCapabilities() {
        const r = await fetch("/api/print/capabilities");
        if (!r.ok) throw new Error(`capabilities failed: ${r.status}`);
        return r.json();
    },
    async printLabel(body) {
        const r = await fetch("/api/print/label", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data && data.error) || `print failed: ${r.status}`);
        return data;
    },
    async printerInfo() {
        const r = await fetch("/api/print/printer_info");
        if (!r.ok) throw new Error(`printer info failed: ${r.status}`);
        return r.json();
    },
    async lookupCapabilities() {
        const r = await fetch("/api/lookup/capabilities");
        if (!r.ok) throw new Error(`lookup capabilities failed: ${r.status}`);
        return r.json();
    },
    async lookupTrustedPartsCompare(mpn, manufacturer) {
        const r = await fetch("/api/lookup/trustedparts/compare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mpn, manufacturer }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data && data.error) || `trustedparts compare failed: ${r.status}`);
        return data;
    },
    async lookupSearch(source, q, by) {
        const r = await fetch(`/api/lookup/${encodeURIComponent(source)}/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ q, by }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data && data.error) || `${source} search failed: ${r.status}`);
        return data;
    },
    async lookupImport(source, result, categoryId, partUnitId) {
        const r = await fetch(`/api/lookup/${encodeURIComponent(source)}/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ result, category_id: categoryId, part_unit_id: partUnitId }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data && data.error) || `${source} import failed: ${r.status}`);
        return data;
    },
    async digikeyBarcode(payload) {
        const r = await fetch("/api/lookup/digikey/barcode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data && data.error) || `digikey barcode failed: ${r.status}`);
        return data;
    },
    async lookupOrderStatus(source, orderId) {
        const r = await fetch(`/api/lookup/${encodeURIComponent(source)}/order-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_id: orderId }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data && data.error) || `${source} order-status failed: ${r.status}`);
        return data;
    },
    async lookupOrderReceive(source, orderId, lines) {
        const r = await fetch(`/api/lookup/${encodeURIComponent(source)}/order-receive`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_id: orderId, lines }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data && data.error) || `${source} order-receive failed: ${r.status}`);
        return data;
    },
    async metaMatches(metaPartId) {
        const r = await fetch(`/api/parts/${metaPartId}/matches?limit=200`);
        if (!r.ok) throw new Error(`meta matches failed: ${r.status} ${await r.text()}`);
        return r.json();  // {items, total, limit, offset}
    },
    async listGridPresets(grid) {
        const r = await fetch("/api/grid_presets?grid=" + encodeURIComponent(grid));
        if (!r.ok) throw new Error(`list grid presets failed: ${r.status}`);
        return r.json();
    },
    async createGridPreset(body) {
        const r = await fetch("/api/grid_presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`create grid preset failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async updateGridPreset(id, body) {
        const r = await fetch(`/api/grid_presets/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`update grid preset failed: ${r.status} ${await r.text()}`);
        return r.json();
    },
    async deleteGridPreset(id) {
        const r = await fetch(`/api/grid_presets/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`delete grid preset failed: ${r.status} ${await r.text()}`);
    },
};

