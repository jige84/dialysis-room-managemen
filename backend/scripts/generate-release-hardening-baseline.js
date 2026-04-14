/**
 * 生成上线硬化基线清单（golden baseline）
 * 输出：
 *  - docs/qa/release-hardening/generated/golden-baseline.json
 *  - docs/qa/release-hardening/generated/golden-baseline.md
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const backendRoot = path.join(repoRoot, 'backend');
const frontendRoot = path.join(repoRoot, 'frontend');
const outputDir = path.join(repoRoot, 'docs', 'qa', 'release-hardening', 'generated');
const outputJson = path.join(outputDir, 'golden-baseline.json');
const outputMd = path.join(outputDir, 'golden-baseline.md');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function listFilesRecursive(dir, predicate) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...listFilesRecursive(abs, predicate));
    } else if (predicate(abs)) {
      out.push(abs);
    }
  }
  return out;
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return '';
  }
}

function parseRouteInventory() {
  const serverPath = path.join(backendRoot, 'src', 'server.js');
  const serverText = readText(serverPath);

  const varToRouteFile = new Map();
  const requireRe = /const\s+(\w+)\s*=\s*require\('\.\/routes\/([^']+)'\);/g;
  for (let m = requireRe.exec(serverText); m; m = requireRe.exec(serverText)) {
    varToRouteFile.set(m[1], `${m[2]}.js`);
  }

  const routeFileToPrefix = new Map();
  const useRe = /app\.use\('([^']+)'\s*,\s*(\w+)\);/g;
  for (let m = useRe.exec(serverText); m; m = useRe.exec(serverText)) {
    const routeFile = varToRouteFile.get(m[2]);
    if (routeFile) routeFileToPrefix.set(routeFile, m[1]);
  }

  const routesDir = path.join(backendRoot, 'src', 'routes');
  const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).sort();
  const endpoints = [];
  const endpointRe = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;

  for (const file of files) {
    const fullPath = path.join(routesDir, file);
    const text = readText(fullPath);
    const prefix = routeFileToPrefix.get(file);
    if (!prefix) continue;
    for (let m = endpointRe.exec(text); m; m = endpointRe.exec(text)) {
      const method = m[1].toUpperCase();
      const p = m[2];
      let fullPathRoute = prefix;
      if (p !== '/') {
        fullPathRoute = `${prefix}${p.startsWith('/') ? p : `/${p}`}`;
      }
      endpoints.push({
        method,
        path: fullPathRoute,
        source: path.relative(repoRoot, fullPath).replaceAll('\\', '/'),
      });
    }
  }

  endpoints.sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`));
  return endpoints;
}

function parseCronInventory() {
  const jobsDir = path.join(backendRoot, 'src', 'jobs');
  const jobFiles = listFilesRecursive(jobsDir, (f) => f.endsWith('.js'));
  const cronRe = /cron\.schedule\(\s*['"`]([^'"`]+)['"`]/g;
  const rows = [];
  for (const file of jobFiles) {
    const text = readText(file);
    for (let m = cronRe.exec(text); m; m = cronRe.exec(text)) {
      rows.push({
        cron: m[1],
        source: path.relative(repoRoot, file).replaceAll('\\', '/'),
      });
    }
  }
  return rows;
}

function parseMigrations() {
  const migrationsDir = path.join(backendRoot, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  return files;
}

function scanFormulaAnchors() {
  const targets = [
    ...listFilesRecursive(path.join(backendRoot, 'src'), (f) => f.endsWith('.js')),
    ...listFilesRecursive(path.join(frontendRoot, 'src'), (f) => f.endsWith('.ts') || f.endsWith('.tsx')),
  ];

  const specs = [
    { key: 'daugirdas_formula', re: /0\.008\s*\*/i },
    { key: 'ktv_threshold', re: /ktv\s*>=\s*1\.2|sp_?ktv\s*>=\s*1\.2/i },
    { key: 'urr_threshold', re: /urr\s*>=\s*65/i },
    { key: 'uf_5pct_threshold', re: /uf.*>\s*5|>\s*5%/i },
  ];

  const hits = [];
  for (const file of targets) {
    const lines = readText(file).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const spec of specs) {
        if (spec.re.test(line)) {
          hits.push({
            key: spec.key,
            source: path.relative(repoRoot, file).replaceAll('\\', '/'),
            line: i + 1,
            snippet: line.trim(),
          });
        }
      }
    }
  }
  return hits;
}

function toMarkdown(data) {
  const lines = [];
  lines.push('# Golden Baseline');
  lines.push('');
  lines.push(`- 生成时间：${data.generatedAt}`);
  lines.push(`- 分支：\`${data.git.branch || 'unknown'}\``);
  lines.push(`- HEAD：\`${data.git.head || 'unknown'}\``);
  lines.push('');
  lines.push('## Git Snapshot');
  lines.push('');
  lines.push('```text');
  lines.push(data.git.statusShort || '(clean)');
  lines.push('```');
  lines.push('');
  lines.push('## Route Inventory');
  lines.push('');
  lines.push(`总计：${data.routes.length} 个路由端点`);
  lines.push('');
  lines.push('| Method | Path | Source |');
  lines.push('|---|---|---|');
  for (const r of data.routes) {
    lines.push(`| ${r.method} | \`${r.path}\` | \`${r.source}\` |`);
  }
  lines.push('');
  lines.push('## Scheduled Jobs');
  lines.push('');
  lines.push('| Cron | Source |');
  lines.push('|---|---|');
  for (const j of data.cronJobs) {
    lines.push(`| \`${j.cron}\` | \`${j.source}\` |`);
  }
  lines.push('');
  lines.push('## Migrations');
  lines.push('');
  lines.push(`总计：${data.migrations.length} 个迁移脚本`);
  lines.push('');
  lines.push('```text');
  lines.push(data.migrations.join('\n'));
  lines.push('```');
  lines.push('');
  lines.push('## Medical Formula Anchors');
  lines.push('');
  lines.push('| Key | Source | Line | Snippet |');
  lines.push('|---|---|---:|---|');
  for (const f of data.formulaAnchors) {
    lines.push(`| ${f.key} | \`${f.source}\` | ${f.line} | ${f.snippet.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const data = {
    generatedAt: new Date().toISOString(),
    git: {
      branch: safeExec('git rev-parse --abbrev-ref HEAD'),
      head: safeExec('git rev-parse --short HEAD'),
      statusShort: safeExec('git status --short'),
    },
    routes: parseRouteInventory(),
    cronJobs: parseCronInventory(),
    migrations: parseMigrations(),
    formulaAnchors: scanFormulaAnchors(),
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outputMd, `${toMarkdown(data)}\n`, 'utf8');

  console.log(`Generated:\n- ${outputJson}\n- ${outputMd}`);
}

main();

