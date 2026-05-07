// HAND-ROLLED — not from codegen. The `PartStorageLocation` table is
// new in partkeepr-ng (no upstream Doctrine entity); see
// `scripts/migrations/multi-location-parts.sql` for the schema.

use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::FromRow;

#[allow(dead_code)]
#[derive(Debug, Serialize, FromRow)]
pub struct PartStorageLocation {
    pub id: i32,
    pub part_id: i32,
    #[sqlx(rename = "storageLocation_id")]
    pub storage_location_id: i32,
    pub form: String,
    pub quantity: i32,
    #[sqlx(rename = "lotNumber")]
    pub lot_number: Option<String>,
    pub comment: Option<String>,
    pub created: Option<NaiveDateTime>,
    #[sqlx(rename = "lastModified")]
    pub last_modified: Option<NaiveDateTime>,
    pub user_id: Option<i32>,
}
