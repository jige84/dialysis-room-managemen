/**
 * 带鉴权拉取并展示患者透析知情同意书单张图片
 * GET /api/patients/:id/consent-dialysis-image/:index（index 默认 0）
 */
import { useEffect, useState } from 'react';
import { Image, Spin } from 'antd';
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

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const token = localStorage.getItem('hd_token');
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/patients/${patientId}/consent-dialysis-image/${index}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
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
        影像暂不可预览
      </div>
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
