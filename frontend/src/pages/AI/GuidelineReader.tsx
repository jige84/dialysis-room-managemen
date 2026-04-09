/**
 * 指南阅读器页
 * 主要作用：录入或导入指南来源（文本/URL/DOI），触发服务端生成阅读笔记并可写入知识库。
 * 主要功能：表单创建条目；列表与详情；调用 `guidelinesApi`；Modal 与表格交互。
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Typography,
  Radio,
  Alert,
  Spin,
  Modal,
  Table,
  Space,
  message,
  Popconfirm,
} from 'antd';
import PageShell from '../../components/PageShell/PageShell';
import { usePermission } from '../../utils/permission';
import {
  guidelinesApi,
  type GuidelineDocRow,
  type GuidelineNoticeRow,
  type GuidelineSourceType,
} from '../../api/guidelines';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const DEFAULT_PAGE_SIZE = 10;

export default function GuidelineReaderPage() {
  const { canUseAiGuidelines } = usePermission();
  const [form] = Form.useForm();
  const sourceType = Form.useWatch('sourceType', form) as GuidelineSourceType | undefined;
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [rows, setRows] = useState<GuidelineDocRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [notices, setNotices] = useState<GuidelineNoticeRow[]>([]);
  const [readModalId, setReadModalId] = useState<string | null>(null);
  const [readModalDoc, setReadModalDoc] = useState<GuidelineDocRow | null>(null);
  const [readModalLoading, setReadModalLoading] = useState(false);

  const fetchList = useCallback(async () => {
    if (!canUseAiGuidelines) return;
    setListLoading(true);
    try {
      const { data } = await guidelinesApi.list(page, pageSize, searchKeyword);
      setRows(data.data.list);
      setTotal(data.data.total);
    } catch {
      /* 拦截器已提示 */
    } finally {
      setListLoading(false);
    }
  }, [canUseAiGuidelines, page, pageSize, searchKeyword]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const loadNotices = async () => {
    if (!canUseAiGuidelines) return;
    try {
      const { data } = await guidelinesApi.listNotices();
      setNotices(data.data.list ?? []);
    } catch {
      /*  */
    }
  };

  useEffect(() => {
    if (canUseAiGuidelines) loadNotices();
  }, [canUseAiGuidelines]);

  const dismissNotices = async () => {
    try {
      await guidelinesApi.markAllNoticesRead();
      setNotices([]);
    } catch {
      /*  */
    }
  };

  const onCreate = async () => {
    if (!canUseAiGuidelines) return;
    const v = await form.validateFields();
    setLoading(true);
    try {
      await guidelinesApi.create({
        title: v.title,
        sourceType: v.sourceType as GuidelineSourceType,
        sourceUrl: v.sourceUrl || null,
        sourceDoi: v.sourceDoi || null,
        rawText: v.rawText || null,
      });
      message.success('已创建记录');
      form.resetFields();
      setPage(1);
      setSearchKeyword('');
      const listRes = await guidelinesApi.list(1, pageSize, '');
      setRows(listRes.data.data.list);
      setTotal(listRes.data.data.total);
    } catch {
      /*  */
    } finally {
      setLoading(false);
    }
  };

  const onGenerate = async (id: string) => {
    setLoading(true);
    try {
      const { data } = await guidelinesApi.generateNote(id);
      message.success('读书笔记已生成');
      setRows((prev) => prev.map((r) => (r.id === id ? data.data : r)));
      fetchList();
    } catch {
      /*  */
    } finally {
      setLoading(false);
    }
  };

  const openReadModal = async (id: string) => {
    setReadModalId(id);
    setReadModalDoc(null);
    setReadModalLoading(true);
    try {
      const { data } = await guidelinesApi.get(id);
      setReadModalDoc(data.data);
    } catch {
      setReadModalId(null);
    } finally {
      setReadModalLoading(false);
    }
  };

  const onSaveKb = (id: string) => {
    Modal.confirm({
      title: '保存到本地知识库',
      content: '将把指南原文（提取/粘贴的正文）写入资料库供检索，不单独以 AI 读书笔记作为正文。是否继续？',
      onOk: async () => {
        try {
          const { data } = await guidelinesApi.saveToKb(id);
          if (data.data.saved) message.success('已保存');
          else if (data.data.duplicate) message.info('内容已存在，未重复入库');
          fetchList();
        } catch {
          /*  */
        }
      },
    });
  };

  const onDelete = async (r: GuidelineDocRow) => {
    const lastOnPage = rows.length <= 1;
    try {
      await guidelinesApi.remove(r.id);
      message.success('已删除');
      if (lastOnPage && page > 1) {
        setPage((p) => Math.max(1, p - 1));
      } else {
        fetchList();
      }
    } catch {
      /*  */
    }
  };

  return (
    <PageShell fullWidth>
      <Title level={4}>指南阅读中心</Title>
      <Text type="secondary" style={{ fontSize: 12 }}>
        上传或粘贴指南正文，生成结构化读书笔记；保存到知识库前需二次确认。
      </Text>

      {!canUseAiGuidelines && (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message="当前账号无权限"
          description="管理员须在「用户管理」中为本账号勾选侧栏「指南阅读中心」模块。"
        />
      )}

      {canUseAiGuidelines && notices.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message={notices[0]?.title ?? '新资料提醒'}
          description={
            <div>
              <Paragraph style={{ marginBottom: 8 }}>{notices.map((n) => n.message).join('\n')}</Paragraph>
              <Button size="small" type="primary" onClick={dismissNotices}>
                知道了
              </Button>
            </div>
          }
        />
      )}

      <Spin spinning={loading}>
        <Card style={{ marginTop: 16, borderColor: '#DBEAFE' }} title="新建阅读任务">
          <Form
            form={form}
            layout="vertical"
            disabled={!canUseAiGuidelines}
            initialValues={{ sourceType: 'text_paste' }}
          >
            <Form.Item label="文献标题" name="title" rules={[{ required: true, message: '请输入标题' }]}>
              <Input placeholder="指南或共识名称" />
            </Form.Item>
            <Form.Item label="来源类型" name="sourceType">
              <Radio.Group>
                <Radio value="text_paste">文本粘贴</Radio>
                <Radio value="url">网页 URL</Radio>
                <Radio value="doi">DOI</Radio>
              </Radio.Group>
            </Form.Item>
            {sourceType === 'url' && (
              <Form.Item
                label="URL"
                name="sourceUrl"
                rules={[{ required: true, message: '请填写 URL' }]}
              >
                <Input placeholder="https://..." />
              </Form.Item>
            )}
            {sourceType === 'doi' && (
              <Form.Item
                label="DOI"
                name="sourceDoi"
                rules={[{ required: true, message: '请填写 DOI' }]}
              >
                <Input placeholder="10.xxxx/xxxx" />
              </Form.Item>
            )}
            {(sourceType === 'text_paste' || !sourceType) && (
              <Form.Item label="正文" name="rawText" rules={[{ required: true, message: '请粘贴正文' }]}>
                <TextArea rows={10} placeholder="粘贴指南全文或节选（系统将截取合理长度）" />
              </Form.Item>
            )}
            <Button type="primary" onClick={onCreate} disabled={!canUseAiGuidelines}>
              创建记录并拉取正文
            </Button>
          </Form>
        </Card>

        <Card
          style={{ marginTop: 16, borderColor: '#DBEAFE' }}
          title="阅读任务列表"
          extra={
            <Input.Search
              allowClear
              placeholder="搜索标题或知识库中已保存的正文关键词"
              style={{ width: 320 }}
              disabled={!canUseAiGuidelines}
              onSearch={(v) => {
                setSearchKeyword(v.trim());
                setPage(1);
              }}
            />
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="如何阅读已获取的资料"
            description={
              <span>
                点击表格<strong>左侧展开图标</strong>或<strong>整行</strong>可展开查看 AI 读书笔记；亦可点「打开阅读窗口」在弹窗中同时查看笔记与原文摘录。若列为「未生成」，请先点「生成读书笔记」（需配置通义 API）。已生成笔记时不再显示该按钮。
              </span>
            }
          />
          <Table
            loading={listLoading}
            rowKey="id"
            dataSource={rows}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50'],
              showTotal: (t) => `共 ${t} 条`,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps ?? DEFAULT_PAGE_SIZE);
              },
            }}
            scroll={{ x: true }}
            columns={[
              { title: '标题', dataIndex: 'title', ellipsis: true },
              { title: '来源', dataIndex: 'source_type', width: 100 },
              {
                title: '读书笔记',
                width: 100,
                render: (_, r) => (r.note_generated_at ? '已生成' : '未生成'),
              },
              {
                title: '知识库',
                width: 88,
                render: (_, r) => (r.is_saved_to_kb ? '已保存' : '—'),
              },
              {
                title: '操作',
                width: 420,
                render: (_, r) => (
                  <Space wrap size="small">
                    <Button size="small" onClick={() => openReadModal(r.id)}>
                      打开阅读窗口
                    </Button>
                    {!r.note_generated_at && (
                      <Button
                        size="small"
                        type="primary"
                        disabled={!canUseAiGuidelines}
                        onClick={() => onGenerate(r.id)}
                      >
                        生成读书笔记
                      </Button>
                    )}
                    <Button
                      size="small"
                      disabled={!r.note_generated_at || r.is_saved_to_kb}
                      onClick={() => onSaveKb(r.id)}
                    >
                      {r.is_saved_to_kb ? '已入库' : '保存到知识库'}
                    </Button>
                    <Popconfirm
                      title="删除本条阅读任务？"
                      description={
                        r.is_saved_to_kb
                          ? '将同时从本地知识库中删除已保存的对应文档，不可恢复。'
                          : '删除后不可恢复。'
                      }
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      disabled={!canUseAiGuidelines}
                      onConfirm={() => onDelete(r)}
                    >
                      <Button size="small" danger disabled={!canUseAiGuidelines}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            expandable={{
              expandRowByClick: true,
              expandedRowRender: (r) => (
                <div style={{ maxWidth: 900 }}>
                  {r.reading_note?.markdown ? (
                    <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{r.reading_note.markdown}</Paragraph>
                  ) : (
                    <Text type="secondary">
                      尚未生成读书笔记，请点击「生成读书笔记」。若按钮无反应，请检查服务器是否配置 QWEN_API_KEY。
                    </Text>
                  )}
                </div>
              ),
            }}
          />
        </Card>
      </Spin>

      <Modal
        title={readModalDoc?.title ?? '阅读'}
        open={readModalId !== null}
        onCancel={() => {
          setReadModalId(null);
          setReadModalDoc(null);
        }}
        footer={null}
        width={880}
        destroyOnClose
      >
        <Spin spinning={readModalLoading}>
          {readModalDoc && (
            <div>
              {(readModalDoc.source_url || readModalDoc.source_doi) && (
                <Paragraph type="secondary" style={{ fontSize: 12 }}>
                  {readModalDoc.source_url && (
                    <>
                      来源链接：{' '}
                      <a href={readModalDoc.source_url} target="_blank" rel="noopener noreferrer">
                        {readModalDoc.source_url}
                      </a>
                    </>
                  )}
                  {readModalDoc.source_doi && !readModalDoc.source_url && <>DOI：{readModalDoc.source_doi}</>}
                </Paragraph>
              )}
              <Title level={5}>AI 读书笔记</Title>
              {readModalDoc.reading_note?.markdown ? (
                <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{readModalDoc.reading_note.markdown}</Paragraph>
              ) : (
                <Text type="secondary">尚未生成，请点击列表中的「生成读书笔记」。</Text>
              )}
              <Title level={5} style={{ marginTop: 16 }}>
                正文摘录
              </Title>
              <Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', fontSize: 13 }}>
                {readModalDoc.raw_text
                  ? readModalDoc.raw_text.length > 12000
                    ? `${readModalDoc.raw_text.slice(0, 12000)}…（已截断）`
                    : readModalDoc.raw_text
                  : '无正文'}
              </Paragraph>
            </div>
          )}
        </Spin>
      </Modal>
    </PageShell>
  );
}
