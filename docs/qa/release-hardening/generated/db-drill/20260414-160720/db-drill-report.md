# DB Drill Rehearsal Report

- Run ID: `20260414-160720`
- Status: **passed**
- Generated At: 2026-04-14T08:07:20.072Z
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
| capability-check | passed | 3 |
| target-table-selection | passed | 9 |
| prepare-drill-schemas | passed | 3 |
| clone-public-into-drill-schemas | passed | 220 |
| baseline-row-counts | passed | 4 |
| simulate-migration-on-work-schema | passed | 25 |
| rollback-restore-from-backup-schema | passed | 108 |
| verify-row-counts-after-restore | passed | 3 |
| cleanup-drill-schemas | passed | 78 |

## Row Count Verification

- All target tables recovered to backup row counts.

## Artifacts

- Backup dump: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-160720\hemodialysis_db-20260414-160720.dump`
- Backup list: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-160720\hemodialysis_db-20260414-160720.list`
- JSON report: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-160720\db-drill-report.json`
- Markdown report: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-160720\db-drill-report.md`

