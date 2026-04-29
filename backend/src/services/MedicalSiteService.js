/**
 * 专业医学网站元数据（二级检索引用，不爬取正文）
 */
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { assertPublicHttpUrl } = require('../utils/safeHttpUrl');
const { htmlToPlainText } = require('../utils/htmlToPlainText');

function isPermissionDenied(err) {
  return Boolean(err && err.code === '42501');
}

function isUndefinedTable(err) {
  return Boolean(err && err.code === '42P01');
}

/**
 * 管理员列表（含未启用）
 */
async function listAllSites() {
  try {
    const { rows } = await pool.query(
      `SELECT id, site_key, display_name, base_url, search_url, guidelines_url, specialty,
              priority, enabled, rate_limit_ms, description, last_tested_at, is_reachable,
              created_at, updated_at
       FROM medical_sites
       ORDER BY priority ASC, site_key ASC`,
    );
    return rows;
  } catch (err) {
    if (isUndefinedTable(err) || isPermissionDenied(err)) {
      logger.warn('[MedicalSiteService] medical_sites 不可用，返回空列表');
      return [];
    }
    throw err;
  }
}

/**
 * AI 分析：已启用站点，用于 prompt 引用
 * @param {number} [limit]
 */
async function listEnabledSitesForPrompt(limit = 8) {
  const lim = Math.min(20, Math.max(1, limit));
  try {
    const { rows } = await pool.query(
      `SELECT site_key, display_name, base_url, search_url, guidelines_url, priority
       FROM medical_sites
       WHERE enabled = true AND base_url IS NOT NULL AND trim(base_url) <> ''
       ORDER BY priority ASC NULLS LAST, site_key ASC
       LIMIT $1`,
      [lim],
    );
    return rows;
  } catch (err) {
    if (isUndefinedTable(err) || isPermissionDenied(err)) {
      return [];
    }
    throw err;
  }
}

/**
 * @param {string} siteKey
 */
async function getSiteByKey(siteKey) {
  const { rows } = await pool.query(
    `SELECT * FROM medical_sites WHERE site_key = $1`,
    [siteKey],
  );
  return rows[0] || null;
}

/**
 * @param {string} siteKey
 * @param {object} patch
 */
async function updateSite(siteKey, patch) {
  const allowed = [
    'display_name',
    'base_url',
    'search_url',
    'guidelines_url',
    'priority',
    'enabled',
    'rate_limit_ms',
    'description',
  ];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      sets.push(`${k} = $${i}`);
      vals.push(patch[k]);
      i += 1;
    }
  }
  if (!sets.length) {
    return getSiteByKey(siteKey);
  }
  sets.push('updated_at = NOW()');
  vals.push(siteKey);
  const sql = `UPDATE medical_sites SET ${sets.join(', ')} WHERE site_key = $${i} RETURNING *`;
  const { rows } = await pool.query(sql, vals);
  return rows[0] || null;
}

/**
 * HEAD 探测可访问性（管理员测试连接）
 * @param {string} siteKey
 */
async function testReachability(siteKey) {
  const row = await getSiteByKey(siteKey);
  if (!row || !row.base_url) {
    const e = new Error('站点不存在或未配置 base_url');
    e.statusCode = 400;
    throw e;
  }
  assertPublicHttpUrl(row.base_url);
  const u = new URL(row.base_url.trim());
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(u.toString(), {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'DialysisSystemSiteTest/1.0' },
    });
    const ok = res.ok || res.status === 405 || res.status === 403;
    await pool.query(
      `UPDATE medical_sites SET last_tested_at = NOW(), is_reachable = $2, updated_at = NOW() WHERE site_key = $1`,
      [siteKey, ok],
    );
    return { ok, status: res.status };
  } catch (err) {
    await pool.query(
      `UPDATE medical_sites SET last_tested_at = NOW(), is_reachable = false, updated_at = NOW() WHERE site_key = $1`,
      [siteKey],
    );
    const e = new Error(err.message || '连接失败');
    e.statusCode = 502;
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function isSiteExcerptEnabled() {
  const raw = String(process.env.AI_SITE_EXCERPT_ENABLED || '').trim().toLowerCase();
  if (!raw) return true;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function buildQueryUrl(site, queryText) {
  const q = encodeURIComponent(String(queryText || '').trim());
  const searchUrl = String(site.search_url || '').trim();
  if (searchUrl) {
    if (searchUrl.includes('{q}')) return searchUrl.replace(/\{q\}/g, q);
    const delimiter = searchUrl.includes('?') ? '&' : '?';
    return `${searchUrl}${delimiter}q=${q}`;
  }
  return String(site.guidelines_url || '').trim() || String(site.base_url || '').trim();
}

function pickSnippetByQuery(text, queryText) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const tokens = String(queryText || '')
    .split(/[\s,，;；、]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  const hit = tokens.find((t) => source.includes(t));
  if (!hit) return source.slice(0, 420);
  const idx = source.indexOf(hit);
  const start = Math.max(0, idx - 120);
  const end = Math.min(source.length, idx + 320);
  return source.slice(start, end);
}

async function fetchEnabledSiteExcerpts(queryText, limit = 3) {
  if (!isSiteExcerptEnabled()) return [];
  const q = String(queryText || '').trim();
  if (!q) return [];
  const maxSites = Math.min(6, Math.max(1, Number(limit) || 3));
  const sites = await listEnabledSitesForPrompt(maxSites);
  const out = [];
  for (const site of sites) {
    const target = buildQueryUrl(site, q);
    if (!target) continue;
    let url;
    try {
      url = assertPublicHttpUrl(target).toString();
    } catch {
      continue;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'DialysisSystemAiRetriever/1.0',
          Accept: 'text/html,text/plain,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (!res.ok) continue;
      const body = await res.text();
      const plain = htmlToPlainText(body).slice(0, 9000);
      const excerpt = pickSnippetByQuery(plain, q);
      if (!excerpt) continue;
      out.push({
        site_key: site.site_key,
        display_name: site.display_name,
        url,
        excerpt,
      });
      if (out.length >= maxSites) break;
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.warn('[MedicalSiteService] fetchEnabledSiteExcerpts failed', {
          site_key: site.site_key,
          message: err.message,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

module.exports = {
  listAllSites,
  listEnabledSitesForPrompt,
  fetchEnabledSiteExcerpts,
  getSiteByKey,
  updateSite,
  testReachability,
};
