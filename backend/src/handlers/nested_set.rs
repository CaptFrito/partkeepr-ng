//! Shared nested-set tree helpers, used by every entity that has a
//! Doctrine NestedSet behaviour: PartCategory, StorageLocationCategory,
//! FootprintCategory.
//!
//! All three tables follow the same shape: `id`, `parent_id`, `lft`,
//! `rgt`, `lvl`, `name`, plus a denormalised `categoryPath` column.
//! Mutations (create / rename / move / delete) leave parent_id and the
//! row contents in a consistent state; we then call `rebuild_tree` to
//! re-derive lft / rgt / lvl / categoryPath from the parent_id adjacency
//! list. O(N) per write, but the trees are small (≤ 141 rows in prod).
//!
//! The table name is interpolated into SQL strings. Every caller passes
//! a hard-coded literal, so there is no SQL-injection surface here, but
//! this function MUST NOT be called with caller-supplied input.

use std::collections::HashMap;

use sqlx::Transaction;

use crate::error::AppError;

const PATH_SEP: &str = " ➤ ";

/// Re-derive lft / rgt / lvl / categoryPath for every row in the given
/// nested-set table from the parent_id adjacency list. Children of each
/// parent are visited in name-ascending order so in-tree ordering is
/// stable across rebuilds.
pub async fn rebuild_tree(
    tx: &mut Transaction<'_, sqlx::MySql>,
    table_name: &str,
) -> Result<(), AppError> {
    let select_sql =
        format!("SELECT id, parent_id, name FROM {table_name} ORDER BY name");
    let rows: Vec<(i32, Option<i32>, String)> =
        sqlx::query_as(&select_sql).fetch_all(&mut **tx).await?;

    let mut children: HashMap<Option<i32>, Vec<(i32, String)>> = HashMap::new();
    for (id, pid, name) in rows {
        children.entry(pid).or_default().push((id, name));
    }

    // (id, lft, rgt, lvl, categoryPath)
    let mut updates: Vec<(i32, i32, i32, i32, String)> = Vec::new();
    let mut counter: i32 = 1;

    fn dfs(
        id: i32,
        name: &str,
        prefix: &str,
        lvl: i32,
        children: &HashMap<Option<i32>, Vec<(i32, String)>>,
        counter: &mut i32,
        updates: &mut Vec<(i32, i32, i32, i32, String)>,
    ) {
        let lft = *counter;
        *counter += 1;
        let path = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}{PATH_SEP}{name}")
        };
        if let Some(kids) = children.get(&Some(id)) {
            for (cid, cname) in kids {
                dfs(*cid, cname, &path, lvl + 1, children, counter, updates);
            }
        }
        let rgt = *counter;
        *counter += 1;
        updates.push((id, lft, rgt, lvl, path));
    }

    if let Some(roots) = children.get(&None) {
        for (rid, rname) in roots {
            dfs(*rid, rname, "", 0, &children, &mut counter, &mut updates);
        }
    }

    let update_sql = format!(
        "UPDATE {table_name} SET lft = ?, rgt = ?, lvl = ?, categoryPath = ? \
         WHERE id = ?"
    );
    for (id, lft, rgt, lvl, path) in updates {
        sqlx::query(&update_sql)
            .bind(lft)
            .bind(rgt)
            .bind(lvl)
            .bind(&path)
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }

    Ok(())
}
