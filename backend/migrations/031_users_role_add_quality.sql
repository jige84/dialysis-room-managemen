-- 允许 users.role 使用规范名 quality（与 qc 并存，应用层 RBAC 将二者视为等价）
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'doctor', 'nurse', 'head_nurse', 'qc', 'quality'));
