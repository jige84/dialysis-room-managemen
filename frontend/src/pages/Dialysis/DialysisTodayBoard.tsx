/**
 * 今日上机名单：展示当日排班透析患者，点击卡片进入透析记录录入详情
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { Button, Spin, Alert } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import DialysisTodayPatientGrid from '../../components/DialysisTodayPatientGrid/DialysisTodayPatientGrid';
import { scheduleApi, type TodaySchedulePatientRow } from '../../api/schedule';

export default function DialysisTodayBoardPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TodaySchedulePatientRow[]>([]);
  const [loading, setLoading] = useState(true);

  const todayStr = useMemo(() => dayjs().format('YYYY-MM-DD'), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await scheduleApi.getToday();
        if (!cancelled) setRows(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectPatient = useCallback(
    (row: TodaySchedulePatientRow) => {
      const raw = row.scheduled_date != null ? String(row.scheduled_date) : '';
      const d = raw.length >= 10 ? raw.slice(0, 10) : '';
      const dateQs = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayStr;
      navigate(
        `/dialysis/entry?patient_id=${encodeURIComponent(row.patient_id)}&date=${encodeURIComponent(dateQs)}`,
      );
    },
    [navigate, todayStr],
  );

  return (
    <PageShell fullWidth>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: '1px solid #EEF2F7',
        }}
      >
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} size="small">
          返回
        </Button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: '#0D1B3E' }}>今日上机名单</div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
            与排班管理同步 · 选择患者后进入透析记录录入（录入页支持临时保存，换患者后再返回可继续编辑）
          </div>
        </div>
      </div>

      <Spin spinning={loading}>
        {!loading && rows.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message="今日暂无排班患者"
            description="请先在「排班管理」中生成或调整今日排班，或从其他入口使用带患者参数的链接进入录入页。"
            style={{ marginBottom: 16 }}
          />
        ) : rows.length > 0 ? (
          <DialysisTodayPatientGrid
            rows={rows}
            headerDateLabel={todayStr}
            onSelectPatient={handleSelectPatient}
          />
        ) : null}
      </Spin>
    </PageShell>
  );
}
