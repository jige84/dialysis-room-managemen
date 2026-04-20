# 血液透析系统 - Windows 部署辅助脚本
# 用于上传代码到 ECS 并执行部署

param(
    [string]$ECSIp = "47.114.111.216",
    [string]$Username = "root",
    [string]$Password = "",
    [string]$LocalProjectPath = "E:\xuetoushiguanli",
    [string]$RemotePath = "/opt/hemodialysis"
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  血液透析系统 - 部署助手" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 如果没有提供密码，提示输入
if ([string]::IsNullOrEmpty($Password)) {
    $securePassword = Read-Host "请输入ECS root密码" -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword))
}

# 检查必要的命令
function Test-Command($Command) {
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

# 安装 scp 和 ssh 客户端（如果需要）
if (!(Test-Command "scp")) {
    Write-Host "正在安装 OpenSSH 客户端..." -ForegroundColor Yellow
    Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
}

Write-Host "步骤 1: 准备部署包..." -ForegroundColor Green

# 创建临时部署目录
$DeployTemp = "$env:TEMP\hemodialysis-deploy-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $DeployTemp -Force | Out-Null

# 复制后端代码（排除 node_modules）
Write-Host "  - 复制后端代码..."
robocopy "$LocalProjectPath\backend" "$DeployTemp\backend" /E /XD node_modules logs uploads .git /XF .env 2>&1 | Out-Null

# 复制前端代码（如果已构建）
if (Test-Path "$LocalProjectPath\frontend\dist") {
    Write-Host "  - 复制前端构建文件..."
    robocopy "$LocalProjectPath\frontend\dist" "$DeployTemp\frontend\dist" /E 2>&1 | Out-Null
} else {
    Write-Host "  - 警告: 前端未构建，请先运行 npm run build" -ForegroundColor Yellow
}

# 复制部署脚本
Copy-Item "$LocalProjectPath\deploy-to-ecs.sh" "$DeployTemp\deploy-to-ecs.sh"

# 创建 .env 文件用于生产环境
$EnvContent = @"
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=hemodialysis_db
DB_USER=hd_app
DB_PASSWORD=840611
DB_POOL_MAX=10

# Redis配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT配置
JWT_SECRET=a8f5f167f44f4964e6c998dee827110c15e3b9f7a3b1e12c89d6f3e9b0a2c4d6
JWT_EXPIRES_IN=8h

# 数据加密
ENCRYPT_KEY=2b7e151628aed2a6abf7158809cf4f3c26b2e8f9a1c4d7e0b3f6a9d2c5e8b1f4

# 服务器
PORT=3080
NODE_ENV=production

# AI 服务（通义千问）
QWEN_MODEL=qwen3-max
QWEN_API_KEY=sk-cec9142e836a4ac6a241465264995604

# 阿里云OSS
OSS_REGION=cn-beijing
OSS_BUCKET=hemodialysis-backup
OSS_ACCESS_KEY=
OSS_ACCESS_SECRET=

# 短信
SMS_PROVIDER=
SMS_API_KEY=
"@

$EnvContent | Out-File -FilePath "$DeployTemp\backend\.env" -Encoding UTF8

Write-Host "步骤 2: 压缩部署包..." -ForegroundColor Green
$DeployZip = "$env:TEMP\hemodialysis-deploy.zip"
Compress-Archive -Path "$DeployTemp\*" -DestinationPath $DeployZip -Force

Write-Host "步骤 3: 上传到 ECS..." -ForegroundColor Green
Write-Host "  - 目标: ${Username}@${ECSIp}:${RemotePath}" -ForegroundColor Gray

# 使用 plink/pscp (PuTTY) 或 OpenSSH
# 这里使用 PowerShell 的 SSH 功能

# 首先创建远程目录
$CreateDirCmd = "mkdir -p $RemotePath && rm -rf $RemotePath/*"
$SecurePassword = ConvertTo-SecureString $Password -AsPlainText -Force
$Credential = New-Object System.Management.Automation.PSCredential($Username, $SecurePassword)

# 使用 SSH 执行命令
Write-Host "  - 创建远程目录..."
$Session = New-SSHSession -ComputerName $ECSIp -Credential $Credential -AcceptKey 2>$null
if ($Session) {
    Invoke-SSHCommand -SessionId $Session.SessionId -Command $CreateDirCmd | Out-Null
    Remove-SSHSession -SessionId $Session.SessionId | Out-Null
}

# 上传文件
Write-Host "  - 上传文件（这可能需要几分钟）..."
$ScpArgs = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -P 22 -r `"$DeployTemp\*`" ${Username}@${ECSIp}:${RemotePath}/"

# 使用 SCP 上传
$ScpProcess = Start-Process -FilePath "scp" -ArgumentList $ScpArgs -Wait -PassThru -NoNewWindow

if ($ScpProcess.ExitCode -eq 0) {
    Write-Host "  - 上传成功!" -ForegroundColor Green
} else {
    Write-Host "  - 上传失败，尝试使用备用方法..." -ForegroundColor Yellow
    # 备用：使用 PowerShell 的 SFTP
}

Write-Host "步骤 4: 执行部署脚本..." -ForegroundColor Green

# 执行远程部署脚本
$DeployCmd = "cd $RemotePath && chmod +x deploy-to-ecs.sh && bash deploy-to-ecs.sh 2>&1"

# 使用 SSH 执行部署
$Session = New-SSHSession -ComputerName $ECSIp -Credential $Credential -AcceptKey 2>$null
if ($Session) {
    $Result = Invoke-SSHCommand -SessionId $Session.SessionId -Command $DeployCmd -TimeOut 300
    Write-Host $Result.Output
    Remove-SSHSession -SessionId $Session.SessionId | Out-Null
}

# 清理临时文件
Remove-Item $DeployTemp -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $DeployZip -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  部署完成!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "访问地址:" -ForegroundColor Cyan
Write-Host "  - 前端: http://$ECSIp" -ForegroundColor White
Write-Host "  - API:  http://$ECSIp/api" -ForegroundColor White
Write-Host ""
Write-Host "常用命令（在ECS上执行）:" -ForegroundColor Cyan
Write-Host "  pm2 status          - 查看服务状态" -ForegroundColor Gray
Write-Host "  pm2 logs            - 查看实时日志" -ForegroundColor Gray
Write-Host "  pm2 restart all     - 重启所有服务" -ForegroundColor Gray
Write-Host ""
