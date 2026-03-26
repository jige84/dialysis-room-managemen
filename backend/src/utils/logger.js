const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function formatDate() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function writeLog(level, message, data) {
  const entry = `[${formatDate()}] [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
  const date = new Date().toISOString().slice(0, 10);
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
