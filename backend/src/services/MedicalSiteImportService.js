/**
 * 从已启用的专业网站配置抓取页面，整理为简体中文后写入指南阅读中心与本地知识库（管理员手动触发）
 */
const { assertPublicHttpUrl } = require('../utils/safeHttpUrl');
const MedicalSiteService = require('./MedicalSiteService');
const GuidelineReaderService = require('./GuidelineReaderService');
const GuidelineNoticeService = require('./GuidelineNoticeService');
const AiAnalysisService = require('./AiAnalysisService');
const { htmlToPlainText } = require('../utils/htmlToPlainText');

const MAX_ITEMS_PER_RUN = 6;
const MAX_LINKS_SCAN = 80;
const MIN_TEXT_CHARS = 200;
const HANZI_RATIO_ZH = 0.12;

const TOPIC_RE =
  /指南|共识|规范|标准|建议|规程|血液透析|血液净化|透析|CKD|慢性肾脏|并发症|质控|抗凝|血管通路|贫血|矿物质|研究进展|Meta|随机|多中心|专家/;

function stripHtml(html) {
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/&[a-z#0-9]+;/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function extractPageTitle(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 500) : '';
}

/**
 * @param {string} html
 * @param {string} pageUrl
 * @returns {{ href: string, text: string }[]}
 */
function extractSameSiteLinks(html, pageUrl) {
  const base = new URL(pageUrl);
  const out = [];
  const re = /<a[^>]*href\s*=\s*(["'])([^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  let n = 0;
  while ((m = re.exec(html)) !== null && n < MAX_LINKS_SCAN) {
    n += 1;
    const href = String(m[2] || '').trim();
    const inner = m[3] || '';
    const text = stripHtml(inner).replace(/\s+/g, ' ').trim();
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) continue;
    if (!text || text.length < 4) continue;
    let abs;
    try {
      abs = new URL(href, base).toString();
    } catch {
      continue;
    }
    try {
      assertPublicHttpUrl(abs);
    } catch {
      continue;
    }
    const u = new URL(abs);
    if (u.hostname !== base.hostname) continue;
    out.push({ href: abs.split('#')[0], text: text.slice(0, 300) });
  }
  return out;
}

function scoreLink(title, href) {
  let s = 0;
  if (TOPIC_RE.test(title)) s += 4;
  if (/共识/.test(title)) s += 2;
  if (/指南/.test(title)) s += 2;
  if (/规范|标准|规程/.test(title)) s += 1;
  if (/研究|进展|前沿|动态/.test(title)) s += 2;
  if (/\.pdf($|\?)/i.test(href)) s += 1;
  return s;
}

function inferDocType(title) {
  const t = String(title);
  if (/共识/.test(t)) return 'consensus';
  if (/标准|规程/.test(t)) return 'standard';
  return 'guideline';
}

function hanziRatio(text) {
  const t = String(text);
  if (!t.length) return 0;
  const han = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  return han / t.length;
}

/**
 * @param {string} userId
 * @param {{ siteKeys?: string[], maxItems?: number }} opts
 */
async function importFromEnabledSites(opts = {}) {
  const adminUserId = opts.userId || null;
  const maxItems = Math.min(MAX_ITEMS_PER_RUN, Math.max(1, Number(opts.maxItems) || MAX_ITEMS_PER_RUN));
  const siteKeysFilter =
    Array.isArray(opts.siteKeys) && opts.siteKeys.length
      ? new Set(opts.siteKeys.map((k) => String(k).trim()).filter(Boolean))
      : null;

  const all = await MedicalSiteService.listAllSites();
  const candidates = all.filter((row) => {
    if (!row.enabled) return false;
    const seed = (row.guidelines_url && String(row.guidelines_url).trim()) || row.base_url;
    if (!seed || !String(seed).trim()) return false;
    if (siteKeysFilter && !siteKeysFilter.has(row.site_key)) return false;
    return true;
  });

  if (!candidates.length) {
    const e = new Error('没有符合条件的站点：请启用站点并填写「指南页」或「base_url」');
    e.statusCode = 400;
    throw e;
  }

  const results = [];
  const errors = [];
  const seenUrls = new Set();
  let budget = maxItems;

  for (const site of candidates) {
    if (budget <= 0) break;
    const seedUrl = (site.guidelines_url && String(site.guidelines_url).trim()) || site.base_url;
    let html;
    try {
      html = await GuidelineReaderService.fetchUrlRawHtml(seedUrl);
    } catch (err) {
      errors.push({ site_key: site.site_key, step: 'fetch_seed', message: err.message || String(err) });
      continue;
    }
    if (!html || html.length < 50) {
      errors.push({ site_key: site.site_key, step: 'fetch_seed', message: '页面内容过短' });
      continue;
    }

    const links = extractSameSiteLinks(html, seedUrl);
    const scored = links
      .map((l) => ({ ...l, score: scoreLink(l.text, l.href) }))
      .sort((a, b) => b.score - a.score);
    let ranked = scored.filter((l) => l.score >= 3);
    if (!ranked.length) ranked = scored.filter((l) => l.score >= 1);
    if (!ranked.length) ranked = scored.slice(0, 10);

    const toFetch = [];
    const seenHref = new Set();
    for (const l of ranked) {
      if (toFetch.length >= budget) break;
      if (seenHref.has(l.href)) continue;
      seenHref.add(l.href);
      toFetch.push(l);
    }

    if (!toFetch.length) {
      const pageTitle = extractPageTitle(html) || site.display_name;
      const plainLen = htmlToPlainText(html).length;
      if (TOPIC_RE.test(pageTitle) || plainLen >= MIN_TEXT_CHARS * 2) {
        toFetch.push({ href: seedUrl, text: pageTitle, score: 5 });
      }
    }

    const delayMs = Math.min(8000, Math.max(500, Number(site.rate_limit_ms) || 2000));

    for (const link of toFetch) {
      if (budget <= 0) break;
      if (seenUrls.has(link.href)) continue;

      await sleep(delayMs);

      let bodyHtml;
      try {
        bodyHtml = await GuidelineReaderService.fetchUrlRawHtml(link.href);
      } catch (err) {
        errors.push({ site_key: site.site_key, step: 'fetch_page', url: link.href, message: err.message });
        continue;
      }
      const plain = htmlToPlainText(bodyHtml);
      if (plain.length < MIN_TEXT_CHARS) {
        errors.push({
          site_key: site.site_key,
          step: 'short_text',
          url: link.href,
          message: `正文过短（${plain.length} 字）`,
        });
        continue;
      }

      const dup = await GuidelineReaderService.findGuidelineBySourceUrl(link.href);
      if (dup) {
        seenUrls.add(link.href);
        results.push({
          site_key: site.site_key,
          url: link.href,
          status: 'skipped_duplicate',
          guideline_id: dup,
        });
        continue;
      }

      let rawZh = plain.slice(0, 120_000);
      if (hanziRatio(rawZh) < HANZI_RATIO_ZH) {
        try {
          const summarized = await AiAnalysisService.summarizeWebExcerptToChinese(
            rawZh.slice(0, 25_000),
            link.text,
          );
          rawZh = summarized;
        } catch (err) {
          errors.push({
            site_key: site.site_key,
            step: 'summarize',
            url: link.href,
            message: err.message || String(err),
          });
          continue;
        }
      }

      const titleBase = link.text || extractPageTitle(bodyHtml) || site.display_name;
      const title = `[${site.display_name}] ${titleBase}`.slice(0, 500);
      const docType = inferDocType(titleBase);

      let doc;
      try {
        doc = await GuidelineReaderService.createGuidelineFromPreparedContent({
          title,
          docType,
          rawText: rawZh,
          sourceUrl: link.href,
          uploadedBy: adminUserId,
        });
      } catch (err) {
        errors.push({ site_key: site.site_key, step: 'insert_guideline', message: err.message });
        continue;
      }

      try {
        await GuidelineReaderService.generateReadingNote(doc.id);
      } catch (err) {
        errors.push({
          site_key: site.site_key,
          step: 'generate_note',
          guideline_id: doc.id,
          message: err.message,
        });
      }

      try {
        await GuidelineReaderService.saveReadingNoteToKb(doc.id, adminUserId);
      } catch (err) {
        errors.push({
          site_key: site.site_key,
          step: 'save_kb',
          guideline_id: doc.id,
          message: err.message,
        });
      }

      seenUrls.add(link.href);
      budget -= 1;
      results.push({
        site_key: site.site_key,
        url: link.href,
        status: 'imported',
        guideline_id: doc.id,
        title,
      });
    }
  }

  const imported = results.filter((r) => r.status === 'imported').length;
  let notified = 0;
  if (imported > 0) {
    const n = await GuidelineNoticeService.notifyAllGuidelineReaders({
      title: '指南阅读中心资料已更新',
      message: `管理员已自「专业网站配置」同步 ${imported} 条最新指南/共识或研究进展摘要（简体中文），请打开侧栏「指南阅读中心」查阅；原文已写入本地知识库检索。`,
    });
    notified = n.inserted;
  }

  return {
    imported,
    notified_users: notified,
    results,
    errors,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  importFromEnabledSites,
};
