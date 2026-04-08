/**
 * 指南阅读器页
 * 主要作用：录入或导入指南来源（文本/URL/DOI），触发服务端生成阅读笔记并可写入知识库。
 * 主要功能：表单创建条目；列表与详情；调用 `guidelinesApi`；Modal 与表格交互。
 */
import { useState, useEffect } from 'react';
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
} from 'antd';
import PageShell from '../../components/PageShell/PageShell';
import { usePermission } from '../../utils/permission';
import { guidelinesApi, type GuidelineDocRow, type GuidelineSourceType } from '../../api/guidelines';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export default function GuidelineReaderPage() {
  const { canUseAiGuidelines } = usePermission();
  const [form] = Form.useForm();
  const sourceType = Form.useWatch('sourceType', form) as GuidelineSourceType | undefined;
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [rows, setRows] = useState<GuidelineDocRow[]>([]);

  const loadList = async () => {
    setListLoading(true);
    try {
      const { data } = await guidelinesApi.list(1, 50);
      setRows(data.data.list);
    } catch {
      /* 拦截器已提示 */
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (canUseAiGuidelines) loadList();
  }, [canUseAiGuidelines]);

  const onCreate = async () => {
    if (!canUseAiGuidelines) return;
    const v = await form.validateFields();
    setLoading(true);
    try {
      const { data } = await guidelinesApi.create({
        title: v.title,
        sourceType: v.sourceType as GuidelineSourceType,
        sourceUrl: v.sourceUrl || null,
        sourceDoi: v.sourceDoi || null,
        rawText: v.rawText || null,
      });
      message.success('已创建记录');
      form.resetFields();
      setRows((prev) => [data.data, ...prev]);
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
    } catch {
      /*  */
    } finally {
      setLoading(false);
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
          loadList();
        } catch {
          /*  */
        }
      },
    });
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

        <Card style={{ marginTop: 16, borderColor: '#DBEAFE' }} title="阅读任务列表">
          <Table
            loading={listLoading}
            rowKey="id"
            dataSource={rows}
            pagination={false}
            scroll={{ x: true }}
            columns={[
              { title: '标题', dataIndex: 'title', ellipsis: true },
              { title: '来源', dataIndex: 'source_type', width: 100 },
              {
                title: '读书笔记',
                width: 120,
                render: (_, r) => (r.note_generated_at ? '已生成' : '未生成'),
              },
              {
                title: '操作',
                width: 280,
                render: (_, r) => (
                  <Space>
                    <Button size="small" type="primary" disabled={!canUseAiGuidelines} onClick={() => onGenerate(r.id)}>
                      生成读书笔记
                    </Button>
                    <Button size="small" disabled={!r.note_generated_at} onClick={() => onSaveKb(r.id)}>
                      保存到知识库
                    </Button>
                  </Space>
                ),
              },
            ]}
            expandable={{
              expandedRowRender: (r) => (
                <div style={{ maxWidth: 900 }}>
                  {r.reading_note?.markdown ? (
                    <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{r.reading_note.markdown}</Paragraph>
                  ) : (
                    <Text type="secondary">尚未生成</Text>
                  )}
                </div>
              ),
            }}
          />
        </Card>
      </Spin>
    </PageShell>
  );
}
