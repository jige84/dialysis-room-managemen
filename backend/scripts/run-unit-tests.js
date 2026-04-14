const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const TEST_ROOT = path.resolve(__dirname, '..', 'tests');
const tests = [];
let currentFile = '';

function registerTest(name, fn, options = {}) {
  if (typeof name !== 'string') {
    throw new Error('test name must be a string');
  }
  if (typeof fn !== 'function') {
    throw new Error(`test "${name}" must provide a function`);
  }
  tests.push({ name, fn, file: currentFile, skip: Boolean(options.skip) });
}

function createTestApi() {
  const test = (name, fn) => registerTest(name, fn);
  test.skip = (name, fn) => registerTest(name, fn, { skip: true });
  test.todo = (name) => registerTest(`${name} (TODO)`, () => {}, { skip: true });
  return test;
}

function listTestFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTestFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out.sort();
}

async function run() {
  if (!fs.existsSync(TEST_ROOT)) {
    console.log('No tests directory found, skipping unit tests.');
    return;
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'node:test') {
      return createTestApi();
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const files = listTestFiles(TEST_ROOT);
    for (const file of files) {
      currentFile = file;
      delete require.cache[require.resolve(file)];
      require(file);
    }
  } finally {
    Module._load = originalLoad;
  }

  if (!tests.length) {
    console.log('No unit tests collected.');
    return;
  }

  let passed = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of tests) {
    const displayName = `${path.relative(TEST_ROOT, t.file)} :: ${t.name}`;
    if (t.skip) {
      skipped += 1;
      console.log(`- SKIP ${displayName}`);
      continue;
    }
    try {
      await Promise.resolve(t.fn());
      passed += 1;
      console.log(`+ PASS ${displayName}`);
    } catch (err) {
      failed += 1;
      console.error(`x FAIL ${displayName}`);
      console.error(err && err.stack ? err.stack : err);
    }
  }

  console.log('\nUnit test summary');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total: ${tests.length}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
