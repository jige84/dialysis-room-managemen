/**
 * 外部医学站点配置页（管理员）
 * 主要作用：维护检索入口、指南链接、启用状态与限速等，供 AI/指南模块安全引用。
 * 主要功能：表格展示 `medicalSitesApi` 数据；行内编辑与保存；权限不足时只读提示。
 */
import { useState, useEffect } from 'react';
import { Card, Table, Typography, Switch, Input, Button, Space, message, Alert, Spin } from 'antd';
import PageShell from '../../components/PageShell/PageShell';
import { usePermission } from '../../utils/permission';
import { medicalSitesApi, type MedicalSiteRow } from '../../api/medicalSites';

const { Title, Text } = Typography;

export default function SiteConfigPage() {
  const { canManageMedicalSites } = usePermission();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MedicalSiteRow[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<MedicalSiteRow>>>({});

  /** 加载站点列表（进入页面与刷新） */
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await medicalSitesApi.list();
      setRows(data.data);
    } catch {
      /*  */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManageMedicalSites) load();
  }, [canManageMedicalSites]);

  const patchRow = (key: string, field: keyof MedicalSiteRow, value: unknown) => {
    setEdits((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
    setRows((prev) =>
      prev.map((r) => (r.site_key === key ? { ...r, [field]: value } as MedicalSiteRow : r)),
    );
  };

  const save = async (siteKey: string) => {
    const patch = edits[siteKey];
    if (!patch || !Object.keys(patch).length) {
      message.info('无修改');
      return;
    }
    try {
      await medicalSitesApi.patch(siteKey, patch);
      message.success('已保存');
      setEdits((e) => {
        const n = { ...e };
        delete n[siteKey];
        return n;
      });
      load();
    } catch {
      /*  */
    }
  };

  const test = async (siteKey: string) => {
    try {
      const { data } = await medicalSitesApi.test(siteKey);
      message.success(`可达性：${data.data.ok ? '正常' : '异常'}（HTTP ${data.data.status}）`);
      load();
    } catch {
      /*  */
    }
  };

  if (!canManageMedicalSites) {
    return (
      <PageShell fullWidth>
        <Alert type="warning" showIcon message="仅超级管理员可配置专业网站" />
      </PageShell>
    );
  }

  return (
    <PageShell fullWidth>
      <Title level={4}>专业网站配置</Title>
      <Text type="secondary" style={{ fontSize: 12 }}>
        填写主站 URL，测试通过后可勾选「启用」以在 AI 分析中作为二级引用来源（不自动爬取正文）。
      </Text>

      <Spin spinning={loading}>
        <Card style={{ marginTop: 16, borderColor: '#DBEAFE' }}>
          <Table
            rowKey="site_key"
            dataSource={rows}
            pagination={false}
            scroll={{ x: 1200 }}
            columns={[
              { title: '键', dataIndex: 'site_key', width: 90 },
              { title: '名称', dataIndex: 'display_name', width: 200, ellipsis: true },
              {
                title: 'base_url',
                dataIndex: 'base_url',
                width: 280,
                render: (v, r) => (
                  <Input
                    value={v || ''}
                    onChange={(e) => patchRow(r.site_key, 'base_url', e.target.value)}
                  />
                ),
              },
              {
                title: '指南页',
                dataIndex: 'guidelines_url',
                width: 200,
                render: (v, r) => (
                  <Input
                    value={v || ''}
                    placeholder="可选"
                    onChange={(e) => patchRow(r.site_key, 'guidelines_url', e.target.value || null)}
                  />
                ),
              },
              {
                title: '启用',
                width: 80,
                render: (_, r) => (
                  <Switch
                    checked={r.enabled}
                    onChange={(c) => patchRow(r.site_key, 'enabled', c)}
                  />
                ),
              },
              {
                title: '上次探测',
                width: 100,
                render: (_, r) => (r.is_reachable ? '可达' : '未知/失败'),
              },
              {
                title: '操作',
                width: 200,
                fixed: 'right',
                render: (_, r) => (
                  <Space>
                    <Button size="small" type="primary" onClick={() => save(r.site_key)}>
                      保存
                    </Button>
                    <Button size="small" onClick={() => test(r.site_key)}>
                      测试连接
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      </Spin>
    </PageShell>
  );
}
