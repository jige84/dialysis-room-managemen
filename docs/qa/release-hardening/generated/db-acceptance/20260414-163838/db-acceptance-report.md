# DB Backup/Restore Acceptance Report

- Run ID: `20260414-163838`
- Status: **failed**
- Generated At: 2026-04-14T08:38:38.012Z
- Source DB: `hemodialysis_db`
- DB User: `hd_app`
- Temp DB: `(not used)`

## Steps

| Step | Status | Duration(ms) |
|---|---|---:|
| precheck-pg-tools | failed | 1 |

## Artifacts

- Backup dump: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-acceptance\20260414-163838\hemodialysis_db-20260414-163838.dump`
- Backup list: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-acceptance\20260414-163838\hemodialysis_db-20260414-163838.list`
- JSON report: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-acceptance\20260414-163838\db-acceptance-report.json`
- Markdown report: `E:\xuetoushiguanli\docs\qa\release-hardening\generated\db-acceptance\20260414-163838\db-acceptance-report.md`

## Error

```text
Error: spawnSync pg_dump EPERM
    at Object.spawnSync (node:internal/child_process:1119:20)
    at spawnSync (node:child_process:911:24)
    at execOrThrow (E:\xuetoushiguanli\backend\scripts\db-backup-restore-acceptance.js:101:15)
    at E:\xuetoushiguanli\backend\scripts\db-backup-restore-acceptance.js:327:7
    at measureStep (E:\xuetoushiguanli\backend\scripts\db-backup-restore-acceptance.js:127:27)
    at main (E:\xuetoushiguanli\backend\scripts\db-backup-restore-acceptance.js:326:11)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
```

