# DB Drill Rehearsal Report

- Run ID: `20260414-155628`
- Status: **failed**
- Generated At: 2026-04-14T07:56:28.492Z
- DB: `hemodialysis_db`
- User: `hd_app`

## Drill Mode

- Mode: schema-level
- Limitation: None

## Target Tables


## Step Results

| Step | Status | Duration(ms) |
|---|---|---:|
| db-backup | failed | 1 |

## Row Count Verification

- All target tables recovered to backup row counts.

## Artifacts

- Backup dump: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-155628\hemodialysis_db-20260414-155628.dump`
- Backup list: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-155628\hemodialysis_db-20260414-155628.list`
- JSON report: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-155628\db-drill-report.json`
- Markdown report: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-drill\20260414-155628\db-drill-report.md`

## Error

```text
Error: spawnSync pg_dump EPERM
    at Object.spawnSync (node:internal/child_process:1119:20)
    at spawnSync (node:child_process:911:24)
    at execOrThrow (E:\xuetoushiguanli\backend\scripts\db-drill-rehearsal.js:63:15)
    at E:\xuetoushiguanli\backend\scripts\db-drill-rehearsal.js:351:7
    at measureStep (E:\xuetoushiguanli\backend\scripts\db-drill-rehearsal.js:89:27)
    at main (E:\xuetoushiguanli\backend\scripts\db-drill-rehearsal.js:350:11)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
```

