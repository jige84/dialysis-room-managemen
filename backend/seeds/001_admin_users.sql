-- 种子数据：初始用户
-- 密码 Shangu@2026 对应的bcrypt hash（12轮）
-- 注意：生产环境请在首次登录后立即修改密码

INSERT INTO users (username, password_hash, real_name, role) VALUES
  ('renjige',  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsQ8G9gVL7q0CxaUyNPfQ1GVKB3u', '任计阁', 'admin'),
  ('yangchen', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsQ8G9gVL7q0CxaUyNPfQ1GVKB3u', '杨晨',   'head_nurse'),
  ('nurse01',  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsQ8G9gVL7q0CxaUyNPfQ1GVKB3u', '护士01', 'nurse'),
  ('doctor01', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsQ8G9gVL7q0CxaUyNPfQ1GVKB3u', '主治医生01', 'doctor'),
  ('qc01',     '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsQ8G9gVL7q0CxaUyNPfQ1GVKB3u', '质控员01', 'qc')
ON CONFLICT (username) DO NOTHING;

-- 注意：上方hash仅为占位符，实际初始化需使用下方脚本生成正确hash:
-- node -e "const b=require('bcryptjs'); b.hash('Shangu@2026', 12).then(console.log)"
-- 然后替换上方所有 $2b$12$... 为实际生成的hash
