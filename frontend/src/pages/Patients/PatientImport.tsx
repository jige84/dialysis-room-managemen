/**
 * 患者导入页
 * 主要作用：统一导入入口，同时支持标准模板单文件、多个历史文件与整个历史资料文件夹。
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
  FileAddOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';
import { useAuthStore } from '../../stores/authStore';
import {
  patientsApi,
  type PatientAutoImportAffectedPatient,
  type PatientAutoImportResult,
  type PatientHistoryImportIssueRow,
  type PatientHistoryUnsupportedFile,
  type PatientImportRowError,
  type PatientImportSkippedDuplicate,
} from '../../api/patients';

function isExcelFile(file: UploadFile): boolean {
  const name = String(file.name || '').toLowerCase();
  return name.endsWith('.xlsx');
}

function modeLabel(mode: PatientAutoImportResult['mode']): string {
  return mode === 'bulk_template' ? '标准模板导入' : '历史资料导入';
}

function actionLabel(action: PatientAutoImportAffectedPatient['action'], dryRun: boolean): string {
  if (action === 'updated') return '补全';
  if (action === 'preview') return '预检';
  return dryRun ? '预览新增' : '新建';
}

export default function PatientImportPage() {
  const navigate = useNavigate();
  const canImport = useAuthStore((s) => s.hasRole(['admin', 'doctor']));
  const [selectedFiles, setSelectedFiles] = useState<UploadFile[]>([]);
  const [loadingDry, setLoadingDry] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);
  const [importResult, setImportResult] = useState<PatientAutoImportResult | null>(null);

  const localFiles = useMemo(
    () =>
      selectedFiles
        .filter(isExcelFile)
        .map((file) => file.originFileObj)
        .filter((file): file is NonNullable<UploadFile['originFileObj']> => file != null),
    [selectedFiles],
  );

  const affectedPatientColumns: ColumnsType<PatientAutoImportAffectedPatient> = [
    {
      title: '动作',
      dataIndex: 'action',
      width: 100,
      render: (value: PatientAutoImportAffectedPatient['action']) =>
        importResult ? actionLabel(value, importResult.dry_run) : value,
    },
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
  ];

  const rowErrorColumns: ColumnsType<PatientImportRowError> = [
    { title: 'Excel行号', dataIndex: 'rowIndex', width: 100 },
    { title: '姓名', dataIndex: 'name', width: 140, render: (value: string | undefined) => value || '—' },
    { title: '错误', dataIndex: 'errors', render: (errors: string[]) => errors.join('；') },
  ];

  const skippedDuplicateColumns: ColumnsType<PatientImportSkippedDuplicate> = [
    { title: 'Excel行号', dataIndex: 'rowIndex', width: 100 },
    { title: '姓名', dataIndex: 'name' },
  ];

  const issueColumns: ColumnsType<PatientHistoryImportIssueRow> = [
    { title: '分类', dataIndex: 'category', width: 170 },
    { title: '文件', dataIndex: 'fileName', width: 220 },
    { title: '行号', dataIndex: 'rowIndex', width: 90, render: (value: number | null) => value ?? '—' },
    { title: '患者', dataIndex: 'patientName', width: 120, render: (value: string | null) => value || '—' },
    { title: '原因', dataIndex: 'reason' },
  ];

  const unsupportedColumns: ColumnsType<PatientHistoryUnsupportedFile> = [
    { title: '文件', dataIndex: 'fileName' },
    { title: '原因', dataIndex: 'reason' },
  ];

  const updateFiles = (fileList: UploadFile[]) => {
    setSelectedFiles(fileList.filter((file) => {
      if (isExcelFile(file)) return true;
      if (file.status !== 'removed') {
        message.warning(`已忽略非 Excel 文件：${file.name}`);
      }
      return false;
    }));
  };

  const runImport = async (dryRun: boolean) => {
    if (!canImport) {
      message.warning('仅管理员与医生可执行导入');
      return;
    }
    if (localFiles.length === 0) {
      message.warning('请先选择 Excel 文件或整个历史资料文件夹');
      return;
    }

    const setLoading = dryRun ? setLoadingDry : setLoadingCommit;
    setLoading(true);
    setImportResult(null);
    try {
      const res = await patientsApi.importAuto(localFiles, dryRun);
      if (res.data.code !== 200 || !res.data.data) {
        message.error(res.data.message || '导入失败');
        return;
      }
      setImportResult(res.data.data);
      message.success(res.data.message);
    } finally {
      setLoading(false);
    }
  };

  const sharedUploadProps = {
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    multiple: true,
    beforeUpload: () => false,
    fileList: selectedFiles,
    onChange: ({ fileList }: { fileList: UploadFile[] }) => updateFiles(fileList),
  };

  return (
    <PageShell subtitle="导入患者资料">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/patients')}>
          返回患者列表
        </Button>

        <Alert
          type="info"
          showIcon
          message="统一导入入口"
          description={
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              支持标准模板单文件、多个历史资料文件和整个历史资料文件夹。系统会自动识别导入模式；护理记录单已支持最小透析记录自动导入（未识别部分仍列入待人工处理）。
            </Typography.Paragraph>
          }
        />

        <Card title="患者资料导入">
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              标准模板首行为英文列名；历史资料可直接选择单个文件、多个文件或整个文件夹。若混入标准模板文件与历史资料文件，系统会提示分开导入。
            </Typography.Paragraph>

            <Upload.Dragger {...sharedUploadProps} style={{ background: '#FAFCFF' }} disabled={!canImport}>
              <p className="ant-upload-drag-icon">
                <CloudUploadOutlined />
              </p>
              <p className="ant-upload-text">拖拽 Excel 到这里，或使用下面的按钮选择文件 / 文件夹</p>
              <p className="ant-upload-hint">仅支持 .xlsx；可一次导入多个历史资料文件。</p>
            </Upload.Dragger>

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
                下载标准模板
              </Button>
              <Upload {...sharedUploadProps} showUploadList={false} disabled={!canImport}>
                <Button icon={<FileAddOutlined />} disabled={!canImport}>
                  选择文件
                </Button>
              </Upload>
              <Upload {...sharedUploadProps} directory showUploadList={false} disabled={!canImport}>
                <Button icon={<FolderOpenOutlined />} disabled={!canImport}>
                  选择文件夹
                </Button>
              </Upload>
              <Button onClick={() => setSelectedFiles([])} disabled={!selectedFiles.length}>
                清空已选
              </Button>
            </Space>

            <Typography.Text type="secondary">
              当前已选择 {localFiles.length} 个 Excel 文件
            </Typography.Text>

            <Space wrap>
              <Button icon={<ExperimentOutlined />} loading={loadingDry} disabled={!canImport} onClick={() => void runImport(true)}>
                预检导入
              </Button>
              <Button type="primary" icon={<CloudUploadOutlined />} loading={loadingCommit} disabled={!canImport} onClick={() => void runImport(false)}>
                正式导入
              </Button>
            </Space>
          </Space>
        </Card>

        {importResult ? (
          <Card title="最近一次导入结果">
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <Typography.Text>
                模式 {modeLabel(importResult.mode)}；文件数 {importResult.files_count}；识别类型 {importResult.detected_file_types.join('、') || '—'}
                {importResult.dry_run ? '（预检）' : ''}
              </Typography.Text>

              <Typography.Text>
                新建患者 {importResult.patients_created}；补全患者 {importResult.patients_updated}；导入化验 {importResult.labs_created}；导入医嘱 {importResult.orders_created}；导入透析记录 {importResult.dialysis_created}
              </Typography.Text>

              {importResult.affected_patients.length > 0 ? (
                <>
                  <Typography.Title level={5}>受影响患者</Typography.Title>
                  <Table
                    size="small"
                    rowKey={(row) => `${row.action}-${row.id}-${row.name}`}
                    dataSource={importResult.affected_patients}
                    columns={affectedPatientColumns}
                    pagination={false}
                  />
                </>
              ) : null}

              {importResult.skipped_duplicates.length > 0 ? (
                <>
                  <Typography.Title level={5}>跳过重复</Typography.Title>
                  <Table
                    size="small"
                    rowKey={(row) => `${row.rowIndex}-${row.name}`}
                    dataSource={importResult.skipped_duplicates}
                    columns={skippedDuplicateColumns}
                    pagination={false}
                  />
                </>
              ) : null}

              {importResult.row_errors.length > 0 ? (
                <>
                  <Typography.Title level={5}>行错误</Typography.Title>
                  <Table
                    size="small"
                    rowKey={(row) => `${row.rowIndex}-${row.name || 'unknown'}`}
                    dataSource={importResult.row_errors}
                    columns={rowErrorColumns}
                    pagination={false}
                  />
                </>
              ) : null}

              {importResult.unresolved_items.length > 0 ? (
                <>
                  <Typography.Title level={5}>待补全 / 待人工处理</Typography.Title>
                  <Table
                    size="small"
                    rowKey={(_row, index) => `issue-${index}`}
                    dataSource={importResult.unresolved_items}
                    columns={issueColumns}
                    pagination={false}
                  />
                </>
              ) : null}

              {importResult.unsupported_files.length > 0 ? (
                <>
                  <Typography.Title level={5}>未支持文件</Typography.Title>
                  <Table
                    size="small"
                    rowKey={(row) => row.fileName}
                    dataSource={importResult.unsupported_files}
                    columns={unsupportedColumns}
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
