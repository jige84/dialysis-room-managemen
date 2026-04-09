/**
 * 透析工作台：左侧「今日上机名单」竖列分区列表 + 右侧透析记录录入（Outlet）
 */
import { useEffect, useState, useCallback } from 'react';
import { Outlet, useSearchParams, useNavigate } from 'react-router-dom';
import { Layout, Spin, Alert } from 'antd';
import dayjs from 'dayjs';
import DialysisTodayPatientSidebar from '../../components/DialysisTodayPatientSidebar/DialysisTodayPatientSidebar';
import { scheduleApi, type TodaySchedulePatientRow } from '../../api/schedule';

const { Sider, Content } = Layout;

/** 今日上机名单侧栏宽度（略窄以让右侧录入区更宽） */
const TODAY_LIST_SIDER_WIDTH = 240;

export default function DialysisWorkspace() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<TodaySchedulePatientRow[]>([]);
  const [loading, setLoading] = useState(true);

  /** 每次渲染取当前本地日，与「今日上机名单」语义一致（勿用行内 scheduled_date，避免库内日期与今日差一天） */
  const todayStr = dayjs().format('YYYY-MM-DD');

  const selectedPatientId = searchParams.get('patient_id') ?? '';
  const dateParam = searchParams.get('date') ?? '';
  const selectedScheduleDate = dateParam.length >= 10 ? dateParam.slice(0, 10) : '';

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

  const handleSelectPatient = useCallback((row: TodaySchedulePatientRow) => {
    const dateQs = dayjs().format('YYYY-MM-DD');
    navigate(
      `/dialysis/entry?patient_id=${encodeURIComponent(row.patient_id)}&date=${encodeURIComponent(dateQs)}`,
    );
  }, [navigate]);

  return (
    <Layout
      style={{
        background: 'transparent',
        gap: 16,
        minHeight: 'min(70vh, calc(100vh - 140px))',
      }}
    >
      <Sider
        width={TODAY_LIST_SIDER_WIDTH}
        theme="light"
        style={{
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #EEF2F7',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          flex: `0 0 ${TODAY_LIST_SIDER_WIDTH}px`,
          maxWidth: TODAY_LIST_SIDER_WIDTH,
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: '14px 10px 10px',
            fontWeight: 700,
            fontSize: 14,
            color: '#0D1B3E',
            borderBottom: '1px solid #EEF2F7',
            flexShrink: 0,
          }}
        >
          透析工作台
        </div>
        <div
          style={{
            padding: '10px 10px 8px',
            flexShrink: 0,
            borderBottom: '1px solid #F1F5F9',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>今日上机名单</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
            与排班同步 · 点击姓名在右侧录入
          </div>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            padding: '10px 10px 16px',
          }}
        >
          <Spin spinning={loading}>
            {!loading && rows.length === 0 ? (
              <Alert
                type="info"
                showIcon
                message="今日暂无排班"
                description="请先在「排班管理」中维护今日排班，或通过带患者参数的链接打开录入。"
                style={{ fontSize: 12 }}
              />
            ) : rows.length > 0 ? (
              <DialysisTodayPatientSidebar
                rows={rows}
                headerDateLabel={todayStr}
                onSelectPatient={handleSelectPatient}
                selectedPatientId={selectedPatientId}
                selectedScheduleDate={selectedScheduleDate}
              />
            ) : null}
          </Spin>
        </div>
      </Sider>
      <Content
        style={{
          minWidth: 0,
          flex: 1,
          background: 'transparent',
        }}
      >
        <Outlet />
      </Content>
    </Layout>
  );
}
