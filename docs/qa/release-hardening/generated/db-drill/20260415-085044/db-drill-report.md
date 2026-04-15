# DB Drill Rehearsal Report

- Run ID: `20260415-085044`
- Status: **passed**
- Generated At: 2026-04-15T00:50:44.507Z
- DB: `hemodialysis_db`
- User: `hd_app`

## Drill Mode

- Mode: schema-level
- Limitation: Current DB role has no createdb privilege; rehearsal executed in schema-level isolation.

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
| db-backup | passed | 273 |
| backup-verify-list | passed | 35 |
| capability-check | passed | 3 |
| target-table-selection | passed | 6 |
| prepare-drill-schemas | passed | 14 |
| clone-public-into-drill-schemas | passed | 247 |
| baseline-row-counts | passed | 4 |
| simulate-migration-on-work-schema | passed | 25 |
| rollback-restore-from-backup-schema | passed | 106 |
| verify-row-counts-after-restore | passed | 3 |
| cleanup-drill-schemas | passed | 75 |

## Row Count Verification

- All target tables recovered to backup row counts.

## Artifacts

- Backup dump: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260415-085044\hemodialysis_db-20260415-085044.dump`
- Backup list: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260415-085044\hemodialysis_db-20260415-085044.list`
- JSON report: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260415-085044\db-drill-report.json`
- Markdown report: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260415-085044\db-drill-report.md`

