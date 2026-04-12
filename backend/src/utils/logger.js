/**
 * 简易文件日志工具
 * 主要作用：将 INFO/WARN/ERROR 等写入按日滚动的日志文件，并视级别输出控制台。
 * 主要功能：确保 logs 目录存在；按上海时区格式化时间戳；开发环境同步打印，ERROR 始终 stderr。
 */
const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function formatDateOnly() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatDate() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function writeLog(level, message, data) {
  const entry = `[${formatDate()}] [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
  const date = formatDateOnly();
  const filePath = path.join(logDir, `${date}.log`);
  fs.appendFile(filePath, entry, () => {});
  if (level === 'ERROR') console.error(entry.trim());
  else if (process.env.NODE_ENV !== 'production') console.log(entry.trim());
}

module.exports = {
  info:  (msg, data) => writeLog('INFO', msg, data),
  warn:  (msg, data) => writeLog('WARN', msg, data),
  error: (msg, data) => writeLog('ERROR', msg, data),
  debug: (msg, data) => { if (process.env.NODE_ENV === 'development') writeLog('DEBUG', msg, data); },
};
