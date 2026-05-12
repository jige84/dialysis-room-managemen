# 复制本文件为 cloud-sync-to-ecs.local.ps1（该文件已被 .gitignore 忽略）
# 填写后在本机执行（不经由 GitHub push）:
#   .\scripts\cloud-sync-to-ecs.ps1
# 或指定主机:
#   .\scripts\cloud-sync-to-ecs.ps1 -EcsHost 47.114.111.216
# 跳过迁移 / 跳过 nginx:
#   .\scripts\cloud-sync-to-ecs.ps1 -SkipMigrate -SkipNginx

$CloudSyncHost = "47.114.111.216"
$CloudSyncUser = "root"
$CloudSyncRemotePath = "/opt/hemodialysis"

# 二选一：推荐 SSH 公钥登录（留空密码，脚本将使用 ssh/scp 交互或密钥）
$CloudSyncPassword = ""

# 若已安装 PuTTY 且需非交互密码，可填写密码并使用 plink（勿把本文件提交到 Git）
# $CloudSyncPassword = "你的密码"
