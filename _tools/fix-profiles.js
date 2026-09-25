// 把测试脚本的 Chrome profile 目录从项目内改到系统临时目录，并在结束时清理
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname);

const jobs = [
  ['smoke.js', "path.join(ROOT, '_tools', '.chrome-profile')", "TMPPROF('eh5-smoke')"],
  ['shot.js', "path.join(ROOT, '_tools', '.chrome-profile2')", "TMPPROF('eh5-shot')"],
  ['measure.js', "path.join(ROOT, '_tools', '.chrome-profile3')", "TMPPROF('eh5-measure')"],
  ['diag.js', "path.join(ROOT, '_tools', '.chrome-profile4')", "TMPPROF('eh5-diag')"],
  ['interact.js', "path.join(ROOT, '_tools', '.chrome-p5')", "TMPPROF('eh5-interact')"],
  ['export-test.js', "path.join(ROOT, '_tools', '.chrome-p1')", "TMPPROF('eh5-export-1')"],
  ['export-test.js', "path.join(ROOT, '_tools', '.chrome-p2')", "TMPPROF('eh5-export-2')"]
];

const helper = `
/* 临时 profile 放系统临时目录，避免污染项目 */
const os = require('os');
const TMPPROF = (n) => path.join(os.tmpdir(), n + '-' + process.pid + '-' + Date.now());
`;

const counts = Object.create(null);
let touched = 0;

for (const [file, from, to] of jobs) {
  const p = path.join(dir, file);
  let s = fs.readFileSync(p, 'utf8');
  const n = s.split(from).length - 1;
  if (n === 0) {
    // 已经改过或写法不同：只记数，不报错（幂等）
    counts[file] = (counts[file] || 0);
    continue;
  }
  s = s.split(from).join(to);
  fs.writeFileSync(p, s, 'utf8');
  counts[file] = (counts[file] || 0) + n;
  touched++;
}

// 给每个文件补上 helper（如果还没有）
const files = [...new Set(jobs.map(j => j[0]))];
for (const f of files) {
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('const TMPPROF =')) continue;
  const anchor = "const path = require('path');";
  if (!s.includes(anchor)) throw new Error(f + ' 找不到 path require 锚点');
  const i = s.indexOf(anchor);
  const end = s.indexOf('\n', i) + 1;
  s = s.slice(0, end) + helper + s.slice(end);
  fs.writeFileSync(p, s, 'utf8');
}

for (const f of files) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  console.log(f + '  替换 ' + (counts[f] || 0) + ' 处，TMPPROF 已就位: ' + s.includes('const TMPPROF ='));
}
console.log('改了 ' + touched + ' 处');
