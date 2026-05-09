// partkeepr-ng — Webix frontend.
//
// Same-origin with the API: backend serves these files via tower-http
// ServeDir. Session cookie rides along automatically; no CORS, no
// `credentials: include` needed.

(function () {
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

    // ============================================================
    //  Mount management
    // ============================================================

    let topView = null;
    let currentUser = null;  // set on login so per-user state can key on it

    function unmount() {
        if (topView) {
            try { topView.destructor(); } catch (_) {}
            topView = null;
        }
    }

    // ============================================================
    //  Login window
    // ============================================================

    function mountLogin() {
        unmount();
        topView = webix.ui({
            view: "window",
            id: "pk-login",
            css: "pk-login-window",
            modal: true,
            move: false,
            position: "center",
            width: 360,
            head: "Sign in to PartKeeper",
            body: {
                view: "form",
                id: "pk-login-form",
                elements: [
                    { view: "text", name: "username", label: "Username", labelWidth: 90 },
                    { view: "text", type: "password", name: "password", label: "Password", labelWidth: 90 },
                    { view: "label", id: "pk-login-error", label: "", hidden: true },
                    {
                        cols: [
                            {},
                            {
                                view: "button",
                                value: "Sign in",
                                css: "webix_primary",
                                width: 110,
                                hotkey: "enter",
                                click: doLogin,
                            },
                        ],
                    },
                ],
            },
        });
        topView.show();
        setTimeout(() => {
            const form = $$("pk-login-form");
            if (form) form.focus();
        }, 0);
    }

    async function doLogin() {
        const form = $$("pk-login-form");
        const errLabel = $$("pk-login-error");
        const data = form.getValues();
        if (!data.username || !data.password) {
            errLabel.setValue("Username and password are required.");
            errLabel.show();
            return;
        }
        errLabel.hide();
        const result = await api.login(data.username, data.password);
        if (!result.ok) {
            errLabel.setValue(
                result.reason === "bad-credentials"
                    ? "Username or password not recognised."
                    : "Sign-in failed (server error)."
            );
            errLabel.show();
            return;
        }
        mountShell(result.body.user);
    }

    // ============================================================
    //  Main shell — three-column PartManager layout
    // ============================================================

    function mountShell(user) {
        unmount();
        currentUser = user;
        topView = webix.ui({
            id: "pk-app",
            rows: [
                buildHeader(user),
                {
                    cols: [
                        buildLeftPane(),
                        { view: "resizer" },
                        buildCenterPane(),
                        { view: "resizer" },
                        buildRightPane(),
                    ],
                },
            ],
        });
        loadCategoryTree();
        ensureFilterDistributorsLoaded();
        // Restore per-user parts-grid layout (W8c).
        setTimeout(restorePartsGridState, 0);
        // Slice 12a.1: figure out which lookup sources are
        // available; reveal the "🔎 Add via Mouser" button on hit.
        refreshLookupCapabilities();

        // Lazy-load the other trees the first time the user switches to
        // them. Webix tabbar with multiview:true auto-fires onChange when
        // the active cell changes; we hook for two reasons:
        //   1. trigger the lazy load
        //   2. swap the center pane between parts grid and lookups grid
        $$("pk-left-tabbar").attachEvent("onChange", function (newId) {
            if (newId === "tab-storage") loadStorageTree();
            else if (newId === "tab-footprints") loadFootprintTree();
            else if (newId === "tab-projects") loadProjectsList();
            // Swap center cell to match the left-pane mode:
            //   tree tabs (categories/storage/footprints) → parts grid
            //   projects                                   → project view
            //   lookups                                    → lookups grid
            //                                                (showLookupType swaps it)
            if (newId === "tab-projects") {
                const cell = $$("centerpane-project");
                if (cell) cell.show();
            } else if (newId !== "tab-lookups") {
                const cell = $$("centerpane-grid");
                if (cell) cell.show();
            }
        });
    }

    function buildHeader(user) {
        const adminBadge = user.is_admin ? `<span class="pk-user-admin">admin</span>` : "";
        const userHtml = `<span class="pk-user-name">${escapeHtml(user.username)}</span>${adminBadge}`;
        return {
            view: "toolbar",
            id: "pk-header",
            css: "pk-header",
            height: 40,
            cols: [
                { view: "label", label: '<span class="pk-app-title">PartKeeper</span>', width: 160 },
                {},
                {
                    view: "search",
                    id: "pk-scan",
                    placeholder: "🔍 Scan / search IPN…",
                    width: 280,
                    on: {
                        onSearchIconClick: function () { handleScan(this.getValue()); this.setValue(""); },
                        // Webix's onEnter doesn't always fire when the
                        // value contains URL chars or the input was
                        // populated via a fast HID typing burst (barcode
                        // scanner). Bind a DOM-level keydown on the
                        // underlying <input> so Enter always triggers.
                        onAfterRender: function () {
                            const node = this.getInputNode && this.getInputNode();
                            if (!node || node._pkScanBound) return;
                            node._pkScanBound = true;
                            // Capture the Webix view in a closure — `this`
                            // inside addEventListener is the DOM element.
                            const view = this;
                            node.addEventListener("keydown", (ev) => {
                                if (ev.key === "Enter" || ev.keyCode === 13) {
                                    ev.preventDefault();
                                    const v = view.getValue();
                                    view.setValue("");
                                    handleScan(v);
                                }
                            });
                        },
                    },
                },
                { view: "button", value: "📷 Scan", width: 100,
                  tooltip: "Open scan-capture overlay. Suppresses browser shortcuts (Alt+digit, Ctrl+T, ...) so HID scanners that emit control chars via Alt+digit don't trigger tab-switching.",
                  click: () => openScanCaptureOverlay() },
                { view: "button", value: "🖨 Label", width: 100, click: () => openLabelDialog({ template: "Custom" }) },
                { view: "label", label: userHtml, width: 220 },
                { view: "button", value: "Sign out", width: 100, click: doLogout },
            ],
        };
    }

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

    /// Slice 13c: when consuming stock from a part with multiple
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

    async function doLogout() {
        await api.logout();
        mountLogin();
    }

    // ============================================================
    //  Left pane — tabbar (Categories / Storage / Footprints / Lookups)
    //  + multiview switching the body
    // ============================================================

    function buildLeftPane() {
        return {
            id: "pk-left",
            width: 280,
            rows: [
                {
                    view: "tabbar",
                    id: "pk-left-tabbar",
                    multiview: true,
                    value: "tab-categories",
                    options: [
                        { value: "Categories", id: "tab-categories" },
                        { value: "Storage", id: "tab-storage" },
                        { value: "Footprints", id: "tab-footprints" },
                        { value: "Projects", id: "tab-projects" },
                        { value: "Lookups", id: "tab-lookups" },
                    ],
                },
                {
                    view: "multiview",
                    id: "pk-left-multiview",
                    cells: [
                        {
                            id: "tab-categories",
                            rows: [buildCategoryActionToolbar(), buildCategoryTreeView()],
                        },
                        {
                            id: "tab-storage",
                            rows: [buildStorageActionToolbar(), buildStorageTreeView()],
                        },
                        {
                            id: "tab-footprints",
                            rows: [buildFootprintActionToolbar(), buildFootprintTreeView()],
                        },
                        { id: "tab-projects", rows: [buildProjectsListView()] },
                        { id: "tab-lookups", rows: [buildLookupsStub()] },
                    ],
                },
            ],
        };
    }

    function treeNodeTemplate(obj, common) {
        const indent = common.icon(obj, common);
        const count = obj.part_count > 0
            ? ` <span class="pk-cat-count">${obj.part_count}</span>`
            : "";
        return `${indent}<span class="pk-cat-name">${escapeHtml(obj.value)}</span>${count}`;
    }

    // --- Part categories tree ---

    function buildCategoryTreeView() {
        return {
            view: "tree",
            id: "pk-cat-tree",
            select: true,
            drag: false,
            template: treeNodeTemplate,
            on: {
                onAfterSelect: function (id) {
                    const node = this.getItem(id);
                    const filter = (node && node.lvl === 0) || !node
                        ? null
                        : { kind: "category", id: node.id };
                    loadParts({ filter });
                },
            },
        };
    }

    async function loadCategoryTree() {
        try {
            const arr = await api.categoryTree();
            const tree = $$("pk-cat-tree");
            tree.clearAll();
            tree.parse(arr.map(transformCategoryNode));
            if (arr.length) {
                tree.select(String(arr[0].id));
                tree.open(String(arr[0].id));
            }
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load categories" });
        }
    }

    function transformCategoryNode(node) {
        const out = {
            id: String(node.id),
            value: node.name,
            name: node.name,
            lvl: node.lvl,
            part_count: node.part_count,
            category_path: node.category_path,
        };
        if (node.children && node.children.length) {
            out.data = node.children.map(transformCategoryNode);
            out.open = node.lvl === 0;
        }
        return out;
    }

    // --- Part-category CRUD toolbar + dialogs ---

    function buildCategoryActionToolbar() {
        return {
            view: "toolbar",
            css: "pk-pane-toolbar",
            height: 38,
            cols: [
                { view: "button", value: "+ Sub", css: "pk-btn-add", width: 70, click: openCategoryAdd },
                { view: "button", value: "✎ Edit", css: "webix_primary", width: 75, click: openCategoryEdit },
                { view: "button", value: "Move…", width: 70, click: openCategoryMove },
                { view: "button", value: "🗑", css: "pk-btn-remove", width: 40, click: confirmCategoryDelete },
                {},
            ],
        };
    }

    function getSelectedTreeNode(treeId) {
        const tree = $$(treeId);
        if (!tree) return null;
        const id = tree.getSelectedId();
        if (!id) return null;
        return tree.getItem(id);
    }

    async function reloadPartCategoryTreeAndGrid(reselectId) {
        // Reload the tree, restoring selection if asked. Also refresh the
        // parts grid since category counts may have shifted.
        try {
            const arr = await api.categoryTree();
            const tree = $$("pk-cat-tree");
            tree.clearAll();
            tree.parse(arr.map(transformCategoryNode));
            const target = reselectId != null ? String(reselectId) : (arr[0] ? String(arr[0].id) : null);
            if (target && tree.exists(target)) {
                tree.select(target);
                tree.open(target);
            }
        } catch (e) {
            console.error(e);
        }
        await loadParts({});
    }

    function openCategoryAdd() {
        const sel = getSelectedTreeNode("pk-cat-tree");
        if (!sel) {
            webix.message({ type: "error", text: "Select a parent category first." });
            return;
        }
        showSimpleNameDescDialog({
            title: `New sub-category under "${sel.name}"`,
            saveLabel: "Create",
            initial: { name: "", description: "" },
            onSave: async (v) => {
                await api.createPartCategory({
                    parent_id: parseInt(sel.id, 10),
                    name: v.name,
                    description: v.description || null,
                });
                await reloadPartCategoryTreeAndGrid(sel.id);
            },
        });
    }

    async function openCategoryEdit() {
        const sel = getSelectedTreeNode("pk-cat-tree");
        if (!sel) {
            webix.message({ type: "error", text: "Select a category to edit." });
            return;
        }
        if (sel.lvl === 0) {
            webix.message({ type: "error", text: "The root category cannot be renamed." });
            return;
        }
        const full = await api.partCategoryById(parseInt(sel.id, 10));
        showSimpleNameDescDialog({
            title: `Edit category "${sel.name}"`,
            saveLabel: "Save",
            initial: { name: sel.name, description: (full && full.description) || "" },
            onSave: async (v) => {
                await api.updatePartCategory(parseInt(sel.id, 10), {
                    name: v.name,
                    description: v.description || null,
                });
                await reloadPartCategoryTreeAndGrid(sel.id);
            },
        });
    }

    function confirmCategoryDelete() {
        const sel = getSelectedTreeNode("pk-cat-tree");
        if (!sel) {
            webix.message({ type: "error", text: "Select a category to delete." });
            return;
        }
        if (sel.lvl === 0) {
            webix.message({ type: "error", text: "The root category cannot be deleted." });
            return;
        }
        webix.confirm({
            title: "Delete category",
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text:
                `Delete category <b>${escapeHtml(sel.name)}</b>?<br><br>` +
                `Refused if the category contains parts or sub-categories.`,
            callback: async (result) => {
                if (!result) return;
                try {
                    await api.deletePartCategory(parseInt(sel.id, 10));
                    await reloadPartCategoryTreeAndGrid();
                    webix.message({ text: "Category deleted", type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    function openCategoryMove() {
        const sel = getSelectedTreeNode("pk-cat-tree");
        if (!sel) {
            webix.message({ type: "error", text: "Select a category to move." });
            return;
        }
        if (sel.lvl === 0) {
            webix.message({ type: "error", text: "The root category cannot be moved." });
            return;
        }
        showCategoryMoveDialog({
            moving: sel,
            onPick: async (newParentId) => {
                await api.movePartCategory(parseInt(sel.id, 10), newParentId);
                await reloadPartCategoryTreeAndGrid(sel.id);
            },
        });
    }

    // Generic add/edit dialog for nodes with name + (optional) description.
    // Pass { omitDescription: true } for name-only forms (e.g. storage location).
    function showSimpleNameDescDialog(opts) {
        const formElements = [
            { view: "text", name: "name", label: "Name", labelWidth: 110, required: true },
        ];
        if (!opts.omitDescription) {
            formElements.push({
                view: "textarea", name: "description", label: "Description",
                labelWidth: 110, height: 80,
            });
        }
        formElements.push({
            cols: [
                {},
                { view: "button", value: "Cancel", width: 90, click: () => $$("pk-edit-namedesc").close() },
                {
                    view: "button",
                    value: opts.saveLabel || "Save",
                    width: 100,
                    css: "webix_primary",
                    hotkey: "ctrl+s",
                    click: async function () {
                        const v = $$("pk-edit-namedesc-form").getValues();
                        if (!v.name || !v.name.trim()) {
                            webix.message({ type: "error", text: "Name is required" });
                            return;
                        }
                        try {
                            const payload = { name: v.name.trim() };
                            if (!opts.omitDescription) payload.description = (v.description || "").trim();
                            await opts.onSave(payload);
                            $$("pk-edit-namedesc").close();
                            webix.message({ text: "Saved", type: "success" });
                        } catch (e) {
                            webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                        }
                    },
                },
            ],
        });
        webix.ui({
            view: "window",
            id: "pk-edit-namedesc",
            modal: true,
            position: "center",
            width: 440,
            head: opts.title,
            body: {
                view: "form",
                id: "pk-edit-namedesc-form",
                elements: formElements,
            },
        }).show();
        const initial = opts.initial || {};
        $$("pk-edit-namedesc-form").setValues({
            name: initial.name || "",
            description: initial.description || "",
        });
    }

    // Move-to picker for the part-category tree.
    function showCategoryMoveDialog(opts) {
        const movingId = String(opts.moving.id);

        function exclude(arr, id) {
            return arr
                .filter((n) => String(n.id) !== id)
                .map((n) => Object.assign({}, n, {
                    children: n.children ? exclude(n.children, id) : [],
                }));
        }

        webix.ui({
            view: "window",
            id: "pk-cat-move",
            modal: true,
            position: "center",
            width: 460,
            height: 560,
            head: `Move "${opts.moving.name}" to…`,
            body: {
                rows: [
                    { template: "Pick a new parent category:", height: 32, css: "pk-dialog-hint", borderless: true },
                    {
                        view: "tree",
                        id: "pk-cat-move-tree",
                        select: true,
                        template: treeNodeTemplate,
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 48,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-cat-move").close() },
                            {
                                view: "button",
                                value: "Move",
                                width: 90,
                                css: "webix_primary",
                                click: async function () {
                                    const tree = $$("pk-cat-move-tree");
                                    const targetId = tree.getSelectedId();
                                    if (!targetId) {
                                        webix.message({ type: "error", text: "Pick a target parent" });
                                        return;
                                    }
                                    try {
                                        await opts.onPick(parseInt(targetId, 10));
                                        $$("pk-cat-move").close();
                                        webix.message({ text: "Moved", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Move failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();

        api.categoryTree().then((arr) => {
            const cleaned = exclude(arr, movingId);
            const tree = $$("pk-cat-move-tree");
            tree.clearAll();
            tree.parse(cleaned.map(transformCategoryNode));
            // Open root
            if (cleaned.length) tree.open(String(cleaned[0].id));
        });
    }

    // --- Storage tree (categories + locations as leaves) ---

    function buildStorageTreeView() {
        return {
            view: "tree",
            id: "pk-storage-tree",
            select: true,
            drag: false,
            template: treeNodeTemplate,
            on: {
                onAfterSelect: function (id) {
                    const node = this.getItem(id);
                    if (!node) return;
                    if (node.kind === "leaf") {
                        loadParts({ filter: { kind: "storage_location", id: node.location_id } });
                    } else if (node.lvl === 0) {
                        loadParts({ filter: null });
                    } else {
                        loadParts({ filter: { kind: "storage_folder", id: node.category_id } });
                    }
                },
            },
        };
    }

    let storageTreeLoaded = false;
    async function loadStorageTree() {
        if (storageTreeLoaded) return;
        try {
            const arr = await api.storageTree();
            const tree = $$("pk-storage-tree");
            tree.clearAll();
            tree.parse(arr.map(transformStorageNode));
            if (arr.length) tree.open(transformStorageNode(arr[0]).id);
            storageTreeLoaded = true;
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load storage tree" });
        }
    }

    function transformStorageNode(node) {
        const out = {
            id: "scat:" + node.id,
            value: node.name,
            kind: "folder",
            lvl: node.lvl,
            category_id: node.id,
            category_path: node.category_path,
        };
        const children = [];
        if (node.children) children.push(...node.children.map(transformStorageNode));
        if (node.locations) {
            children.push(...node.locations.map((loc) => ({
                id: "sloc:" + loc.id,
                value: loc.name,
                kind: "leaf",
                location_id: loc.id,
                part_count: loc.part_count,
            })));
        }
        if (children.length) {
            out.data = children;
            out.open = node.lvl === 0;
        }
        return out;
    }

    // --- Storage CRUD toolbar + dialogs ---

    function buildStorageActionToolbar() {
        return {
            view: "toolbar",
            css: "pk-pane-toolbar",
            height: 38,
            cols: [
                { view: "button", value: "+ Sub", css: "pk-btn-add", width: 60, click: openStorageCategoryAdd },
                { view: "button", value: "+ Loc", css: "pk-btn-add", width: 60, click: openStorageLocationAdd },
                { view: "button", value: "✎", css: "webix_primary", width: 36, click: openStorageEdit },
                { view: "button", value: "Move…", width: 70, click: openStorageMove },
                { view: "button", value: "🗑", css: "pk-btn-remove", width: 36, click: confirmStorageDelete },
                {},
            ],
        };
    }

    // Returns the contextual storage-category id for + actions:
    //   folder selected → that folder's category_id
    //   leaf selected   → its parent category's category_id
    //   nothing selected → null
    function getStorageContextCategoryId() {
        const tree = $$("pk-storage-tree");
        if (!tree) return null;
        const id = tree.getSelectedId();
        if (!id) return null;
        const node = tree.getItem(id);
        if (!node) return null;
        if (node.kind === "folder") return node.category_id;
        if (node.kind === "leaf") {
            const parentId = tree.getParentId(id);
            if (!parentId) return null;
            const parent = tree.getItem(parentId);
            return parent ? parent.category_id : null;
        }
        return null;
    }

    async function reloadStorageTreeAndGrid(reselectId) {
        try {
            const arr = await api.storageTree();
            const tree = $$("pk-storage-tree");
            tree.clearAll();
            tree.parse(arr.map(transformStorageNode));
            if (reselectId && tree.exists(reselectId)) {
                tree.select(reselectId);
                tree.open(reselectId);
            } else if (arr.length) {
                tree.open(transformStorageNode(arr[0]).id);
            }
        } catch (e) {
            console.error(e);
        }
        await loadParts({});
    }

    function openStorageCategoryAdd() {
        const parentId = getStorageContextCategoryId();
        if (parentId == null) {
            webix.message({ type: "error", text: "Select a storage folder first." });
            return;
        }
        showSimpleNameDescDialog({
            title: "New storage sub-category",
            saveLabel: "Create",
            initial: { name: "", description: "" },
            onSave: async (v) => {
                const created = await api.createStorageCategory({
                    parent_id: parentId,
                    name: v.name,
                    description: v.description || null,
                });
                await reloadStorageTreeAndGrid("scat:" + created.id);
            },
        });
    }

    function openStorageLocationAdd() {
        const parentId = getStorageContextCategoryId();
        if (parentId == null) {
            webix.message({ type: "error", text: "Select a storage folder first." });
            return;
        }
        openStorageLocationEditor("new", null, parentId);
    }

    async function openStorageEdit() {
        const tree = $$("pk-storage-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a folder or location to edit." });
            return;
        }
        if (node.kind === "folder") {
            if (node.lvl === 0) {
                webix.message({ type: "error", text: "The root storage category cannot be renamed." });
                return;
            }
            const full = await api.storageCategoryById(node.category_id);
            showSimpleNameDescDialog({
                title: `Edit storage category "${node.value}"`,
                saveLabel: "Save",
                initial: { name: node.value, description: (full && full.description) || "" },
                onSave: async (v) => {
                    await api.updateStorageCategory(node.category_id, {
                        name: v.name,
                        description: v.description || null,
                    });
                    await reloadStorageTreeAndGrid("scat:" + node.category_id);
                },
            });
        } else {
            // leaf — comprehensive editor with Image + Contained Parts tabs
            openStorageLocationEditor(
                "edit",
                { id: node.location_id, name: node.value },
                null
            );
        }
    }

    function openStorageLocationEditor(mode, existing, parentCategoryId) {
        const isEdit = mode === "edit";
        const locId = isEdit && existing ? existing.id : null;
        const seed = existing || { name: "" };

        const tabs = [
            {
                header: "Identity",
                body: {
                    rows: [
                        { view: "text", name: "name", label: "Name", labelWidth: 130, required: true },
                        {},
                    ],
                },
            },
        ];
        if (isEdit) {
            tabs.push({
                header: "Image",
                body: buildAttachmentsSection({
                    tableId: "pk-sloc-images",
                    uploaderId: "pk-sloc-images-uploader",
                    kind: "StorageLocationImage",
                    getParentId: () => locId,
                }),
            });
            tabs.push({
                header: "Contained Parts",
                body: {
                    rows: [
                        {
                            view: "toolbar",
                            css: "pk-pane-toolbar",
                            height: 32,
                            cols: [
                                { view: "label", id: "pk-sloc-contained-status", label: "", css: "pk-pane-title" },
                            ],
                        },
                        {
                            view: "datatable",
                            id: "pk-sloc-contained",
                            css: "pk-grid",
                            select: "row",
                            columns: [
                                { id: "name", header: "Name", fillspace: true, sort: "string" },
                                { id: "internal_part_number", header: "IPN", width: 110, sort: "string" },
                                {
                                    id: "stock_level",
                                    header: { text: "Stock", css: "pk-th-numeric" },
                                    width: 70, sort: "int", css: "pk-numeric",
                                },
                                {
                                    id: "category_path",
                                    header: "Category",
                                    width: 220,
                                    sort: "string",
                                    template: (o) => {
                                        const parts = (o.category_path || "").split(" ➤ ");
                                        return escapeHtml(parts[parts.length - 1] || "");
                                    },
                                },
                            ],
                        },
                    ],
                },
            });
        }

        webix.ui({
            view: "window",
            id: "pk-sloc-editor",
            modal: true,
            position: "center",
            width: 820,
            height: 600,
            head: isEdit ? `Edit storage location "${existing.name}"` : "New storage location",
            body: {
                view: "form",
                id: "pk-sloc-editor-form",
                elements: [
                    { view: "tabview", cells: tabs },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-sloc-editor").close() },
                            {
                                view: "button",
                                value: isEdit ? "Save" : "Create",
                                width: 110,
                                css: isEdit ? "webix_primary" : "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-sloc-editor-form").getValues();
                                    if (!v.name || !v.name.trim()) {
                                        webix.message({ type: "error", text: "Name is required" });
                                        return;
                                    }
                                    try {
                                        let savedId;
                                        if (isEdit) {
                                            await api.updateStorageLocation(existing.id, { name: v.name.trim() });
                                            savedId = existing.id;
                                        } else {
                                            const created = await api.createStorageLocation({
                                                category_id: parentCategoryId,
                                                name: v.name.trim(),
                                            });
                                            savedId = created.id;
                                        }
                                        $$("pk-sloc-editor").close();
                                        await reloadStorageTreeAndGrid("sloc:" + savedId);
                                        webix.message({ text: "Saved", type: "success" });
                                        if (!isEdit) {
                                            // Re-open in edit mode so the operator can attach an image.
                                            openStorageLocationEditor("edit", { id: savedId, name: v.name.trim() }, null);
                                        }
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
        $$("pk-sloc-editor-form").setValues(seed);

        if (isEdit) {
            refreshAttachments({ tableId: "pk-sloc-images", kind: "StorageLocationImage", getParentId: () => locId });
            // Load contained parts (read-only).
            api.parts({ filter: { kind: "storage_location", id: locId }, limit: 1000, offset: 0 })
                .then((json) => {
                    const grid = $$("pk-sloc-contained");
                    if (!grid) return;
                    grid.clearAll();
                    grid.parse(json.items);
                    const status = $$("pk-sloc-contained-status");
                    if (status) status.setValue(`${json.items.length} part${json.items.length === 1 ? "" : "s"} in this location`);
                })
                .catch((e) => console.error(e));
        }
    }

    function confirmStorageDelete() {
        const tree = $$("pk-storage-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a folder or location to delete." });
            return;
        }
        if (node.kind === "folder" && node.lvl === 0) {
            webix.message({ type: "error", text: "The root storage category cannot be deleted." });
            return;
        }
        const what = node.kind === "folder" ? "storage category" : "storage location";
        webix.confirm({
            title: `Delete ${what}`,
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text:
                `Delete ${what} <b>${escapeHtml(node.value)}</b>?<br><br>` +
                (node.kind === "folder"
                    ? "Refused if it contains locations or sub-categories."
                    : "Refused if any parts reference this location."),
            callback: async (result) => {
                if (!result) return;
                try {
                    if (node.kind === "folder") {
                        await api.deleteStorageCategory(node.category_id);
                    } else {
                        await api.deleteStorageLocation(node.location_id);
                    }
                    await reloadStorageTreeAndGrid();
                    webix.message({ text: `${what} deleted`, type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    function openStorageMove() {
        const tree = $$("pk-storage-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a folder or location to move." });
            return;
        }
        if (node.kind === "folder" && node.lvl === 0) {
            webix.message({ type: "error", text: "The root storage category cannot be moved." });
            return;
        }
        const isFolder = node.kind === "folder";
        showStoragePickerDialog({
            title: isFolder
                ? `Move "${node.value}" to…`
                : `Move location "${node.value}" to…`,
            hint: "Pick a new parent storage category:",
            excludeCategoryId: isFolder ? node.category_id : null,
            onPick: async (newCatId) => {
                if (isFolder) {
                    await api.moveStorageCategory(node.category_id, newCatId);
                    await reloadStorageTreeAndGrid("scat:" + node.category_id);
                } else {
                    await api.moveStorageLocation(node.location_id, newCatId);
                    await reloadStorageTreeAndGrid("sloc:" + node.location_id);
                }
            },
        });
    }

    // Folders-only transform: drop the `locations` arrays so the picker
    // shows just the category structure (you can't put a category or a
    // location *under* a location).
    function transformStorageCategoryOnly(node) {
        const out = {
            id: "scat:" + node.id,
            value: node.name,
            kind: "folder",
            lvl: node.lvl,
            category_id: node.id,
        };
        if (node.children && node.children.length) {
            out.data = node.children.map(transformStorageCategoryOnly);
            out.open = node.lvl === 0;
        }
        return out;
    }

    function showStoragePickerDialog(opts) {
        function exclude(arr, excludedId) {
            if (excludedId == null) return arr;
            return arr
                .filter((n) => "scat:" + n.id !== excludedId)
                .map((n) => Object.assign({}, n, {
                    children: n.children ? exclude(n.children, excludedId) : [],
                }));
        }

        webix.ui({
            view: "window",
            id: "pk-storage-picker",
            modal: true,
            position: "center",
            width: 460,
            height: 560,
            head: opts.title,
            body: {
                rows: [
                    { template: opts.hint, height: 32, css: "pk-dialog-hint", borderless: true },
                    {
                        view: "tree",
                        id: "pk-storage-picker-tree",
                        select: true,
                        template: treeNodeTemplate,
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 48,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-storage-picker").close() },
                            {
                                view: "button",
                                value: "Move",
                                width: 90,
                                css: "webix_primary",
                                click: async function () {
                                    const t = $$("pk-storage-picker-tree");
                                    const targetId = t.getSelectedId();
                                    if (!targetId) {
                                        webix.message({ type: "error", text: "Pick a target category" });
                                        return;
                                    }
                                    const targetNode = t.getItem(targetId);
                                    try {
                                        await opts.onPick(targetNode.category_id);
                                        $$("pk-storage-picker").close();
                                        webix.message({ text: "Moved", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Move failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();

        api.storageTree().then((arr) => {
            const cleaned = exclude(arr, opts.excludeCategoryId ? "scat:" + opts.excludeCategoryId : null);
            const t = $$("pk-storage-picker-tree");
            t.clearAll();
            t.parse(cleaned.map(transformStorageCategoryOnly));
            if (cleaned.length) t.open("scat:" + cleaned[0].id);
        });
    }

    // --- Footprint tree (categories + footprints as leaves) ---

    function buildFootprintTreeView() {
        return {
            view: "tree",
            id: "pk-footprint-tree",
            select: true,
            drag: false,
            template: treeNodeTemplate,
            on: {
                onAfterSelect: function (id) {
                    const node = this.getItem(id);
                    if (!node) return;
                    if (node.kind === "leaf") {
                        loadParts({ filter: { kind: "footprint", id: node.footprint_id } });
                    } else if (node.lvl === 0) {
                        loadParts({ filter: null });
                    } else {
                        loadParts({ filter: { kind: "footprint_folder", id: node.category_id } });
                    }
                },
            },
        };
    }

    let footprintTreeLoaded = false;
    async function loadFootprintTree() {
        if (footprintTreeLoaded) return;
        try {
            const arr = await api.footprintTree();
            const tree = $$("pk-footprint-tree");
            tree.clearAll();
            tree.parse(arr.map(transformFootprintNode));
            if (arr.length) tree.open(transformFootprintNode(arr[0]).id);
            footprintTreeLoaded = true;
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load footprint tree" });
        }
    }

    function transformFootprintNode(node) {
        const out = {
            id: "fcat:" + node.id,
            value: node.name,
            kind: "folder",
            lvl: node.lvl,
            category_id: node.id,
            category_path: node.category_path,
        };
        const children = [];
        if (node.children) children.push(...node.children.map(transformFootprintNode));
        if (node.footprints) {
            children.push(...node.footprints.map((fp) => ({
                id: "fp:" + fp.id,
                value: fp.name,
                kind: "leaf",
                footprint_id: fp.id,
                part_count: fp.part_count,
            })));
        }
        if (children.length) {
            out.data = children;
            out.open = node.lvl === 0;
        }
        return out;
    }

    // --- Footprint CRUD toolbar + dialogs ---

    function buildFootprintActionToolbar() {
        return {
            view: "toolbar",
            css: "pk-pane-toolbar",
            height: 38,
            cols: [
                { view: "button", value: "+ Sub", css: "pk-btn-add", width: 60, click: openFootprintCategoryAdd },
                { view: "button", value: "+ FP", css: "pk-btn-add", width: 56, click: openFootprintAdd },
                { view: "button", value: "✎", css: "webix_primary", width: 36, click: openFootprintEdit },
                { view: "button", value: "Move…", width: 70, click: openFootprintMove },
                { view: "button", value: "🗑", css: "pk-btn-remove", width: 36, click: confirmFootprintDelete },
                {},
            ],
        };
    }

    function getFootprintContextCategoryId() {
        const tree = $$("pk-footprint-tree");
        if (!tree) return null;
        const id = tree.getSelectedId();
        if (!id) return null;
        const node = tree.getItem(id);
        if (!node) return null;
        if (node.kind === "folder") return node.category_id;
        if (node.kind === "leaf") {
            const parentId = tree.getParentId(id);
            if (!parentId) return null;
            const parent = tree.getItem(parentId);
            return parent ? parent.category_id : null;
        }
        return null;
    }

    async function reloadFootprintTreeAndGrid(reselectId) {
        try {
            const arr = await api.footprintTree();
            const tree = $$("pk-footprint-tree");
            tree.clearAll();
            tree.parse(arr.map(transformFootprintNode));
            if (reselectId && tree.exists(reselectId)) {
                tree.select(reselectId);
                tree.open(reselectId);
            } else if (arr.length) {
                tree.open(transformFootprintNode(arr[0]).id);
            }
        } catch (e) {
            console.error(e);
        }
        await loadParts({});
    }

    function openFootprintCategoryAdd() {
        const parentId = getFootprintContextCategoryId();
        if (parentId == null) {
            webix.message({ type: "error", text: "Select a footprint folder first." });
            return;
        }
        showSimpleNameDescDialog({
            title: "New footprint sub-category",
            saveLabel: "Create",
            initial: { name: "", description: "" },
            onSave: async (v) => {
                const created = await api.createFootprintCategory({
                    parent_id: parentId,
                    name: v.name,
                    description: v.description || null,
                });
                await reloadFootprintTreeAndGrid("fcat:" + created.id);
            },
        });
    }

    function openFootprintAdd() {
        const parentId = getFootprintContextCategoryId();
        if (parentId == null) {
            webix.message({ type: "error", text: "Select a footprint folder first." });
            return;
        }
        openFootprintLeafEditor("new", null, parentId);
    }

    async function openFootprintEdit() {
        const tree = $$("pk-footprint-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a footprint folder or footprint to edit." });
            return;
        }
        if (node.kind === "folder") {
            if (node.lvl === 0) {
                webix.message({ type: "error", text: "The root footprint category cannot be renamed." });
                return;
            }
            const full = await api.footprintCategoryById(node.category_id);
            showSimpleNameDescDialog({
                title: `Edit footprint category "${node.value}"`,
                saveLabel: "Save",
                initial: { name: node.value, description: (full && full.description) || "" },
                onSave: async (v) => {
                    await api.updateFootprintCategory(node.category_id, {
                        name: v.name,
                        description: v.description || null,
                    });
                    await reloadFootprintTreeAndGrid("fcat:" + node.category_id);
                },
            });
        } else {
            // leaf — comprehensive editor with Images + Attachments tabs
            const full = await api.footprintById(node.footprint_id);
            openFootprintLeafEditor(
                "edit",
                full || { id: node.footprint_id, name: node.value, description: "" },
                null
            );
        }
    }

    function openFootprintLeafEditor(mode, existing, parentCategoryId) {
        const isEdit = mode === "edit";
        const fpId = isEdit && existing ? existing.id : null;
        const seed = existing || { name: "", description: "" };

        const tabs = [
            {
                header: "Identity",
                body: {
                    rows: [
                        { view: "text", name: "name", label: "Name", labelWidth: 130, required: true },
                        { view: "textarea", name: "description", label: "Description", labelWidth: 130, height: 100 },
                        {},
                    ],
                },
            },
        ];
        if (isEdit) {
            tabs.push({
                header: "Images",
                body: buildAttachmentsSection({
                    tableId: "pk-fp-images",
                    uploaderId: "pk-fp-images-uploader",
                    kind: "FootprintImage",
                    getParentId: () => fpId,
                }),
            });
            tabs.push({
                header: "Attachments",
                body: buildAttachmentsSection({
                    tableId: "pk-fp-attachments",
                    uploaderId: "pk-fp-attachments-uploader",
                    kind: "FootprintAttachment",
                    getParentId: () => fpId,
                }),
            });
        }

        webix.ui({
            view: "window",
            id: "pk-fp-editor",
            modal: true,
            position: "center",
            width: 820,
            height: 600,
            head: isEdit ? `Edit footprint "${existing.name}"` : "New footprint",
            body: {
                view: "form",
                id: "pk-fp-editor-form",
                elements: [
                    { view: "tabview", cells: tabs },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-fp-editor").close() },
                            {
                                view: "button",
                                value: isEdit ? "Save" : "Create",
                                width: 110,
                                css: isEdit ? "webix_primary" : "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-fp-editor-form").getValues();
                                    if (!v.name || !v.name.trim()) {
                                        webix.message({ type: "error", text: "Name is required" });
                                        return;
                                    }
                                    const body = {
                                        name: v.name.trim(),
                                        description: (v.description || "").trim() || null,
                                    };
                                    try {
                                        let savedId;
                                        if (isEdit) {
                                            await api.updateFootprint(existing.id, body);
                                            savedId = existing.id;
                                        } else {
                                            const created = await api.createFootprint({
                                                ...body,
                                                category_id: parentCategoryId,
                                            });
                                            savedId = created.id;
                                        }
                                        $$("pk-fp-editor").close();
                                        await reloadFootprintTreeAndGrid("fp:" + savedId);
                                        webix.message({ text: "Saved", type: "success" });
                                        if (!isEdit) {
                                            // Re-open in edit mode so the operator can immediately
                                            // attach images/files to the freshly created footprint.
                                            const full = await api.footprintById(savedId);
                                            openFootprintLeafEditor("edit", full, null);
                                        }
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
        $$("pk-fp-editor-form").setValues(seed);

        if (isEdit) {
            refreshAttachments({ tableId: "pk-fp-images", kind: "FootprintImage", getParentId: () => fpId });
            refreshAttachments({ tableId: "pk-fp-attachments", kind: "FootprintAttachment", getParentId: () => fpId });
        }
    }

    function confirmFootprintDelete() {
        const tree = $$("pk-footprint-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a footprint folder or footprint to delete." });
            return;
        }
        if (node.kind === "folder" && node.lvl === 0) {
            webix.message({ type: "error", text: "The root footprint category cannot be deleted." });
            return;
        }
        const what = node.kind === "folder" ? "footprint category" : "footprint";
        webix.confirm({
            title: `Delete ${what}`,
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text:
                `Delete ${what} <b>${escapeHtml(node.value)}</b>?<br><br>` +
                (node.kind === "folder"
                    ? "Refused if it contains footprints or sub-categories."
                    : "Refused if any parts reference this footprint."),
            callback: async (result) => {
                if (!result) return;
                try {
                    if (node.kind === "folder") {
                        await api.deleteFootprintCategory(node.category_id);
                    } else {
                        await api.deleteFootprint(node.footprint_id);
                    }
                    await reloadFootprintTreeAndGrid();
                    webix.message({ text: `${what} deleted`, type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    function openFootprintMove() {
        const tree = $$("pk-footprint-tree");
        const node = tree && tree.getSelectedId() ? tree.getItem(tree.getSelectedId()) : null;
        if (!node) {
            webix.message({ type: "error", text: "Select a footprint folder or footprint to move." });
            return;
        }
        if (node.kind === "folder" && node.lvl === 0) {
            webix.message({ type: "error", text: "The root footprint category cannot be moved." });
            return;
        }
        const isFolder = node.kind === "folder";
        showFootprintPickerDialog({
            title: isFolder
                ? `Move "${node.value}" to…`
                : `Move footprint "${node.value}" to…`,
            hint: "Pick a new parent footprint category:",
            excludeCategoryId: isFolder ? node.category_id : null,
            onPick: async (newCatId) => {
                if (isFolder) {
                    await api.moveFootprintCategory(node.category_id, newCatId);
                    await reloadFootprintTreeAndGrid("fcat:" + node.category_id);
                } else {
                    await api.moveFootprint(node.footprint_id, newCatId);
                    await reloadFootprintTreeAndGrid("fp:" + node.footprint_id);
                }
            },
        });
    }

    function transformFootprintCategoryOnly(node) {
        const out = {
            id: "fcat:" + node.id,
            value: node.name,
            kind: "folder",
            lvl: node.lvl,
            category_id: node.id,
        };
        if (node.children && node.children.length) {
            out.data = node.children.map(transformFootprintCategoryOnly);
            out.open = node.lvl === 0;
        }
        return out;
    }

    function showFootprintPickerDialog(opts) {
        function exclude(arr, excludedId) {
            if (excludedId == null) return arr;
            return arr
                .filter((n) => "fcat:" + n.id !== excludedId)
                .map((n) => Object.assign({}, n, {
                    children: n.children ? exclude(n.children, excludedId) : [],
                }));
        }

        webix.ui({
            view: "window",
            id: "pk-footprint-picker",
            modal: true,
            position: "center",
            width: 460,
            height: 560,
            head: opts.title,
            body: {
                rows: [
                    { template: opts.hint, height: 32, css: "pk-dialog-hint", borderless: true },
                    {
                        view: "tree",
                        id: "pk-footprint-picker-tree",
                        select: true,
                        template: treeNodeTemplate,
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 48,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-footprint-picker").close() },
                            {
                                view: "button",
                                value: "Move",
                                width: 90,
                                css: "webix_primary",
                                click: async function () {
                                    const t = $$("pk-footprint-picker-tree");
                                    const targetId = t.getSelectedId();
                                    if (!targetId) {
                                        webix.message({ type: "error", text: "Pick a target category" });
                                        return;
                                    }
                                    const targetNode = t.getItem(targetId);
                                    try {
                                        await opts.onPick(targetNode.category_id);
                                        $$("pk-footprint-picker").close();
                                        webix.message({ text: "Moved", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Move failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();

        api.footprintTree().then((arr) => {
            const cleaned = exclude(arr, opts.excludeCategoryId ? "fcat:" + opts.excludeCategoryId : null);
            const t = $$("pk-footprint-picker-tree");
            t.clearAll();
            t.parse(cleaned.map(transformFootprintCategoryOnly));
            if (cleaned.length) t.open("fcat:" + cleaned[0].id);
        });
    }

    // --- Projects left-pane list ---

    function buildProjectsListView() {
        return {
            rows: [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 38,
                    cols: [
                        { view: "button", value: "+ Project", css: "pk-btn-add", width: 110, click: openProjectAdd },
                        {},
                    ],
                },
                {
                    view: "list",
                    id: "pk-projects-list",
                    css: "pk-projects-list",
                    select: true,
                    template: function (o) {
                        const desc = o.description ? `<div class="pk-projects-desc">${escapeHtml(o.description)}</div>` : "";
                        const meta = [];
                        if (o.parts_count != null) meta.push(`${o.parts_count} parts`);
                        if (o.runs_count) meta.push(`${o.runs_count} runs`);
                        if (o.last_run_at) meta.push(`last ${o.last_run_at.substring(0, 10)}`);
                        const metaHtml = meta.length
                            ? `<span class="pk-projects-meta">${meta.join(" · ")}</span>`
                            : "";
                        return `<div class="pk-projects-name">${escapeHtml(o.name)}${metaHtml}</div>${desc}`;
                    },
                    type: { height: 56 },
                    on: {
                        onAfterSelect: function (id) {
                            loadProjectIntoCenter(id);
                        },
                    },
                },
            ],
        };
    }

    let projectsListLoaded = false;
    async function loadProjectsList(force) {
        if (projectsListLoaded && !force) return;
        try {
            const rows = await api.listProjects();
            const list = $$("pk-projects-list");
            list.clearAll();
            list.parse(rows);
            projectsListLoaded = true;
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load projects" });
        }
    }

    // --- Project center pane ---

    let currentProject = null;  // most recently loaded project detail

    function buildProjectCenterRows() {
        return [
            {
                view: "toolbar",
                css: "pk-pane-toolbar",
                height: 40,
                cols: [
                    { view: "label", id: "pk-project-title", label: "Project", css: "pk-pane-title" },
                    {},
                    { view: "button", value: "▶ Run", css: "pk-btn-add", width: 80, click: openRunDialog },
                    { view: "button", value: "✎ Edit", css: "webix_primary", width: 90, click: openProjectEdit },
                    { view: "button", value: "🗑 Delete", css: "pk-btn-remove", width: 100, click: confirmProjectDelete },
                ],
            },
            {
                view: "template",
                id: "pk-project-header",
                template: '<div class="pk-detail-empty">Select a project from the left.</div>',
                height: 70,
                borderless: true,
            },
            {
                view: "toolbar",
                id: "pk-bom-toolbar",
                css: "pk-pane-toolbar",
                height: 38,
                hidden: true,
                cols: [
                    { view: "label", id: "pk-bom-title", label: "BOM", css: "pk-pane-title" },
                    {},
                    { view: "button", value: "+ Line", css: "pk-btn-add", width: 80, click: openBomAdd },
                    { view: "button", value: "✎ Edit", css: "webix_primary", width: 80, click: openBomEdit },
                    { view: "button", value: "🗑 Remove", css: "pk-btn-remove", width: 95, click: confirmBomDelete },
                ],
            },
            {
                view: "datatable",
                id: "pk-bom-grid",
                css: "pk-grid",
                hidden: true,
                select: "row",
                resizeColumn: { headerOnly: true, size: 4 },
                columns: [
                    {
                        id: "part_name", header: "Part", width: 220, sort: "string",
                        template: (o) => escapeHtml(o.part_name || ""),
                    },
                    {
                        id: "part_internal_part_number", header: "IPN", width: 110, sort: "string",
                        template: (o) => escapeHtml(o.part_internal_part_number || ""),
                    },
                    {
                        id: "quantity", header: { text: "Qty", css: "pk-th-numeric" },
                        width: 70, sort: "int", css: "pk-numeric",
                    },
                    {
                        id: "overage", header: "Overage", width: 110,
                        template: (o) => {
                            if (!o.overage_type || !o.overage) return "";
                            const suffix = o.overage_type === "percent" ? "%" : "";
                            return `${o.overage}${suffix} (${o.overage_type})`;
                        },
                    },
                    { id: "lot_number", header: "Lot", width: 110, template: (o) => escapeHtml(o.lot_number || "") },
                    { id: "remarks", header: "Remarks", fillspace: true, template: (o) => escapeHtml(o.remarks || "") },
                    {
                        id: "part_stock_level", header: { text: "Stock", css: "pk-th-numeric" },
                        width: 70, css: "pk-numeric",
                        template: (o) => o.part_stock_level != null ? o.part_stock_level : "",
                    },
                ],
                on: {
                    onItemClick: function (sel) {
                        // Drive the right-pane part detail when a BOM line is clicked.
                        const row = this.getItem(sel.row);
                        if (row && row.part_id) loadPartDetail(row.part_id);
                    },
                },
            },
            {
                view: "scrollview",
                id: "pk-project-scroll",
                scroll: "y",
                body: {
                    view: "template",
                    id: "pk-project-body",
                    template: " ",
                    autoheight: true,
                },
            },
        ];
    }

    async function loadProjectIntoCenter(projectId) {
        let proj, runs;
        try {
            // Fetch project + runs together so the lower section renders
            // with run history in one HTML pass — no second async hop, no
            // DOM-after-setHTML race.
            [proj, runs] = await Promise.all([
                api.projectById(projectId),
                api.listRuns(projectId).catch(() => []),
            ]);
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load project" });
            return;
        }
        currentProject = proj;
        $$("pk-project-title").setValue(`Project: ${escapeHtml(proj.name)}`);
        $$("pk-project-header").setHTML(renderProjectHeaderHtml(proj));
        $$("pk-bom-toolbar").show();
        $$("pk-bom-grid").show();
        $$("pk-bom-title").setValue(`BOM (${(proj.parts || []).length})`);
        const grid = $$("pk-bom-grid");
        grid.clearAll();
        grid.parse(proj.parts || []);
        $$("pk-project-body").setHTML(renderProjectLowerHtml(proj, runs));
        // Wire up delete-run buttons rendered into the runs-section table.
        const sec = document.getElementById("pk-project-runs-section");
        if (sec) {
            sec.querySelectorAll('button[data-action="del-run"]').forEach((btn) => {
                btn.addEventListener("click", () => {
                    const rid = parseInt(btn.dataset.rid, 10);
                    confirmRunDelete(projectId, rid);
                });
            });
        }
        const cell = $$("centerpane-project");
        if (cell) cell.show();
    }

    function renderProjectHeaderHtml(p) {
        return `<div class="pk-detail-section pk-detail-header">
            <div class="pk-detail-name">${escapeHtml(p.name)}</div>
            ${p.description ? `<div class="pk-detail-desc">${escapeHtml(p.description)}</div>` : ""}
        </div>`;
    }

    function renderProjectLowerHtml(p, runs) {
        const sections = [];
        if (p.attachments && p.attachments.length) {
            const rows = p.attachments.map((a) => {
                const tag = a.is_image ? "img" : "doc";
                const size = a.size ? `${(a.size / 1024).toFixed(1)} KB` : "";
                const url = `/files/ProjectAttachment/${a.id}`;
                return `<tr>
                    <td><a href="${url}" target="_blank">${escapeHtml(a.original_filename || a.filename)}</a></td>
                    <td>${tag}</td>
                    <td class="pk-numeric">${escapeHtml(size)}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(
                `Attachments (${p.attachments.length})`,
                `<table class="pk-detail-table"><thead><tr><th>File</th><th>Type</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table>`
            ));
        }

        let runsBody;
        if (!runs || !runs.length) {
            runsBody = `<p class="pk-help-hint">No runs yet — use ▶ Run to record a build.</p>`;
        } else {
            const rows = runs.map((r) => {
                const date = (r.run.run_date_time || "").substring(0, 16).replace("T", " ");
                const lines = (r.lines || []).length;
                return `<tr>
                    <td>${escapeHtml(date)}</td>
                    <td class="pk-numeric">×${r.run.quantity}</td>
                    <td class="pk-numeric">${lines} line${lines === 1 ? "" : "s"}</td>
                    <td><button class="pk-link-btn" data-rid="${r.run.id}" data-action="del-run">delete…</button></td>
                </tr>`;
            }).join("");
            runsBody = `<table class="pk-detail-table">
                <thead><tr><th>When</th><th class="pk-numeric">Qty</th><th class="pk-numeric">Lines</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
        }
        sections.push(`<div id="pk-project-runs-section">` +
            detailSectionHtml(`Runs${runs && runs.length ? ` (${runs.length})` : ""}`, runsBody) +
            `</div>`);
        return sections.join("");
    }

    // --- Run dialog ---

    let runPreviewQty = 1;

    // Per-line meta-part allocations (W7c.X). Keyed by project_part_id;
    // each value is an array of {real_part_id, quantity}. Reset every
    // time the Run dialog opens so state never leaks across projects.
    let runAllocations = {};

    // Snapshot of the most recent run preview rows, keyed by
    // project_part_id, so the allocator dialog can read the BOM line's
    // required `effective` qty without round-tripping through the
    // datatable.
    let runPreviewByPpid = {};

    function openRunDialog() {
        if (!currentProject) {
            webix.message({ type: "error", text: "Select a project first." });
            return;
        }
        if (!currentProject.parts || !currentProject.parts.length) {
            webix.message({ type: "error", text: "Project has no BOM lines — add some first." });
            return;
        }

        runPreviewQty = 1;
        runAllocations = {};
        runPreviewByPpid = {};

        webix.ui({
            view: "window",
            id: "pk-run-dialog",
            modal: true,
            position: "center",
            width: 880,
            height: 620,
            head: `Run project: ${currentProject.name}`,
            body: {
                rows: [
                    {
                        view: "toolbar",
                        css: "pk-pane-toolbar",
                        height: 44,
                        cols: [
                            { view: "label", label: "Build quantity:", width: 130, css: "pk-pane-title" },
                            {
                                view: "counter",
                                id: "pk-run-quantity",
                                value: 1, min: 1, step: 1, width: 110,
                                on: {
                                    onChange: function (newVal) {
                                        runPreviewQty = parseInt(newVal, 10) || 1;
                                        refreshRunPreview();
                                    },
                                },
                            },
                            {},
                            {
                                view: "label",
                                id: "pk-run-banner",
                                label: "",
                                hidden: true,
                                css: "pk-run-banner",
                            },
                        ],
                    },
                    {
                        view: "datatable",
                        id: "pk-run-preview",
                        css: "pk-grid",
                        select: false,
                        rowCss: function (o) {
                            return o.shortfall ? "pk-row-shortfall" : "";
                        },
                        onClick: {
                            // Status-cell "Allocate" link → open allocator
                            "pk-allocate-link": function (ev, row) {
                                const item = this.getItem(row);
                                if (item) openAllocateDialog(item);
                                return false;  // suppress default row select
                            },
                        },
                        columns: [
                            { id: "part_name", header: "Part", fillspace: true,
                              template: (o) => `${escapeHtml(o.part_name || "(orphan)")}${o.is_meta ? ' <span class="pk-detail-meta-tag">META</span>' : ""}` },
                            { id: "bom_quantity", header: { text: "BOM", css: "pk-th-numeric" }, width: 60, css: "pk-numeric" },
                            { id: "per_build", header: { text: "Per build", css: "pk-th-numeric" }, width: 80, css: "pk-numeric" },
                            { id: "effective", header: { text: "Needed", css: "pk-th-numeric" }, width: 75, css: "pk-numeric" },
                            { id: "current_stock", header: { text: "Stock", css: "pk-th-numeric" }, width: 65, css: "pk-numeric",
                              template: (o) => o.current_stock != null ? o.current_stock : "—" },
                            {
                                id: "shortfall_label", header: "Status", width: 200,
                                template: renderRunStatusCell,
                            },
                            { id: "lot_number", header: "Lot", width: 100,
                              template: (o) => escapeHtml(o.lot_number || "") },
                        ],
                    },
                    { view: "textarea", id: "pk-run-comment", placeholder: "Run comment (optional)", height: 50 },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 50,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 100, click: () => $$("pk-run-dialog").close() },
                            {
                                view: "button",
                                id: "pk-run-go",
                                value: "▶ Run",
                                width: 110,
                                css: "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: doRun,
                            },
                        ],
                    },
                ],
            },
        }).show();
        refreshRunPreview();
    }

    async function refreshRunPreview() {
        if (!currentProject) return;
        try {
            const lines = await api.runPreview(currentProject.id, runPreviewQty);
            const grid = $$("pk-run-preview");
            grid.clearAll();
            grid.parse(lines);
            // Snapshot: project_part_id → preview row (for the allocator)
            runPreviewByPpid = {};
            for (const l of lines) runPreviewByPpid[l.project_part_id] = l;
            updateRunBanner();
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Preview failed: " + (e.message || e) });
        }
    }

    function updateRunBanner() {
        const banner = $$("pk-run-banner");
        if (!banner) return;
        const lines = Object.values(runPreviewByPpid);
        if (!lines.length) { banner.hide(); return; }
        const shortfalls = lines.filter((l) => l.shortfall).length;
        const metaLines = lines.filter((l) => l.is_meta);
        const metasUnallocated = metaLines.filter((l) => !runAllocations[l.project_part_id] || runAllocations[l.project_part_id].length === 0).length;
        if (metasUnallocated > 0) {
            banner.setValue(`<b>${metasUnallocated}</b> meta-part line${metasUnallocated === 1 ? "" : "s"} not allocated — Run will be refused.`);
            banner.show();
        } else if (shortfalls > 0) {
            banner.setValue(`<b>${shortfalls}</b> line${shortfalls === 1 ? "" : "s"} short — run will produce negative stock (allowed).`);
            banner.show();
        } else {
            banner.hide();
        }
    }

    /// Status-cell renderer for the Run dialog's preview grid. Renders
    /// a clickable "Allocate…" link for meta lines, plus an OK/SHORTFALL
    /// label for real lines. The click handler is wired via Webix's
    /// onClick.<css> mechanism on the datatable (key: "pk-allocate-link").
    function renderRunStatusCell(o) {
        if (o.is_meta) {
            const allocs = runAllocations[o.project_part_id] || [];
            const sum = allocs.reduce((acc, a) => acc + (a.quantity || 0), 0);
            const need = o.effective || 0;
            let pill;
            if (allocs.length === 0) {
                pill = `<span class="pk-stock-remove">❌ Not allocated</span>`;
            } else if (sum < need) {
                pill = `<span style="color:#b09a3e;font-weight:600">⚠ ${sum} / ${need} (short ${need - sum})</span>`;
            } else {
                pill = `<span class="pk-stock-add">✓ ${sum} / ${need}</span>`;
            }
            const linkLabel = allocs.length ? "Edit…" : "Allocate…";
            return `${pill} <a href="javascript:void(0)" class="pk-allocate-link pk-link-btn">${linkLabel}</a>`;
        }
        if (o.shortfall) return `<span class="pk-stock-remove">SHORTFALL ${(o.current_stock || 0) - o.effective}</span>`;
        return '<span class="pk-stock-add">OK</span>';
    }

    /// Open the per-line meta-part allocator for a single BOM line.
    /// `line` is one row from the run-preview datatable (must have
    /// is_meta=true). Picks live in runAllocations[line.project_part_id].
    async function openAllocateDialog(line) {
        if (!line || !line.is_meta || !line.part_id) return;
        const ppid = line.project_part_id;
        const required = line.effective || 0;
        const winId = "pk-allocate-dialog";

        // Fetch matches for the meta-part. Errors here are fatal for
        // the dialog (we have nothing to populate the picker with).
        let matches;
        try {
            const resp = await api.metaMatches(line.part_id);
            matches = resp.items || [];
        } catch (e) {
            webix.message({ type: "error", text: "Could not load matches: " + (e.message || e) });
            return;
        }

        // Build the seed dataset: every match as a row with quantity 0,
        // *then* layer in any prior allocations (for matches we set
        // quantity; for off-match parts we append a synthetic _off row).
        const rows = matches.map((p) => ({
            id: "m_" + p.id,
            real_part_id: p.id,
            name: p.name || "",
            internal_part_number: p.internal_part_number || "",
            stock_level: p.stock_level != null ? p.stock_level : 0,
            quantity: 0,
            _off: false,
        }));
        const matchById = {};
        rows.forEach((r) => { matchById[r.real_part_id] = r; });

        const prior = runAllocations[ppid] || [];
        for (const a of prior) {
            if (matchById[a.real_part_id]) {
                matchById[a.real_part_id].quantity = a.quantity;
            } else {
                rows.push({
                    id: "o_" + a.real_part_id,
                    real_part_id: a.real_part_id,
                    name: a.name || `(part #${a.real_part_id})`,
                    internal_part_number: a.internal_part_number || "",
                    stock_level: a.stock_level != null ? a.stock_level : 0,
                    quantity: a.quantity,
                    _off: true,
                });
            }
        }

        const updateHeader = () => {
            const grid = $$("pk-allocate-grid");
            if (!grid) return;
            let sum = 0;
            grid.data.each((r) => { sum += parseInt(r.quantity, 10) || 0; });
            const status = $$("pk-allocate-status");
            if (!status) return;
            let html;
            if (sum === 0) {
                html = `<span class="pk-stock-remove">Allocated: <b>0</b> / ${required}  ❌ none</span>`;
            } else if (sum < required) {
                html = `<span style="color:#b09a3e;font-weight:600">Allocated: <b>${sum}</b> / ${required}  ⚠ short ${required - sum}</span>`;
            } else {
                html = `<span class="pk-stock-add">Allocated: <b>${sum}</b> / ${required}  ✓</span>`;
            }
            status.setHTML(html);
        };

        webix.ui({
            view: "window",
            id: winId,
            modal: true,
            position: "center",
            width: 760,
            height: 540,
            head: `Allocate "${escapeHtml(line.part_name || "(unnamed meta)")}"`,
            body: {
                rows: [
                    {
                        view: "template",
                        height: 32,
                        template: `<div style="padding:6px 12px;color:#4a5b6a">Required: <b>${required}</b> &nbsp;(${line.per_build} per build × ${runPreviewQty} build${runPreviewQty === 1 ? "" : "s"})</div>`,
                        borderless: true,
                    },
                    {
                        view: "template",
                        id: "pk-allocate-status",
                        height: 28,
                        template: "",
                        borderless: true,
                        css: "pk-dialog-hint",
                    },
                    {
                        view: "datatable",
                        id: "pk-allocate-grid",
                        css: "pk-grid",
                        editable: true,
                        editaction: "click",
                        select: "row",
                        rowCss: function (r) {
                            const q = parseInt(r.quantity, 10) || 0;
                            return (q > 0 && q > r.stock_level) ? "pk-row-shortfall" : "";
                        },
                        on: {
                            onBeforeEditStart: function (state) {
                                if (state && state.row) this.select(state.row);
                            },
                            onAfterEditStop: function () {
                                updateHeader();
                                this.refresh();
                            },
                        },
                        columns: [
                            { id: "_match", header: "Match", width: 65,
                              template: (o) => o._off
                                  ? '<span style="color:#884ea0">off</span>'
                                  : '<span style="color:#1e7e34">✓</span>' },
                            { id: "name", header: "Name", fillspace: true,
                              template: (o) => escapeHtml(o.name || "") },
                            { id: "internal_part_number", header: "IPN", width: 130,
                              template: (o) => escapeHtml(o.internal_part_number || "") },
                            { id: "stock_level", header: { text: "Stock", css: "pk-th-numeric" }, width: 75, css: "pk-numeric" },
                            { id: "quantity", header: { text: "Allocate", css: "pk-th-numeric" }, width: 100, css: "pk-numeric",
                              editor: "text" },
                            { id: "_remove", header: "", width: 32,
                              template: (o) => o._off
                                  ? '<a href="javascript:void(0)" class="pk-link-btn" style="color:#b03030" data-remove="' + o.id + '" title="Remove">×</a>'
                                  : "" },
                        ],
                        onClick: {
                            "pk-link-btn": function (ev) {
                                const t = ev.target;
                                if (t && t.dataset && t.dataset.remove) {
                                    this.remove(t.dataset.remove);
                                    updateHeader();
                                    return false;
                                }
                            },
                        },
                        data: rows,
                    },
                    {
                        view: "toolbar",
                        css: "pk-pane-toolbar",
                        height: 44,
                        cols: [
                            { view: "label", label: "Add part not in matches:", width: 180, css: "pk-help-hint" },
                            {
                                view: "combo",
                                id: "pk-allocate-extra-combo",
                                placeholder: "Search by name / IPN…",
                                width: 360,
                                suggest: { body: { yCount: 10 } },
                                options: [],
                            },
                            {
                                view: "button",
                                value: "+ Add",
                                width: 80,
                                css: "pk-btn-add",
                                click: async function () {
                                    const combo = $$("pk-allocate-extra-combo");
                                    const v = combo.getValue();
                                    if (!v) {
                                        webix.message({ type: "error", text: "Pick a part first" });
                                        return;
                                    }
                                    const realId = parseInt(v, 10);
                                    if (isNaN(realId)) return;
                                    const dt = $$("pk-allocate-grid");
                                    if (!dt) return;
                                    if (dt.exists("m_" + realId) || dt.exists("o_" + realId)) {
                                        webix.message({ type: "error", text: "Already in the list" });
                                        return;
                                    }
                                    // Look up the part details from the combo's options.
                                    const opt = (combo.getList().getItem(realId)) || null;
                                    let stock = 0, name = "", ipn = "";
                                    if (opt) {
                                        name = opt.name || opt.value || "";
                                        ipn = opt.internal_part_number || "";
                                        // Stock is on the part — fetch it once.
                                        try {
                                            const detail = await api.part(realId);
                                            stock = detail.stock_level || 0;
                                        } catch (_) {}
                                    }
                                    dt.add({
                                        id: "o_" + realId,
                                        real_part_id: realId,
                                        name, internal_part_number: ipn,
                                        stock_level: stock,
                                        quantity: 0,
                                        _off: true,
                                    });
                                    combo.setValue("");
                                    updateHeader();
                                },
                            },
                            {},
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
                                value: "Save allocation",
                                width: 160,
                                css: "webix_primary",
                                click: function () {
                                    const dt = $$("pk-allocate-grid");
                                    const out = [];
                                    dt.data.each((r) => {
                                        const q = parseInt(r.quantity, 10) || 0;
                                        if (q > 0) {
                                            out.push({
                                                real_part_id: r.real_part_id,
                                                quantity: q,
                                                lot_number: null,
                                                // Cosmetic — kept so re-opening the
                                                // dialog can preserve the off-match row
                                                // labels without round-tripping the API.
                                                name: r.name,
                                                internal_part_number: r.internal_part_number,
                                                stock_level: r.stock_level,
                                            });
                                        }
                                    });
                                    if (out.length === 0) {
                                        delete runAllocations[ppid];
                                    } else {
                                        runAllocations[ppid] = out;
                                    }
                                    $$(winId).close();
                                    const grid = $$("pk-run-preview");
                                    if (grid) grid.refresh();
                                    updateRunBanner();
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();

        // Populate the off-match combo using the same pattern as the
        // BOM-line picker: write to combo.getPopup().getList() rather
        // than `define("options", ...)` (the latter doesn't refresh
        // the suggest popup reliably across Webix versions).
        api.parts({ limit: 1000 }).then((resp) => {
            const combo = $$("pk-allocate-extra-combo");
            if (!combo) return;
            const data = (resp.items || []).map((p) => ({
                id: p.id,
                value: p.name + (p.internal_part_number ? " [" + p.internal_part_number + "]" : ""),
                name: p.name,
                internal_part_number: p.internal_part_number || "",
            }));
            const suggest = combo.getPopup();
            const list = suggest.getList();
            list.clearAll();
            list.parse(data);
        }).catch((e) => console.warn("part picker load failed:", e));

        // First paint of the allocation header.
        setTimeout(updateHeader, 0);
    }

    async function doRun() {
        if (!currentProject) return;
        const body = {
            quantity: runPreviewQty,
            comment: ($$("pk-run-comment").getValue() || "").trim() || null,
            lot_overrides: {},
            // Strip cosmetic fields (name, internal_part_number, stock_level)
            // from each allocation before sending — backend only accepts
            // {real_part_id, quantity, lot_number}.
            allocations: Object.fromEntries(
                Object.entries(runAllocations).map(([k, arr]) => [
                    k,
                    arr.map((a) => ({
                        real_part_id: a.real_part_id,
                        quantity: a.quantity,
                        lot_number: a.lot_number || null,
                    })),
                ])
            ),
        };
        const projectId = currentProject.id;

        // Step 1: actually run the project. Distinguish run failure from
        // post-run refresh failure so we don't say "Run failed" after the
        // backend already committed.
        try {
            await api.runProject(projectId, body);
        } catch (e) {
            console.error(e);
            const msg = String(e.message || e);
            webix.message({ type: "error", text: "Run failed: " + msg });
            return;
        }

        // Step 2: refresh UI. Failures here are surface-only — the run
        // itself is already committed on the server.
        $$("pk-run-dialog").close();
        webix.message({ text: `Recorded run ×${body.quantity}`, type: "success" });
        try {
            await loadProjectIntoCenter(projectId);
            await loadProjectsList(true);
            const list = $$("pk-projects-list");
            if (list && list.exists(projectId)) list.select(projectId);
        } catch (e) {
            console.error("post-run refresh failed:", e);
            // Don't toast — the run succeeded, the user can refresh manually.
        }
    }

    function confirmRunDelete(projectId, runId) {
        webix.ui({
            view: "window",
            id: "pk-run-delete",
            modal: true,
            position: "center",
            width: 480,
            head: `Delete run #${runId}`,
            body: {
                view: "form",
                id: "pk-run-delete-form",
                elements: [
                    {
                        view: "label",
                        label:
                            "Run history is normally append-only. This is the admin escape hatch — " +
                            "use it for fixing mistakes or cleaning up test runs.",
                        height: 50,
                    },
                    {
                        view: "checkbox",
                        name: "restore_stock",
                        labelRight: "Also restore stock (insert compensating positive entries)",
                        labelWidth: 0,
                        value: 0,
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 50,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 100, click: () => $$("pk-run-delete").close() },
                            {
                                view: "button",
                                value: "Delete run",
                                width: 130,
                                css: "pk-btn-remove",
                                click: async function () {
                                    const v = $$("pk-run-delete-form").getValues();
                                    try {
                                        await api.deleteRun(projectId, runId, !!v.restore_stock);
                                        $$("pk-run-delete").close();
                                        await loadProjectIntoCenter(projectId);
                                        await loadProjectsList(true);
                                        const list = $$("pk-projects-list");
                                        if (list && list.exists(projectId)) list.select(projectId);
                                        webix.message({ text: "Run deleted", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
    }

    // --- BOM CRUD ---

    function openBomAdd() {
        if (!currentProject) {
            webix.message({ type: "error", text: "Select a project first." });
            return;
        }
        openBomLineDialog("new", null);
    }

    function openBomEdit() {
        if (!currentProject) return;
        const grid = $$("pk-bom-grid");
        const sel = grid && grid.getSelectedId() ? grid.getItem(grid.getSelectedId()) : null;
        if (!sel) {
            webix.message({ type: "error", text: "Select a BOM line to edit." });
            return;
        }
        openBomLineDialog("edit", sel);
    }

    function confirmBomDelete() {
        if (!currentProject) return;
        const grid = $$("pk-bom-grid");
        const sel = grid && grid.getSelectedId() ? grid.getItem(grid.getSelectedId()) : null;
        if (!sel) {
            webix.message({ type: "error", text: "Select a BOM line to remove." });
            return;
        }
        const projId = currentProject.id;
        webix.confirm({
            title: "Remove BOM line",
            type: "confirm-error",
            ok: "Remove",
            cancel: "Cancel",
            text: `Remove <b>${escapeHtml(sel.part_name || "(orphan)")}</b> from BOM?`,
            callback: async (result) => {
                if (!result) return;
                try {
                    await api.deleteBomLine(projId, sel.id);
                    await loadProjectIntoCenter(projId);
                    webix.message({ text: "Removed", type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Remove failed: " + (e.message || e) });
                }
            },
        });
    }

    function openBomLineDialog(mode, existing) {
        const isEdit = mode === "edit";
        const seed = existing || {
            part_id: null, quantity: 1, remarks: "",
            overage_type: "", overage: 0, lot_number: "",
        };
        webix.ui({
            view: "window",
            id: "pk-bom-line",
            modal: true,
            position: "center",
            width: 540,
            head: isEdit ? `Edit BOM line` : "New BOM line",
            body: {
                view: "form",
                id: "pk-bom-line-form",
                elements: [
                    {
                        view: "combo",
                        id: "pk-bom-line-part",
                        name: "part_id",
                        label: "Part",
                        labelWidth: 120,
                        suggest: {
                            body: {
                                template: function (o) {
                                    const ipn = o.internal_part_number ? ` <span class="pk-bom-ipn">${escapeHtml(o.internal_part_number)}</span>` : "";
                                    const cat = o.category_path ? ` <span class="pk-bom-cat">${escapeHtml((o.category_path.split(" ➤ ").pop()) || "")}</span>` : "";
                                    return `${escapeHtml(o.name || "")}${ipn}${cat}`;
                                },
                            },
                            data: [],  // populated below
                        },
                        readonly: isEdit,  // can't change the part on an existing line — remove + re-add instead
                    },
                    { view: "counter", name: "quantity", label: "Quantity", labelWidth: 120, value: 1, min: 1, step: 1 },
                    {
                        view: "richselect",
                        name: "overage_type",
                        label: "Overage type",
                        labelWidth: 120,
                        options: [
                            { id: "", value: "(none)" },
                            { id: "absolute", value: "absolute" },
                            { id: "percent", value: "percent" },
                        ],
                    },
                    { view: "counter", name: "overage", label: "Overage amount", labelWidth: 120, value: 0, min: 0, step: 1 },
                    { view: "text", name: "lot_number", label: "Lot number", labelWidth: 120 },
                    { view: "textarea", name: "remarks", label: "Remarks", labelWidth: 120, height: 50 },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-bom-line").close() },
                            {
                                view: "button",
                                value: isEdit ? "Save" : "Add",
                                width: 100,
                                css: "webix_primary",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-bom-line-form").getValues();
                                    if (!v.part_id) {
                                        webix.message({ type: "error", text: "Pick a part." });
                                        return;
                                    }
                                    const body = {
                                        part_id: parseInt(v.part_id, 10),
                                        quantity: parseInt(v.quantity, 10) || 1,
                                        remarks: (v.remarks || "").trim() || null,
                                        overage_type: v.overage_type || "",
                                        overage: parseInt(v.overage, 10) || 0,
                                        lot_number: (v.lot_number || "").trim() || null,
                                    };
                                    try {
                                        if (isEdit) {
                                            await api.updateBomLine(currentProject.id, existing.id, body);
                                        } else {
                                            await api.addBomLine(currentProject.id, body);
                                        }
                                        $$("pk-bom-line").close();
                                        await loadProjectIntoCenter(currentProject.id);
                                        webix.message({ text: "Saved", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
        // Populate the part suggest list from /api/parts (full list — 685
        // parts is small enough; we filter client-side via Webix's combo).
        api.parts({ limit: 1000 }).then((json) => {
            const data = (json.items || []).map((p) => ({
                id: p.id,
                value: p.name + (p.internal_part_number ? ` [${p.internal_part_number}]` : ""),
                name: p.name,
                internal_part_number: p.internal_part_number,
                category_path: p.category_path,
            }));
            const suggest = $$("pk-bom-line-part").getPopup();
            const list = suggest.getList();
            list.clearAll();
            list.parse(data);
        }).catch((e) => console.error(e));
        $$("pk-bom-line-form").setValues(seed);
    }

    // --- Project add/edit/delete ---

    function openProjectAdd() {
        openProjectEditor("new", null);
    }

    function openProjectEdit() {
        if (!currentProject) {
            webix.message({ type: "error", text: "Select a project first." });
            return;
        }
        openProjectEditor("edit", currentProject);
    }

    function confirmProjectDelete() {
        if (!currentProject) {
            webix.message({ type: "error", text: "Select a project first." });
            return;
        }
        const p = currentProject;
        webix.confirm({
            title: "Delete project",
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text: `Delete project <b>${escapeHtml(p.name)}</b>? Refused if any runs exist (run history is append-only).`,
            callback: async (result) => {
                if (!result) return;
                try {
                    await api.deleteProject(p.id);
                    currentProject = null;
                    $$("pk-project-title").setValue("Project");
                    $$("pk-project-body").setHTML('<div class="pk-detail-empty">Select a project from the left.</div>');
                    await loadProjectsList(true);
                    webix.message({ text: "Project deleted", type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    function openProjectEditor(mode, existing) {
        const isEdit = mode === "edit";
        const projId = isEdit && existing ? existing.id : null;
        const seed = existing || { name: "", description: "" };

        const tabs = [
            {
                header: "Identity",
                body: {
                    rows: [
                        { view: "text", name: "name", label: "Name", labelWidth: 110, required: true },
                        { view: "textarea", name: "description", label: "Description", labelWidth: 110, height: 100 },
                        {},
                    ],
                },
            },
        ];
        if (isEdit) {
            tabs.push({
                header: "Attachments",
                body: buildAttachmentsSection({
                    tableId: "pk-project-attachments",
                    uploaderId: "pk-project-attachments-uploader",
                    kind: "ProjectAttachment",
                    getParentId: () => projId,
                }),
            });
        }

        webix.ui({
            view: "window",
            id: "pk-project-editor",
            modal: true,
            position: "center",
            width: 720,
            height: 540,
            head: isEdit ? `Edit project "${existing.name}"` : "New project",
            body: {
                view: "form",
                id: "pk-project-editor-form",
                elements: [
                    { view: "tabview", cells: tabs },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-project-editor").close() },
                            {
                                view: "button",
                                value: isEdit ? "Save" : "Create",
                                width: 110,
                                css: isEdit ? "webix_primary" : "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-project-editor-form").getValues();
                                    if (!v.name || !v.name.trim()) {
                                        webix.message({ type: "error", text: "Name is required" });
                                        return;
                                    }
                                    const body = {
                                        name: v.name.trim(),
                                        description: (v.description || "").trim() || null,
                                    };
                                    try {
                                        let savedId;
                                        if (isEdit) {
                                            await api.updateProject(existing.id, body);
                                            savedId = existing.id;
                                        } else {
                                            const created = await api.createProject(body);
                                            savedId = created.id;
                                        }
                                        $$("pk-project-editor").close();
                                        await loadProjectsList(true);
                                        await loadProjectIntoCenter(savedId);
                                        const list = $$("pk-projects-list");
                                        if (list && list.exists(savedId)) list.select(savedId);
                                        webix.message({ text: "Saved", type: "success" });
                                        if (!isEdit) {
                                            // Re-open in edit mode so the operator can attach files immediately.
                                            const fresh = await api.projectById(savedId);
                                            openProjectEditor("edit", fresh);
                                        }
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
        $$("pk-project-editor-form").setValues(seed);

        if (isEdit) {
            refreshAttachments({ tableId: "pk-project-attachments", kind: "ProjectAttachment", getParentId: () => projId });
        }
    }

    // --- Lookups left-pane list ---

    function buildLookupsStub() {
        return {
            view: "list",
            id: "pk-lookups-list",
            css: "pk-lookups-list",
            select: true,
            template: function (o) {
                return `<span class="pk-lookups-icon">▤</span> ${escapeHtml(o.value)}`;
            },
            data: [
                { id: "manufacturers", value: "Manufacturers" },
                { id: "distributors", value: "Distributors" },
                { id: "part_units", value: "Part Units" },
                { id: "units", value: "Units (parametric)" },
                { id: "si_prefixes", value: "SI Prefixes" },
            ],
            on: {
                onAfterSelect: function (id) { showLookupType(id); },
            },
        };
    }

    // ============================================================
    //  Center pane — parts grid
    // ============================================================

    // Active filter for the parts grid. `filter` is null (= all parts)
    // or { kind: "category"|"storage_folder"|"storage_location"|
    //              "footprint_folder"|"footprint", id: number }.
    // byField holds the optional flat predicates exposed by the filter
    // pane (stock_mode, meta_only, distributor_id, price_min/max).
    // predicates holds the parametric-pane predicates (W9). When set,
    // the parts grid is populated from /api/parts/parametric instead.
    let currentParts = { filter: null, search: "", byField: {}, predicates: [], footprint_ids: [], category_ids: [] };

    /// Selected footprint ids in the parametric pane's footprint
    /// picker. Module-level so the popup can read/write while open
    /// and the main applyParametricSearch can read on submit.
    let selectedFootprintIds = [];
    /// Selected category ids ("functional class") in the parametric
    /// pane's class picker. Each picked category auto-expands to its
    /// sub-tree on the backend, so picking a parent matches all
    /// descendants. Module-level for the same reason as above.
    let selectedCategoryIds = [];

    /// Refresh the right-hand status label next to the category-
    /// class picker button. Mirrors refreshParametricFpLabel.
    function refreshParametricCatLabel() {
        const lbl = $$("pk-parametric-cat-status");
        if (!lbl) return;
        if (!selectedCategoryIds.length) {
            lbl.define("label", '<span style="color:#aaa">(none picked)</span>');
        } else {
            const flat = lookupsCache && lookupsCache.categories_tree
                ? flattenCategoryTree(lookupsCache.categories_tree)
                : [];
            const names = selectedCategoryIds
                .map((id) => {
                    const m = flat.find((c) => c.id === id);
                    // flattenCategoryTree pads the value with NBSPs
                    // for indentation; trim for the inline label.
                    return m ? (m.value || "").replace(/^[ \s]+/, "") : null;
                })
                .filter(Boolean);
            const label = (names.length <= 4 && names.join(", ").length <= 60)
                ? names.join(", ")
                : `${names.length} classes`;
            lbl.define("label", `<span>${escapeHtml(label)}</span>`);
        }
        lbl.refresh();
    }

    /// Shuttle popup for "functional class" picking. Same as
    /// openFootprintPickerPopup but operates on PartCategory rows
    /// (flattened with depth indentation). Each picked category will
    /// expand to its sub-tree on the backend, so picking "Active
    /// Components" includes every leaf under it.
    function openCategoryPickerPopup(anchorBtn) {
        const old = $$("pk-cat-popup");
        if (old) old.destructor();

        const flat = lookupsCache && lookupsCache.categories_tree
            ? flattenCategoryTree(lookupsCache.categories_tree)
            : [];
        const allItems = flat.map((c) => ({ id: c.id, value: c.value }));
        const selectedSet = new Set(selectedCategoryIds);
        const availableData = allItems.filter((it) => !selectedSet.has(it.id));
        const selectedData  = allItems.filter((it) =>  selectedSet.has(it.id));

        function syncToModule() {
            const lst = $$("pk-cat-selected");
            if (!lst) return;
            const ids = [];
            lst.data.each((it) => { if (it && it.id) ids.push(it.id); });
            selectedCategoryIds = ids;
            refreshParametricCatLabel();
            const avail = $$("pk-cat-available");
            const aHdr = $$("pk-cat-avail-hdr");
            const sHdr = $$("pk-cat-sel-hdr");
            if (avail && aHdr) aHdr.define("label", `Available (${avail.count()})`);
            if (lst && sHdr)   sHdr.define("label", `Selected (${lst.count()})`);
            if (aHdr) aHdr.refresh();
            if (sHdr) sHdr.refresh();
        }

        function moveItem(fromListId, toListId, itemId) {
            const from = $$(fromListId);
            const to   = $$(toListId);
            if (!from || !to) return;
            const item = from.getItem(itemId);
            if (!item) return;
            from.remove(itemId);
            to.add({ id: item.id, value: item.value });
            syncToModule();
        }

        const popup = webix.ui({
            view: "popup",
            id: "pk-cat-popup",
            width: 600,
            height: 420,
            body: {
                rows: [
                    {
                        cols: [
                            {
                                width: 290,
                                rows: [
                                    { view: "label", id: "pk-cat-avail-hdr",
                                      label: `Available (${availableData.length})`,
                                      css: "pk-pane-title" },
                                    {
                                        view: "search",
                                        placeholder: "Filter classes…",
                                        on: {
                                            onTimedKeyPress: function () {
                                                const list = $$("pk-cat-available");
                                                if (!list) return;
                                                const q = (this.getValue() || "").toLowerCase();
                                                list.filter((item) =>
                                                    !q || (item.value || "").toLowerCase().indexOf(q) !== -1);
                                            },
                                        },
                                    },
                                    {
                                        view: "list",
                                        id: "pk-cat-available",
                                        select: false,
                                        template: "#value#",
                                        data: availableData,
                                        scroll: "y",
                                        on: {
                                            onItemClick: function (id) {
                                                moveItem("pk-cat-available", "pk-cat-selected", id);
                                            },
                                        },
                                    },
                                ],
                            },
                            {
                                width: 290,
                                rows: [
                                    { view: "label", id: "pk-cat-sel-hdr",
                                      label: `Selected (${selectedData.length})`,
                                      css: "pk-pane-title" },
                                    { height: 36, view: "label",
                                      label: '<span class="pk-help-hint">Each pick includes all sub-classes</span>' },
                                    {
                                        view: "list",
                                        id: "pk-cat-selected",
                                        select: false,
                                        template: "#value#",
                                        data: selectedData,
                                        scroll: "y",
                                        on: {
                                            onItemClick: function (id) {
                                                moveItem("pk-cat-selected", "pk-cat-available", id);
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        view: "toolbar",
                        cols: [
                            { view: "button", value: "Clear all", width: 100,
                              click: () => {
                                  const sel = $$("pk-cat-selected");
                                  if (!sel) return;
                                  const ids = [];
                                  sel.data.each((it) => { if (it && it.id) ids.push(it.id); });
                                  ids.forEach((id) => moveItem("pk-cat-selected", "pk-cat-available", id));
                              } },
                            {},
                            { view: "button", value: "Done", css: "webix_primary", width: 90,
                              click: () => $$("pk-cat-popup") && $$("pk-cat-popup").hide() },
                        ],
                    },
                ],
            },
        });

        if (anchorBtn && anchorBtn.$view) {
            popup.show(anchorBtn.$view);
        } else {
            popup.show();
        }
    }

    /// Refresh the right-hand status label next to the footprint
    /// picker button. "(none picked)" / "1 footprint" / "0603, 0805".
    function refreshParametricFpLabel() {
        const lbl = $$("pk-parametric-fp-status");
        if (!lbl) return;
        if (!selectedFootprintIds.length) {
            lbl.define("label", '<span style="color:#aaa">(none picked)</span>');
        } else {
            const fps = lookupsCache && lookupsCache.footprints || [];
            const names = selectedFootprintIds
                .map((id) => (fps.find((f) => f.id === id) || {}).name)
                .filter(Boolean);
            // Show names if short, else just count.
            const label = (names.length <= 4 && names.join(", ").length <= 60)
                ? names.join(", ")
                : `${names.length} footprints`;
            lbl.define("label", `<span>${escapeHtml(label)}</span>`);
        }
        lbl.refresh();
    }

    /// Shuttle-list (dual-list) multi-select for footprints. Left
    /// pane lists "Available" (everything not yet picked, filterable);
    /// right pane lists "Selected" (the OR-clause that the search
    /// will use). Click on the left → moves to right. Click on right
    /// → moves back to left.
    ///
    /// Why shuttle instead of inline multi-select: makes the OR-list
    /// explicit and visible at a glance. Webix Standard's `select:
    /// "multiselect"` works but the visual feedback is just row
    /// highlighting, which doesn't read as "OR" to the operator.
    function openFootprintPickerPopup(anchorBtn) {
        const old = $$("pk-fp-popup");
        if (old) old.destructor();

        const fps = (lookupsCache && lookupsCache.footprints) || [];
        const allItems = fps.map((f) => ({ id: f.id, value: f.name }));
        const selectedSet = new Set(selectedFootprintIds);
        const availableData = allItems.filter((it) => !selectedSet.has(it.id));
        const selectedData  = allItems.filter((it) =>  selectedSet.has(it.id));

        function syncToModule() {
            const lst = $$("pk-fp-selected");
            if (!lst) return;
            const ids = [];
            lst.data.each((it) => { if (it && it.id) ids.push(it.id); });
            selectedFootprintIds = ids;
            refreshParametricFpLabel();
            // Update the count headers on each side.
            const avail = $$("pk-fp-available");
            const aHdr = $$("pk-fp-avail-hdr");
            const sHdr = $$("pk-fp-sel-hdr");
            if (avail && aHdr) aHdr.define("label", `Available (${avail.count()})`);
            if (lst && sHdr)   sHdr.define("label", `Selected (${lst.count()})`);
            if (aHdr) aHdr.refresh();
            if (sHdr) sHdr.refresh();
        }

        function moveItem(fromListId, toListId, itemId) {
            const from = $$(fromListId);
            const to   = $$(toListId);
            if (!from || !to) return;
            const item = from.getItem(itemId);
            if (!item) return;
            from.remove(itemId);
            to.add({ id: item.id, value: item.value });
            syncToModule();
        }

        const popup = webix.ui({
            view: "popup",
            id: "pk-fp-popup",
            width: 560,
            height: 380,
            body: {
                rows: [
                    {
                        cols: [
                            // ── Available (left) ──
                            {
                                width: 270,
                                rows: [
                                    { view: "label", id: "pk-fp-avail-hdr",
                                      label: `Available (${availableData.length})`,
                                      css: "pk-pane-title" },
                                    {
                                        view: "search",
                                        id: "pk-fp-search",
                                        placeholder: "Filter…",
                                        on: {
                                            onTimedKeyPress: function () {
                                                const list = $$("pk-fp-available");
                                                if (!list) return;
                                                const q = (this.getValue() || "").toLowerCase();
                                                list.filter((item) =>
                                                    !q || (item.value || "").toLowerCase().indexOf(q) !== -1);
                                            },
                                        },
                                    },
                                    {
                                        view: "list",
                                        id: "pk-fp-available",
                                        select: false,
                                        template: "#value#",
                                        data: availableData,
                                        scroll: "y",
                                        on: {
                                            onItemClick: function (id) {
                                                moveItem("pk-fp-available", "pk-fp-selected", id);
                                            },
                                        },
                                    },
                                ],
                            },
                            // ── Selected (right) ──
                            {
                                width: 270,
                                rows: [
                                    { view: "label", id: "pk-fp-sel-hdr",
                                      label: `Selected (${selectedData.length})`,
                                      css: "pk-pane-title" },
                                    { height: 36, view: "label", label: '<span class="pk-help-hint">Click to remove from OR-list</span>' },
                                    {
                                        view: "list",
                                        id: "pk-fp-selected",
                                        select: false,
                                        template: "#value#",
                                        data: selectedData,
                                        scroll: "y",
                                        on: {
                                            onItemClick: function (id) {
                                                moveItem("pk-fp-selected", "pk-fp-available", id);
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        view: "toolbar",
                        cols: [
                            { view: "button", value: "Clear all", width: 100,
                              click: () => {
                                  // Move every selected item back to Available.
                                  const sel = $$("pk-fp-selected");
                                  const avail = $$("pk-fp-available");
                                  if (!sel || !avail) return;
                                  const ids = [];
                                  sel.data.each((it) => { if (it && it.id) ids.push(it.id); });
                                  ids.forEach((id) => moveItem("pk-fp-selected", "pk-fp-available", id));
                              } },
                            {},
                            { view: "button", value: "Done", css: "webix_primary", width: 90,
                              click: () => $$("pk-fp-popup") && $$("pk-fp-popup").hide() },
                        ],
                    },
                ],
            },
        });

        if (anchorBtn && anchorBtn.$view) {
            popup.show(anchorBtn.$view);
        } else {
            popup.show();
        }
    }

    function buildCenterPane() {
        return {
            id: "pk-center",
            view: "multiview",
            cells: [
                { id: "centerpane-grid", rows: buildPartsGridRows() },
                { id: "centerpane-lookups", rows: buildLookupsCenterRows() },
                { id: "centerpane-project", rows: buildProjectCenterRows() },
            ],
        };
    }

    function buildPartsGridRows() {
        return [
                // Row 1: title + create-actions. Keeps the "I want to
                // make a part" affordances visually grouped and the
                // toolbar narrow enough that the center pane can be
                // shrunk meaningfully.
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 40,
                    cols: [
                        { view: "label", id: "pk-grid-title", label: "Parts", css: "pk-pane-title" },
                        {},
                        {
                            view: "button",
                            value: "+ Part",
                            css: "pk-btn-add",
                            width: 95,
                            click: () => openPartEditor("new"),
                        },
                        {
                            view: "button",
                            value: "+ Meta-Part",
                            css: "pk-btn-meta",
                            width: 125,
                            click: () => openPartEditor("new", { metaPart: true }),
                        },
                        {
                            view: "button",
                            id: "pk-lookup-button",
                            value: "🔎 Add via lookup",
                            css: "pk-btn-add",
                            width: 165,
                            hidden: true,  // shown only when ≥1 source is configured
                            click: () => openLookupSearchDialog(),
                        },
                        {
                            view: "button",
                            id: "pk-receive-button",
                            value: "📦 Receive Order",
                            css: "pk-btn-add",
                            width: 165,
                            hidden: true,  // shown only when ≥1 source has order_status_available
                            // Default: pick the only-configured source if exactly
                            // one is enabled, else "digikey" (richer data, larger
                            // catalog). The dialog itself has a source picker
                            // when ≥2 sources are available.
                            click: () => openOrderReceiveDialog(defaultReceiveSource()),
                        },
                        {
                            view: "button",
                            value: "⎘ Duplicate",
                            css: "webix_primary",
                            width: 130,
                            click: () => openPartEditor("duplicate"),
                        },
                    ],
                },
                // Row 2: view toggles + filters + search. Lets the
                // operator narrow the center pane without losing
                // any controls.
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 40,
                    cols: [
                        {
                            view: "toggle",
                            id: "pk-filters-toggle",
                            type: "iconButton",
                            label: "▾ Filters",
                            offLabel: "▸ Filters",
                            width: 90,
                            on: {
                                onChange: function (newVal) {
                                    const pane = $$("pk-filters-pane");
                                    if (!pane) return;
                                    if (newVal) pane.show();
                                    else pane.hide();
                                },
                            },
                        },
                        { view: "button", value: "⊞ Columns", width: 110, click: openColumnsDialog },
                        {
                            view: "button",
                            id: "pk-presets-button",
                            value: "★ Presets ▾",
                            width: 110,
                            click: function () { openPresetsMenu(this); },
                        },
                        {
                            view: "toggle",
                            id: "pk-parametric-toggle",
                            type: "iconButton",
                            label: "▾ Parametric",
                            offLabel: "▸ Parametric",
                            width: 115,
                            on: {
                                onChange: function (newVal) {
                                    const pane = $$("pk-parametric-pane");
                                    if (!pane) return;
                                    if (newVal) {
                                        pane.show();
                                        // Populate parameter-name combo + SI prefix /
                                        // unit options + footprint multi-select. No-op
                                        // if already loaded.
                                        ensureParametricLookupsReady();
                                    } else {
                                        pane.hide();
                                    }
                                },
                            },
                        },
                        {},
                        {
                            view: "search",
                            id: "pk-search",
                            placeholder: "Search name / description / IPN…",
                            width: 320,
                            on: {
                                onTimedKeyPress: function () {
                                    currentParts.search = this.getValue().trim();
                                    loadParts({});
                                },
                            },
                        },
                    ],
                },
                {
                    id: "pk-filters-pane",
                    view: "toolbar",
                    css: "pk-filters-pane",
                    height: 50,
                    hidden: true,
                    cols: [
                        {
                            view: "richselect",
                            id: "pk-filter-stock",
                            label: "Stock",
                            labelWidth: 50,
                            width: 180,
                            value: "any",
                            options: [
                                { id: "any", value: "any" },
                                { id: "in_stock", value: "in stock (>0)" },
                                { id: "out_of_stock", value: "out of stock (=0)" },
                                { id: "low_stock", value: "low stock (<min)" },
                            ],
                        },
                        {
                            view: "richselect",
                            id: "pk-filter-meta",
                            label: "Type",
                            labelWidth: 50,
                            width: 160,
                            value: "any",
                            options: [
                                { id: "any", value: "any" },
                                { id: "real", value: "real only" },
                                { id: "meta", value: "meta only" },
                            ],
                        },
                        {
                            view: "richselect",
                            id: "pk-filter-distributor",
                            label: "Distributor",
                            labelWidth: 80,
                            width: 240,
                            value: "",
                            options: [{ id: "", value: "(any)" }],  // populated lazily
                        },
                        {
                            view: "text",
                            id: "pk-filter-price-min",
                            label: "Price min",
                            labelWidth: 75,
                            width: 130,
                            placeholder: "(any)",
                        },
                        {
                            view: "text",
                            id: "pk-filter-price-max",
                            label: "max",
                            labelWidth: 35,
                            width: 110,
                            placeholder: "(any)",
                        },
                        {},
                        { view: "button", value: "Apply", css: "webix_primary", width: 90, click: applyFilters },
                        { view: "button", value: "Reset", width: 90, click: resetFilters },
                    ],
                },
                {
                    id: "pk-parametric-pane",
                    css: "pk-filters-pane",
                    hidden: true,
                    rows: [
                        // Category (functional class) filter row —
                        // multi-select with sub-tree expansion. Picks
                        // are OR'd; each pick auto-includes every
                        // descendant so picking "Active Components"
                        // matches everything under it. Same shuttle
                        // UX as the footprint picker below.
                        {
                            view: "toolbar",
                            css: "pk-pane-toolbar",
                            height: 38,
                            cols: [
                                {
                                    view: "checkbox",
                                    id: "pk-parametric-cat-toggle",
                                    label: "",
                                    labelRight: "Class",
                                    labelWidth: 0,
                                    width: 110,
                                    on: {
                                        onChange: function (newVal) {
                                            const btn = $$("pk-parametric-cat-button");
                                            if (!btn) return;
                                            if (newVal) {
                                                btn.enable();
                                            } else {
                                                btn.disable();
                                                selectedCategoryIds = [];
                                                refreshParametricCatLabel();
                                            }
                                        },
                                    },
                                },
                                {
                                    view: "button",
                                    id: "pk-parametric-cat-button",
                                    value: "Pick classes…",
                                    width: 200,
                                    disabled: true,
                                    click: function () { openCategoryPickerPopup(this); },
                                },
                                {
                                    view: "label",
                                    id: "pk-parametric-cat-status",
                                    label: "",
                                    css: "pk-help-hint",
                                },
                            ],
                        },
                        // Footprint filter row — multi-select, gated by
                        // a checkbox. Webix Standard (GPL) doesn't ship
                        // `multicombo` (Pro-only), so we use a button
                        // that opens a popup with a `list` in
                        // multiselect mode, which IS in GPL. Status
                        // label shows the current pick count.
                        {
                            view: "toolbar",
                            css: "pk-pane-toolbar",
                            height: 38,
                            cols: [
                                {
                                    view: "checkbox",
                                    id: "pk-parametric-fp-toggle",
                                    label: "",
                                    labelRight: "Footprint",
                                    labelWidth: 0,
                                    width: 110,
                                    on: {
                                        onChange: function (newVal) {
                                            const btn = $$("pk-parametric-fp-button");
                                            if (!btn) return;
                                            if (newVal) {
                                                btn.enable();
                                            } else {
                                                btn.disable();
                                                selectedFootprintIds = [];
                                                refreshParametricFpLabel();
                                            }
                                        },
                                    },
                                },
                                {
                                    view: "button",
                                    id: "pk-parametric-fp-button",
                                    value: "Pick footprints…",
                                    width: 200,
                                    disabled: true,
                                    click: function () { openFootprintPickerPopup(this); },
                                },
                                {
                                    view: "label",
                                    id: "pk-parametric-fp-status",
                                    label: "",
                                    css: "pk-help-hint",
                                },
                            ],
                        },
                        {
                            view: "toolbar",
                            css: "pk-pane-toolbar",
                            height: 32,
                            cols: [
                                { view: "label", label: "Parameter predicates (AND-combined)", css: "pk-pane-title" },
                                {},
                                { view: "button", value: "+ Add predicate", css: "pk-btn-add", width: 130, click: addParametricPredicate },
                                { view: "button", value: "− Remove", css: "pk-btn-remove", width: 90, click: removeParametricPredicate },
                            ],
                        },
                        {
                            view: "datatable",
                            id: "pk-parametric-grid",
                            css: "pk-grid",
                            height: 180,
                            editable: true,
                            // Single click both edits AND selects (the
                            // onBeforeEditStart hook below ensures the
                            // row is selected so − Remove sees it).
                            editaction: "click",
                            select: "row",
                            on: {
                                onBeforeEditStart: function (state) {
                                    if (state && state.row) this.select(state.row);
                                },
                            },
                            columns: [
                                {
                                    id: "name",
                                    header: "Parameter",
                                    width: 200,
                                    editor: "combo",
                                    options: [],  // populated lazily
                                },
                                {
                                    id: "op",
                                    header: "Op",
                                    width: 70,
                                    editor: "richselect",
                                    options: [
                                        { id: "=", value: "=" },
                                        { id: "!=", value: "≠" },
                                        { id: "<", value: "<" },
                                        { id: "<=", value: "≤" },
                                        { id: ">", value: ">" },
                                        { id: ">=", value: "≥" },
                                        { id: "like", value: "like" },
                                    ],
                                },
                                {
                                    id: "value_type",
                                    header: "Type",
                                    width: 90,
                                    editor: "richselect",
                                    options: [
                                        { id: "numeric", value: "numeric" },
                                        { id: "string", value: "string" },
                                    ],
                                },
                                { id: "value", header: "Value", width: 100, editor: "text", css: "pk-numeric" },
                                {
                                    id: "si_prefix_id",
                                    header: "Prefix",
                                    width: 100,
                                    editor: "richselect",
                                    options: [],  // populated by ensureParametricLookupsReady
                                    template: function (o) {
                                        if (!o.si_prefix_id || !lookupsCache) return "";
                                        const p = (lookupsCache.prefixes || []).find((x) => String(x.id) === String(o.si_prefix_id));
                                        return p ? escapeHtml(p.symbol) : "";
                                    },
                                },
                                {
                                    id: "unit_id",
                                    header: "Unit",
                                    width: 130,
                                    editor: "richselect",
                                    options: [],
                                    template: function (o) {
                                        if (!o.unit_id || !lookupsCache) return "";
                                        const u = (lookupsCache.units || []).find((x) => String(x.id) === String(o.unit_id));
                                        return u ? escapeHtml(u.name + " (" + u.symbol + ")") : "";
                                    },
                                },
                                { id: "string_value", header: "String value", fillspace: true, editor: "text" },
                            ],
                            data: [],
                        },
                        {
                            view: "toolbar",
                            css: "pk-pane-toolbar",
                            height: 38,
                            cols: [
                                { view: "label", label: '<span class="pk-help-hint">Numeric: fill Value + Prefix + Unit · String: use String value</span>' },
                                {},
                                { view: "button", value: "Apply parametric", css: "webix_primary", width: 150, click: applyParametricSearch },
                                { view: "button", value: "Reset", width: 90, click: resetParametricSearch },
                            ],
                        },
                    ],
                },
                {
                    view: "datatable",
                    id: "pk-parts-grid",
                    css: "pk-grid",
                    select: "row",
                    resizeColumn: { headerOnly: true, size: 4 },
                    dragColumn: true,
                    // Show the per-column filter row beneath each header.
                    headerRowHeight: 26,
                    columns: [
                        {
                            id: "name",
                            header: ["Name", { content: "textFilter" }],
                            width: 220,
                            sort: "string",
                            template: (o) => escapeHtml(o.name || ""),
                        },
                        {
                            id: "internal_part_number",
                            header: ["IPN", { content: "textFilter" }],
                            width: 110,
                            sort: "string",
                            template: (o) => escapeHtml(o.internal_part_number || ""),
                        },
                        {
                            id: "description",
                            header: ["Description", { content: "textFilter" }],
                            fillspace: true,
                            sort: "string",
                            template: (o) => escapeHtml(o.description || ""),
                        },
                        {
                            id: "category_path",
                            header: ["Category", { content: "selectFilter" }],
                            width: 240,
                            sort: "string",
                            // The full breadcrumb is what we filter against,
                            // but we render the leaf for grid density.
                            template: (o) => {
                                const p = o.category_path || "";
                                const parts = p.split(" ➤ ");
                                return escapeHtml(parts[parts.length - 1] || p);
                            },
                        },
                        {
                            id: "stock_level",
                            header: [{ text: "Stock", css: "pk-th-numeric" }, { content: "numberFilter" }],
                            width: 70,
                            sort: "int",
                            css: "pk-numeric",
                        },
                        {
                            id: "average_price",
                            header: [{ text: "Avg $", css: "pk-th-numeric" }, { content: "textFilter" }],
                            width: 80,
                            sort: "int",
                            css: "pk-numeric",
                            template: (o) => {
                                const v = parseFloat(o.average_price);
                                return Number.isFinite(v) ? v.toFixed(4) : "";
                            },
                        },
                    ],
                    on: {
                        onAfterSelect: function (s) {
                            loadPartDetail(s.id);
                        },
                        onAfterColumnDrop: function () { savePartsGridState(); },
                        onColumnResize: function () { savePartsGridState(); },
                        onAfterColumnHide: function () { savePartsGridState(); },
                        onAfterColumnShow: function () { savePartsGridState(); },
                    },
                },
                {
                    view: "label",
                    id: "pk-parts-status",
                    css: "pk-status-bar",
                    label: "",
                    height: 22,
                },
            ];
    }

    // ============================================================
    //  Attachments — reusable section for any of the 6 kinds
    // ============================================================

    const ATTACHMENT_KINDS = {
        PartAttachment: {
            listPath: (id) => `/api/parts/${id}/attachments`,
            label: "Attachments",
        },
        FootprintImage: {
            listPath: (id) => `/api/footprints/${id}/images`,
            label: "Images",
        },
        FootprintAttachment: {
            listPath: (id) => `/api/footprints/${id}/attachments`,
            label: "Attachments",
        },
        ManufacturerICLogo: {
            listPath: (id) => `/api/manufacturers/${id}/logos`,
            label: "Logos",
        },
        StorageLocationImage: {
            listPath: (id) => `/api/storage_locations/${id}/images`,
            label: "Images",
        },
        ProjectAttachment: {
            listPath: (id) => `/api/projects/${id}/attachments`,
            label: "Attachments",
        },
    };

    // Build a Webix view that shows the attachments for one parent entity.
    //   tableId      — unique Webix id for the inner datatable
    //   uploaderId   — unique Webix id for the file-picker
    //   kind         — key into ATTACHMENT_KINDS
    //   getParentId  — () => current parent id (or null when not yet saved)
    function buildAttachmentsSection({ tableId, uploaderId, kind, getParentId }) {
        return {
            rows: [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 38,
                    cols: [
                        {
                            view: "uploader",
                            id: uploaderId,
                            value: "+ Attach files",
                            css: "pk-btn-add",
                            multiple: true,
                            link: tableId,
                            autosend: false,
                            width: 130,
                            on: {
                                onBeforeFileAdd: function () {
                                    const parentId = getParentId();
                                    if (!parentId) {
                                        webix.message({ type: "error", text: "Save the entity first." });
                                        return false;
                                    }
                                    this.config.upload = ATTACHMENT_KINDS[kind].listPath(parentId);
                                    return true;
                                },
                                onFileUpload: function () {
                                    // Re-fetch the list so we get the server's
                                    // canonical view (the uploader's auto-add
                                    // skips fields like id/mimetype).
                                    refreshAttachments({ tableId, kind, getParentId });
                                },
                                onFileUploadError: function (file, response) {
                                    webix.message({
                                        type: "error",
                                        text: "Upload failed: " + (response && response.text ? response.text : "?"),
                                    });
                                },
                            },
                        },
                        {
                            view: "button",
                            value: "+ From URL",
                            css: "webix_primary",
                            width: 110,
                            click: () => openAttachmentByUrlDialog({ tableId, kind, getParentId }),
                        },
                        {
                            view: "button",
                            value: "✎ Description",
                            width: 130,
                            click: () => openAttachmentDescriptionDialog({ tableId, kind, getParentId }),
                        },
                        {
                            view: "button",
                            value: "🗑 Delete",
                            css: "pk-btn-remove",
                            width: 100,
                            click: () => confirmAttachmentDelete({ tableId, kind, getParentId }),
                        },
                        {},
                    ],
                },
                {
                    view: "datatable",
                    id: tableId,
                    css: "pk-grid",
                    select: "row",
                    columns: [
                        {
                            id: "preview",
                            header: "",
                            width: 60,
                            template: function (o) {
                                if (!o.id) return "";
                                if (o.is_image) {
                                    return `<img src="/files/${kind}/${o.id}/thumb" alt="" class="pk-att-thumb">`;
                                }
                                return '<span class="pk-att-doc">📄</span>';
                            },
                        },
                        {
                            id: "originalname",
                            header: "Filename",
                            fillspace: true,
                            template: function (o) {
                                if (!o.id) return "";
                                const name = escapeHtml(o.originalname || o.filename || "");
                                return `<a href="/files/${kind}/${o.id}" target="_blank">${name}</a>`;
                            },
                        },
                        {
                            id: "size",
                            header: { text: "Size", css: "pk-th-numeric" },
                            width: 90,
                            css: "pk-numeric",
                            template: (o) => o.size ? `${(o.size / 1024).toFixed(1)} KB` : "",
                        },
                        {
                            id: "mimetype",
                            header: "Type",
                            width: 130,
                        },
                        {
                            id: "description",
                            header: "Description",
                            width: 200,
                            template: (o) => escapeHtml(o.description || ""),
                        },
                    ],
                    type: { height: 44 },  // taller rows for the thumbs
                },
            ],
        };
    }

    async function refreshAttachments({ tableId, kind, getParentId }) {
        const parentId = getParentId();
        const grid = $$(tableId);
        if (!grid) return;
        if (!parentId) { grid.clearAll(); return; }
        try {
            const rows = await api.listAttachments(kind, parentId);
            grid.clearAll();
            grid.parse(rows);
        } catch (e) {
            console.error(e);
        }
    }

    function openAttachmentByUrlDialog({ tableId, kind, getParentId }) {
        const parentId = getParentId();
        if (!parentId) {
            webix.message({ type: "error", text: "Save the entity first." });
            return;
        }
        webix.ui({
            view: "window",
            id: "pk-att-url",
            modal: true,
            position: "center",
            width: 520,
            head: "Attach by URL",
            body: {
                view: "form",
                id: "pk-att-url-form",
                elements: [
                    { view: "text", name: "url", label: "URL", labelWidth: 100, required: true },
                    { view: "text", name: "filename", label: "Filename", labelWidth: 100,
                      placeholder: "(optional — auto-detected)" },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-att-url").close() },
                            {
                                view: "button",
                                value: "Fetch",
                                width: 100,
                                css: "webix_primary",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-att-url-form").getValues();
                                    if (!v.url || !v.url.trim()) {
                                        webix.message({ type: "error", text: "URL is required" });
                                        return;
                                    }
                                    try {
                                        await api.fetchAttachmentByUrl(kind, parentId,
                                            v.url.trim(), (v.filename || "").trim() || null);
                                        $$("pk-att-url").close();
                                        await refreshAttachments({ tableId, kind, getParentId });
                                        webix.message({ text: "Fetched", type: "success" });
                                    } catch (e) {
                                        showUrlFetchFailedAlert(v.url.trim(), e);
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
        setTimeout(() => $$("pk-att-url-form").focus(), 0);
    }

    function openAttachmentDescriptionDialog({ tableId, kind, getParentId }) {
        const grid = $$(tableId);
        const sel = grid && grid.getSelectedId() ? grid.getItem(grid.getSelectedId()) : null;
        if (!sel) {
            webix.message({ type: "error", text: "Select an attachment first." });
            return;
        }
        webix.ui({
            view: "window",
            id: "pk-att-desc",
            modal: true,
            position: "center",
            width: 480,
            head: `Edit description: ${sel.originalname || sel.filename}`,
            body: {
                view: "form",
                id: "pk-att-desc-form",
                elements: [
                    { view: "textarea", name: "description", label: "Description", labelWidth: 100, height: 100 },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-att-desc").close() },
                            {
                                view: "button",
                                value: "Save",
                                width: 90,
                                css: "webix_primary",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-att-desc-form").getValues();
                                    try {
                                        await api.updateAttachmentDescription(kind, sel.id, v.description);
                                        $$("pk-att-desc").close();
                                        await refreshAttachments({ tableId, kind, getParentId });
                                        webix.message({ text: "Saved", type: "success" });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
        $$("pk-att-desc-form").setValues({ description: sel.description || "" });
    }

    function showUrlFetchFailedAlert(url, error) {
        const msg = String(error && error.message ? error.message : error);

        // Heuristics: extract the host so the alert mentions a specific
        // vendor when known to be problematic.
        let host = "";
        try { host = new URL(url).host.replace(/^www\./, ""); } catch (_) {}
        const knownBlockers = ["analog.com", "octopart.com", "digikey.com", "mouser.com"];
        const isKnownBlocker = knownBlockers.some((h) => host.endsWith(h));

        const reason = msg.includes("error sending request")
            ? "the server refused the connection or timed out"
            : msg.includes("status 403")
                ? "the server returned 403 (forbidden — usually bot protection)"
                : msg.includes("status 404")
                    ? "the server returned 404 (URL not found)"
                    : msg.includes("status 4")
                        ? "the server returned a client error"
                        : msg.includes("status 5")
                            ? "the server returned a server error"
                            : "an error occurred while fetching";

        const blockerNote = isKnownBlocker
            ? `<p><b>${escapeHtml(host)}</b> is known to block automated downloads via Akamai or Cloudflare bot protection. ` +
              `Programmatic clients can't pass their TLS/JS challenges.</p>`
            : "";

        webix.alert({
            title: "URL fetch failed",
            width: 520,
            text:
                `<div style="text-align:left;line-height:1.5">` +
                `<p>Could not fetch <code style="word-break:break-all">${escapeHtml(url)}</code> — ${reason}.</p>` +
                blockerNote +
                `<p><b>Workaround:</b> download the file manually in your browser, ` +
                `then use <b>+ Attach files</b> to upload it.</p>` +
                `<details style="margin-top:8px"><summary style="cursor:pointer;color:#6a7a8a">Show server message</summary>` +
                `<pre style="background:#f3f5f7;padding:6px;font-size:11px;white-space:pre-wrap">${escapeHtml(msg)}</pre>` +
                `</details>` +
                `</div>`,
        });
    }

    function confirmAttachmentDelete({ tableId, kind, getParentId }) {
        const grid = $$(tableId);
        const sel = grid && grid.getSelectedId() ? grid.getItem(grid.getSelectedId()) : null;
        if (!sel) {
            webix.message({ type: "error", text: "Select an attachment first." });
            return;
        }
        const name = sel.originalname || sel.filename;
        webix.confirm({
            title: "Delete attachment",
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text: `Delete <b>${escapeHtml(name)}</b>? This removes the file from disk too.`,
            callback: async (result) => {
                if (!result) return;
                try {
                    await api.deleteAttachment(kind, sel.id);
                    await refreshAttachments({ tableId, kind, getParentId });
                    webix.message({ text: "Deleted", type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    // ============================================================
    //  Lookups CRUD — center pane content + per-type definitions
    // ============================================================

    // Configuration table: each lookup type knows its endpoint, list
    // columns to render, and how to seed/format an edit dialog.
    const LOOKUP_TYPES = {
        manufacturers: {
            label: "Manufacturers",
            url: "/api/manufacturers",
            columns: [
                { id: "name", header: "Name", fillspace: true, sort: "string" },
                { id: "url", header: "URL", width: 220, sort: "string" },
                { id: "email", header: "Email", width: 200, sort: "string" },
                { id: "phone", header: "Phone", width: 130, sort: "string" },
                { id: "part_count", header: { text: "Parts", css: "pk-th-numeric" }, width: 70, sort: "int", css: "pk-numeric" },
            ],
            buildEdit: (existing) => ({
                title: existing ? `Edit manufacturer "${existing.name}"` : "New manufacturer",
                fields: [
                    { kind: "text", name: "name", label: "Name", required: true },
                    { kind: "text", name: "url", label: "URL" },
                    { kind: "text", name: "email", label: "Email" },
                    { kind: "text", name: "phone", label: "Phone" },
                    { kind: "text", name: "fax", label: "Fax" },
                    { kind: "textarea", name: "address", label: "Address", height: 60 },
                    { kind: "textarea", name: "comment", label: "Comment", height: 60 },
                ],
                seed: existing || { name: "", url: "", email: "", phone: "", fax: "", address: "", comment: "" },
                serialize: (v) => ({
                    name: v.name.trim(),
                    url: (v.url || "").trim() || null,
                    email: (v.email || "").trim() || null,
                    phone: (v.phone || "").trim() || null,
                    fax: (v.fax || "").trim() || null,
                    address: (v.address || "").trim() || null,
                    comment: (v.comment || "").trim() || null,
                }),
            }),
        },
        distributors: {
            label: "Distributors",
            url: "/api/distributors",
            columns: [
                { id: "name", header: "Name", fillspace: true, sort: "string" },
                { id: "url", header: "URL", width: 220, sort: "string" },
                { id: "skuurl", header: "SKU URL", width: 200, sort: "string" },
                { id: "phone", header: "Phone", width: 130, sort: "string" },
            ],
            buildEdit: (existing) => ({
                title: existing ? `Edit distributor "${existing.name}"` : "New distributor",
                fields: [
                    { kind: "text", name: "name", label: "Name", required: true },
                    { kind: "text", name: "url", label: "URL" },
                    { kind: "text", name: "skuurl", label: "SKU URL" },
                    { kind: "text", name: "email", label: "Email" },
                    { kind: "text", name: "phone", label: "Phone" },
                    { kind: "text", name: "fax", label: "Fax" },
                    { kind: "textarea", name: "address", label: "Address", height: 60 },
                    { kind: "textarea", name: "comment", label: "Comment", height: 60 },
                    { kind: "checkbox", name: "enabled_for_reports", labelRight: "Enabled for reports" },
                ],
                seed: existing || { name: "", url: "", skuurl: "", email: "", phone: "", fax: "", address: "", comment: "", enabled_for_reports: true },
                serialize: (v) => ({
                    name: v.name.trim(),
                    url: (v.url || "").trim() || null,
                    skuurl: (v.skuurl || "").trim() || null,
                    email: (v.email || "").trim() || null,
                    phone: (v.phone || "").trim() || null,
                    fax: (v.fax || "").trim() || null,
                    address: (v.address || "").trim() || null,
                    comment: (v.comment || "").trim() || null,
                    enabled_for_reports: !!v.enabled_for_reports,
                }),
            }),
        },
        part_units: {
            label: "Part Units",
            url: "/api/part_measurement_units",
            columns: [
                { id: "name", header: "Name", fillspace: true, sort: "string" },
                { id: "short_name", header: "Short", width: 100, sort: "string" },
                {
                    id: "is_default", header: "Default", width: 80,
                    template: (o) => o.is_default ? "<b>✓</b>" : "",
                },
                { id: "part_count", header: { text: "Parts", css: "pk-th-numeric" }, width: 70, sort: "int", css: "pk-numeric" },
            ],
            buildEdit: (existing) => ({
                title: existing ? `Edit part unit "${existing.name}"` : "New part unit",
                fields: [
                    { kind: "text", name: "name", label: "Name", required: true },
                    { kind: "text", name: "short_name", label: "Short name", required: true },
                    { kind: "checkbox", name: "is_default", labelRight: "Default unit for new parts" },
                ],
                seed: existing || { name: "", short_name: "", is_default: false },
                serialize: (v) => ({
                    name: v.name.trim(),
                    short_name: (v.short_name || "").trim(),
                    is_default: !!v.is_default,
                }),
            }),
        },
        units: {
            label: "Units (parametric)",
            url: "/api/units",
            columns: [
                { id: "name", header: "Name", fillspace: true, sort: "string" },
                { id: "symbol", header: "Symbol", width: 110, sort: "string" },
                { id: "parameter_count", header: { text: "Used", css: "pk-th-numeric" }, width: 70, sort: "int", css: "pk-numeric" },
            ],
            buildEdit: (existing) => ({
                title: existing ? `Edit unit "${existing.name}"` : "New unit",
                fields: [
                    { kind: "text", name: "name", label: "Name", required: true },
                    { kind: "text", name: "symbol", label: "Symbol", required: true },
                    {
                        kind: "prefix_checkboxes",
                        name: "allowed_prefix_ids",
                        label: "SI prefixes allowed",
                    },
                ],
                seed: existing || { name: "", symbol: "", allowed_prefix_ids: [] },
                serialize: (v) => ({
                    name: v.name.trim(),
                    symbol: (v.symbol || "").trim(),
                    // The prefix_checkboxes field contributes one
                    // _pfx_<id>:bool key per prefix; collect the truthy
                    // ones back into the array shape the API expects.
                    allowed_prefix_ids: Object.keys(v)
                        .filter((k) => k.startsWith("_pfx_") && !!v[k])
                        .map((k) => parseInt(k.slice(5), 10))
                        .filter((n) => !isNaN(n)),
                }),
            }),
        },
        si_prefixes: {
            label: "SI Prefixes",
            url: "/api/si_prefixes",
            columns: [
                { id: "prefix", header: "Prefix", fillspace: true, sort: "string" },
                { id: "symbol", header: "Symbol", width: 90, sort: "string" },
                { id: "base", header: { text: "Base", css: "pk-th-numeric" }, width: 70, sort: "int", css: "pk-numeric" },
                { id: "exponent", header: { text: "Exponent", css: "pk-th-numeric" }, width: 90, sort: "int", css: "pk-numeric" },
                { id: "parameter_count", header: { text: "Used", css: "pk-th-numeric" }, width: 70, sort: "int", css: "pk-numeric" },
            ],
            buildEdit: (existing) => ({
                title: existing ? `Edit SI prefix "${existing.prefix}"` : "New SI prefix",
                fields: [
                    { kind: "text", name: "prefix", label: "Prefix", required: true },
                    { kind: "text", name: "symbol", label: "Symbol", required: true },
                    { kind: "counter", name: "base", label: "Base", min: 2, step: 1 },
                    // Webix counter defaults min:0; exponents go negative
                    // (yocto = -24), so allow plenty of headroom both ways.
                    { kind: "counter", name: "exponent", label: "Exponent", min: -100, max: 100, step: 1 },
                ],
                seed: existing || { prefix: "", symbol: "", base: 10, exponent: 0 },
                serialize: (v) => ({
                    prefix: v.prefix.trim(),
                    symbol: (v.symbol || "").trim(),
                    base: parseInt(v.base, 10) || 10,
                    exponent: parseInt(v.exponent, 10) || 0,
                }),
            }),
        },
    };

    let currentLookupType = null;  // key into LOOKUP_TYPES

    function buildLookupsCenterRows() {
        return [
            {
                view: "toolbar",
                css: "pk-pane-toolbar",
                height: 40,
                cols: [
                    { view: "label", id: "pk-lookups-title", label: "Lookups", css: "pk-pane-title" },
                    {},
                    { view: "button", value: "+ Add", css: "pk-btn-add", width: 80, click: openLookupAdd },
                    { view: "button", value: "✎ Edit", css: "webix_primary", width: 80, click: openLookupEdit },
                    { view: "button", value: "🔀 Merge into…", width: 130, click: openLookupMergeDialog },
                    { view: "button", value: "🗑 Delete", css: "pk-btn-remove", width: 90, click: confirmLookupDelete },
                ],
            },
            {
                view: "datatable",
                id: "pk-lookups-grid",
                css: "pk-grid",
                select: "row",
                resizeColumn: { headerOnly: true, size: 4 },
                columns: [],
            },
            {
                view: "label",
                id: "pk-lookups-status",
                css: "pk-status-bar",
                label: "",
                height: 22,
            },
        ];
    }

    async function showLookupType(typeKey) {
        const cfg = LOOKUP_TYPES[typeKey];
        if (!cfg) return;
        currentLookupType = typeKey;
        $$("pk-lookups-title").setValue(cfg.label);
        const grid = $$("pk-lookups-grid");
        // Webix datatable's columns are mostly static; replace via refreshColumns.
        grid.config.columns = cfg.columns;
        grid.refreshColumns();
        try {
            const rows = await api.lookupList(cfg.url);
            grid.clearAll();
            grid.parse(rows);
            $$("pk-lookups-status").setValue(`${rows.length} ${cfg.label.toLowerCase()}`);
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load " + cfg.label.toLowerCase() });
        }
        // Make sure the center pane is showing the lookups cell.
        const cell = $$("centerpane-lookups");
        if (cell) cell.show();
    }

    function getSelectedLookupRow() {
        const grid = $$("pk-lookups-grid");
        if (!grid) return null;
        const id = grid.getSelectedId();
        if (!id) return null;
        const item = grid.getItem(id);
        return item || null;
    }

    async function openLookupAdd() {
        if (!currentLookupType) return;
        if (currentLookupType === "manufacturers") {
            openManufacturerEditor("new", null);
            return;
        }
        // Units' edit dialog includes a prefix-checkbox grid that reads
        // from lookupsCache.prefixes — guarantee it's loaded.
        await ensureLookups();
        const cfg = LOOKUP_TYPES[currentLookupType];
        const ed = cfg.buildEdit(null);
        showLookupEditDialog({
            title: ed.title,
            fields: ed.fields,
            seed: ed.seed,
            saveLabel: "Create",
            onSave: async (formValues) => {
                const body = ed.serialize(formValues, null);
                await api.lookupCreate(cfg.url, body);
                lookupsCache = null;  // any cross-screen list (units, prefixes, etc.) is now stale
                await showLookupType(currentLookupType);
            },
        });
    }

    async function openLookupEdit() {
        if (!currentLookupType) return;
        const sel = getSelectedLookupRow();
        if (!sel) {
            webix.message({ type: "error", text: "Select a row to edit." });
            return;
        }
        if (currentLookupType === "manufacturers") {
            openManufacturerEditor("edit", sel);
            return;
        }
        await ensureLookups();
        const cfg = LOOKUP_TYPES[currentLookupType];
        const ed = cfg.buildEdit(sel);
        showLookupEditDialog({
            title: ed.title,
            fields: ed.fields,
            seed: ed.seed,
            saveLabel: "Save",
            onSave: async (formValues) => {
                const body = ed.serialize(formValues, sel);
                await api.lookupUpdate(cfg.url, sel.id, body);
                lookupsCache = null;
                await showLookupType(currentLookupType);
            },
        });
    }

    // Comprehensive manufacturer editor (Identity + Logos tabs).
    // Other lookup types use the generic showLookupEditDialog.
    function openManufacturerEditor(mode, existing) {
        const isEdit = mode === "edit";
        const mfgId = isEdit && existing ? existing.id : null;
        const seed = existing || {
            name: "", url: "", email: "", phone: "", fax: "",
            address: "", comment: "",
        };

        const tabs = [
            {
                header: "Identity",
                body: {
                    rows: [
                        { view: "text", name: "name", label: "Name", labelWidth: 110, required: true },
                        { view: "text", name: "url", label: "URL", labelWidth: 110 },
                        { view: "text", name: "email", label: "Email", labelWidth: 110 },
                        { view: "text", name: "phone", label: "Phone", labelWidth: 110 },
                        { view: "text", name: "fax", label: "Fax", labelWidth: 110 },
                        { view: "textarea", name: "address", label: "Address", labelWidth: 110, height: 60 },
                        { view: "textarea", name: "comment", label: "Comment", labelWidth: 110, height: 80 },
                        {},
                    ],
                },
            },
        ];
        if (isEdit) {
            tabs.push({
                header: "Logos",
                body: buildAttachmentsSection({
                    tableId: "pk-mfg-logos",
                    uploaderId: "pk-mfg-logos-uploader",
                    kind: "ManufacturerICLogo",
                    getParentId: () => mfgId,
                }),
            });
        }

        webix.ui({
            view: "window",
            id: "pk-mfg-editor",
            modal: true,
            position: "center",
            width: 820,
            height: 620,
            head: isEdit ? `Edit manufacturer "${existing.name}"` : "New manufacturer",
            body: {
                view: "form",
                id: "pk-mfg-editor-form",
                elements: [
                    { view: "tabview", cells: tabs },
                    {
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90, click: () => $$("pk-mfg-editor").close() },
                            {
                                view: "button",
                                value: isEdit ? "Save" : "Create",
                                width: 110,
                                css: isEdit ? "webix_primary" : "pk-btn-add",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-mfg-editor-form").getValues();
                                    if (!v.name || !v.name.trim()) {
                                        webix.message({ type: "error", text: "Name is required" });
                                        return;
                                    }
                                    const body = {
                                        name: v.name.trim(),
                                        url: (v.url || "").trim() || null,
                                        email: (v.email || "").trim() || null,
                                        phone: (v.phone || "").trim() || null,
                                        fax: (v.fax || "").trim() || null,
                                        address: (v.address || "").trim() || null,
                                        comment: (v.comment || "").trim() || null,
                                    };
                                    try {
                                        let savedId;
                                        if (isEdit) {
                                            await api.lookupUpdate("/api/manufacturers", existing.id, body);
                                            savedId = existing.id;
                                        } else {
                                            const created = await api.lookupCreate("/api/manufacturers", body);
                                            savedId = created.id;
                                        }
                                        $$("pk-mfg-editor").close();
                                        await showLookupType("manufacturers");
                                        webix.message({ text: "Saved", type: "success" });
                                        if (!isEdit) {
                                            // Re-open in edit mode so the operator can attach a logo.
                                            openManufacturerEditor("edit", { ...body, id: savedId });
                                        }
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
        $$("pk-mfg-editor-form").setValues(seed);

        if (isEdit) {
            refreshAttachments({ tableId: "pk-mfg-logos", kind: "ManufacturerICLogo", getParentId: () => mfgId });
        }
    }

    /// Build a friendly display label for a lookup row regardless of
    /// type (manufacturers/distributors/units use `name`, si_prefixes
    /// uses `prefix`, fall back to `#id`).
    function lookupRowLabel(row) {
        if (!row) return "?";
        if (row.name) return row.name;
        if (row.prefix) return row.prefix + (row.symbol ? ` (${row.symbol})` : "");
        return `#${row.id}`;
    }

    /// Slice 5d — open the merge-into dialog. Source is the currently-
    /// selected row; target is picked from the same lookup type's other
    /// rows. On confirm: backend reassigns all FK references in one
    /// transaction and deletes the source.
    async function openLookupMergeDialog() {
        if (!currentLookupType) return;
        const sel = getSelectedLookupRow();
        if (!sel) {
            webix.message({ type: "error", text: "Select a row to merge." });
            return;
        }
        const cfg = LOOKUP_TYPES[currentLookupType];

        // Re-fetch the full list so we always pick from current data
        // (the grid may show a stale snapshot if the user just
        // edited something in another tab).
        let rows;
        try {
            rows = await api.lookupList(cfg.url);
        } catch (e) {
            webix.message({ type: "error", text: "Failed to load list: " + (e.message || e) });
            return;
        }
        const targets = rows
            .filter((r) => r.id !== sel.id)
            .map((r) => ({ id: r.id, value: lookupRowLabel(r) }))
            .sort((a, b) => a.value.localeCompare(b.value));
        if (targets.length === 0) {
            webix.message({ type: "error", text: "No other rows to merge into." });
            return;
        }

        const sourceLabel = lookupRowLabel(sel);

        webix.ui({
            view: "window",
            id: "pk-lookup-merge",
            modal: true,
            position: "center",
            width: 520,
            head: `Merge "${sourceLabel}" into…`,
            body: {
                rows: [
                    {
                        view: "template",
                        height: 80,
                        borderless: true,
                        css: "pk-dialog-hint",
                        template: `<div style="padding:10px 14px;line-height:1.5">` +
                            `All references to <b>${escapeHtml(sourceLabel)}</b> ` +
                            `will be reassigned to the target you choose, then ` +
                            `<b>${escapeHtml(sourceLabel)}</b> will be deleted.<br>` +
                            `<span style="color:#b03030">This cannot be undone.</span>` +
                            `</div>`,
                    },
                    {
                        view: "form",
                        id: "pk-lookup-merge-form",
                        elements: [
                            {
                                view: "richselect",
                                name: "target_id",
                                label: "Target",
                                labelWidth: 80,
                                options: targets,
                            },
                        ],
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 50,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 100,
                              click: () => $$("pk-lookup-merge").close() },
                            {
                                view: "button",
                                value: "Merge",
                                width: 110,
                                css: "pk-btn-remove",
                                hotkey: "ctrl+s",
                                click: async function () {
                                    const v = $$("pk-lookup-merge-form").getValues();
                                    const targetId = parseInt(v.target_id, 10);
                                    if (!targetId) {
                                        webix.message({ type: "error", text: "Pick a target." });
                                        return;
                                    }
                                    try {
                                        const resp = await api.lookupMerge(cfg.url, sel.id, targetId);
                                        $$("pk-lookup-merge").close();
                                        // lookupsCache is now stale (units, prefixes
                                        // counts may have shifted; ids are gone).
                                        lookupsCache = null;
                                        await showLookupType(currentLookupType);
                                        const moved = (resp && resp.moved) || {};
                                        const summary = Object.entries(moved)
                                            .filter(([, n]) => n > 0)
                                            .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`)
                                            .join(", ");
                                        const msg = summary
                                            ? `Merged: moved ${summary}.`
                                            : `Merged (no references to move).`;
                                        webix.message({ type: "success", text: msg });
                                    } catch (e) {
                                        webix.message({ type: "error", text: "Merge failed: " + (e.message || e) });
                                    }
                                },
                            },
                        ],
                    },
                ],
            },
        }).show();
    }

    function confirmLookupDelete() {
        if (!currentLookupType) return;
        const sel = getSelectedLookupRow();
        if (!sel) {
            webix.message({ type: "error", text: "Select a row to delete." });
            return;
        }
        const cfg = LOOKUP_TYPES[currentLookupType];
        const label = sel.name || sel.prefix || `#${sel.id}`;
        webix.confirm({
            title: `Delete from ${cfg.label}`,
            type: "confirm-error",
            ok: "Delete",
            cancel: "Cancel",
            text:
                `Delete <b>${escapeHtml(label)}</b>?<br><br>` +
                `Refused if any parts / parameters reference it.`,
            callback: async (result) => {
                if (!result) return;
                try {
                    await api.lookupDelete(cfg.url, sel.id);
                    await showLookupType(currentLookupType);
                    webix.message({ text: "Deleted", type: "success" });
                } catch (e) {
                    webix.message({ type: "error", text: "Delete failed: " + (e.message || e) });
                }
            },
        });
    }

    function showLookupEditDialog(opts) {
        // Some fields (prefix_checkboxes) expand into multiple form
        // elements rather than one, so flatMap, not map.
        const formElements = opts.fields.flatMap((f) => {
            if (f.kind === "text") return [{ view: "text", name: f.name, label: f.label, labelWidth: 140, required: !!f.required }];
            if (f.kind === "textarea") return [{ view: "textarea", name: f.name, label: f.label, labelWidth: 140, height: f.height || 60 }];
            if (f.kind === "checkbox") return [{ view: "checkbox", name: f.name, labelRight: f.labelRight || f.label, labelWidth: 140 }];
            if (f.kind === "counter") {
                const c = { view: "counter", name: f.name, label: f.label, labelWidth: 140, step: f.step || 1 };
                if (f.min !== undefined) c.min = f.min;
                if (f.max !== undefined) c.max = f.max;
                return [c];
            }
            if (f.kind === "prefix_checkboxes") {
                // Render the full SI prefix list as a two-column grid
                // of named checkboxes (`_pfx_<id>`). lookupsCache is
                // guaranteed loaded by openLookupAdd/openLookupEdit.
                const pfxs = ((lookupsCache && lookupsCache.prefixes) || [])
                    .slice()
                    .sort((a, b) => a.exponent - b.exponent);
                if (pfxs.length === 0) {
                    return [{ template: "(no SI prefixes defined)", borderless: true, height: 24, css: "pk-help-hint" }];
                }
                const renderRow = (p) => {
                    const sym = escapeHtml(p.symbol || "");
                    const pre = escapeHtml(p.prefix || "");
                    const exp = `${p.base}<sup>${p.exponent}</sup>`;
                    return {
                        view: "checkbox",
                        name: "_pfx_" + p.id,
                        labelRight: `${sym} ${pre} (${exp})`,
                        labelWidth: 0,
                        height: 24,
                    };
                };
                const half = Math.ceil(pfxs.length / 2);
                const left = pfxs.slice(0, half).map(renderRow);
                const right = pfxs.slice(half).map(renderRow);
                return [
                    {
                        view: "template",
                        template: `<div class="pk-detail-section-title">${escapeHtml(f.label)}</div>`,
                        height: 24,
                        borderless: true,
                    },
                    {
                        cols: [
                            { rows: left },
                            { rows: right },
                        ],
                    },
                ];
            }
            return [{ view: "text", name: f.name, label: f.label, labelWidth: 140 }];
        });
        formElements.push({
            cols: [
                {},
                { view: "button", value: "Cancel", width: 90, click: () => $$("pk-lookup-edit").close() },
                {
                    view: "button",
                    value: opts.saveLabel || "Save",
                    width: 100,
                    css: "webix_primary",
                    hotkey: "ctrl+s",
                    click: async function () {
                        const v = $$("pk-lookup-edit-form").getValues();
                        // Validate required text fields
                        for (const f of opts.fields) {
                            if (f.kind === "text" && f.required && !(v[f.name] || "").trim()) {
                                webix.message({ type: "error", text: `${f.label} is required` });
                                return;
                            }
                        }
                        try {
                            await opts.onSave(v);
                            $$("pk-lookup-edit").close();
                            webix.message({ text: "Saved", type: "success" });
                        } catch (e) {
                            webix.message({ type: "error", text: "Save failed: " + (e.message || e) });
                        }
                    },
                },
            ],
        });
        // Some kinds expand a single seed key into many form fields —
        // do that translation here so individual buildEdit configs
        // don't have to know.
        const expandedSeed = Object.assign({}, opts.seed);
        for (const f of opts.fields) {
            if (f.kind === "prefix_checkboxes") {
                const ids = (expandedSeed[f.name] || []).map(Number);
                for (const id of ids) expandedSeed["_pfx_" + id] = 1;
                delete expandedSeed[f.name];
            }
        }

        // Default size is fine for most lookups; bump for the unit
        // editor's prefix grid.
        const hasPrefixGrid = opts.fields.some((f) => f.kind === "prefix_checkboxes");
        const winHeight = hasPrefixGrid ? 560 : null;

        webix.ui({
            view: "window",
            id: "pk-lookup-edit",
            modal: true,
            position: "center",
            width: 520,
            ...(winHeight ? { height: winHeight } : {}),
            head: opts.title,
            body: { view: "form", id: "pk-lookup-edit-form", elements: formElements },
        }).show();
        $$("pk-lookup-edit-form").setValues(expandedSeed);
    }

    async function loadParts(opts) {
        opts = opts || {};
        if ("filter" in opts) currentParts.filter = opts.filter;
        if ("search" in opts) currentParts.search = opts.search;
        if ("byField" in opts) currentParts.byField = opts.byField;
        if ("predicates" in opts) currentParts.predicates = opts.predicates;
        if ("footprint_ids" in opts) currentParts.footprint_ids = opts.footprint_ids;
        if ("category_ids" in opts) currentParts.category_ids = opts.category_ids;
        try {
            const json = await api.parts({
                filter: currentParts.filter,
                search: currentParts.search,
                byField: currentParts.byField,
                predicates: currentParts.predicates,
                footprint_ids: currentParts.footprint_ids,
                category_ids: currentParts.category_ids,
                limit: 500,
                offset: 0,
            });
            const grid = $$("pk-parts-grid");
            grid.clearAll();
            grid.parse(json.items);
            const fbits = [];
            if (currentParts.search) fbits.push(`search "${currentParts.search}"`);
            if (currentParts.byField) {
                if (currentParts.byField.stock_mode) fbits.push(currentParts.byField.stock_mode.replace("_", " "));
                if (currentParts.byField.meta_only === true) fbits.push("meta only");
                if (currentParts.byField.meta_only === false) fbits.push("real only");
                if (currentParts.byField.distributor_id) fbits.push("distributor");
                if (currentParts.byField.price_min || currentParts.byField.price_max) fbits.push("price range");
            }
            if (currentParts.predicates && currentParts.predicates.length) {
                fbits.push(`${currentParts.predicates.length} predicate${currentParts.predicates.length === 1 ? "" : "s"}`);
            }
            const filterSuffix = fbits.length ? ` · ${fbits.join(" · ")}` : "";
            $$("pk-parts-status").setValue(`${json.items.length} of ${json.total} parts${filterSuffix}`);
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load parts" });
        }
    }

    // ============================================================
    //  Right pane — part detail
    // ============================================================

    function buildRightPane() {
        return {
            id: "pk-right",
            width: 380,
            rows: [
                {
                    view: "toolbar",
                    css: "pk-pane-toolbar",
                    height: 32,
                    cols: [
                        { view: "label", label: "Detail", css: "pk-pane-title" },
                    ],
                },
                {
                    id: "pk-detail-actions",
                    hidden: true,
                    rows: [
                        {
                            view: "toolbar",
                            css: "pk-detail-actions",
                            height: 42,
                            cols: [
                                {
                                    view: "button",
                                    value: "+ Add stock",
                                    css: "pk-btn-add",
                                    width: 110,
                                    click: () => openStockDialog("add"),
                                },
                                {
                                    view: "button",
                                    value: "− Remove",
                                    css: "pk-btn-remove",
                                    width: 100,
                                    click: () => openStockDialog("remove"),
                                },
                                {
                                    view: "button",
                                    value: "⇄ Reconcile",
                                    css: "webix_primary",
                                    width: 120,
                                    click: () => openStockDialog("reconcile"),
                                },
                                {},
                            ],
                        },
                        {
                            view: "toolbar",
                            css: "pk-detail-actions",
                            height: 42,
                            cols: [
                                {
                                    view: "button",
                                    value: "✎ Edit",
                                    css: "webix_primary",
                                    width: 100,
                                    click: () => openPartEditor("edit"),
                                },
                                {
                                    view: "button",
                                    value: "🖨 Label",
                                    width: 100,
                                    click: () => openLabelDialog({
                                        template: "Part",
                                        id: currentPart && currentPart.id,
                                        name: currentPart && currentPart.name,
                                        internal_part_number: currentPart && currentPart.internal_part_number,
                                    }),
                                },
                                {
                                    view: "button",
                                    value: "🗑 Delete",
                                    css: "pk-btn-remove",
                                    width: 110,
                                    click: () => openDeleteDialog(),
                                },
                                {},
                            ],
                        },
                    ],
                },
                {
                    view: "scrollview",
                    id: "pk-detail-scroll",
                    scroll: "y",
                    body: {
                        id: "pk-detail",
                        template: '<div class="pk-detail-empty">Select a part to view detail.</div>',
                        autoheight: true,
                    },
                },
            ],
        };
    }

    let currentPart = null;

    async function loadPartDetail(id) {
        try {
            const [part, projects, runs, receipts] = await Promise.all([
                api.part(id),
                api.partProjects(id).catch(() => []),
                api.partRuns(id).catch(() => []),
                api.partReceipts(id).catch(() => []),
            ]);
            currentPart = part;
            $$("pk-detail").setHTML(renderPartDetailHtml(part, projects, runs, receipts));
            const actions = $$("pk-detail-actions");
            if (actions) actions.show();
            // Wire up project links in the cross-cutting sections.
            const root = $$("pk-detail").$view;
            if (root) {
                root.querySelectorAll('a[data-project-id]').forEach((a) => {
                    a.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        const pid = parseInt(a.dataset.projectId, 10);
                        jumpToProject(pid);
                    });
                });
                // Slice 13c: per-row consume buttons in the Packaging section.
                root.querySelectorAll('button.pk-consume-btn[data-psl-id]').forEach((btn) => {
                    btn.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        const pslId = parseInt(btn.dataset.pslId, 10);
                        const row = (currentPart.locations || []).find((l) => l.id === pslId);
                        if (row) openConsumeContainerDialog(currentPart, row);
                    });
                });
            }
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load part detail" });
        }
    }

    // ============================================================
    //  Parts grid column persistence (W8c) + named GridPresets (W8c.X)
    //
    //  Two layers cooperate:
    //    1. localStorage holds the current "last seen" layout per
    //       user. Saved on every reorder/resize/hide/show. Restored on
    //       mount so reload is invisible.
    //    2. GridPreset rows on the server hold *named* shared layouts.
    //       Anyone logged in can save/edit/delete; one row per grid
    //       can be marked default. On a fresh session (no localStorage
    //       yet) the default preset, if any, is applied.
    //
    //  PARTS_GRID = "parts" is the grid slug. Future grids reuse the
    //  same backend by passing their own slug.
    // ============================================================

    const PARTS_GRID = "parts";

    function partsGridStorageKey() {
        const u = currentUser ? currentUser.username : "anon";
        return `pk:parts-grid-state:${u}`;
    }

    // Captured once on first mount so 'Reset layout' has a known target
    // to revert to. Cleared on logout.
    let _partsGridDefaultState = null;

    // Cache of /api/grid_presets?grid=<slug> results, keyed by slug.
    // Refreshed after every mutation.
    let gridPresetsCache = {};

    function savePartsGridState() {
        const grid = $$("pk-parts-grid");
        if (!grid) return;
        try {
            const state = grid.getState();
            localStorage.setItem(partsGridStorageKey(), JSON.stringify(state));
        } catch (e) {
            console.warn("savePartsGridState failed:", e);
        }
    }

    async function restorePartsGridState() {
        const grid = $$("pk-parts-grid");
        if (!grid) return;
        // Capture pristine defaults on first call so Reset can use them.
        if (_partsGridDefaultState == null) {
            try { _partsGridDefaultState = grid.getState(); } catch (_) {}
        }
        // localStorage takes precedence. If present, that's the answer.
        try {
            const raw = localStorage.getItem(partsGridStorageKey());
            if (raw) {
                grid.setState(JSON.parse(raw));
                return;
            }
        } catch (e) {
            console.warn("restorePartsGridState (localStorage) failed:", e);
        }
        // No local state — try the server's default preset (if any).
        try {
            const presets = await loadGridPresets(PARTS_GRID);
            const def = presets.find((p) => p.grid_default);
            if (def) {
                applyGridPreset(def, /*persist=*/ true);
            }
        } catch (e) {
            console.warn("restorePartsGridState (default preset) failed:", e);
        }
    }

    function clearPartsGridState() {
        try {
            localStorage.removeItem(partsGridStorageKey());
        } catch (_) {}
        const grid = $$("pk-parts-grid");
        if (grid && _partsGridDefaultState != null) {
            try { grid.setState(_partsGridDefaultState); } catch (e) { console.warn(e); }
        }
    }

    // ----- GridPreset CRUD glue -----

    async function loadGridPresets(grid, force = false) {
        if (!force && gridPresetsCache[grid]) return gridPresetsCache[grid];
        const list = await api.listGridPresets(grid);
        gridPresetsCache[grid] = list;
        return list;
    }

    function applyGridPreset(preset, persist = true) {
        const grid = $$("pk-parts-grid");
        if (!grid) return;
        try {
            grid.setState(JSON.parse(preset.configuration));
        } catch (e) {
            console.error("apply preset failed:", e);
            webix.message({ type: "error", text: "Could not apply preset (bad configuration)" });
            return;
        }
        // The preset's layout becomes the user's current layout. Save it
        // through to localStorage so reloads stick.
        if (persist) savePartsGridState();
    }

    function openPresetsMenu(toolbarButton) {
        loadGridPresets(PARTS_GRID, /*force=*/ true)
            .then((presets) => {
                // Close a previously-opened menu before building a new
                // one — otherwise the duplicate id throws.
                const old = $$("pk-presets-popup");
                if (old) old.destructor();

                const data = [];
                if (presets.length === 0) {
                    data.push({ id: "_empty", value: "(no saved presets)", $css: "pk-help-hint" });
                } else {
                    for (const p of presets) {
                        const star = p.grid_default ? "★ " : "&nbsp;&nbsp;";
                        data.push({
                            id: "apply:" + p.id,
                            value: star + " " + escapeHtml(p.name),
                        });
                    }
                }
                data.push({ $template: "Separator" });
                data.push({ id: "save", value: "+ Save current as preset…" });
                data.push({ id: "manage", value: "✎ Manage presets…" });

                const menu = webix.ui({
                    view: "contextmenu",
                    id: "pk-presets-popup",
                    width: 240,
                    autoheight: true,
                    data: data,
                    on: {
                        onMenuItemClick: function (id) {
                            if (id === "_empty") return;
                            if (id === "save") { openSavePresetDialog(PARTS_GRID); return; }
                            if (id === "manage") { openManagePresetsDialog(PARTS_GRID); return; }
                            if (typeof id === "string" && id.startsWith("apply:")) {
                                const pid = parseInt(id.slice(6), 10);
                                const found = (gridPresetsCache[PARTS_GRID] || [])
                                    .find((p) => p.id === pid);
                                if (found) {
                                    applyGridPreset(found, true);
                                    webix.message({ type: "success", text: `Preset "${found.name}" applied` });
                                }
                            }
                        },
                    },
                });
                // Position below the toolbar button.
                const node = toolbarButton && toolbarButton.$view;
                if (node) {
                    const r = node.getBoundingClientRect();
                    menu.show({ x: r.left, y: r.bottom });
                } else {
                    menu.show();
                }
            })
            .catch((e) => {
                console.error("openPresetsMenu:", e);
                webix.message({ type: "error", text: "Failed to load presets: " + (e && e.message ? e.message : String(e)) });
            });
    }

    function openSavePresetDialog(grid) {
        webix.ui({
            view: "window",
            id: "pk-save-preset-dialog",
            modal: true,
            position: "center",
            width: 380,
            head: "Save preset",
            body: {
                rows: [
                    {
                        view: "form",
                        id: "pk-save-preset-form",
                        elements: [
                            { view: "text", name: "name", label: "Name", labelWidth: 90,
                              placeholder: "e.g. Engineering, Procurement…" },
                            { view: "checkbox", name: "grid_default", labelRight: "Make default for this grid",
                              labelWidth: 0, label: "" },
                        ],
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 48,
                        cols: [
                            {},
                            { view: "button", value: "Cancel", width: 90,
                              click: () => $$("pk-save-preset-dialog").close() },
                            { view: "button", value: "Save", width: 90, css: "webix_primary",
                              click: async function () {
                                  const v = $$("pk-save-preset-form").getValues();
                                  const name = (v.name || "").trim();
                                  if (!name) {
                                      webix.message({ type: "error", text: "Name is required" });
                                      return;
                                  }
                                  const ds = $$("pk-parts-grid");
                                  if (!ds) return;
                                  const config = JSON.stringify(ds.getState());
                                  try {
                                      await api.createGridPreset({
                                          grid, name, configuration: config,
                                          grid_default: !!v.grid_default,
                                      });
                                      gridPresetsCache[grid] = null;
                                      $$("pk-save-preset-dialog").close();
                                      webix.message({ type: "success", text: `Preset "${name}" saved` });
                                  } catch (e) {
                                      console.error(e);
                                      webix.message({ type: "error", text: String(e.message || e) });
                                  }
                              } },
                        ],
                    },
                ],
            },
        }).show();
        setTimeout(() => {
            const f = $$("pk-save-preset-form");
            if (f) f.setValues({ name: "", grid_default: 0 });
        }, 0);
    }

    function openManagePresetsDialog(grid) {
        loadGridPresets(grid, true).then((presets) => {
            webix.ui({
                view: "window",
                id: "pk-manage-presets-dialog",
                modal: true,
                position: "center",
                width: 600,
                height: 400,
                head: "Manage presets",
                body: {
                    rows: [
                        {
                            view: "datatable",
                            id: "pk-manage-presets-grid",
                            data: presets,
                            select: "row",
                            columns: [
                                { id: "name", header: "Name", fillspace: true },
                                {
                                    id: "grid_default", header: "Default", width: 80,
                                    template: function (o) {
                                        return `<input type="checkbox" data-default="${o.id}" ${o.grid_default ? "checked" : ""}>`;
                                    },
                                },
                                {
                                    id: "_overwrite", header: "Overwrite", width: 110,
                                    template: function (o) {
                                        return `<button class="pk-link-btn" data-overwrite="${o.id}">Replace with current</button>`;
                                    },
                                },
                                {
                                    id: "_delete", header: "", width: 80,
                                    template: function (o) {
                                        return `<button class="pk-link-btn" data-delete="${o.id}" style="color:#b03030">Delete</button>`;
                                    },
                                },
                            ],
                        },
                        {
                            view: "toolbar",
                            css: "pk-dialog-actions",
                            height: 48,
                            cols: [
                                {},
                                { view: "button", value: "Close", width: 90, css: "webix_primary",
                                  click: () => $$("pk-manage-presets-dialog").close() },
                            ],
                        },
                    ],
                },
            }).show();

            // Wire row-action click handlers after the datatable mounts.
            setTimeout(() => {
                const dt = $$("pk-manage-presets-grid");
                if (!dt || !dt.$view) return;
                dt.$view.addEventListener("click", async (ev) => {
                    const t = ev.target;
                    if (!t) return;
                    const dId = t.dataset.delete && parseInt(t.dataset.delete, 10);
                    const oId = t.dataset.overwrite && parseInt(t.dataset.overwrite, 10);
                    const defId = t.dataset.default && parseInt(t.dataset.default, 10);

                    if (dId) {
                        const row = dt.getItem(dId);
                        if (!row) return;
                        webix.confirm({
                            title: "Delete preset",
                            text: `Delete preset "${escapeHtml(row.name)}"?`,
                            ok: "Delete",
                            cancel: "Cancel",
                        }).then(async () => {
                            try {
                                await api.deleteGridPreset(dId);
                                dt.remove(dId);
                                gridPresetsCache[grid] = null;
                                webix.message({ type: "success", text: "Preset deleted" });
                            } catch (e) {
                                webix.message({ type: "error", text: String(e.message || e) });
                            }
                        });
                    } else if (oId) {
                        const row = dt.getItem(oId);
                        if (!row) return;
                        const ds = $$("pk-parts-grid");
                        if (!ds) return;
                        try {
                            const config = JSON.stringify(ds.getState());
                            await api.updateGridPreset(oId, {
                                grid, name: row.name, configuration: config,
                                grid_default: !!row.grid_default,
                            });
                            row.configuration = config;
                            gridPresetsCache[grid] = null;
                            webix.message({ type: "success", text: `Preset "${row.name}" updated` });
                        } catch (e) {
                            webix.message({ type: "error", text: String(e.message || e) });
                        }
                    } else if (defId) {
                        const row = dt.getItem(defId);
                        if (!row) return;
                        const newDefault = !!t.checked;
                        try {
                            await api.updateGridPreset(defId, {
                                grid, name: row.name, configuration: row.configuration,
                                grid_default: newDefault,
                            });
                            // If we set a new default, every other row in
                            // the table loses its checkmark — patch the
                            // local data to match the server's transaction.
                            if (newDefault) {
                                dt.data.each((r) => { if (r.id !== defId) r.grid_default = false; });
                            }
                            row.grid_default = newDefault;
                            dt.refresh();
                            gridPresetsCache[grid] = null;
                        } catch (e) {
                            // Roll the checkbox back on failure.
                            t.checked = !newDefault;
                            webix.message({ type: "error", text: String(e.message || e) });
                        }
                    }
                });
            }, 0);
        }).catch((e) => {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load presets" });
        });
    }

    function openColumnsDialog() {
        const grid = $$("pk-parts-grid");
        if (!grid) return;
        // Build the list of column ids → human label and current visibility.
        const cfg = grid.config.columns;
        const items = cfg.map((c) => {
            // Column header may be a string OR an array of header config
            // objects. Walk the array and find the first {text:...} or
            // string entry — that's the label.
            let label = c.id;
            if (typeof c.header === "string") label = c.header;
            else if (Array.isArray(c.header)) {
                for (const h of c.header) {
                    if (typeof h === "string") { label = h; break; }
                    if (h && typeof h === "object" && h.text) { label = h.text; break; }
                }
            } else if (c.header && typeof c.header === "object" && c.header.text) {
                label = c.header.text;
            }
            return { id: c.id, label, hidden: !!c.hidden };
        });

        webix.ui({
            view: "window",
            id: "pk-columns-dialog",
            modal: true,
            position: "center",
            width: 380,
            head: "Columns",
            body: {
                rows: [
                    { template: "Toggle column visibility:", height: 32, css: "pk-dialog-hint", borderless: true },
                    {
                        view: "list",
                        id: "pk-columns-list",
                        data: items,
                        select: false,
                        type: { height: 32 },
                        template: function (o) {
                            const checked = o.hidden ? "" : "checked";
                            return `<label><input type="checkbox" ${checked} data-col="${o.id}"> ${escapeHtml(o.label)}</label>`;
                        },
                        onClick: {
                            // Click a row → toggle the checkbox + grid column.
                            "webix_list_item": function (ev, row) {
                                // Let the native checkbox toggle drive things;
                                // intercept the click on the label/text otherwise.
                                if (ev.target && ev.target.tagName !== "INPUT") {
                                    const cb = ev.target.closest(".webix_list_item")
                                        ? ev.target.closest(".webix_list_item").querySelector("input[type=checkbox]")
                                        : null;
                                    if (cb) cb.click();
                                }
                            },
                        },
                    },
                    {
                        view: "toolbar",
                        css: "pk-dialog-actions",
                        height: 48,
                        cols: [
                            { view: "button", value: "Reset layout", width: 130, click: function () {
                                clearPartsGridState();
                                $$("pk-columns-dialog").close();
                                webix.message({ text: "Layout reset", type: "success" });
                            } },
                            {},
                            { view: "button", value: "Done", width: 90, css: "webix_primary", click: () => $$("pk-columns-dialog").close() },
                        ],
                    },
                ],
            },
        }).show();

        // Wire up the inline checkboxes after the list mounts.
        setTimeout(() => {
            const list = $$("pk-columns-list");
            if (!list || !list.$view) return;
            list.$view.querySelectorAll('input[type=checkbox][data-col]').forEach((cb) => {
                cb.addEventListener("change", () => {
                    const colId = cb.dataset.col;
                    if (cb.checked) grid.showColumn(colId);
                    else grid.hideColumn(colId);
                    // savePartsGridState fires from onAfterColumnHide/Show.
                });
            });
        }, 0);
    }

    // ============================================================
    //  Parts grid filter pane (W8a)
    // ============================================================

    let filterDistributorsLoaded = false;

    async function ensureFilterDistributorsLoaded() {
        if (filterDistributorsLoaded) return;
        try {
            const dists = await api.lookupList("/api/distributors");
            const sel = $$("pk-filter-distributor");
            if (!sel) return;
            const options = [{ id: "", value: "(any)" }].concat(
                dists.map((d) => ({ id: String(d.id), value: d.name }))
            );
            sel.define("options", options);
            sel.refresh();
            filterDistributorsLoaded = true;
        } catch (e) {
            console.error(e);
        }
    }

    function readFiltersFromPane() {
        const stock = $$("pk-filter-stock").getValue();
        const meta = $$("pk-filter-meta").getValue();
        const dist = $$("pk-filter-distributor").getValue();
        const priceMin = ($$("pk-filter-price-min").getValue() || "").trim();
        const priceMax = ($$("pk-filter-price-max").getValue() || "").trim();
        const out = {};
        if (stock && stock !== "any") out.stock_mode = stock;
        if (meta === "real") out.meta_only = false;
        else if (meta === "meta") out.meta_only = true;
        if (dist) out.distributor_id = parseInt(dist, 10);
        if (priceMin) out.price_min = priceMin;
        if (priceMax) out.price_max = priceMax;
        return out;
    }

    function applyFilters() {
        ensureFilterDistributorsLoaded();
        loadParts({ byField: readFiltersFromPane() });
    }

    // ============================================================
    //  Parametric search pane (W9)
    // ============================================================

    let parametricLookupsReady = false;

    async function ensureParametricLookupsReady() {
        if (parametricLookupsReady) return;
        try {
            const [names, lk] = await Promise.all([
                api.parametricNames(),
                ensureLookups(),
            ]);
            const grid = $$("pk-parametric-grid");
            if (!grid) return;

            // Param-name combo: option id = the parameter name string,
            // value = same. No custom body template — would render HTML
            // into the cell value when an option is picked.
            grid.getColumnConfig("name").options = names.map((n) => ({ id: n.name, value: n.name }));

            const prefOptions = [{ id: "", value: "(none)" }].concat(
                lk.prefixes.map((p) => ({ id: p.id, value: p.symbol + " — " + p.prefix }))
            );
            const unitOptions = [{ id: "", value: "(none)" }].concat(
                lk.units.map((u) => ({ id: u.id, value: u.name + " (" + u.symbol + ")" }))
            );
            grid.getColumnConfig("si_prefix_id").options = prefOptions;
            grid.getColumnConfig("unit_id").options = unitOptions;
            grid.refreshColumns();

            // Footprint + class picker label initialization. The
            // popups build their data from lookupsCache on demand,
            // so nothing to seed here beyond rendering "(none picked)".
            refreshParametricFpLabel();
            refreshParametricCatLabel();

            parametricLookupsReady = true;
        } catch (e) {
            console.error(e);
            webix.message({ type: "error", text: "Failed to load parameter names" });
        }
    }

    async function addParametricPredicate() {
        await ensureParametricLookupsReady();
        const grid = $$("pk-parametric-grid");
        if (!grid) return;
        const row = { id: webix.uid(), name: "", op: "=", value_type: "numeric", value: "", string_value: "", si_prefix_id: null, unit_id: null };
        grid.add(row);
        grid.select(row.id);
        grid.editCell(row.id, "name");
    }

    function removeParametricPredicate() {
        const grid = $$("pk-parametric-grid");
        if (!grid) return;
        const sel = grid.getSelectedId();
        if (!sel) {
            webix.message({ type: "error", text: "Select a predicate row." });
            return;
        }
        grid.remove(sel);
    }

    function applyParametricSearch() {
        const grid = $$("pk-parametric-grid");
        if (!grid) return;

        // Footprint multi-select: collected only when the toggle is on.
        // selectedFootprintIds is a module-level array maintained by
        // the popup picker (openFootprintPickerPopup).
        const fpToggle = $$("pk-parametric-fp-toggle");
        const footprintIds = (fpToggle && fpToggle.getValue())
            ? selectedFootprintIds.slice()
            : [];
        // Class (category) multi-select: same shape, separate state.
        const catToggle = $$("pk-parametric-cat-toggle");
        const categoryIds = (catToggle && catToggle.getValue())
            ? selectedCategoryIds.slice()
            : [];

        const rows = grid.serialize().filter((r) => (r.name || "").trim() && r.op);
        if (!rows.length && footprintIds.length === 0 && categoryIds.length === 0) {
            webix.message({ type: "error", text: "Add at least one predicate row, or pick a class / footprint." });
            return;
        }
        const predicates = rows.map((r) => {
            const isNumeric = r.value_type !== "string";
            const p = {
                name: r.name.trim(),
                op: r.op,
                value_type: isNumeric ? "numeric" : "string",
            };
            if (isNumeric) {
                if (r.value !== "" && r.value != null) p.value = parseFloat(r.value);
                if (r.si_prefix_id) p.si_prefix_id = parseInt(r.si_prefix_id, 10);
                if (r.unit_id) p.unit_id = parseInt(r.unit_id, 10);
            } else {
                if (r.string_value) p.string_value = r.string_value;
            }
            return p;
        });
        loadParts({ predicates, footprint_ids: footprintIds, category_ids: categoryIds });
    }

    function resetParametricSearch() {
        const grid = $$("pk-parametric-grid");
        if (grid) grid.clearAll();
        const fpToggle  = $$("pk-parametric-fp-toggle");
        const fpBtn     = $$("pk-parametric-fp-button");
        const catToggle = $$("pk-parametric-cat-toggle");
        const catBtn    = $$("pk-parametric-cat-button");
        if (fpToggle)  fpToggle.setValue(0);
        if (fpBtn)     fpBtn.disable();
        if (catToggle) catToggle.setValue(0);
        if (catBtn)    catBtn.disable();
        selectedFootprintIds = [];
        selectedCategoryIds = [];
        refreshParametricFpLabel();
        refreshParametricCatLabel();
        loadParts({ predicates: [], footprint_ids: [], category_ids: [] });
    }

    function resetFilters() {
        $$("pk-filter-stock").setValue("any");
        $$("pk-filter-meta").setValue("any");
        $$("pk-filter-distributor").setValue("");
        $$("pk-filter-price-min").setValue("");
        $$("pk-filter-price-max").setValue("");
        loadParts({ byField: {} });
    }

    function jumpToProject(projectId) {
        // Switch left tabbar to Projects, ensure the list is loaded,
        // select the requested project (which fires loadProjectIntoCenter).
        const tabbar = $$("pk-left-tabbar");
        if (tabbar) tabbar.setValue("tab-projects");
        loadProjectsList(true).then(() => {
            const list = $$("pk-projects-list");
            if (list && list.exists(projectId)) list.select(projectId);
            else loadProjectIntoCenter(projectId);
        });
    }

    function renderPartDetailHtml(p, projects, runs, receipts) {
        const sections = [];

        // Header
        const ipn = p.internal_part_number ? ` <span class="pk-detail-ipn">${escapeHtml(p.internal_part_number)}</span>` : "";
        const meta = p.meta_part ? ` <span class="pk-detail-meta-tag">META</span>` : "";
        const lowStock = p.low_stock ? ` <span class="pk-detail-low-stock">LOW STOCK</span>` : "";
        sections.push(`
            <div class="pk-detail-section pk-detail-header">
                <div class="pk-detail-name">${escapeHtml(p.name)}${ipn}${meta}${lowStock}</div>
                ${p.description ? `<div class="pk-detail-desc">${escapeHtml(p.description)}</div>` : ""}
            </div>
        `);

        // Identity / classification
        const idRows = [];
        if (p.category) idRows.push(["Category", escapeHtml(p.category.category_path)]);
        if (p.storage_location) idRows.push(["Storage", escapeHtml(`${p.storage_location.name}  —  ${p.storage_location.category_path}`)]);
        if (p.footprint) idRows.push(["Footprint", escapeHtml(p.footprint.name)]);
        if (p.part_unit) idRows.push(["Unit", escapeHtml(`${p.part_unit.name} (${p.part_unit.short_name})`)]);
        if (idRows.length) sections.push(detailSectionHtml("Classification", kvTable(idRows)));

        // Stock
        const stockRows = [
            ["On hand", String(p.stock_level)],
            ["Min stock", String(p.min_stock_level)],
            ["Avg price", p.average_price],
        ];
        sections.push(detailSectionHtml("Stock", kvTable(stockRows)));

        // Multi-location breakdown (descriptive). Hidden when the
        // operator hasn't broken this part out — keeps the panel
        // clean for ordinary single-bin parts.
        if (p.locations && p.locations.length) {
            const sum = p.locations.reduce((acc, l) => acc + (l.quantity || 0), 0);
            const driftHtml = sum === p.stock_level
                ? `<span class="pk-stock-add">matches stock level</span>`
                : `<span class="pk-stock-remove">⚠ stock level = ${p.stock_level} (off by ${sum - p.stock_level >= 0 ? "+" : ""}${sum - p.stock_level})</span>`;
            const rows = p.locations.map(l => {
                const consumeBtn = (l.quantity || 0) > 0
                    ? `<button class="pk-btn-remove pk-consume-btn" data-psl-id="${l.id}" title="Consume from this packaging">🔻</button>`
                    : `<span class="pk-help-hint">empty</span>`;
                return `<tr>
                    <td>${escapeHtml(l.form)}</td>
                    <td class="pk-numeric">${l.quantity}</td>
                    <td>${escapeHtml(l.storage_location_name || "")}</td>
                    <td>${consumeBtn}</td>
                </tr>`;
            }).join("");
            const footer = `<tr style="font-weight:600;background:#f3f5f7">
                <td style="text-align:right">Total:</td>
                <td class="pk-numeric">${sum}</td>
                <td>${driftHtml}</td>
                <td></td>
            </tr>`;
            sections.push(detailSectionHtml(`Packaging (${p.locations.length})`,
                `<table class="pk-detail-table">
                    <thead><tr>
                        <th>Form</th>
                        <th class="pk-numeric">Qty</th>
                        <th>Where</th>
                        <th></th>
                    </tr></thead>
                    <tbody>${rows}${footer}</tbody>
                </table>`));
        }

        // Manufacturers
        if (p.manufacturers && p.manufacturers.length) {
            const rows = p.manufacturers.map(m =>
                `<tr><td>${escapeHtml(m.manufacturer_name || "")}</td><td>${escapeHtml(m.part_number || "")}</td></tr>`
            ).join("");
            sections.push(detailSectionHtml(`Manufacturers (${p.manufacturers.length})`,
                `<table class="pk-detail-table"><thead><tr><th>Manufacturer</th><th>MPN</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        // Distributors
        if (p.distributors && p.distributors.length) {
            const rows = p.distributors.map(d =>
                `<tr>
                    <td>${escapeHtml(d.distributor_name || "")}</td>
                    <td>${escapeHtml(d.order_number || "")}</td>
                    <td class="pk-numeric">${escapeHtml(d.price || "")}</td>
                    <td class="pk-numeric">${escapeHtml(String(d.packaging_unit || ""))}</td>
                </tr>`
            ).join("");
            sections.push(detailSectionHtml(`Distributors (${p.distributors.length})`,
                `<table class="pk-detail-table"><thead><tr><th>Distributor</th><th>Order #</th><th>Price</th><th>Pkg</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        // Parameters
        if (p.parameters && p.parameters.length) {
            const rows = p.parameters.map(prm => {
                let value = "";
                if (prm.value_type === "numeric" && prm.value != null) {
                    value = `${prm.value} ${prm.si_prefix_symbol || ""}${prm.unit_symbol || ""}`.trim();
                } else if (prm.string_value) {
                    value = prm.string_value;
                }
                return `<tr><td>${escapeHtml(prm.name || "")}</td><td>${escapeHtml(value)}</td></tr>`;
            }).join("");
            sections.push(detailSectionHtml(`Parameters (${p.parameters.length})`,
                `<table class="pk-detail-table"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        // Recent stock entries
        if (p.stock_entries && p.stock_entries.length) {
            const rows = p.stock_entries.slice(0, 8).map(e => {
                const delta = e.stock_level > 0 ? `+${e.stock_level}` : String(e.stock_level);
                const cls = e.stock_level > 0 ? "pk-stock-add" : "pk-stock-remove";
                const corr = e.correction ? " (recount)" : "";
                const date = (e.date_time || "").substring(0, 10);
                return `<tr>
                    <td>${escapeHtml(date)}</td>
                    <td class="pk-numeric ${cls}">${delta}${corr}</td>
                    <td class="pk-numeric">${escapeHtml(e.price || "")}</td>
                    <td>${escapeHtml(e.username || "")}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(`Recent stock activity`,
                `<table class="pk-detail-table"><thead><tr><th>Date</th><th>Δ</th><th>Price</th><th>By</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        // Distributor-attributed receipts (slice 12b.2 follow-on).
        // One row per (distributor, sales order #); useful for stock
        // age and "which order is this batch from" tracking.
        if (receipts && receipts.length) {
            const rows = receipts.map((rcp) => {
                const date = (rcp.last_date || "").substring(0, 10);
                const cur = rcp.currency || "";
                const price = rcp.avg_unit_price ? `${rcp.avg_unit_price} ${cur}` : "";
                const partial = (rcp.entry_count > 1) ? ` <span class="pk-help-hint">(${rcp.entry_count} entries)</span>` : "";
                return `<tr>
                    <td>${escapeHtml(rcp.distributor_name || "")}</td>
                    <td>${escapeHtml(rcp.sales_order_number || "")}${partial}</td>
                    <td class="pk-numeric">+${rcp.units_added}</td>
                    <td class="pk-numeric">${escapeHtml(price)}</td>
                    <td>${escapeHtml(date)}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(`Receipts by sales order (${receipts.length})`,
                `<table class="pk-detail-table"><thead><tr><th>Distributor</th><th>SO #</th><th>Units</th><th>Unit price</th><th>Last received</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        // Attachments
        if (p.attachments && p.attachments.length) {
            const rows = p.attachments.map(a => {
                const tag = a.is_image ? "img" : "doc";
                const size = a.size ? `${(a.size / 1024).toFixed(1)} KB` : "";
                const url = `/files/PartAttachment/${a.id}`;
                return `<tr>
                    <td><a href="${url}" target="_blank">${escapeHtml(a.original_filename || a.filename)}</a></td>
                    <td>${tag}</td>
                    <td class="pk-numeric">${escapeHtml(size)}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(`Attachments (${p.attachments.length})`,
                `<table class="pk-detail-table"><thead><tr><th>File</th><th>Type</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table>`));
        }

        // Cross-cutting: which projects' BOMs reference this part
        if (projects && projects.length) {
            const rows = projects.map((row) => {
                const overage = row.overage_type && row.overage
                    ? ` <span class="pk-help-hint">(+${row.overage}${row.overage_type === "percent" ? "%" : ""})</span>`
                    : "";
                const remarks = row.remarks ? ` &mdash; <span class="pk-help-hint">${escapeHtml(row.remarks)}</span>` : "";
                return `<tr>
                    <td><a href="#" data-project-id="${row.project_id}">${escapeHtml(row.project_name)}</a></td>
                    <td class="pk-numeric">${row.quantity}${overage}</td>
                    <td>${remarks}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(
                `Used in projects (${projects.length})`,
                `<table class="pk-detail-table">
                    <thead><tr><th>Project</th><th class="pk-numeric">BOM qty</th><th>Notes</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>`
            ));
        }

        // Cross-cutting: recent project runs that consumed this part
        if (runs && runs.length) {
            const rows = runs.slice(0, 8).map((r) => {
                const date = (r.run_date_time || "").substring(0, 10);
                const lot = r.lot_number ? ` <span class="pk-help-hint">[${escapeHtml(r.lot_number)}]</span>` : "";
                return `<tr>
                    <td>${escapeHtml(date)}</td>
                    <td><a href="#" data-project-id="${r.project_id}">${escapeHtml(r.project_name)}</a></td>
                    <td class="pk-numeric">×${r.run_quantity}</td>
                    <td class="pk-numeric pk-stock-remove">−${r.deducted_quantity}${lot}</td>
                </tr>`;
            }).join("");
            sections.push(detailSectionHtml(
                `Recent runs (${runs.length})`,
                `<table class="pk-detail-table">
                    <thead><tr><th>Date</th><th>Project</th><th class="pk-numeric">Run ×</th><th class="pk-numeric">Δ</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>`
            ));
        }

        return sections.join("");
    }

    function detailSectionHtml(title, body) {
        return `<div class="pk-detail-section">
            <div class="pk-detail-section-title">${escapeHtml(title)}</div>
            <div class="pk-detail-section-body">${body}</div>
        </div>`;
    }

    function kvTable(rows) {
        return `<table class="pk-detail-kv">${
            rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join("")
        }</table>`;
    }

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

    /// Slice 13c: consume N units from a specific PartStorageLocation
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

    // ============================================================
    //  Delete part
    // ============================================================

    function openDeleteDialog() {
        if (!currentPart) return;
        const name = escapeHtml(currentPart.name);
        const ipn = currentPart.internal_part_number
            ? ` <span class="pk-detail-ipn">${escapeHtml(currentPart.internal_part_number)}</span>`
            : "";
        webix.confirm({
            title: "Delete part",
            ok: "Delete",
            cancel: "Cancel",
            type: "confirm-error",
            text:
                `<div style="text-align:left">Delete <b>${name}</b>${ipn}?<br><br>` +
                `Stock history is preserved. Project run history (if any) blocks this — ` +
                `the backend will refuse and the part stays in place.</div>`,
            callback: async function (result) {
                if (!result) return;
                try {
                    await api.deletePart(currentPart.id);
                    webix.message({ text: `Deleted ${currentPart.name}`, type: "success" });
                    // Clear detail, hide actions, reload grid.
                    currentPart = null;
                    $$("pk-detail").setHTML('<div class="pk-detail-empty">Select a part to view detail.</div>');
                    $$("pk-detail-actions").hide();
                    await loadParts({});
                } catch (e) {
                    console.error(e);
                    webix.message({
                        type: "error",
                        text: e.message && e.message.includes("400")
                            ? "Cannot delete: part is referenced by project runs."
                            : "Delete failed: " + (e.message || e),
                    });
                }
            },
        });
    }

    // ============================================================
    //  Helpers
    // ============================================================

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
        );
    }

    function showFatalError(e) {
        document.body.innerHTML =
            '<div style="font-family:sans-serif;padding:24px;color:#a33">' +
            '<h2>PartKeeper failed to start</h2>' +
            '<pre>' + escapeHtml(e && e.message ? e.message : String(e)) + '</pre>' +
            '</div>';
        console.error("[partkeepr] boot failed", e);
    }

    // ============================================================
    //  Slice 13 — label printing (Brother PT-D410 via ptouch-print)
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
    //  Slice 12a.1 — Mouser search dialog
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
    //  Slice 12b.2 — Receive Digi-Key Order
    //
    //  Operator types a Digi-Key Sales Order #, hits Fetch. We call
    //  /order-status which fetches the order via Digi-Key OrderStatus
    //  API and joins line items against PartDistributor on
    //  (distributor=Digi-Key, orderNumber=line.digikey_pn). Each line
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

        const sourceLabel = (s) => s === "mouser" ? "Mouser" : "Digi-Key";
        const skuHeaderFor = (s) => s === "mouser" ? "Mouser P/N" : "DK P/N";

        let preview = null;  // OrderStatusResponse from the last fetch
        let lineState = [];  // per-line: {apply: bool, quantity: int}

        const headTpl = (sid) => sid
            ? `Receive ${sourceLabel(source)} Sales Order #${sid}`
            : `Receive ${sourceLabel(source)} Sales Order`;

        webix.ui({
            view: "window",
            id: winId,
            modal: true,
            position: "center",
            width: 1080,
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
                                                grid.config.columns.find(c => c.id === "digikey_pn").header = skuHeaderFor(newSrc);
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
                            { id: "digikey_pn", header: skuHeaderFor(source), width: 150 },
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
                            { id: "quantity_shipped", header: "Qty shipped", width: 100, css: "right" },
                            {
                                id: "_qty",
                                header: "Apply qty",
                                width: 110,
                                editor: "text",
                                css: "right",
                            },
                            {
                                id: "_price",
                                header: "Unit price",
                                width: 110,
                                css: "right",
                                template: function (o) {
                                    if (!o.unit_price) return "";
                                    return o.unit_price.toFixed(4) + " " + (preview && preview.currency || "");
                                },
                            },
                            { id: "description", header: "Description", fillspace: true, minWidth: 200 },
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
                                if (lineState[idx]) lineState[idx].apply = !!val;
                                refreshSummary();
                            },
                            onAfterEditStop: function (state, ed) {
                                if (ed.column !== "_qty") return;
                                const idx = this.getIndexById(ed.row);
                                const n = parseInt(state.value, 10);
                                if (!Number.isFinite(n) || n < 0) {
                                    this.updateItem(ed.row, { _qty: lineState[idx].quantity });
                                    return;
                                }
                                lineState[idx].quantity = n;
                                refreshSummary();
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
            let lines = 0, units = 0, skipped = 0, noMatch = 0;
            grid.eachRow(function (rid) {
                const idx = grid.getIndexById(rid);
                const item = grid.getItem(rid);
                const st = lineState[idx];
                if (!st || !st.apply) { skipped++; return; }
                if (!item.part_id) { noMatch++; return; }
                if (!st.quantity || st.quantity <= 0) { skipped++; return; }
                lines++;
                units += st.quantity;
            });
            const txt = `${lines} line${lines === 1 ? "" : "s"} → +${units} unit${units === 1 ? "" : "s"} ` +
                `· ${skipped} skipped` + (noMatch ? ` · ${noMatch} no-match (will skip)` : "");
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
            // Per-line: default apply=true when matched & shipped > 0;
            // default qty = quantity_shipped (or quantity ordered if
            // shipped is zero — typical for not-yet-shipped orders).
            lineState = preview.lines.map((li) => {
                const qty = li.quantity_shipped > 0 ? li.quantity_shipped : li.quantity_ordered;
                return {
                    apply: !!li.part_id && li.quantity_shipped > 0,
                    quantity: qty || 0,
                };
            });
            const rows = preview.lines.map((li, i) => Object.assign({}, li, {
                id: i + 1,
                _apply: lineState[i].apply,
                _qty: lineState[i].quantity,
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
            const mpn = (li.mpn || li.digikey_pn || "").trim();
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
                forceDistributorPn: li.digikey_pn,
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
    //  Bootstrap
    // ============================================================

    webix.ready(async function () {
        try {
            const me = await api.me();
            if (me) {
                mountShell(me);
                // Deep-link support: if the URL fragment is "/part/<id>"
                // (the form our printed QR labels encode), route to that
                // part once the shell is up. Loose timing here is fine
                // — handleScan does the same work asynchronously.
                if (location.hash) {
                    const m = location.hash.match(/(?:#\/)part\/(\d+)$/);
                    if (m) {
                        // Defer one tick so all the shell views finish
                        // their initial mount before we try to navigate.
                        setTimeout(() => handleScan(location.hash), 100);
                    }
                }
            } else {
                mountLogin();
            }
        } catch (e) {
            showFatalError(e);
        }
    });
})();
