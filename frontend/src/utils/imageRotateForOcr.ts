/**
 * 化验单拍照常见情况：横向 A4 竖持手机拍摄 → 画面为「竖图」、文字相对画面旋转 90°。
 * 在送 OCR 前用画布转正，可显著提升 Tesseract 识别率。
 */

const OCR_MIN_LONG_SIDE_PX = 2400;
const OCR_CONTRAST = 1.6;

/**
 * OCR 预处理流水线：
 *   1. 旋转（degreesClockwise，0 表示不旋转）
 *   2. 放大（长边小于 OCR_MIN_LONG_SIDE_PX 时等比放大）
 *   3. 灰度化 + 对比度增强
 * 输出 PNG（无损），送给 Tesseract 效果最佳。
 */
function processOnCanvas(
  img: HTMLImageElement,
  degreesClockwise: number,
  onCanvas: (canvas: HTMLCanvasElement) => void
) {
  const normalizedDeg = ((degreesClockwise % 360) + 360) % 360;
  const rad = (normalizedDeg * Math.PI) / 180;
  const swap = normalizedDeg === 90 || normalizedDeg === 270;

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  let rotW = swap ? srcH : srcW;
  let rotH = swap ? srcW : srcH;

  const longer = Math.max(rotW, rotH);
  const scale = longer < OCR_MIN_LONG_SIDE_PX ? OCR_MIN_LONG_SIDE_PX / longer : 1;
  const cw = Math.round(rotW * scale);
  const ch = Math.round(rotH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;

  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(rad);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -srcW / 2, -srcH / 2);
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, cw, ch);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const c = Math.min(255, Math.max(0, (gray - 128) * OCR_CONTRAST + 128));
    d[i] = d[i + 1] = d[i + 2] = c;
  }
  ctx.putImageData(imageData, 0, 0);

  onCanvas(canvas);
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('图片编码失败'))),
      'image/png',
      1
    );
  });
}

/** 顺时针角度（度），负值表示逆时针 */
export async function rotateImageFile(file: File | Blob, degreesClockwise: number): Promise<Blob> {
  const normalized = ((degreesClockwise % 360) + 360) % 360;
  if (normalized === 0 && file.size < 10 * 1024 * 1024) {
    return file;
  }
  const img = await loadImage(file);
  return new Promise((resolve, reject) => {
    try {
      processOnCanvas(img, degreesClockwise, async (canvas) => {
        try {
          resolve(await canvasToBlob(canvas));
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 旋转 + 灰度 + 对比度增强 + 放大 → OCR 专用 PNG。
 * 这是送 Tesseract 前必须调用的函数。
 */
export async function preprocessForOcr(file: File | Blob, degreesClockwise: number): Promise<Blob> {
  const img = await loadImage(file);
  return new Promise((resolve, reject) => {
    try {
      processOnCanvas(img, degreesClockwise, async (canvas) => {
        try {
          resolve(await canvasToBlob(canvas));
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/** 只用于生成预览（不做灰度处理，保持彩色） */
export async function rotateForPreview(file: File | Blob, degreesClockwise: number): Promise<Blob> {
  const normalized = ((degreesClockwise % 360) + 360) % 360;
  const img = await loadImage(file);
  return new Promise((resolve, reject) => {
    try {
      const swap = normalized === 90 || normalized === 270;
      const rad = (normalized * Math.PI) / 180;
      const cw = swap ? img.naturalHeight : img.naturalWidth;
      const ch = swap ? img.naturalWidth : img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      void canvasToBlob(canvas).then(resolve).catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 竖拍（高度大于宽度）时，默认按「横向单据竖拍」做一次逆时针 90°（即画布顺时针 270°）。
 * 若仍不对，用户可在界面点旋转按钮微调。
 */
export function defaultAutoRotationDegrees(naturalWidth: number, naturalHeight: number): number {
  if (naturalHeight > naturalWidth * 1.02) {
    return -90;
  }
  return 0;
}

export function getImageNaturalSize(file: File | Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片尺寸'));
    };
    img.src = url;
  });
}
