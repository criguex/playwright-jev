import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'pwjev-pack-'));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], root));
const files = packed[0].files.map((f) => f.path);
const required = [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/reporter.js',
  'dist/reporter.cjs',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'package.json',
];
const missing = required.filter((f) => !files.includes(f));
const forbidden = files.filter((f) =>
  /^(src|test|tests|examples|scripts)\/|^\.env|\.jev\//.test(f),
);
if (missing.length || forbidden.length) {
  console.error({ missing, forbidden });
  process.exit(1);
}

writeFileSync(
  join(work, 'package.json'),
  JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
);
run(
  'npm',
  [
    'install',
    '--no-audit',
    '--no-fund',
    '--ignore-scripts',
    join(work, packed[0].filename),
    `@playwright/test@${JSON.parse(run('npm', ['pkg', 'get', 'devDependencies.@playwright/test'], root))}`,
  ],
  work,
);

const expected = [
  'expect',
  'configureJev',
  'jevMatchers',
  'createJevClient',
  'redactors',
  'toMean',
  'toMeanAll',
  'toMeanAny',
  'toBeScored',
  'toChoose',
];
const esm = `import * as m from 'playwright-jev'; import R from 'playwright-jev/reporter';
const miss = ${JSON.stringify(expected)}.filter((k) => !(k in m));
if (miss.length || typeof R !== 'function' || typeof m.expect('x').toMean !== 'function') { console.error('esm', miss); process.exit(1); }
console.log('esm ok');`;
const cjs = `const m = require('playwright-jev'); const r = require('playwright-jev/reporter');
const miss = ${JSON.stringify(expected)}.filter((k) => !(k in m));
if (miss.length || typeof r.default !== 'function') { console.error('cjs', miss); process.exit(1); }
console.log('cjs ok');`;
writeFileSync(join(work, 'esm.mjs'), esm);
writeFileSync(join(work, 'cjs.cjs'), cjs);
process.stdout.write(run('node', ['esm.mjs'], work));
process.stdout.write(run('node', ['cjs.cjs'], work));
console.log(`pack ok: ${packed[0].filename} (${files.length} files, ${packed[0].size} bytes)`);
