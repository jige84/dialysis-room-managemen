# DB Drill Rehearsal Report

- Run ID: `20260414-163140`
- Status: **passed**
- Generated At: 2026-04-14T08:31:40.046Z
- DB: `hemodialysis_db`
- User: `hd_app`

## Drill Mode

- Mode: schema-level
- Limitation: External pg_dump unavailable (spawnSync pg_dump EPERM); fallback to schema-level logical backup rehearsal. Current DB role has no createdb privilege; rehearsal executed in schema-level isolation.

## Target Tables

- users
- patients
- dialysis_records
- prescriptions
- infection_screenings
- devices
- alerts
- audit_logs
- complications
- consumable_batches

## Step Results

| Step | Status | Duration(ms) |
|---|---|---:|
| db-backup | passed | 1 |
| backup-verify-list | passed | 0 |
| capability-check | passed | 2 |
| target-table-selection | passed | 4 |
| prepare-drill-schemas | passed | 10 |
| clone-public-into-drill-schemas | passed | 207 |
| baseline-row-counts | passed | 4 |
| simulate-migration-on-work-schema | passed | 24 |
| rollback-restore-from-backup-schema | passed | 110 |
| verify-row-counts-after-restore | passed | 3 |
| cleanup-drill-schemas | passed | 76 |

## Row Count Verification

- All target tables recovered to backup row counts.

## Artifacts

- Backup dump: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-163140\hemodialysis_db-20260414-163140.dump`
- Backup list: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-163140\hemodialysis_db-20260414-163140.list`
- JSON report: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-163140\db-drill-report.json`
- Markdown report: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-163140\db-drill-report.md`

