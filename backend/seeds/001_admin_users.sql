-- 种子数据：初始用户（仅开发/测试环境）
-- 安全说明：
-- 1) 不在仓库中提供可推导的默认明文密码；
-- 2) 生产环境请改用 seedUsers.js + SEED_DEFAULT_PASSWORD 初始化；
-- 3) 初始化后必须立即重置账号密码。

INSERT INTO users (username, password_hash, real_name, role) VALUES
  ('renjige',  '$2a$12$zYNiR4eVjd8Kipes112NY.cESJ80THgSKrKLwrOV6ssPgGk01xojy', '任计阁', 'admin'),
  ('yangchen', '$2a$12$zYNiR4eVjd8Kipes112NY.cESJ80THgSKrKLwrOV6ssPgGk01xojy', '杨晨',   'head_nurse'),
  ('nurse01',  '$2a$12$zYNiR4eVjd8Kipes112NY.cESJ80THgSKrKLwrOV6ssPgGk01xojy', '护士01', 'nurse'),
  ('doctor01', '$2a$12$zYNiR4eVjd8Kipes112NY.cESJ80THgSKrKLwrOV6ssPgGk01xojy', '主治医生01', 'doctor'),
  ('qc01',     '$2a$12$zYNiR4eVjd8Kipes112NY.cESJ80THgSKrKLwrOV6ssPgGk01xojy', '质控员01', 'quality')
ON CONFLICT (username) DO NOTHING;
