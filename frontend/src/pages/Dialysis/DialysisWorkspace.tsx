/**
 * 透析工作台：左侧「今日上机名单」竖列分区列表 + 右侧透析记录录入（Outlet）
 */
import { useEffect, useState, useCallback } from 'react';
import { Outlet, useSearchParams, useNavigate } from 'react-router-dom';
import { Layout, Spin, Alert, Tooltip } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import DialysisTodayPatientSidebar from '../../components/DialysisTodayPatientSidebar/DialysisTodayPatientSidebar';
import { scheduleApi, type TodaySchedulePatientRow } from '../../api/schedule';

const { Sider, Content } = Layout;

/** 今日上机名单侧栏宽度（略窄以让右侧录入区更宽；与处方工作台保持一致） */
const TODAY_LIST_SIDER_WIDTH = 192;
const SIDER_COLLAPSED_WIDTH = 32;

export default function DialysisWorkspace() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<TodaySchedulePatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [siderCollapsed, setSiderCollapsed] = useState(false);

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
        gap: 12,
        minHeight: 'min(70vh, calc(100vh - 140px))',
      }}
    >
      <Sider
        width={TODAY_LIST_SIDER_WIDTH}
        collapsedWidth={SIDER_COLLAPSED_WIDTH}
        collapsed={siderCollapsed}
        trigger={null}
        theme="light"
        style={{
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #EEF2F7',
          overflow: 'hidden',
          minHeight: 0,
          transition: 'width 0.22s ease',
        }}
      >
        {siderCollapsed ? (
          /* ── 折叠态：只显示展开箭头 + 竖向标签 ── */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              paddingTop: 14,
              gap: 12,
              height: '100%',
            }}
          >
            <Tooltip title="展开名单" placement="right">
              <button
                type="button"
                onClick={() => setSiderCollapsed(false)}
                className="hd-workspace-collapse-toggle"
              >
                <RightOutlined />
              </button>
            </Tooltip>
            <div
              style={{
                writingMode: 'vertical-rl',
                fontSize: 11,
                color: '#94a3b8',
                letterSpacing: 3,
                userSelect: 'none',
              }}
            >
              今日上机
            </div>
          </div>
        ) : (
          /* ── 展开态：完整内容 ── */
          <>
            <div
              style={{
                padding: '11px 10px 10px',
                fontWeight: 700,
                fontSize: 13,
                color: '#0D1B3E',
                borderBottom: '1px solid #EEF2F7',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>透析工作台</span>
              <Tooltip title="收起名单" placement="right">
                <button
                  type="button"
                  onClick={() => setSiderCollapsed(true)}
                  className="hd-workspace-collapse-toggle"
                >
                  <LeftOutlined />
                </button>
              </Tooltip>
            </div>
            <div
              style={{
                padding: '8px 10px 7px',
                flexShrink: 0,
                borderBottom: '1px solid #F1F5F9',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 12, color: '#0f172a' }}>今日上机名单</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3, lineHeight: 1.4 }}>
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
          </>
        )}
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
