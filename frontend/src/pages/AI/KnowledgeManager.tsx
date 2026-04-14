/**
 * 本地知识库管理页
 * 主要作用：查看与管理 `kb_documents` 条目（来源、校验状态等），支持分页与筛选。
 * 主要功能：拉取 `knowledgeApi.listDocuments`；表格展示；需角色与侧栏「知识库管理」权限。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Typography, Switch, Alert, Spin, Select, Space } from 'antd';
import PageShell from '../../components/PageShell/PageShell';
import { usePermission } from '../../utils/permission';
import { knowledgeApi, type KbDocumentRow } from '../../api/knowledge';

const { Title, Text, Paragraph } = Typography;

export default function KnowledgeManagerPage() {
  const { canUseAiKnowledge, canManageAiKnowledge } = usePermission();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<KbDocumentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [sourceType, setSourceType] = useState<string | undefined>(undefined);
  const [detailChunks, setDetailChunks] = useState<{ id: string; content_text: string }[]>([]);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const { data } = await knowledgeApi.listDocuments({
        page: p,
        pageSize,
        sourceType,
      });
      setRows(data.data.list);
      setTotal(data.data.total);
    } catch {
      /*  */
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sourceType]);

  useEffect(() => {
    if (canUseAiKnowledge) {
      setPage(1);
      void load(1);
    }
  }, [canUseAiKnowledge, sourceType, load]);

  const onVerify = async (id: string, checked: boolean) => {
    try {
      await knowledgeApi.patchDocument(id, { is_verified: checked });
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_verified: checked } : r)));
    } catch {
      /*  */
    }
  };

  return (
    <PageShell fullWidth>
      <Title level={4}>知识库管理</Title>
      <Text type="secondary" style={{ fontSize: 12 }}>
        查看已入库的资料片段；人工核实可提高检索可信度。
      </Text>

      {!canUseAiKnowledge && (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message="当前账号无权限"
          description="管理员须在「用户管理」中为本账号勾选侧栏「知识库管理」模块。"
        />
      )}

      <Spin spinning={loading}>
        <Card style={{ marginTop: 16, borderColor: '#DBEAFE' }}>
          <Space style={{ marginBottom: 12 }}>
            <span>来源类型</span>
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 180 }}
              disabled={!canUseAiKnowledge}
              onChange={(v) => {
                setSourceType(v);
                setPage(1);
                setDetailChunks([]);
              }}
              options={[
                { value: 'manual', label: 'manual' },
                { value: 'ai_session', label: 'ai_session' },
                { value: 'guideline', label: 'guideline' },
                { value: 'web_import', label: 'web_import' },
              ]}
            />
          </Space>
          <Table
            rowKey="id"
            dataSource={rows}
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: (p) => {
                setPage(p);
                load(p);
              },
            }}
            columns={[
              { title: '标题', dataIndex: 'title', ellipsis: true },
              { title: '类型', dataIndex: 'source_type', width: 120 },
              {
                title: '已核实',
                width: 100,
                render: (_, r) => (
                  <Switch
                    checked={r.is_verified}
                    disabled={!canManageAiKnowledge}
                    onChange={(c) => onVerify(r.id, c)}
                  />
                ),
              },
              { title: '状态', dataIndex: 'status', width: 100 },
              {
                title: '操作',
                width: 100,
                render: (_, r) => (
                  <a
                    role="button"
                    tabIndex={0}
                    onClick={async () => {
                      const { data } = await knowledgeApi.getDocument(r.id);
                      setDetailChunks(data.data.chunks);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                      }
                    }}
                  >
                    加载片段
                  </a>
                ),
              },
            ]}
          />
          {detailChunks.length > 0 && (
            <Card size="small" title="资料片段预览" style={{ marginTop: 16 }}>
              {detailChunks.map((c) => (
                <Paragraph key={c.id} style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
                  {c.content_text.slice(0, 2000)}
                  {c.content_text.length > 2000 ? '…' : ''}
                </Paragraph>
              ))}
            </Card>
          )}
        </Card>
      </Spin>
    </PageShell>
  );
}
