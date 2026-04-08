/**
 * 防止 SSRF：仅允许访问公网 http(s) URL（禁止内网与本地）
 */
const net = require('net');
const { URL } = require('url');

function isPrivateOrLoopbackIpv4(ip) {
  if (!ip || typeof ip !== 'string') return true;
  if (ip === '127.0.0.1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  return false;
}

/**
 * @param {string} inputUrl
 * @returns {URL}
 */
function assertPublicHttpUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    const e = new Error('URL 无效');
    e.statusCode = 400;
    throw e;
  }
  let u;
  try {
    u = new URL(inputUrl.trim());
  } catch {
    const e = new Error('URL 格式错误');
    e.statusCode = 400;
    throw e;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    const e = new Error('仅支持 http 或 https');
    e.statusCode = 400;
    throw e;
  }
  const host = u.hostname;
  if (!host || host === 'localhost' || host.endsWith('.local')) {
    const e = new Error('禁止访问本地主机');
    e.statusCode = 400;
    throw e;
  }
  if (net.isIPv4(host) && isPrivateOrLoopbackIpv4(host)) {
    const e = new Error('禁止访问内网地址');
    e.statusCode = 400;
    throw e;
  }
  if (net.isIPv6(host)) {
    const e = new Error('暂不支持 IPv6 直链');
    e.statusCode = 400;
    throw e;
  }
  return u;
}

module.exports = {
  assertPublicHttpUrl,
  isPrivateOrLoopbackIpv4,
};
