/**
 * 带鉴权拉取并展示患者透析知情同意书单张图片
 * GET /api/patients/:id/consent-dialysis-image/:index（index 默认 0）
 */
import { useEffect, useState } from 'react';
import { Image, Spin, Tooltip } from 'antd';
import { getApiBaseUrl } from '../../config/apiBaseUrl';

type Props = {
  patientId: string;
  /** 第几张，从 0 开始 */
  index?: number;
};

export default function PatientConsentDialysisImage({ patientId, index = 0 }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [errorText, setErrorText] = useState('影像暂不可预览');

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const token = localStorage.getItem('hd_token');
    (async () => {
      setLoading(true);
      setFailed(false);
      setErrorText('影像暂不可预览');
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/patients/${patientId}/consent-dialysis-image/${index}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok) {
          const fallback = res.status === 404 ? '影像文件未找到' : '影像加载失败';
          let messageText = fallback;
          try {
            const body = await res.json();
            if (typeof body?.message === 'string' && body.message.trim()) {
              messageText = body.message.trim();
            }
          } catch {
            /* 非 JSON 响应时使用默认提示 */
          }
          if (!cancelled) {
            setErrorText(messageText);
            setFailed(true);
          }
          return;
        }
        const blob = await res.blob();
        if (!blob.type.startsWith('image/')) {
          throw new Error('接口未返回图片内容');
        }
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch (err) {
        if (!cancelled) {
          setErrorText(err instanceof Error ? err.message : '影像加载失败');
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [patientId, index]);

  if (loading) {
    return (
      <div
        style={{
          width: 112,
          height: 84,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: '1px solid #E2E8F0',
          background: '#F8FAFC',
        }}
      >
        <Spin size="small" />
      </div>
    );
  }
  if (failed || !src) {
    return (
      <Tooltip title={errorText}>
        <div
          style={{
            width: 112,
            height: 84,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 8,
            borderRadius: 8,
            border: '1px dashed #CBD5E1',
            background: '#F8FAFC',
            color: '#94A3B8',
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          {errorText}
        </div>
      </Tooltip>
    );
  }
  return (
    <Image
      width={112}
      height={84}
      src={src}
      alt={`透析知情同意书 ${index + 1}`}
      style={{
        objectFit: 'cover',
        borderRadius: 8,
        border: '1px solid #E2E8F0',
        background: '#F8FAFC',
      }}
      preview={{
        src,
        mask: '查看原图',
      }}
    />
  );
}
