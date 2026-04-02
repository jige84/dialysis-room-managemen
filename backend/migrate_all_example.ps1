<# 
  migrate_all_example.ps1
  用于在本地一次性按顺序执行 backend\migrations 下的所有 SQL 迁移。
  使用前请先在 PostgreSQL 中创建好 hemodialysis_db 数据库，并确保已安装 psql 工具。

  使用方式（在 PowerShell 中）：
    cd E:\xuetoushiguanli\backend\migrations
    pwsh ..\migrate_all_example.ps1

  根据你的实际数据库连接信息，修改下面 $DbUser / $DbName / $Host / $Port。
#>

$Host   = "localhost"
$Port   = 5432
$DbName = "hemodialysis_db"
$DbUser = "hd_app"          # 如使用其他用户，请修改

$Migrations = @(
  "001_create_users.sql",
  "002_create_patients.sql",
  "003_create_prescriptions.sql",
  "004_create_long_term_orders.sql",
  "005_create_order_executions.sql",
  "006_create_dialysis_records.sql",
  "007_create_vital_signs.sql",
  "008_create_complications.sql",
  "009_create_lab_results.sql",
  "010_create_vascular_accesses.sql",
  "011_create_thrombolysis_records.sql",
  "012_create_cvc_risk_assessments.sql",
  "013_create_infection_screenings.sql",
  "014_create_infection_monitoring.sql",
  "015_create_schedules.sql",
  "016_create_devices.sql",
  "017_create_water_quality.sql",
  "018_create_consumables.sql",
  "019_create_cqi.sql",
  "020_create_qc_reports.sql",
  "021_create_audit_alerts.sql",
  "022_add_patient_history_fields.sql",
  "023_devices_consumables_extend.sql",
  "024_seed_consumable_catalog.sql",
  "025_create_water_machines.sql",
  "026_create_schedule_rules_and_nurse_schedule.sql"
)

Write-Host "开始执行数据库迁移到数据库 $DbName (用户: $DbUser)..." -ForegroundColor Cyan

foreach ($file in $Migrations) {
  $path = Join-Path -Path $PSScriptRoot -ChildPath $file
  if (-not (Test-Path $path)) {
    Write-Warning "未找到迁移文件: $file，跳过。"
    continue
  }

  Write-Host "执行迁移: $file ..." -ForegroundColor Yellow
  & psql -h $Host -p $Port -U $DbUser -d $DbName -f $path

  if ($LASTEXITCODE -ne 0) {
    Write-Error "执行迁移文件 $file 失败，已中止后续迁移。请检查错误信息后重试。"
    exit $LASTEXITCODE
  }
}

Write-Host "所有迁移执行完成。" -ForegroundColor Green

