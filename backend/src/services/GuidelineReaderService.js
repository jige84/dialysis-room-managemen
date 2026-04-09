/**
 * 指南/共识阅读：创建记录、拉取 URL 正文、生成 AI 读书笔记
 */
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { assertPublicHttpUrl } = require('../utils/safeHttpUrl');
const AiAnalysisService = require('./AiAnalysisService');
const { htmlToPlainText } = require('../utils/htmlToPlainText');

const iconv = require('iconv-lite');

const MAX_FETCH_BYTES = 800_000;
const FETCH_TIMEOUT_MS = 15000;

/**
 * 将 HTML 字节流按 Content-Type / meta / 启发式解码为 UTF-8 字符串（国内站点常见 GBK/GB18030）
 * @param {Buffer} buf
 * @param {string} contentTypeHeader
 */
function decodeHtmlBuffer(buf, contentTypeHeader = '') {
  const head = buf.slice(0, Math.min(buf.length, 8000)).toString('ascii');
  let charset = '';
  const ct = String(contentTypeHeader || '');
  const mct = /charset\s*=\s*([^;"'\s]+)/i.exec(ct);
  if (mct) charset = mct[1].trim().toLowerCase();
  if (!charset) {
    const mh =
      /<meta[^>]+charset\s*=\s*["']?([^"'>\s]+)/i.exec(head) ||
      /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^"';\s]+)/i.exec(head);
    if (mh) charset = String(mh[1]).trim().toLowerCase();
  }
  const gbLike =
    charset &&
    (charset.includes('gb') || charset === 'gb2312' || charset === 'gbk' || charset === 'gb18030');

  const tryUtf8 = () => buf.toString('utf8');
  const replacementCount = (s) => (s.match(/\uFFFD/g) || []).length;

  if (gbLike) {
    try {
      return iconv.decode(buf, 'gb18030');
    } catch {
      /* fallthrough */
    }
  }

  let text = tryUtf8();
  if (replacementCount(text) > 8) {
    try {
      const alt = iconv.decode(buf, 'gb18030');
      if (replacementCount(alt) < replacementCount(text)) text = alt;
    } catch {
      /* keep utf8 */
    }
  }
  return text;
}

/**
 * 拉取 URL 解码后的原始 HTML（供链接解析；勿直接作正文存储）
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchUrlRawHtml(url) {
  const u = assertPublicHttpUrl(url);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'DialysisSystemGuidelineBot/1.0',
        Accept: 'text/html,text/plain,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) {
      const e = new Error(`拉取失败：HTTP ${res.status}`);
      e.statusCode = 502;
      throw e;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_FETCH_BYTES) {
      const e = new Error('页面过大，请改用文本粘贴或拆分');
      e.statusCode = 400;
      throw e;
    }
    const ct = res.headers.get('content-type') || '';
    return decodeHtmlBuffer(buf, ct);
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('拉取超时');
      e.statusCode = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 拉取 URL 并提取可读正文（用于指南入库，非原始 HTML）
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchUrlText(url) {
  const html = await fetchUrlRawHtml(url);
  const plain = htmlToPlainText(html);
  const out = plain.replace(/\s+/g, ' ').trim().slice(0, 200_000);
  if (!out || out.length < 30) {
    const e = new Error('未能从页面提取有效正文，请改用文本粘贴或检查页面是否需登录');
    e.statusCode = 422;
    throw e;
  }
  return out;
}

/**
 * DOI 解析为 URL 后再拉取
 * @param {string} doi
 */
async function resolveDoiToText(doi) {
  const clean = String(doi || '')
    .trim()
    .replace(/^doi:\s*/i, '');
  if (!clean) {
    const e = new Error('DOI 为空');
    e.statusCode = 400;
    throw e;
  }
  const landing = `https://doi.org/${encodeURIComponent(clean)}`;
  return fetchUrlText(landing);
}

/**
 * @param {object} p
 */
async function createGuideline(p) {
  const {
    title,
    sourceType,
    sourceUrl = null,
    sourceDoi = null,
    rawText = null,
    uploadedBy = null,
  } = p;
  if (!title || typeof title !== 'string') {
    const e = new Error('标题必填');
    e.statusCode = 400;
    throw e;
  }
  const st = sourceType || 'text_paste';
  if (st === 'pdf_upload') {
    const e = new Error('PDF 上传需配置存储后使用，请暂用文本粘贴或 URL');
    e.statusCode = 400;
    throw e;
  }
  if (!['text_paste', 'url', 'doi'].includes(st)) {
    const e = new Error('sourceType 无效');
    e.statusCode = 400;
    throw e;
  }
  let text = rawText ? String(rawText) : '';
  if (st === 'text_paste' && !text.trim()) {
    const e = new Error('请粘贴正文');
    e.statusCode = 400;
    throw e;
  }
  if (st === 'text_paste' && /<[a-z][\s\S]*>/i.test(text) && text.includes('<')) {
    text = htmlToPlainText(text);
  }
  if (st === 'url') {
    if (!sourceUrl) {
      const e = new Error('请填写 URL');
      e.statusCode = 400;
      throw e;
    }
    text = await fetchUrlText(sourceUrl);
  } else if (st === 'doi') {
    if (!sourceDoi) {
      const e = new Error('请填写 DOI');
      e.statusCode = 400;
      throw e;
    }
    text = await resolveDoiToText(sourceDoi);
  }
  if (!text.trim()) {
    const e = new Error('正文为空，请提供文本或有效链接');
    e.statusCode = 400;
    throw e;
  }
  const { rows } = await pool.query(
    `INSERT INTO guideline_documents (
       title, source_type, source_url, source_doi, raw_text, uploaded_by
     ) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      title.slice(0, 500),
      st,
      sourceUrl,
      sourceDoi,
      text.slice(0, 500_000),
      uploadedBy,
    ],
  );
  return rows[0];
}

/**
 * @param {string} id
 */
async function generateReadingNote(id) {
  const { rows } = await pool.query(`SELECT * FROM guideline_documents WHERE id = $1`, [id]);
  const doc = rows[0];
  if (!doc) {
    const e = new Error('记录不存在');
    e.statusCode = 404;
    throw e;
  }
  const prevRaw = String(doc.raw_text || '').trim();
  let raw = prevRaw;
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    raw = htmlToPlainText(raw);
  }
  if (raw !== prevRaw && raw.length > 80) {
    await pool.query(
      `UPDATE guideline_documents SET raw_text = $2, updated_at = NOW() WHERE id = $1`,
      [id, raw.slice(0, 500_000)],
    );
  }
  const ai = await AiAnalysisService.generateGuidelineReadingNote(raw, {
    title: doc.title,
  });
  const note = { markdown: ai.content, retrieval: ai.retrieval };
  await pool.query(
    `UPDATE guideline_documents
     SET reading_note = $2::jsonb,
         note_generated_at = NOW(),
         note_model = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [id, note, 'qwen3-max'],
  );
  const { rows: out } = await pool.query(`SELECT * FROM guideline_documents WHERE id = $1`, [id]);
  return out[0];
}

/**
 * @param {number} page
 * @param {number} pageSize
 * @param {string} [query] 模糊匹配指南标题，或已入库知识库文档标题/片段（子串匹配，不含通配符注入）
 */
async function listGuidelines(page = 1, pageSize = 20, query = '') {
  const lim = Math.min(100, Math.max(1, pageSize));
  const off = (Math.max(1, page) - 1) * lim;
  const q = String(query || '').trim().slice(0, 120);

  if (q === '') {
    const { rows: list } = await pool.query(
      `SELECT g.id, g.title, g.source_type, g.source_url, g.source_doi,
              g.reading_note, g.note_generated_at, g.is_saved_to_kb, g.created_at
       FROM guideline_documents g
       ORDER BY g.created_at DESC
       LIMIT $1 OFFSET $2`,
      [lim, off],
    );
    const { rows: c } = await pool.query(`SELECT count(*)::int AS n FROM guideline_documents g`);
    return { list, total: c[0]?.n || 0, page: Math.max(1, page), pageSize: lim };
  }

  const whereSql = `WHERE (
      position(lower($1) in lower(g.title)) > 0
      OR EXISTS (
        SELECT 1 FROM kb_documents d
        WHERE d.id = g.kb_entry_id
          AND (
            position(lower($1) in lower(d.title)) > 0
            OR EXISTS (
              SELECT 1 FROM kb_chunks c
              WHERE c.document_id = d.id
                AND c.content_text IS NOT NULL
                AND position(lower($1) in lower(c.content_text)) > 0
            )
          )
      )
    )`;

  const { rows: list } = await pool.query(
    `SELECT g.id, g.title, g.source_type, g.source_url, g.source_doi,
            g.reading_note, g.note_generated_at, g.is_saved_to_kb, g.created_at
     FROM guideline_documents g
     ${whereSql}
     ORDER BY g.created_at DESC
     LIMIT $2 OFFSET $3`,
    [q, lim, off],
  );
  const { rows: c } = await pool.query(
    `SELECT count(*)::int AS n FROM guideline_documents g ${whereSql}`,
    [q],
  );
  return { list, total: c[0]?.n || 0, page: Math.max(1, page), pageSize: lim };
}

async function getGuideline(id) {
  const { rows } = await pool.query(`SELECT * FROM guideline_documents WHERE id = $1`, [id]);
  return rows[0] || null;
}

/**
 * 将指南原文 raw_text 写入 kb_documents / kb_chunks（需用户在前端确认后调用）
 * 入库正文为文献原文，非 AI 读书笔记（见 hd-ai-clinical SKILL）
 */
/**
 * 供管理员抓取入库：已备好简体中文正文，不再远程拉取
 * @param {object} p
 */
async function createGuidelineFromPreparedContent({
  title,
  docType = 'guideline',
  rawText,
  sourceUrl = null,
  uploadedBy = null,
}) {
  const text = String(rawText || '').trim();
  if (!title || typeof title !== 'string' || !title.trim()) {
    const e = new Error('标题必填');
    e.statusCode = 400;
    throw e;
  }
  if (!text) {
    const e = new Error('正文为空');
    e.statusCode = 400;
    throw e;
  }
  const dt = ['guideline', 'consensus', 'standard'].includes(docType) ? docType : 'guideline';
  const { rows } = await pool.query(
    `INSERT INTO guideline_documents (
       title, doc_type, source_type, source_url, raw_text, uploaded_by
     ) VALUES ($1, $2, 'text_paste', $3, $4, $5)
     RETURNING *`,
    [title.slice(0, 500), dt, sourceUrl, text.slice(0, 500_000), uploadedBy],
  );
  return rows[0];
}

/**
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function findGuidelineBySourceUrl(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  const { rows } = await pool.query(
    `SELECT id FROM guideline_documents WHERE source_url = $1 LIMIT 1`,
    [u],
  );
  return rows[0]?.id || null;
}

async function saveReadingNoteToKb(guidelineId, userId) {
  const doc = await getGuideline(guidelineId);
  if (!doc) {
    const e = new Error('指南文档不存在');
    e.statusCode = 404;
    throw e;
  }
  const raw = String(doc.raw_text || '').trim();
  if (!raw) {
    const e = new Error('无指南原文可入库，请先上传或粘贴正文并完成提取');
    e.statusCode = 400;
    throw e;
  }
  const KnowledgeBaseService = require('./KnowledgeBaseService');
  const r = await KnowledgeBaseService.recordSessionSummary({
    title: `指南原文 · ${doc.title}`.slice(0, 500),
    summaryText: raw.slice(0, 80000),
    tags: 'guideline_note',
    scenario: KnowledgeBaseService.AI_KB_SCENARIO.GUIDELINE_NOTE,
    subcategory: guidelineId,
    userId,
  });
  if (r.saved && r.documentId) {
    await pool.query(
      `UPDATE guideline_documents SET is_saved_to_kb = true, kb_entry_id = $2 WHERE id = $1`,
      [guidelineId, r.documentId],
    );
  }
  return r;
}

/**
 * 删除指南条目；若已写入知识库则删除对应 kb_documents（级联删除 kb_chunks）
 * @param {string} id
 */
async function deleteGuideline(id) {
  const gid = String(id || '').trim();
  if (!gid) {
    const e = new Error('id 无效');
    e.statusCode = 400;
    throw e;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT kb_entry_id FROM guideline_documents WHERE id = $1 FOR UPDATE`,
      [gid],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      const e = new Error('记录不存在');
      e.statusCode = 404;
      throw e;
    }
    const kbId = rows[0].kb_entry_id;
    if (kbId) {
      await client.query(`DELETE FROM kb_documents WHERE id = $1`, [kbId]);
    }
    await client.query(`DELETE FROM guideline_documents WHERE id = $1`, [gid]);
    await client.query('COMMIT');
    return { deleted: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createGuideline,
  createGuidelineFromPreparedContent,
  findGuidelineBySourceUrl,
  generateReadingNote,
  listGuidelines,
  getGuideline,
  saveReadingNoteToKb,
  deleteGuideline,
  fetchUrlText,
  fetchUrlRawHtml,
};
