/**
 * 将 HTML 转为可读纯文本：剔除 style/script 及站点级 CSS 噪音，优先提取 article/main/正文区
 * 用于指南 URL 拉取与站点抓取，避免把整页 CSS 当作「正文」存入 raw_text。
 */

/**
 * @param {string} s
 */
function looksLikeCssNoise(s) {
  const sample = String(s).slice(0, 12000);
  if (sample.length < 120) return true;
  const punct = (sample.match(/[{};:!]/g) || []).length;
  return punct / sample.length > 0.055;
}

/**
 * @param {string} html
 * @returns {string}
 */
function extractParagraphsFallback(html) {
  const parts = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const inner = String(m[1] || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (inner.length > 35) parts.push(inner);
  }
  return parts.join('\n\n').trim();
}

/**
 * @param {string} html
 * @returns {string|null}
 */
function pickLargestSemanticRegion(html) {
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]+class=["'][^"']*\bwp-block-post-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*\bpost-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*\bcontent-area\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  let best = '';
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1] && m[1].length > best.length) best = m[1];
  }
  return best.length > 200 ? best : null;
}

/**
 * @param {string} html
 * @returns {string}
 */
function htmlToPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  const original = html;

  let s = original;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  const region = pickLargestSemanticRegion(s);
  if (region) {
    s = region;
    s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  }

  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/&#(\d+);/g, (_, n) => {
    const code = Number.parseInt(n, 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
  });
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, h) => {
    const code = Number.parseInt(h, 16);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
  });
  s = s.replace(/&[a-z]+;/gi, ' ');
  let out = s.replace(/\s+/g, ' ').trim();

  if (out.length < 200 || looksLikeCssNoise(out)) {
    const paras = extractParagraphsFallback(original);
    if (paras.length > out.length && paras.length > 80) out = paras;
  }

  return out.slice(0, 500_000);
}

module.exports = {
  htmlToPlainText,
};
