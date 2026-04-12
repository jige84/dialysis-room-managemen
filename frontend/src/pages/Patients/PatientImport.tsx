/**
 * 患者导入页
 * 主要作用：保留单表 XLSX 导入，并新增历史资料文件夹导入。
 */
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Space, Table, Typography, Upload, message } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';
import { useAuthStore } from '../../stores/authStore';
import {
  patientsApi,
  type PatientHistoryImportIssueRow,
  type PatientHistoryImportLabRow,
  type PatientHistoryImportOrderRow,
  type PatientHistoryImportPatientRow,
  type PatientHistoryImportResult,
  type PatientImportResult,
  type PatientImportRowError,
  type PatientImportSkippedDuplicate,
} from '../../api/patients';

export default function PatientImportPage() {
  const navigate = useNavigate();
  const canImport = useAuthStore((s) => s.hasRole(['admin', 'doctor']));
  const [loadingDry, setLoadingDry] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);
  const [singleResult, setSingleResult] = useState<PatientImportResult | null>(null);
  const [historyFiles, setHistoryFiles] = useState<UploadFile[]>([]);
  const [historyLoadingDry, setHistoryLoadingDry] = useState(false);
  const [historyLoadingCommit, setHistoryLoadingCommit] = useState(false);
  const [historyResult, setHistoryResult] = useState<PatientHistoryImportResult | null>(null);

  const errColumns: ColumnsType<PatientImportRowError> = [
    { title: 'Excel行号', dataIndex: 'rowIndex', width: 100 },
    { title: '姓名', dataIndex: 'name', width: 120, render: (value: string | undefined) => value || '—' },
    { title: '错误', dataIndex: 'errors', render: (errs: string[]) => (errs || []).join('；') },
  ];
  const okColumns: ColumnsType<{ rowIndex: number; id: string; name: string }> = [
    { title: '行号', dataIndex: 'rowIndex', width: 80 },
    { title: '患者ID', dataIndex: 'id', ellipsis: true },
    { title: '姓名', dataIndex: 'name', width: 140 },
  ];
  const dupColumns: ColumnsType<PatientImportSkippedDuplicate> = [
    { title: '行号', dataIndex: 'rowIndex', width: 80 },
    { title: '姓名', dataIndex: 'name' },
  ];

  const historyPatientColumns: ColumnsType<PatientHistoryImportPatientRow> = [
    { title: '动作', dataIndex: 'action', width: 90, render: (value: string) => (value === 'created' ? '新建' : '补全') },
    {
      title: '患者',
      dataIndex: 'name',
      render: (_value, record) => (
        <Space size={4}>
          <span>{record.name}</span>
          {record.id.startsWith('(preview:') ? null : (
            <Button type="link" size="small" onClick={() => navigate(`/patients/${record.id}`)}>
              打开档案
            </Button>
          )}
        </Space>
      ),
    },
    { title: '匹配方式', dataIndex: 'matched_by', width: 110 },
    { title: '来源文件', dataIndex: 'sources', render: (sources: string[]) => (sources || []).join('、') },
  ];
  const historyLabColumns: ColumnsType<PatientHistoryImportLabRow> = [
    { title: '患者', dataIndex: 'patient_name', width: 120 },
    { title: '项目', dataIndex: 'test_type', width: 100 },
    { title: '结果', render: (_value, record) => `${record.value} ${record.unit || ''}`.trim() },
    { title: '日期', dataIndex: 'test_date', width: 110 },
    { title: '来源文件', dataIndex: 'source_file' },
  ];
  const historyOrderColumns: ColumnsType<PatientHistoryImportOrderRow> = [
    { title: '患者', dataIndex: 'patient_name', width: 120 },
    { title: '药品', dataIndex: 'drug_name' },
    { title: '类型', dataIndex: 'order_type', width: 120 },
    { title: '频次', dataIndex: 'frequency', width: 100 },
    { title: '生效日期', dataIndex: 'valid_from', width: 110 },
    { title: '来源文件', dataIndex: 'source_file' },
  ];
  const issueColumns: ColumnsType<PatientHistoryImportIssueRow> = [
    { title: '分类', dataIndex: 'category', width: 160 },
    { title: '文件', dataIndex: 'fileName', width: 220 },
    { title: '行号', dataIndex: 'rowIndex', width: 80, render: (value: number | null) => value ?? '—' },
    { title: '患者', dataIndex: 'patientName', width: 120, render: (value: string | null) => value || '—' },
    { title: '原因', dataIndex: 'reason' },
  ];

  const historyLocalFiles = useMemo(
    () =>
      historyFiles
        .map((file) => file.originFileObj)
        .filter((file): file is NonNullable<UploadFile['originFileObj']> => file != null),
    [historyFiles],
  );

  const runSingleUpload = async (file: File, dryRun: boolean) => {
    if (!canImport) {
      message.warning('仅管理员与医生可执行导入');
      return;
    }
    const setLoading = dryRun ? setLoadingDry : setLoadingCommit;
    setLoading(true);
    setSingleResult(null);
    try {
      const res = await patientsApi.importFromXlsx(file, dryRun);
      if (res.data.code !== 200 || !res.data.data) {
        message.error(res.data.message || '导入失败');
        return;
      }
      setSingleResult(res.data.data);
      message.success(res.data.message);
    } finally {
      setLoading(false);
    }
  };

  const runHistoryUpload = async (dryRun: boolean) => {
    if (!canImport) {
      message.warning('仅管理员与医生可执行导入');
      return;
    }
    if (historyLocalFiles.length === 0) {
      message.warning('请先选择一个包含历史资料的文件夹');
      return;
    }
    const setLoading = dryRun ? setHistoryLoadingDry : setHistoryLoadingCommit;
    setLoading(true);
    setHistoryResult(null);
    try {
      const res = await patientsApi.importHistoryFolder(historyLocalFiles, dryRun);
      if (res.data.code !== 200 || !res.data.data) {
        message.error(res.data.message || '历史资料导入失败');
        return;
      }
      setHistoryResult(res.data.data);
      message.success(res.data.message);
    } finally {
      setLoading(false);
    }
  };

  const singleUploadProps = (dryRun: boolean) => ({
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    maxCount: 1,
    showUploadList: false,
    beforeUpload: (file: File) => {
      void runSingleUpload(file, dryRun);
      return false;
    },
  });

  return (
    <PageShell subtitle="批量导入患者">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/patients')}>
          返回患者列表
        </Button>

        <Alert
          type="info"
          showIcon
          message="导入后仍需补全的工作"
          description={
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              首版会自动导入患者草稿、联系方式、责任护士、化验结果和长期医嘱；护理记录单仅识别后列为待人工处理。知情同意书影像、血管通路、历史透析护理记录等仍需后续补录。
            </Typography.Paragraph>
          }
        />

        <Card title="1. 标准模板导入（原有能力）">
          <Typography.Paragraph type="secondary">
            模板首行为英文列名，第二行为示例（正式导入前请删除示例行）。也可在旧表上增加列，使用中文别名表头（见后端文档）。
          </Typography.Paragraph>
          <Space wrap>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => {
                void patientsApi.downloadImportTemplate().catch(() => {
                  message.error('下载模板失败');
                });
              }}
              disabled={!canImport}
            >
              下载 patient_import_template.xlsx
            </Button>
            <Upload {...singleUploadProps(true)}>
              <Button icon={<ExperimentOutlined />} loading={loadingDry} disabled={!canImport}>
                预检单表
              </Button>
            </Upload>
            <Upload {...singleUploadProps(false)}>
              <Button type="primary" icon={<CloudUploadOutlined />} loading={loadingCommit} disabled={!canImport}>
                正式导入单表
              </Button>
            </Upload>
          </Space>
          {singleResult ? (
            <Card style={{ marginTop: 16 }} title="最近一次单表导入结果">
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Typography.Text>
                  数据行数 {singleResult.total_data_rows}；成功 {singleResult.imported_count}；跳过重复 {singleResult.skipped_duplicate_count}；错误行 {singleResult.row_errors.length}
                  {singleResult.dry_run ? '（预检）' : ''}
                </Typography.Text>
                {singleResult.row_errors.length > 0 ? (
                  <Table size="small" rowKey={(row) => String(row.rowIndex)} dataSource={singleResult.row_errors} columns={errColumns} pagination={false} />
                ) : null}
                {singleResult.skipped_duplicates.length > 0 ? (
                  <Table size="small" rowKey={(row) => `${row.rowIndex}-${row.name}`} dataSource={singleResult.skipped_duplicates} columns={dupColumns} pagination={false} />
                ) : null}
                {singleResult.imported.length > 0 ? (
                  <Table size="small" rowKey={(row) => `${row.rowIndex}-${row.id}`} dataSource={singleResult.imported} columns={okColumns} pagination={false} />
                ) : null}
              </Space>
            </Card>
          ) : null}
        </Card>

        <Card title="2. 历史资料文件夹导入">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              请选择包含 `患者联系方式登记表`、`责任护士所管病人`、`病历首页`、`化验记录表`、`医嘱记录单` 等 Excel 的文件夹。系统会自动识别文件类型并聚合导入。
            </Typography.Paragraph>
            <Upload
              directory
              multiple
              beforeUpload={() => false}
              fileList={historyFiles}
              onChange={({ fileList }) => setHistoryFiles(fileList)}
              disabled={!canImport}
            >
              <Button icon={<FolderOpenOutlined />} disabled={!canImport}>
                选择历史资料文件夹
              </Button>
            </Upload>
            <Typography.Text type="secondary">
              当前已选择 {historyLocalFiles.length} 个文件
            </Typography.Text>
            <Space wrap>
              <Button icon={<ExperimentOutlined />} loading={historyLoadingDry} disabled={!canImport} onClick={() => void runHistoryUpload(true)}>
                预检历史资料
              </Button>
              <Button type="primary" icon={<CloudUploadOutlined />} loading={historyLoadingCommit} disabled={!canImport} onClick={() => void runHistoryUpload(false)}>
                正式导入历史资料
              </Button>
            </Space>
          </Space>
        </Card>

        {historyResult ? (
          <Card title="最近一次历史资料导入结果">
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <Typography.Text>
                文件数 {historyResult.files_count}；新建患者 {historyResult.patients_created}；补全患者 {historyResult.patients_updated}；导入化验 {historyResult.labs_created}；导入医嘱 {historyResult.orders_created}
                {historyResult.dry_run ? '（预检）' : ''}
              </Typography.Text>

              {historyResult.patients.length > 0 ? (
                <>
                  <Typography.Title level={5}>患者</Typography.Title>
                  <Table size="small" rowKey={(row) => `${row.action}-${row.id}-${row.draft_id}`} dataSource={historyResult.patients} columns={historyPatientColumns} pagination={false} />
                </>
              ) : null}

              {historyResult.labs.length > 0 ? (
                <>
                  <Typography.Title level={5}>化验结果</Typography.Title>
                  <Table size="small" rowKey={(row) => `${row.id}-${row.test_type}`} dataSource={historyResult.labs} columns={historyLabColumns} pagination={false} />
                </>
              ) : null}

              {historyResult.orders.length > 0 ? (
                <>
                  <Typography.Title level={5}>长期医嘱</Typography.Title>
                  <Table size="small" rowKey={(row) => `${row.id}-${row.drug_name}`} dataSource={historyResult.orders} columns={historyOrderColumns} pagination={false} />
                </>
              ) : null}

              {historyResult.unresolved_items.length > 0 ? (
                <>
                  <Typography.Title level={5}>待补全 / 待人工处理</Typography.Title>
                  <Table size="small" rowKey={(_row, index) => `issue-${index}`} dataSource={historyResult.unresolved_items} columns={issueColumns} pagination={false} />
                </>
              ) : null}

              {historyResult.unsupported_files.length > 0 ? (
                <>
                  <Typography.Title level={5}>未支持文件</Typography.Title>
                  <Table
                    size="small"
                    rowKey={(row) => row.fileName}
                    dataSource={historyResult.unsupported_files}
                    columns={[
                      { title: '文件', dataIndex: 'fileName' },
                      { title: '原因', dataIndex: 'reason' },
                    ]}
                    pagination={false}
                  />
                </>
              ) : null}
            </Space>
          </Card>
        ) : null}
      </Space>
    </PageShell>
  );
}
