// SPDX-License-Identifier: GPL-3.0-or-later
//
// Left pane — Categories / Storage / Footprints / Lookups trees
// + per-tree CRUD dialogs (add / edit / delete / move).
// All four tabs share the same shape: a Webix tree view, an
// action toolbar above it, and modal editor dialogs.
//
// Loaded after api.js, before app.js. Declares buildLeftPane()
// at script-tag global scope so the main shell can mount it.

"use strict";

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

