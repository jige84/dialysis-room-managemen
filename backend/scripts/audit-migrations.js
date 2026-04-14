/**
 * 迁移脚本审计：序号连续性、命名规范、重复号检测
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const migrationsDir = path.join(repoRoot, 'backend', 'migrations');
const outDir = path.join(repoRoot, 'docs', 'qa', 'release-hardening', 'generated');
const outFile = path.join(outDir, 'migration-audit.md');

function main() {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const nums = [];
  const invalidName = [];

  for (const f of files) {
    const m = /^(\d{3})_[a-z0-9_]+\.sql$/i.exec(f);
    if (!m) {
      invalidName.push(f);
      continue;
    }
    nums.push(Number(m[1]));
  }

  const duplicates = [];
  const seen = new Set();
  for (const n of nums) {
    if (seen.has(n)) duplicates.push(n);
    seen.add(n);
  }

  const gaps = [];
  const min = nums.length ? Math.min(...nums) : 1;
  const max = nums.length ? Math.max(...nums) : 0;
  for (let i = min; i <= max; i += 1) {
    if (!seen.has(i)) gaps.push(i);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const md = [
    '# Migration Audit',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 总脚本数：${files.length}`,
    `- 最小编号：${min}`,
    `- 最大编号：${max}`,
    '',
    '## 结果',
    '',
    `- 命名不规范：${invalidName.length === 0 ? '无' : invalidName.join(', ')}`,
    `- 重复编号：${duplicates.length === 0 ? '无' : duplicates.join(', ')}`,
    `- 缺失编号：${gaps.length === 0 ? '无' : gaps.join(', ')}`,
    '',
    '## 文件清单',
    '',
    '```text',
    ...files,
    '```',
    '',
  ].join('\n');

  fs.writeFileSync(outFile, md, 'utf8');
  console.log(`Generated: ${outFile}`);

  if (invalidName.length > 0 || duplicates.length > 0 || gaps.length > 0) {
    process.exitCode = 1;
  }
}

main();

