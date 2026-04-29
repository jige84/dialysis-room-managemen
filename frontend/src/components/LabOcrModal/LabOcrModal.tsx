/**
 * 化验单拍照/上传 → OCR 识别 → 解析 → 自动分析 → 批量录入检验结果
 * 说明：浏览器端 Tesseract 识别，准确度受拍照质量影响；录入前必须人工核对。
 */
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Modal,
  Upload,
  Button,
  Table,
  Select,
  DatePicker,
  Progress,
  Alert,
  Space,
  InputNumber,
  Slider,
  Typography,
  Tag,
  message,
  Checkbox,
} from 'antd';
import {
  CameraOutlined,
  CloudUploadOutlined,
  ScanOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import dayjs from 'dayjs';
import labsApi from '../../api/labs';
import { patientsApi, type Patient } from '../../api/patients';
import { useAuthStore } from '../../stores/authStore';
import {
  analyzeLabValue,
  extractReportDate,
  formatReferenceRange,
  getCategoryForTestType,
  isLikelyLegibleLabOcrText,
  parseLabReportText,
  requiresSampleTiming,
  type ParsedLabLine,
  type LabStatusUi,
} from '../../utils/labReportOcr';
import {
  defaultAutoRotationDegrees,
  getImageNaturalSize,
  preprocessForOcr,
  rotateForPreview,
} from '../../utils/imageRotateForOcr';

const { Text, Paragraph } = Typography;

const STATUS_TAG: Record<LabStatusUi, { color: string; label: string }> = {
  normal: { color: 'success', label: '正常' },
  high: { color: 'warning', label: '偏高' },
  low: { color: 'processing', label: '偏低' },
  critical: { color: 'error', label: '危急值' },
};

const SAMPLE_TIMING_NOTE_PREFIX = '[透析时点]';
const SAMPLE_TIMING_OPTIONS = [
  { value: 'pre', label: '透前' },
  { value: 'post', label: '透后' },
] as const;

export interface LabOcrModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface RowItem extends ParsedLabLine {
  key: string;
  category: string;
  range: string;
  status: LabStatusUi;
  summary: string;
  sampleTiming?: 'pre' | 'post';
}

function buildRows(lines: ParsedLabLine[]): RowItem[] {
  return lines.map((line, i) => {
    const { status, summary } = analyzeLabValue(line.test_type, line.value);
    return {
      ...line,
      key: `${line.test_type}-${i}`,
      category: getCategoryForTestType(line.test_type),
      range: formatReferenceRange(line.test_type),
      status,
      summary,
    };
  });
}

function loadImageFromSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

type NaturalRect = { x: number; y: number; width: number; height: number };

async function getCroppedBlobFromNaturalRect(src: string, rect: NaturalRect): Promise<Blob> {
  const img = await loadImageFromSrc(src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 Canvas 上下文');

  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) return reject(new Error('图片编码失败'));
      resolve(b);
    }, 'image/png');
  });

  return blob;
}

export default function LabOcrModal({ open, onClose, onSaved }: LabOcrModalProps) {
  const hasWrite = useAuthStore((s) =>
    s.hasRole(['admin', 'doctor', 'head_nurse'])
  );

  const originalFileRef = useRef<File | null>(null);

  const [patientList, setPatientList] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState<string | undefined>();
  const [testDate, setTestDate] = useState(dayjs());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [rawText, setRawText] = useState('');
  const [rows, setRows] = useState<RowItem[]>([]);
  const [saving, setSaving] = useState(false);
  /** 相对原图的累计旋转角度（度），负值=逆时针 */
  const [rotationDeg, setRotationDeg] = useState(0);
  const [rotationDraftDeg, setRotationDraftDeg] = useState(0);
  /** 竖拍横向化验单时自动逆时针 90° 转正 */
  const [autoRotatePortrait, setAutoRotatePortrait] = useState(true);

  type RoiRect = { x: number; y: number; width: number; height: number }; // 相对于预览容器左上角（display 坐标）
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [roi, setRoi] = useState<RoiRect | null>(null);
  const roiDragRef = useRef<
    | null
    | {
        mode: 'draw' | 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se';
        startClient: { x: number; y: number };
        startRoi: RoiRect;
      }
  >(null);

  const ROI_MIN_SIZE_PX = 20;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await patientsApi.list({ page: 1, page_size: 500, status: 'active' });
        const rows = res.data?.data?.list;
        if (!cancelled && Array.isArray(rows)) setPatientList(rows);
      } catch {
        message.error('加载患者列表失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const resetState = () => {
    originalFileRef.current = null;
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setOcrProgress(0);
    setRawText('');
    setRows([]);
    setPatientId(undefined);
    setTestDate(dayjs());
    setRotationDeg(0);
    setRotationDraftDeg(0);
    setRoi(null);
    setImageNaturalSize(null);
    roiDragRef.current = null;
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  /** 送 OCR：旋转 + 灰度增强放大 → Tesseract */
  const runRecognize = async (originalFile: File | Blob, deg: number) => {
    setOcrBusy(true);
    setOcrProgress(0);
    setRawText('');
    setRows([]);
    try {
      const { createWorker, PSM } = await import('tesseract.js');

      const ocrBlob = await preprocessForOcr(originalFile, deg);

      const worker = await createWorker('chi_sim+eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setOcrProgress(Math.round((m.progress ?? 0) * 100));
          }
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });
      const {
        data: { text },
      } = await worker.recognize(ocrBlob);
      await worker.terminate();

      setRawText(text);

      const legible = isLikelyLegibleLabOcrText(text);
      if (!legible) {
        message.warning(
          '识别文字质量较低，请尝试调整旋转角度（使文字横平竖直）后点「重新识别」，或重新拍摄一张更清晰的照片。'
        );
      }

      const parsed = parseLabReportText(text);
      if (parsed.length === 0) {
        if (legible) {
          message.info('未能自动提取检验数值，可手动在下方添加或录入');
        }
      } else {
        message.success(`已识别 ${parsed.length} 项指标，请核对后保存`);
      }
      const dateGuess = extractReportDate(text);
      if (dateGuess) {
        const d = dayjs(dateGuess);
        if (d.isValid()) setTestDate(d);
      }
      setRows(buildRows(parsed));
    } catch (e) {
      console.error(e);
      message.error('识别失败，请换一张清晰照片重试');
    } finally {
      setOcrBusy(false);
      setOcrProgress(0);
    }
  };

  /** 更新彩色预览，然后可选开始识别 */
  const applyRotationPreviewAndRecognize = async (file: File, deg: number, runOcr = true) => {
    setRotationDeg(deg);
    setRotationDraftDeg(deg);
    // 旋转后 ROI 坐标需要重置，避免坐标系错位
    setRoi(null);
    roiDragRef.current = null;
    setImageNaturalSize(null);
    const previewBlob = await rotateForPreview(file, deg);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(previewBlob);
    });
    if (runOcr) {
      await runRecognize(file, deg);
    }
  };

  const onFileChange = async (file: UploadFile | File) => {
    const origin = file instanceof File ? file : file.originFileObj;
    if (!origin) return;
    originalFileRef.current = origin;
    try {
      const { width, height } = await getImageNaturalSize(origin);
      const auto = autoRotatePortrait ? defaultAutoRotationDegrees(width, height) : 0;
      await applyRotationPreviewAndRecognize(origin, auto);
    } catch {
      message.error('无法读取图片');
    }
  };

  const handleRotateBy = async (deltaDeg: number) => {
    const f = originalFileRef.current;
    if (!f) return;
    const next = rotationDeg + deltaDeg;
    setAutoRotatePortrait(false);
    // 旋转只更新预览与 ROI，不立即触发全图 OCR（避免频繁重识别）
    await applyRotationPreviewAndRecognize(f, next, false);
  };

  const handleResetAutoRotation = async (useAutoRotate?: boolean) => {
    const f = originalFileRef.current;
    if (!f) return;
    try {
      const { width, height } = await getImageNaturalSize(f);
      const flag = useAutoRotate ?? autoRotatePortrait;
      const auto = flag ? defaultAutoRotationDegrees(width, height) : 0;
      await applyRotationPreviewAndRecognize(f, auto, false);
    } catch {
      message.error('无法读取图片');
    }
  };

  const handleReRecognize = async () => {
    const f = originalFileRef.current;
    if (!f) return;
    await runRecognize(f, rotationDeg);
  };

  const handleCropRecognize = async () => {
    if (!previewUrl) {
      message.warning('请先上传图片');
      return;
    }
    if (!roi) {
      message.warning('请先在预览框拖拽选择要识别的区域');
      return;
    }
    const containerEl = previewContainerRef.current;
    const imgEl = previewImgRef.current;
    if (!containerEl || !imgEl || !imageNaturalSize) {
      message.warning('获取预览图片信息失败，请重试');
      return;
    }
    const containerRect = containerEl.getBoundingClientRect();
    const imgRect = imgEl.getBoundingClientRect();
    const imgOffsetLeft = imgRect.left - containerRect.left;
    const imgOffsetTop = imgRect.top - containerRect.top;
    const imgDisplayW = Math.max(1, imgRect.width);
    const imgDisplayH = Math.max(1, imgRect.height);

    const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
    const xNat = clamp(((roi.x - imgOffsetLeft) / imgDisplayW) * imageNaturalSize.width, 0, imageNaturalSize.width - 1);
    const yNat = clamp(((roi.y - imgOffsetTop) / imgDisplayH) * imageNaturalSize.height, 0, imageNaturalSize.height - 1);
    const wNat = clamp((roi.width / imgDisplayW) * imageNaturalSize.width, 1, imageNaturalSize.width);
    const hNat = clamp((roi.height / imgDisplayH) * imageNaturalSize.height, 1, imageNaturalSize.height);

    try {
      setOcrBusy(true);
      setOcrProgress(0);
      setRawText('');
      setRows([]);

      const croppedBlob = await getCroppedBlobFromNaturalRect(previewUrl, {
        x: xNat,
        y: yNat,
        width: wNat,
        height: hNat,
      });
      await runRecognize(croppedBlob, 0);
    } catch (e) {
      console.error(e);
      message.error('裁剪区域识别失败，请重试');
      setOcrBusy(false);
    }
  };

  const getImageRectInContainer = () => {
    const containerEl = previewContainerRef.current;
    const imgEl = previewImgRef.current;
    if (!containerEl || !imgEl) return null;
    const containerRect = containerEl.getBoundingClientRect();
    const imgRect = imgEl.getBoundingClientRect();
    return {
      left: imgRect.left - containerRect.left,
      top: imgRect.top - containerRect.top,
      width: imgRect.width,
      height: imgRect.height,
    };
  };

  const pointInRect = (p: { x: number; y: number }, r: RoiRect) => {
    return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  };

  const clampRoiToImageRect = (next: RoiRect, imgRect: { left: number; top: number; width: number; height: number }): RoiRect => {
    const imgLeft = imgRect.left;
    const imgTop = imgRect.top;
    const imgRight = imgRect.left + imgRect.width;
    const imgBottom = imgRect.top + imgRect.height;

    let x = next.x;
    let y = next.y;
    let w = next.width;
    let h = next.height;

    // 最小尺寸
    w = Math.max(ROI_MIN_SIZE_PX, w);
    h = Math.max(ROI_MIN_SIZE_PX, h);

    // 限制到图片边界
    if (x < imgLeft) {
      w -= imgLeft - x;
      x = imgLeft;
    }
    if (y < imgTop) {
      h -= imgTop - y;
      y = imgTop;
    }
    if (x + w > imgRight) w = imgRight - x;
    if (y + h > imgBottom) h = imgBottom - y;

    // 若被裁剪后小于最小值，尽量回推并再限制
    w = Math.max(ROI_MIN_SIZE_PX, w);
    h = Math.max(ROI_MIN_SIZE_PX, h);
    x = Math.min(imgRight - w, Math.max(imgLeft, x));
    y = Math.min(imgBottom - h, Math.max(imgTop, y));

    return { x, y, width: w, height: h };
  };

  const getClientPointInContainer = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const containerEl = previewContainerRef.current;
    if (!containerEl) return null;
    const containerRect = containerEl.getBoundingClientRect();
    return { x: e.clientX - containerRect.left, y: e.clientY - containerRect.top };
  };

  const beginRoiDrag = (mode: 'draw' | 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se', startClient: { x: number; y: number }, startRoi: RoiRect) => {
    roiDragRef.current = { mode, startClient, startRoi };

    const onMove = (ev: MouseEvent) => {
      const p = getClientPointInContainer(ev);
      const containerEl = previewContainerRef.current;
      if (!p || !containerEl || !roiDragRef.current) return;

      const imgRect = getImageRectInContainer();
      if (!imgRect) return;

      const { mode: dragMode, startClient: s, startRoi: sr } = roiDragRef.current;
      const dx = p.x - s.x;
      const dy = p.y - s.y;

      const calc = (): RoiRect => {
        if (dragMode === 'draw') {
          const x = Math.min(s.x, p.x);
          const y = Math.min(s.y, p.y);
          return { x, y, width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) };
        }
        if (dragMode === 'move') {
          return { x: sr.x + dx, y: sr.y + dy, width: sr.width, height: sr.height };
        }
        if (dragMode === 'resize-se') {
          return { x: sr.x, y: sr.y, width: sr.width + dx, height: sr.height + dy };
        }
        if (dragMode === 'resize-nw') {
          return { x: sr.x + dx, y: sr.y + dy, width: sr.width - dx, height: sr.height - dy };
        }
        if (dragMode === 'resize-ne') {
          return { x: sr.x, y: sr.y + dy, width: sr.width + dx, height: sr.height - dy };
        }
        // resize-sw
        return { x: sr.x + dx, y: sr.y, width: sr.width - dx, height: sr.height + dy };
      };

      const next = calc();
      setRoi(clampRoiToImageRect(next, imgRect));
    };

    const onUp = () => {
      roiDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handlePreviewMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (ocrBusy) return;
    const p = getClientPointInContainer(e);
    if (!p) return;
    const imgRect = getImageRectInContainer();
    if (!imgRect) return;
    const imgRoi: RoiRect = { x: imgRect.left, y: imgRect.top, width: imgRect.width, height: imgRect.height };
    if (!pointInRect(p, imgRoi)) return;

    // 点击在已有 ROI 内：拖动移动；否则开始绘制
    if (roi && pointInRect(p, roi)) {
      beginRoiDrag('move', p, roi);
      return;
    }
    const start: RoiRect = { x: p.x, y: p.y, width: 1, height: 1 };
    beginRoiDrag('draw', p, start);
  };

  const startResizeFromHandle = (mode: 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se') =>
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (ocrBusy) return;
      if (!roi) return;
      const p = getClientPointInContainer(e);
      if (!p) return;
      beginRoiDrag(mode, p, roi);
    };

  const updateRowValue = (key: string, value: number | null) => {
    if (value === null) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const { status, summary } = analyzeLabValue(r.test_type, value);
        return { ...r, value, status, summary };
      })
    );
  };

  const updateRowTiming = (key: string, sampleTiming: 'pre' | 'post') => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, sampleTiming } : r)));
  };

  const handleSave = async () => {
    if (!patientId) {
      message.warning('请选择患者');
      return;
    }
    if (rows.length === 0) {
      message.warning('没有可保存的检验项');
      return;
    }
    const missingTiming = rows.find((r) => requiresSampleTiming(r.test_type) && !r.sampleTiming);
    if (missingTiming) {
      message.warning(`${missingTiming.label} 请选择透前或透后`);
      return;
    }
    const dateStr = testDate.format('YYYY-MM-DD');
    setSaving(true);
    try {
      const payload = rows.map((r) => ({
        test_type: r.test_type,
        value: r.value,
        unit: r.unit,
        test_date: dateStr,
        notes: r.sampleTiming
          ? `${SAMPLE_TIMING_NOTE_PREFIX} ${r.sampleTiming}`
          : '来源：化验单拍照识别（已人工核对）',
      }));
      await labsApi.add(patientId, payload);
      message.success('检验结果已保存');
      onSaved?.();
      handleClose();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { title: '类别', dataIndex: 'category', width: 100 },
    { title: '项目', dataIndex: 'label', width: 120 },
    {
      title: '结果值',
      width: 120,
      render: (_: unknown, r: RowItem) => (
        <InputNumber
          size="small"
          value={r.value}
          onChange={(v) => updateRowValue(r.key, v)}
          style={{ width: '100%' }}
        />
      ),
    },
    { title: '单位', dataIndex: 'unit', width: 72 },
    {
      title: '生化时点',
      width: 110,
      render: (_: unknown, r: RowItem) =>
        requiresSampleTiming(r.test_type) ? (
          <Select
            size="small"
            value={r.sampleTiming}
            options={[...SAMPLE_TIMING_OPTIONS]}
            placeholder="透前/透后"
            onChange={(v) => updateRowTiming(r.key, v)}
            style={{ width: '100%' }}
          />
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    { title: '参考范围', dataIndex: 'range', width: 130 },
    {
      title: '自动分析',
      width: 200,
      render: (_: unknown, r: RowItem) => (
        <Space direction="vertical" size={0}>
          <Tag color={STATUS_TAG[r.status].color}>{STATUS_TAG[r.status].label}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.summary}
          </Text>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <ScanOutlined />
          <span>化验单拍照识别录入</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={960}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          关闭
        </Button>,
        ...(hasWrite
          ? [
              <Button
                key="save"
                type="primary"
                icon={<SaveOutlined />}
                loading={saving}
                disabled={rows.length === 0 || !patientId}
                onClick={() => void handleSave()}
              >
                确认录入
              </Button>,
            ]
          : []),
      ]}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="使用说明"
        description={
          <>
            拍摄要点：化验单<Text strong>平整铺放、正面光线均匀</Text>，整页清晰入镜；
            竖拍横向化验单会自动逆时针 90° 转正再识别，如方向仍不对请点「逆时针/顺时针 90°」调整。
            系统会自动放大并增强对比度后送 OCR，<Text strong>识别结果请与纸质报告核对</Text>。
          </>
        }
      />

      {!hasWrite && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="当前账号无检验录入权限，仅可预览识别结果。" />
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="选择患者（必填）"
          style={{ width: 260 }}
          value={patientId}
          onChange={setPatientId}
          showSearch
          optionFilterProp="label"
          options={patientList.map((p) => ({
            value: p.id,
            label: `${p.name}（${p.gender === 'F' ? '女' : '男'}）`,
          }))}
        />
        <DatePicker value={testDate} onChange={(d) => d && setTestDate(d)} />
      </Space>

      <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            上传化验单图片
          </Text>
          <Space align="center" wrap>
            <Upload
              accept="image/*"
              maxCount={1}
              showUploadList={false}
              beforeUpload={(file) => {
                void onFileChange(file);
                return false;
              }}
            >
              <Button icon={<CloudUploadOutlined />}>选择图片</Button>
            </Upload>
            <label
              className="ant-btn ant-btn-default"
              style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', height: 32, paddingInline: 15 }}
            >
              <CameraOutlined />
              拍照
              <input
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  ev.target.value = '';
                  if (!file) return;
                  void onFileChange(file);
                }}
              />
            </label>
          </Space>
          <div style={{ marginTop: 12 }}>
            <Checkbox
              checked={autoRotatePortrait}
              onChange={(e) => {
                const v = e.target.checked;
                setAutoRotatePortrait(v);
                if (originalFileRef.current) {
                  void handleResetAutoRotation(v);
                }
              }}
            >
              竖拍横向单时自动转正（高大于宽时逆时针 90°）
            </Checkbox>
          </div>
          <Space wrap style={{ marginTop: 10 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前旋转：{rotationDeg}°（相对原图）
            </Text>
            <div style={{ width: 320 }}>
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
                手动旋转（自由角度，松开后生效）：{rotationDraftDeg}°
              </Text>
              <Slider
                min={-180}
                max={180}
                step={1}
                value={rotationDraftDeg}
                disabled={!originalFileRef.current || ocrBusy}
                onChange={(v) => setRotationDraftDeg(Array.isArray(v) ? v[0] : v)}
                onAfterChange={(v) => {
                  const f = originalFileRef.current;
                  if (!f) return;
                  setAutoRotatePortrait(false);
                  void applyRotationPreviewAndRecognize(f, Array.isArray(v) ? v[0] : v, false);
                }}
              />
            </div>
            <Button size="small" disabled={!originalFileRef.current || ocrBusy} onClick={() => void handleRotateBy(-90)}>
              逆时针 90°
            </Button>
            <Button size="small" disabled={!originalFileRef.current || ocrBusy} onClick={() => void handleRotateBy(90)}>
              顺时针 90°
            </Button>
            <Button
              size="small"
              disabled={!originalFileRef.current || ocrBusy}
              onClick={() => void handleResetAutoRotation()}
            >
              按选项重新自动转正
            </Button>
            <Button
              size="small"
              type="primary"
              ghost
              disabled={!originalFileRef.current || ocrBusy}
              onClick={() => void handleReRecognize()}
            >
              重新识别
            </Button>
          </Space>
          {ocrBusy && (
            <div style={{ marginTop: 12 }}>
              <Progress percent={ocrProgress} status="active" />
              <Text type="secondary">正在识别文字（首次使用需加载语言包，请稍候）…</Text>
            </div>
          )}
        </div>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            预览
          </Text>
          {previewUrl ? (
            <>
              <div
                ref={previewContainerRef}
                style={{
                  height: 220,
                  width: '100%',
                  position: 'relative',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: '#fff',
                  userSelect: 'none',
                  touchAction: 'none',
                }}
                onMouseDown={handlePreviewMouseDown}
              >
                <img
                  ref={previewImgRef}
                  src={previewUrl}
                  alt="化验单预览"
                  style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', margin: 'auto' }}
                  onLoad={() => {
                    const imgEl = previewImgRef.current;
                    if (!imgEl) return;
                    setImageNaturalSize({ width: imgEl.naturalWidth, height: imgEl.naturalHeight });
                    requestAnimationFrame(() => {
                      const imgRect = getImageRectInContainer();
                      if (!imgRect) return;
                      setRoi({ x: imgRect.left, y: imgRect.top, width: imgRect.width, height: imgRect.height });
                    });
                  }}
                />
                {roi && (
                  <div
                    style={{
                      position: 'absolute',
                      left: roi.x,
                      top: roi.y,
                      width: roi.width,
                      height: roi.height,
                      border: '2px solid #2563EB',
                      boxSizing: 'border-box',
                      background: 'rgba(37, 99, 235, 0.08)',
                    }}
                  >
                    {/* 四角缩放手柄（宽高可独立调整） */}
                    <div
                      style={{ position: 'absolute', left: -5, top: -5, width: 10, height: 10, background: '#fff', border: '2px solid #2563EB', borderRadius: 2, cursor: 'nw-resize' }}
                      onMouseDown={startResizeFromHandle('resize-nw')}
                    />
                    <div
                      style={{ position: 'absolute', right: -5, top: -5, width: 10, height: 10, background: '#fff', border: '2px solid #2563EB', borderRadius: 2, cursor: 'ne-resize' }}
                      onMouseDown={startResizeFromHandle('resize-ne')}
                    />
                    <div
                      style={{ position: 'absolute', left: -5, bottom: -5, width: 10, height: 10, background: '#fff', border: '2px solid #2563EB', borderRadius: 2, cursor: 'sw-resize' }}
                      onMouseDown={startResizeFromHandle('resize-sw')}
                    />
                    <div
                      style={{ position: 'absolute', right: -5, bottom: -5, width: 10, height: 10, background: '#fff', border: '2px solid #2563EB', borderRadius: 2, cursor: 'se-resize' }}
                      onMouseDown={startResizeFromHandle('resize-se')}
                    />
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10 }}>
                <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
                  拖拽选择区域；拖拽四角可独立调整高和宽
                </Text>
                <Button
                  size="small"
                  type="primary"
                  icon={<ScanOutlined />}
                  disabled={ocrBusy || !roi}
                  onClick={() => void handleCropRecognize()}
                >
                  识别当前裁剪区域
                </Button>
              </div>
            </>
          ) : (
            <div
              style={{
                height: 160,
                border: '1px dashed #cbd5e1',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
              }}
            >
              暂无图片
            </div>
          )}
        </div>
      </div>

      {rawText && (
        <>
          <Paragraph type="secondary" style={{ marginBottom: 8 }}>
            <Text strong>识别原文（可对照核对）</Text>
          </Paragraph>
          <pre
            style={{
              maxHeight: 140,
              overflow: 'auto',
              fontSize: 12,
              padding: 12,
              background: '#f8fafc',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
            }}
          >
            {rawText}
          </pre>
        </>
      )}

      {rows.length > 0 && (
        <>
          <Text strong style={{ display: 'block', margin: '16px 0 8px' }}>
            解析结果与自动分析
          </Text>
          <Table
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 800 }}
          />
        </>
      )}
    </Modal>
  );
}
