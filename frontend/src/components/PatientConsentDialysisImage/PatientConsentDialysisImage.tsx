/**
 * 带鉴权拉取并展示患者透析知情同意书单张图片
 * GET /api/patients/:id/consent-dialysis-image/:index（index 默认 0）
 */
import { useEffect, useState } from 'react';
import { Spin } from 'antd';
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

  if (loading) return <Spin size="small" />;
  if (failed || !src) return null;
  return (
    <img
      src={src}
      alt={`透析知情同意书 ${index + 1}`}
      style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, border: '1px solid #E2E8F0' }}
    />
  );
}
