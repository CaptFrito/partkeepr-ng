use axum::{
    routing::{get, patch, post},
    Router,
};

use crate::AppState;

pub mod attachments;
pub mod categories;
pub mod clamd;
pub mod footprints;
pub mod lookups;
pub mod nested_set;
pub mod parametric;
pub mod parts;
pub mod projects;
pub mod stock;
pub mod storage;
pub mod storage_locations;

/// Hand-written endpoints. Merged into the main router alongside the
/// codegen routes from `models::routes()`. Routes here take precedence by
/// not being in codegen output (see SKIP_HANDLER_CLASSES in the codegen).
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/part_categories/tree", get(parts::category_tree))
        .route(
            "/api/part_categories",
            get(categories::list_flat).post(categories::create),
        )
        .route(
            "/api/part_categories/:id",
            axum::routing::put(categories::update).delete(categories::delete),
        )
        .route(
            "/api/part_categories/:id/move",
            patch(categories::move_node),
        )
        .route("/api/parts", get(parts::list).post(parts::create))
        .route(
            "/api/parts/:id",
            get(parts::detail).put(parts::update).delete(parts::delete),
        )
        .route("/api/parts/:id/stock-entries", post(stock::create_stock_entry))
        // Slice 5c-2: storage locations.
        .route("/api/storage_tree", get(storage_locations::tree))
        .route(
            "/api/storage_location_categories",
            get(storage_locations::cat_list_flat).post(storage_locations::cat_create),
        )
        .route(
            "/api/storage_location_categories/:id",
            axum::routing::put(storage_locations::cat_update)
                .delete(storage_locations::cat_delete),
        )
        .route(
            "/api/storage_location_categories/:id/move",
            patch(storage_locations::cat_move),
        )
        .route(
            "/api/storage_locations",
            get(storage_locations::loc_list).post(storage_locations::loc_create),
        )
        .route(
            "/api/storage_locations/:id",
            axum::routing::put(storage_locations::loc_update)
                .delete(storage_locations::loc_delete),
        )
        .route(
            "/api/storage_locations/:id/move",
            patch(storage_locations::loc_move),
        )
        // Slice 5c-3: footprints.
        .route("/api/footprint_tree", get(footprints::tree))
        .route(
            "/api/footprint_categories",
            get(footprints::cat_list_flat).post(footprints::cat_create),
        )
        .route(
            "/api/footprint_categories/:id",
            axum::routing::put(footprints::cat_update).delete(footprints::cat_delete),
        )
        .route(
            "/api/footprint_categories/:id/move",
            patch(footprints::cat_move),
        )
        .route(
            "/api/footprints",
            get(footprints::fp_list).post(footprints::fp_create),
        )
        .route(
            "/api/footprints/:id",
            axum::routing::put(footprints::fp_update).delete(footprints::fp_delete),
        )
        .route("/api/footprints/:id/move", patch(footprints::fp_move))
        // Slice 7: attachment uploads (per parent), list, downloads, edit, delete.
        .route(
            "/api/parts/:id/attachments",
            get(attachments::list_part).post(attachments::upload_part),
        )
        .route(
            "/api/footprints/:id/images",
            get(attachments::list_footprint_image).post(attachments::upload_footprint_image),
        )
        .route(
            "/api/footprints/:id/attachments",
            get(attachments::list_footprint_attachment).post(attachments::upload_footprint_attachment),
        )
        .route(
            "/api/manufacturers/:id/logos",
            get(attachments::list_manufacturer_logo).post(attachments::upload_manufacturer_logo),
        )
        .route(
            "/api/storage_locations/:id/images",
            get(attachments::list_storage_location_image).post(attachments::upload_storage_location_image),
        )
        // URL-fetch counterparts: server downloads the URL, scans, saves.
        .route("/api/parts/:id/attachments/by-url", post(attachments::fetch_part))
        .route("/api/footprints/:id/images/by-url", post(attachments::fetch_footprint_image))
        .route("/api/footprints/:id/attachments/by-url", post(attachments::fetch_footprint_attachment))
        .route("/api/manufacturers/:id/logos/by-url", post(attachments::fetch_manufacturer_logo))
        .route("/api/storage_locations/:id/images/by-url", post(attachments::fetch_storage_location_image))
        .route("/files/:kind/:id", get(attachments::download))
        .route("/files/:kind/:id/thumb", get(attachments::download_thumb))
        .route(
            "/api/attachments/:kind/:id",
            axum::routing::put(attachments::update_description).delete(attachments::delete),
        )
        // Slice 5c-4: flat lookups.
        .route(
            "/api/manufacturers",
            get(lookups::mfg_list).post(lookups::mfg_create),
        )
        .route(
            "/api/manufacturers/:id",
            axum::routing::put(lookups::mfg_update).delete(lookups::mfg_delete),
        )
        .route(
            "/api/distributors",
            get(lookups::dist_list).post(lookups::dist_create),
        )
        .route(
            "/api/distributors/:id",
            axum::routing::put(lookups::dist_update).delete(lookups::dist_delete),
        )
        .route(
            "/api/part_measurement_units",
            get(lookups::part_unit_list).post(lookups::part_unit_create),
        )
        .route(
            "/api/part_measurement_units/:id",
            axum::routing::put(lookups::part_unit_update).delete(lookups::part_unit_delete),
        )
        .route(
            "/api/units",
            get(lookups::unit_list).post(lookups::unit_create),
        )
        .route(
            "/api/units/:id",
            axum::routing::put(lookups::unit_update).delete(lookups::unit_delete),
        )
        .route(
            "/api/si_prefixes",
            get(lookups::siprefix_list).post(lookups::siprefix_create),
        )
        .route(
            "/api/si_prefixes/:id",
            axum::routing::put(lookups::siprefix_update).delete(lookups::siprefix_delete),
        )
        // Slice 8a: Projects + BOM lines.
        .route("/api/projects", get(projects::list).post(projects::create))
        .route(
            "/api/projects/:id",
            get(projects::detail)
                .put(projects::update)
                .delete(projects::delete),
        )
        .route("/api/projects/:pid/parts", post(projects::add_part))
        .route(
            "/api/projects/:pid/parts/:ppid",
            axum::routing::put(projects::update_part).delete(projects::remove_part),
        )
        // Slice 8b: Project runs.
        .route(
            "/api/projects/:pid/runs",
            get(projects::list_runs).post(projects::run_project),
        )
        .route("/api/projects/:pid/runs/preview", get(projects::run_preview))
        .route(
            "/api/projects/:pid/runs/:rid",
            axum::routing::delete(projects::delete_run),
        )
        // Slice 8c: cross-cutting run views.
        .route("/api/parts/:id/projects", get(projects::part_projects))
        .route("/api/parts/:id/runs", get(projects::part_runs))
        .route("/api/project_runs", get(projects::all_runs))
        // Slice 11a: parametric search.
        .route("/api/part_parameters/names", get(parametric::list_names))
        .route("/api/part_parameters/values", get(parametric::list_values))
        .route("/api/parts/parametric", post(parametric::parametric_search))
        // Slice 11c: meta-part matches.
        .route("/api/parts/:id/matches", get(parametric::meta_part_matches))
        // Slice 8a: ProjectAttachment routes (slice-7 attachment pipeline).
        .route(
            "/api/projects/:id/attachments",
            get(attachments::list_project_attachment)
                .post(attachments::upload_project_attachment),
        )
        .route(
            "/api/projects/:id/attachments/by-url",
            post(attachments::fetch_project_attachment),
        )
}
