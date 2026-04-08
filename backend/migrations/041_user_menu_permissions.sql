-- 用户侧栏功能范围（JSON 数组，路径 key 与前端侧栏一致）；NULL 表示不限制（沿用角色默认）
ALTER TABLE users ADD COLUMN IF NOT EXISTS menu_permissions JSONB DEFAULT NULL;

COMMENT ON COLUMN users.menu_permissions IS '侧栏可访问模块路径 key 列表，NULL=不限制';
