/**
 * 患者透析知情同意书图片上传（multer）
 * 主要作用：限制类型与大小，按患者 ID 分目录落盘。
 */
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads/patient-consents');
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 5 * 1024 * 1024;

function ensurePatientDir(patientId) {
  const dir = path.join(UPLOAD_ROOT, patientId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeExt(mimetype) {
  const m = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return m[mimetype] || '';
}

function createPatientConsentUploader() {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const patientId = req.params.id;
        if (!patientId) {
          cb(new Error('缺少患者ID'));
          return;
        }
        const dir = ensurePatientDir(patientId);
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      const ext = safeExt(file.mimetype) || path.extname(file.originalname || '').slice(0, 8) || '.jpg';
      cb(null, `${uuidv4()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_BYTES },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        cb(new Error('仅支持 JPG、PNG、WebP、GIF 图片'));
        return;
      }
      cb(null, true);
    },
  });
}

module.exports = {
  createPatientConsentUploader,
  UPLOAD_ROOT,
  ALLOWED_MIME,
  MAX_BYTES,
};
