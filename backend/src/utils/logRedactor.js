/**
 * 日志脱敏工具
 * 主要作用：在记录日志前对常见敏感字段做掩码处理，避免 PII/凭据写入日志文件。
 * 主要功能：按键名脱敏；手机号/身份证号样式脱敏；循环引用保护；限制递归深度。
 */

const SENSITIVE_KEY_RE = /(password|pwd|token|authorization|secret|api[_-]?key|id[_-]?card|phone|mobile|contact|身份证|手机号|encrypt|cipher)/i;
const MAX_DEPTH = 5;

function maskPhone(text) {
  return text.replace(/\b(1[3-9]\d{2})\d{4}(\d{4})\b/g, '$1****$2');
}

function maskIdCard(text) {
  return text
    .replace(/\b(\d{6})\d{8}(\d{3}[0-9Xx])\b/g, '$1********$2')
    .replace(/\b(\d{3})\d{9}(\d{3})\b/g, '$1*********$2');
}

function maskByKey(key, value) {
  if (value == null) return value;
  if (!SENSITIVE_KEY_RE.test(key)) return value;
  if (typeof value === 'string') {
    if (value.length <= 8) return '[REDACTED]';
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
  return '[REDACTED]';
}

function redactPrimitive(value) {
  if (typeof value !== 'string') return value;
  return maskIdCard(maskPhone(value));
}

function redactForLog(value, depth = 0, seen = new WeakSet(), parentKey = '') {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]';
  if (value == null) return value;
  if (typeof value !== 'object') {
    return parentKey ? maskByKey(parentKey, redactPrimitive(value)) : redactPrimitive(value);
  }
  if (Buffer.isBuffer(value)) return `[Buffer(${value.length})]`;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1, seen));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const masked = maskByKey(k, v);
    if (masked === '[REDACTED]' || (typeof masked === 'string' && masked !== v)) {
      out[k] = masked;
      continue;
    }
    out[k] = redactForLog(v, depth + 1, seen, k);
  }
  return out;
}

module.exports = { redactForLog };

