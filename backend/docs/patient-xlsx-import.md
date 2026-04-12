# 历史患者 XLSX 导入说明

## 目标列与别名

首行表头支持**英文列名**或下列**中文别名**（不区分大小写，可含空格）。旧表列名不一致时，请在 Excel 中增加一行映射或重命名列。

| 内部字段 | 必填 | 英文列名示例 | 中文别名示例 |
|----------|------|--------------|--------------|
| name | 是 | name | 姓名、患者姓名 |
| gender | 是 | gender | 性别（M/F 或 男/女） |
| dob | 是 | dob | 出生日期 |
| dialysis_start_date | 是 | dialysis_start_date | 开始透析日期 |
| primary_diagnosis | 是 | primary_diagnosis | 主要诊断 |
| responsible_nurse_id | 二选一 | responsible_nurse_id | 责任护士ID（UUID） |
| responsible_nurse_name | 二选一 | — | 责任护士、责任护士姓名（与系统 `real_name` 完全一致） |
| id_card | 否 | id_card | 身份证、身份证号 |
| phone | 否 | phone | 手机、电话 |
| isolation_zone | 否 | isolation_zone | 隔离区（normal/hbv/hcv/observation/last_shift，或 阴性/乙肝/丙肝 等别名） |
| dialysis_schedule_code | 否 | dialysis_schedule_code | 透析排班代码（见下表） |
| dialysis_schedule_notes | 否 | dialysis_schedule_notes | 透析排班说明（code 为 other 时建议填写） |
| dialysis_schedule_anchor_date | 条件 | dialysis_schedule_anchor_date | 隔日锚点日期（code 为 qod 时必填） |
| dialysis_mode | 否 | dialysis_mode | 透析模式，默认 HD |
| 其他档案字段 | 否 | address、present_illness、ckd_stage、comorbidities 等 | 见系统「新建患者」表单 |

### 透析排班代码（`dialysis_schedule_code`）

与前端预设一致：`tiw_mwf_morning`、`tiw_mwf_afternoon`、`tiw_mwf_evening`、`tiw_tts_morning`、`tiw_tts_afternoon`、`tiw_tts_evening`、`biw5_alt`、`qod`、`other`。

## 护士姓名与 UUID 对照

- 接口：`GET /api/users/nursing-staff`（管理员/医生 token）返回 `id`、`real_name`。
- 导入时优先使用 **UUID** 列 `responsible_nurse_id`；仅用姓名时须与 `real_name` **完全一致**，重名时需改用 UUID。

## 使用方式

1. **下载模板**：`GET /api/patients/import/template` 或前端「患者档案 → 批量导入 → 下载模板」。
2. **预检**：`POST /api/patients/import?dry_run=1`，表单字段 `file` 上传 `.xlsx`（≤5MB，≤2000 行数据行）。
3. **正式导入**：`POST /api/patients/import`（不传 `dry_run` 或 `dry_run=0`）。
4. **命令行**（服务器侧）：`npm run import:patients -- --dry-run ./data.xlsx`；正式导入去掉 `--dry-run`。可选环境变量 `IMPORT_ACTOR_USER_ID` 指定 `created_by`。

## 去重规则

同一 **姓名 + 出生日期** 且 `status=active` 的档案已存在时，该行**跳过**（不计入错误，计入 `skipped_duplicates`）。

## 导入后第二批工作（不在本接口范围内）

以下数据需另行录入或通过其他流程同步：

- 透析知情同意书**影像**（`POST /api/patients/:id/consent-dialysis-image`）。
- 传染病筛查、血管通路、透析处方、历史透析记录、检验结果等。

合规要求下，建议导入后按科室流程补全知情同意影像与初筛信息。
