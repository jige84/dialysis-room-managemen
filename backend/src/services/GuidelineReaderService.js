/**
 * 指南/共识阅读：创建记录、拉取 URL 正文、生成 AI 读书笔记
 */
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { assertPublicHttpUrl } = require('../utils/safeHttpUrl');
const AiAnalysisService = require('./AiAnalysisService');

const MAX_FETCH_BYTES = 800_000;
const FETCH_TIMEOUT_MS = 15000;

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchUrlText(url) {
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
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_FETCH_BYTES) {
      const e = new Error('页面过大，请改用文本粘贴或拆分');
      e.statusCode = 400;
      throw e;
    }
    const text = Buffer.from(buf).toString('utf8');
    return text.replace(/\s+/g, ' ').trim().slice(0, 200_000);
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
  const raw = doc.raw_text || '';
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

async function listGuidelines(page = 1, pageSize = 20) {
  const lim = Math.min(100, Math.max(1, pageSize));
  const off = (Math.max(1, page) - 1) * lim;
  const { rows: list } = await pool.query(
    `SELECT id, title, source_type, source_url, source_doi, note_generated_at, is_saved_to_kb, created_at
     FROM guideline_documents
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [lim, off],
  );
  const { rows: c } = await pool.query(`SELECT count(*)::int AS n FROM guideline_documents`);
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

module.exports = {
  createGuideline,
  generateReadingNote,
  listGuidelines,
  getGuideline,
  saveReadingNoteToKb,
  fetchUrlText,
};
