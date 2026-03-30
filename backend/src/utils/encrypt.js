/**
 * 敏感字段加解密与脱敏（AES-256-GCM）
 * 主要作用：满足 PII 加密存储规范，API 仅返回脱敏后的展示字段。
 * 主要功能：encrypt/decrypt；身份证号与手机号 mask；密钥来自环境变量。
 */
const crypto = require('crypto');
require('dotenv').config();

const KEY_HEX = process.env.ENCRYPT_KEY;

function getKey() {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('ENCRYPT_KEY 必须是64位十六进制字符串（32字节）');
  }
  return Buffer.from(KEY_HEX, 'hex');
}

/**
 * 加密文本
 * @param {string} text 明文
 * @returns {string} 格式：iv_hex:authTag_hex:encrypted_hex
 */
function encrypt(text) {
  if (!text) return null;
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * 解密文本
 * @param {string} encryptedStr 加密字符串
 * @returns {string} 明文
 */
function decrypt(encryptedStr) {
  if (!encryptedStr) return null;
  const key = getKey();
  const [ivHex, tagHex, dataHex] = encryptedStr.split(':');
  if (!ivHex || !tagHex || !dataHex) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 对身份证号进行脱敏显示（用于前端展示）
 * 保留前6位和后4位，中间统一替换为8个*（规范：security-rbac-rules §5）
 */
function maskIdCard(idCard) {
  if (!idCard) return '';
  return idCard.replace(/^(.{6})(.+)(.{4})$/, '$1********$3');
}

/**
 * 对手机号进行脱敏显示
 * 保留前3位和后4位
 */
function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

module.exports = { encrypt, decrypt, maskIdCard, maskPhone };
