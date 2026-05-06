# partkeepr-api

Rust backend for the partkeepr-ng rewrite. Axum + sqlx, talks MariaDB.

## Local dev setup

The backend connects to a local MariaDB on `felder`. One-time setup:

```bash
sudo mariadb <<'SQL'
CREATE DATABASE IF NOT EXISTS partkeepr_dev CHARACTER SET utf8 COLLATE utf8_unicode_ci;
CREATE USER IF NOT EXISTS 'partkeepr_dev'@'localhost' IDENTIFIED BY 'partkeepr_dev';
GRANT ALL PRIVILEGES ON partkeepr_dev.* TO 'partkeepr_dev'@'localhost';
FLUSH PRIVILEGES;
SQL

mariadb -u partkeepr_dev -ppartkeepr_dev partkeepr_dev \
    < ../docs/live-schema/partkeepr-schema.sql
```

Charset is `utf8`/`utf8_unicode_ci` to match the prod install at
`parts.spectraq.com` exactly. A `utf8mb4` upgrade is a separate decision
for later in the rewrite.

## Run

```bash
cargo run               # binds 127.0.0.1:8080
curl localhost:8080/health
curl localhost:8080/api/parts | jq .
```

Configuration via `.env` (see `.env.example` for the template).

## Layout

```
src/
├── main.rs    # app setup: pool, router, graceful shutdown
└── parts.rs   # Part struct + GET /api/parts handler
```

New entities will get their own files alongside `parts.rs` as we work
through the 49 tables in the schema-as-contract.
