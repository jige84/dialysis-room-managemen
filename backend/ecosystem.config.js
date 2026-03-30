/**
 * PM2 进程管理配置（生产部署可选）
 * 主要作用：以 pm2 守护方式启动后端 Node 进程，支持自动重启与环境变量分区。
 * 主要功能：定义 hd-backend 应用入口、实例数、内存上限与 dev/prod 环境块。
 */
module.exports = {
  apps: [{
    name: 'hd-backend',
    script: 'src/server.js',
    instances: 1,
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
  }],
};
