/**
 * 系统用户管理（仅管理员）
 * 对接 GET/POST/PUT/PATCH /api/users
 *
 * RBAC 自检要点：非 admin 侧栏不显示「用户管理」；直链 /admin/users 由 RequireAdmin 重定向；
 * 非管理员调用用户 API 时后端返回 403（见网络面板）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import { usersApi, type UserRow, type SystemUserRole } from '../../api/users';
import { ROLE_LABELS } from '../../constants/roleLabels';
import { useAuthStore } from '../../stores/authStore';
import {
  AI_CLINICAL_MENU_KEYS,
  SIDEBAR_NAV_SECTIONS,
  menuKeysConfigurableForRole,
} from '../../constants/sidebarModules';
import { AI_ASSISTANT_FEATURES, AI_ASSISTANT_FEATURE_KEYS } from '../../constants/aiAssistantFeatures';

/** 仅 ASCII 字母与数字 */
const PASSWORD_ALLOWED = /^[A-Za-z0-9]+$/;

const ROLE_OPTIONS: { value: SystemUserRole; label: string }[] = [
  { value: 'admin', label: ROLE_LABELS.admin },
  { value: 'doctor', label: ROLE_LABELS.doctor },
  { value: 'nurse', label: ROLE_LABELS.nurse },
  { value: 'technician', label: ROLE_LABELS.technician },
  { value: 'head_nurse', label: ROLE_LABELS.head_nurse },
  { value: 'quality', label: ROLE_LABELS.quality },
];

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export default function AdminUsersPage() {
  const currentUserId = useAuthStore(s => s.user?.id);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [createForm] = Form.useForm<{
    username: string;
    real_name: string;
    role: SystemUserRole;
    password: string;
    menu_keys: string[];
  }>();
  const [editForm] = Form.useForm<{
    real_name: string;
    role: SystemUserRole;
    menu_keys: string[];
  }>();
  const [resetForm] = Form.useForm<{ new_password: string }>();

  const createRoleWatch = Form.useWatch('role', createForm) as SystemUserRole | undefined;
  const editRoleWatch = Form.useWatch('role', editForm) as SystemUserRole | undefined;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await usersApi.list();
      setRows(res.data.data ?? []);
    } catch {
      /* 错误由拦截器提示 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    createForm.resetFields();
    const defaultRole: SystemUserRole = 'doctor';
    createForm.setFieldsValue({
      role: defaultRole,
      menu_keys: menuKeysConfigurableForRole(defaultRole),
    });
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      const pwdErr = validatePassword(v.password);
      if (pwdErr) {
        message.error(pwdErr);
        return;
      }
      const unrestricted = isUnrestrictedMenuKeys(v.role, v.menu_keys);
      await usersApi.create({
        username: v.username,
        real_name: v.real_name,
        role: v.role,
        password: v.password,
        menu_permissions: unrestricted ? null : v.menu_keys,
      });
      message.success('用户创建成功');
      setCreateOpen(false);
      await load();
    } catch (e: unknown) {
      if (isFormValidationError(e)) return;
    }
  };

  const openEdit = useCallback((r: UserRow) => {
    setEditing(r);
    const role = normalizeRoleForForm(r.role);
    const keys = mergePermissionsForForm(role, r.menu_permissions);
    editForm.setFieldsValue({
      real_name: r.real_name,
      role,
      menu_keys: keys,
    });
    setEditOpen(true);
  }, [editForm]);

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const v = await editForm.validateFields();
      const unrestricted = isUnrestrictedMenuKeys(v.role, v.menu_keys);
      await usersApi.update(editing.id, {
        real_name: v.real_name,
        role: v.role,
        menu_permissions: unrestricted ? null : v.menu_keys,
      });
      message.success('已保存');
      setEditOpen(false);
      setEditing(null);
      await load();
    } catch (e: unknown) {
      if (isFormValidationError(e)) return;
    }
  };

  const handleToggle = useCallback(async (r: UserRow) => {
    try {
      await usersApi.toggleActive(r.id);
      message.success('操作成功');
      await load();
    } catch {
      /* 拦截器 */
    }
  }, [load]);

  const handleDelete = useCallback(async (r: UserRow) => {
    try {
      await usersApi.remove(r.id);
      message.success(`已删除用户：${r.real_name}`);
      await load();
    } catch {
      /* 拦截器 */
    }
  }, [load]);

  const openReset = useCallback((r: UserRow) => {
    setEditing(r);
    resetForm.resetFields();
    setResetOpen(true);
  }, [resetForm]);

  const submitReset = async () => {
    if (!editing) return;
    try {
      const v = await resetForm.validateFields();
      const pwdErr = validatePassword(v.new_password);
      if (pwdErr) {
        message.error(pwdErr);
        return;
      }
      await usersApi.resetPassword(editing.id, v.new_password);
      message.success('密码已重置');
      setResetOpen(false);
      setEditing(null);
    } catch (e: unknown) {
      if (isFormValidationError(e)) return;
    }
  };

  const columns: ColumnsType<UserRow> = useMemo(
    () => [
      { title: '用户名', dataIndex: 'username', key: 'username', width: 140 },
      { title: '姓名', dataIndex: 'real_name', key: 'real_name', width: 120 },
      {
        title: '角色',
        dataIndex: 'role',
        key: 'role',
        width: 120,
        render: (role: string) => roleLabel(role),
      },
      {
        title: '侧栏权限',
        key: 'menu_permissions',
        width: 110,
        render: (_: unknown, r: UserRow) =>
          r.menu_permissions === null || r.menu_permissions === undefined ? (
            <Tag>默认</Tag>
          ) : (
            <Tag color="blue">自定义</Tag>
          ),
      },
      {
        title: 'AI 侧栏',
        key: 'ai_menu',
        width: 120,
        render: (_: unknown, r: UserRow) => formatAiMenuCell(r),
      },
      {
        title: '状态',
        dataIndex: 'is_active',
        key: 'is_active',
        width: 100,
        render: (active: boolean) =>
          active ? <Tag color="success">启用</Tag> : <Tag color="default">禁用</Tag>,
      },
      {
        title: '最后登录',
        dataIndex: 'last_login_at',
        key: 'last_login_at',
        width: 170,
        render: (t: string | null) =>
          t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '—',
      },
      {
        title: '创建时间',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 170,
        render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm'),
      },
      {
        title: '操作',
        key: 'actions',
        width: 320,
        fixed: 'right',
        render: (_: unknown, r: UserRow) => {
          const isSelf = currentUserId != null && String(r.id) === String(currentUserId);
          return (
            <Space size="small" wrap>
              <Button type="link" size="small" onClick={() => openEdit(r)}>
                编辑
              </Button>
              <Button type="link" size="small" onClick={() => openReset(r)}>
                重置密码
              </Button>
              {!isSelf && (
                <Popconfirm
                  title={r.is_active ? '确定禁用该用户？' : '确定启用该用户？'}
                  onConfirm={() => handleToggle(r)}
                  okText="确定"
                  cancelText="取消"
                >
                  <Button type="link" size="small" danger={r.is_active}>
                    {r.is_active ? '禁用' : '启用'}
                  </Button>
                </Popconfirm>
              )}
              {!isSelf && (
                <Popconfirm
                  title="确定删除该用户？"
                  description="若该用户已被业务数据引用，系统会阻止删除。"
                  onConfirm={() => handleDelete(r)}
                  okText="删除"
                  cancelText="取消"
                >
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              )}
            </Space>
          );
        },
      },
    ],
    [currentUserId, handleDelete, handleToggle, openEdit, openReset]
  );

  return (
    <PageShell>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建用户
        </Button>
      </div>
      <Table<UserRow>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1350 }}
        pagination={false}
      />

      <Modal
        title="新建用户"
        open={createOpen}
        onOk={() => void submitCreate()}
        onCancel={() => setCreateOpen(false)}
        destroyOnClose
        okText="创建"
        width={720}
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="real_name"
            label="姓名"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={ROLE_OPTIONS}
              placeholder="选择角色"
              onChange={r =>
                createForm.setFieldsValue({
                  menu_keys: menuKeysConfigurableForRole(r as SystemUserRole),
                })
              }
            />
          </Form.Item>
          <Form.Item name="menu_keys" label="侧栏功能范围" extra="勾选表示可从侧栏进入；AI 分析助手可再细分子功能。全部勾选且无 AI 分项限制时保存为「默认」。修改后请重新登录或刷新页面后生效。">
            <MenuKeysEditor role={createRoleWatch ?? 'doctor'} />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[{ required: true, message: '请输入密码' }]}
            extra="至少 6 位，仅含字母与数字"
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑用户"
        open={editOpen}
        onOk={() => void submitEdit()}
        onCancel={() => {
          setEditOpen(false);
          setEditing(null);
        }}
        destroyOnClose
        okText="保存"
        width={720}
      >
        {editing && (
          <Form form={editForm} layout="vertical" style={{ marginTop: 8 }}>
            <Form.Item label="用户名">
              <Input value={editing.username} disabled />
            </Form.Item>
            <Form.Item
              name="real_name"
              label="姓名"
              rules={[{ required: true, message: '请输入姓名' }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
              <Select
                options={ROLE_OPTIONS}
                onChange={r =>
                  editForm.setFieldsValue({
                    menu_keys: menuKeysConfigurableForRole(r as SystemUserRole),
                  })
                }
              />
            </Form.Item>
            <Form.Item name="menu_keys" label="侧栏功能范围" extra="勾选表示可从侧栏进入；AI 分析助手可再细分子功能。全部勾选且无 AI 分项限制时保存为「默认」。修改后请重新登录或刷新页面后生效。">
              <MenuKeysEditor role={editRoleWatch ?? normalizeRoleForForm(editing.role)} />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={editing ? `重置密码：${editing.username}` : '重置密码'}
        open={resetOpen}
        onOk={() => void submitReset()}
        onCancel={() => {
          setResetOpen(false);
          setEditing(null);
        }}
        destroyOnClose
        okText="确认重置"
      >
        <Form form={resetForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[{ required: true, message: '请输入新密码' }]}
            extra="至少 6 位，仅含字母与数字"
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  );
}

function validatePassword(password: string): string | null {
  if (!password || password.length < 6) return '密码不能少于6位';
  if (!PASSWORD_ALLOWED.test(password)) return '密码只能包含字母与数字';
  return null;
}

/** 历史账号可能为 qc，表单选项仅有 quality，编辑时映射为 quality 以便展示一致 */
function normalizeRoleForForm(role: string): SystemUserRole {
  if (role === 'qc') return 'quality';
  return role as SystemUserRole;
}

function mergePermissionsForForm(role: SystemUserRole, stored: string[] | null | undefined): string[] {
  const full = menuKeysConfigurableForRole(role);
  if (stored === null || stored === undefined) return full;
  const fromSidebar = full.filter(k => stored.includes(k));
  const feats = AI_ASSISTANT_FEATURE_KEYS.filter(k => stored.includes(k));
  return [...new Set([...fromSidebar, ...feats])];
}

/** 与保存时「menu_permissions: null」的默认全开语义一致：不得含任一 ai_feat:* */
function isUnrestrictedMenuKeys(role: SystemUserRole, keys: string[]): boolean {
  if (keys.some(k => k.startsWith('ai_feat:'))) return false;
  const full = menuKeysConfigurableForRole(role);
  const keysNoFeat = keys.filter(k => !k.startsWith('ai_feat:'));
  return full.length === keysNoFeat.length && full.every(k => keysNoFeat.includes(k));
}

function toggleMenuKey(menuKeys: string[], key: string, on: boolean): string[] {
  const set = new Set(menuKeys);
  if (on) set.add(key);
  else set.delete(key);
  return Array.from(set);
}

/** 展示该用户在「AI 临床分析」下可配置的子模块勾选情况（与侧栏 menu_permissions 同源） */
function formatAiMenuCell(r: UserRow) {
  const role = normalizeRoleForForm(r.role);
  const full = menuKeysConfigurableForRole(role);
  const aiKeys = AI_CLINICAL_MENU_KEYS.filter(k => full.includes(k));
  const mp = r.menu_permissions;
  const featCount = mp?.filter(k => k.startsWith('ai_feat:')).length ?? 0;
  if (featCount > 0) {
    return (
      <Tag color="cyan">
        助手分项 {featCount}/{AI_ASSISTANT_FEATURE_KEYS.length}
      </Tag>
    );
  }
  if (aiKeys.length === 0) {
    return <Tag>—</Tag>;
  }
  if (mp === null || mp === undefined) {
    return <Tag>默认（全）</Tag>;
  }
  const count = aiKeys.filter(k => mp.includes(k)).length;
  if (count === 0) return <Tag>无</Tag>;
  if (count === aiKeys.length) return <Tag color="blue">全部</Tag>;
  return (
    <Tag color="blue">
      部分 ({count}/{aiKeys.length})
    </Tag>
  );
}

function isFormValidationError(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && 'errorFields' in e);
}

function AiAssistantControls({
  menuKeys,
  onChange,
}: {
  menuKeys: string[];
  onChange: (next: string[]) => void;
}) {
  const hasAssistantRoute = menuKeys.includes('/ai/assistant');
  const selectedFeats = AI_ASSISTANT_FEATURE_KEYS.filter(k => menuKeys.includes(k));
  const fullMode = hasAssistantRoute && selectedFeats.length === 0;

  const toggleFull = (checked: boolean) => {
    let next = menuKeys.filter(k => !k.startsWith('ai_feat:'));
    if (checked) {
      if (!next.includes('/ai/assistant')) next = [...next, '/ai/assistant'];
    } else {
      next = next.filter(k => k !== '/ai/assistant');
    }
    onChange(next);
  };

  const toggleFeat = (featKey: string, checked: boolean) => {
    let next = [...menuKeys];
    if (checked) {
      if (!next.includes('/ai/assistant')) next.push('/ai/assistant');
      if (!next.includes(featKey)) next.push(featKey);
    } else {
      next = next.filter(k => k !== featKey);
      const remaining = AI_ASSISTANT_FEATURE_KEYS.filter(k => next.includes(k));
      if (remaining.length === 0) {
        next = next.filter(k => k !== '/ai/assistant');
      }
    }
    onChange(next);
  };

  return (
    <div style={{ paddingLeft: 8, borderLeft: '2px solid #bae6fd' }}>
      <Typography.Text strong>AI 分析助手 · 子功能</Typography.Text>
      <div style={{ marginTop: 8 }}>
        <Checkbox checked={fullMode} onChange={e => toggleFull(e.target.checked)}>
          全部子功能
        </Checkbox>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          勾选「全部子功能」时不写入分项 key；若勾选下方任意项，则仅开放对应接口与页签（与后端一致）。
        </Typography.Paragraph>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          {AI_ASSISTANT_FEATURES.map(f => (
            <Checkbox
              key={f.key}
              disabled={fullMode}
              checked={menuKeys.includes(f.key)}
              onChange={e => toggleFeat(f.key, e.target.checked)}
            >
              {f.label}
              {f.hint ? (
                <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                  （{f.hint}）
                </Typography.Text>
              ) : null}
            </Checkbox>
          ))}
        </Space>
      </div>
    </div>
  );
}

interface MenuKeysEditorProps {
  value?: string[];
  onChange?: (v: string[]) => void;
  role: SystemUserRole;
}

function MenuKeysEditor({ value = [], onChange, role }: MenuKeysEditorProps) {
  const allowed = menuKeysConfigurableForRole(role);
  const menuKeys = value;
  const setMenuKeys = (next: string[]) => onChange?.(next);
  const canConfigureAiAssistant = allowed.includes('/ai/assistant');

  return (
    <div style={{ width: '100%' }}>
      {SIDEBAR_NAV_SECTIONS.map(section => (
        <div key={section.title} style={{ marginBottom: 12 }}>
          {section.title === 'AI 临床分析' && (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
              指南 / 知识库 / 网站配置与助手子功能相互独立；血管通路「AI 解读」需勾选「CVC 高危评分解读」分项。
            </Typography.Paragraph>
          )}
          <Typography.Text type="secondary">{section.title}</Typography.Text>
          <div style={{ marginTop: 8 }}>
            {section.title === 'AI 临床分析' ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {canConfigureAiAssistant ? (
                  <AiAssistantControls menuKeys={menuKeys} onChange={setMenuKeys} />
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    当前角色不开放临床 AI 助手、指南阅读与知识库模块。
                  </Typography.Text>
                )}
                <Space wrap size={[8, 8]}>
                  {section.items
                    .filter(item => item.key !== '/ai/assistant')
                    .filter(item => allowed.includes(item.key))
                    .filter(item => !(item.adminOnly && role !== 'admin'))
                    .map(item => (
                      <Checkbox
                        key={item.key}
                        checked={menuKeys.includes(item.key)}
                        onChange={e => setMenuKeys(toggleMenuKey(menuKeys, item.key, e.target.checked))}
                      >
                        {item.label}
                      </Checkbox>
                    ))}
                </Space>
              </Space>
            ) : (
              <Space wrap size={[8, 8]}>
                {section.items
                  .filter(item => allowed.includes(item.key))
                  .filter(item => !(item.adminOnly && role !== 'admin'))
                  .map(item => (
                    <Checkbox
                      key={item.key}
                      checked={menuKeys.includes(item.key)}
                      onChange={e => setMenuKeys(toggleMenuKey(menuKeys, item.key, e.target.checked))}
                    >
                      {item.label}
                    </Checkbox>
                  ))}
              </Space>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
