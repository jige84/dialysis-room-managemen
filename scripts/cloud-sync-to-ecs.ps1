#Requires -Version 5.1
<#
.SYNOPSIS
  将本仓库代码直接同步到 ECS（不经由 GitHub push）。

.DESCRIPTION
  1) 在 %TEMP% 暂存 backend / frontend 需上云的文件（排除 node_modules、uploads、.env 等）
  2) 打包为 tar.gz，scp 上传到远端 /tmp
  3) ssh 解压覆盖 /opt/hemodialysis 下对应目录
  4) 远端：backend npm install + migrate；frontend npm install + build；pm2 reload；nginx reload

  凭据：优先加载 scripts/cloud-sync-to-ecs.local.ps1（勿提交该文件）。
        也可设置环境变量 ECS_SYNC_HOST、ECS_SYNC_USER、ECS_SYNC_REMOTE_PATH。

  认证：推荐配置 SSH 公钥；若使用密码，通常由 ssh/scp 交互输入。
        若安装 PuTTY 且在 local 文件中填写了 $CloudSyncPassword，将尝试 plink/pscp（非交互）。

.NOTES
  不上传：.git、各 node_modules、backend/uploads、backend/.env、frontend/dist（在服务器上现编）
#>

param(
  [Alias('Host')]
  [string]$EcsHost,
  [string]$User = "",
  [string]$RemotePath = "",
  [switch]$SkipMigrate,
  [switch]$SkipNginx
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$LocalPs1 = Join-Path $ScriptDir "cloud-sync-to-ecs.local.ps1"
if (Test-Path -LiteralPath $LocalPs1) {
  . $LocalPs1
}

if ([string]::IsNullOrWhiteSpace($EcsHost)) { $EcsHost = $env:ECS_SYNC_HOST }
if ([string]::IsNullOrWhiteSpace($EcsHost)) { $EcsHost = $CloudSyncHost }

if ($PSBoundParameters.ContainsKey('User') -and -not [string]::IsNullOrWhiteSpace($User)) {
  # 显式传入的 -User 优先
} elseif (-not [string]::IsNullOrWhiteSpace($env:ECS_SYNC_USER)) {
  $User = $env:ECS_SYNC_USER
} elseif (-not [string]::IsNullOrWhiteSpace($CloudSyncUser)) {
  $User = $CloudSyncUser
} else {
  $User = "root"
}

if ($PSBoundParameters.ContainsKey('RemotePath') -and -not [string]::IsNullOrWhiteSpace($RemotePath)) {
  # 显式传入的 -RemotePath 优先
} elseif (-not [string]::IsNullOrWhiteSpace($env:ECS_SYNC_REMOTE_PATH)) {
  $RemotePath = $env:ECS_SYNC_REMOTE_PATH
} elseif (-not [string]::IsNullOrWhiteSpace($CloudSyncRemotePath)) {
  $RemotePath = $CloudSyncRemotePath
} else {
  $RemotePath = "/opt/hemodialysis"
}

if ([string]::IsNullOrWhiteSpace($EcsHost)) {
  Write-Error "未配置 ECS 地址：请设置 ECS_SYNC_HOST 或创建 scripts/cloud-sync-to-ecs.local.ps1（参考 cloud-sync-to-ecs.local.example.ps1）"
}

$remoteTar = "/tmp/hemo-ecs-sync-$(Get-Date -Format 'yyyyMMddHHmmss').tar.gz"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stage = Join-Path $env:TEMP "hemo-ecs-sync-$stamp"
$backendStage = Join-Path $stage "backend"
$frontendStage = Join-Path $stage "frontend"

Write-Host "=== 暂存目录: $stage ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Join-Path $backendStage "src") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $backendStage "migrations") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $frontendStage "src") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $frontendStage "public") | Out-Null

function Invoke-RobocopyQuiet {
  param([string]$Src, [string]$Dst)
  if (-not (Test-Path -LiteralPath $Src)) { return }
  & robocopy $Src $Dst /E /NFL /NDL /NJH /NJS /XD "node_modules" "logs" "uploads" ".git" | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败: $Src -> $Dst (exit $LASTEXITCODE)" }
}

Write-Host "=== robocopy 同步到暂存 ===" -ForegroundColor Cyan
Invoke-RobocopyQuiet (Join-Path $ProjectRoot "backend\src") (Join-Path $backendStage "src")
Invoke-RobocopyQuiet (Join-Path $ProjectRoot "backend\migrations") (Join-Path $backendStage "migrations")

$copyOne = @(
  @{ Src = "backend\package.json"; Dst = "backend" },
  @{ Src = "backend\package-lock.json"; Dst = "backend" },
  @{ Src = "backend\ecosystem.config.js"; Dst = "backend" },
  @{ Src = "frontend\package.json"; Dst = "frontend" },
  @{ Src = "frontend\package-lock.json"; Dst = "frontend" },
  @{ Src = "frontend\index.html"; Dst = "frontend" },
  @{ Src = "frontend\vite.config.ts"; Dst = "frontend" },
  @{ Src = "frontend\tsconfig.json"; Dst = "frontend" },
  @{ Src = "frontend\tsconfig.app.json"; Dst = "frontend" },
  @{ Src = "frontend\tsconfig.node.json"; Dst = "frontend" }
)
foreach ($c in $copyOne) {
  $fp = Join-Path $ProjectRoot $c.Src
  if (Test-Path -LiteralPath $fp) {
    Copy-Item -Force $fp (Join-Path $stage $c.Dst)
  }
}
Invoke-RobocopyQuiet (Join-Path $ProjectRoot "frontend\src") (Join-Path $frontendStage "src")
if (Test-Path (Join-Path $ProjectRoot "frontend\public")) {
  Invoke-RobocopyQuiet (Join-Path $ProjectRoot "frontend\public") (Join-Path $frontendStage "public")
}

$localTar = Join-Path $env:TEMP "hemo-ecs-sync-$stamp.tar.gz"
Write-Host "=== 打包: $localTar ===" -ForegroundColor Cyan
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
  Write-Error "未找到 tar 命令。请安装 Windows OpenSSH 自带的 tar 或使用 Git Bash 运行 scripts/cloud-sync-to-ecs.sh"
}
Push-Location $stage
try {
  & tar -czf $localTar "backend" "frontend"
} finally {
  Pop-Location
}

$target = "${User}@${EcsHost}"
$usePw = -not [string]::IsNullOrWhiteSpace($CloudSyncPassword)
$plink = Get-Command plink -ErrorAction SilentlyContinue
$pscp = Get-Command pscp -ErrorAction SilentlyContinue

Write-Host "=== 上传 -> ${EcsHost}:${remoteTar} ===" -ForegroundColor Cyan
if ($usePw -and $pscp) {
  echo y | & pscp -batch -pw $CloudSyncPassword $localTar "${target}:$remoteTar"
} else {
  & scp -o StrictHostKeyChecking=accept-new $localTar "${target}:$remoteTar"
}

$migratePart = if ($SkipMigrate) { "echo 'skip migrate'" } else { "npm run migrate" }
$nginxPart = if ($SkipNginx) { "echo 'skip nginx'" } else { "nginx -t && systemctl reload nginx" }

$remoteScript = @"
set -e
cd $RemotePath
tar -xzf $remoteTar
rm -f $remoteTar
cd $RemotePath/backend
npm install --omit=dev
$migratePart
cd $RemotePath/frontend
npm install
npm run build
cd $RemotePath/backend
pm2 reload ecosystem.config.js --env production || pm2 restart hd-backend
$nginxPart
curl -sS -m 10 -o /dev/null -w 'health:%{http_code}\n' http://127.0.0.1:3080/api/health || true
echo DONE
"@

$remoteB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))

Write-Host "=== 远端解压、安装、构建、重启 ===" -ForegroundColor Cyan
if ($usePw -and $plink) {
  echo y | & plink -batch -ssh -pw $CloudSyncPassword $target "bash -lc 'echo $remoteB64 | base64 -d | bash'"
} else {
  ssh -o StrictHostKeyChecking=accept-new $target "bash -lc 'echo $remoteB64 | base64 -d | bash'"
}

Remove-Item -Force -Recurse $stage -ErrorAction SilentlyContinue
Remove-Item -Force $localTar -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== 同步完成 ===" -ForegroundColor Green
Write-Host "  站点: http://${EcsHost}/" -ForegroundColor Gray
