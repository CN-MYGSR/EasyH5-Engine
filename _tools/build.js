/* ============================================================
   build.js — 把源码打包成单文件 EasyH5Engine.html
   产物特点：
     · 一个文件，双击就能用，不需要本地服务器
     · 内嵌 three.js 与全部引擎源码，因此「导出独立 HTML」在离线也能用
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'EasyH5Engine.html');

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

/* 内联安全性：源码里绝不能出现脚本结束标签或注释开启符 */
function assertInlineSafe(name, text) {
  const bad = [];
  if (/<\/script/i.test(text)) bad.push('出现了脚本结束标签');
  if (/<!--/.test(text)) bad.push('出现了 HTML 注释开启符');
  if (bad.length) {
    throw new Error('【内联不安全】' + name + '：' + bad.join('、'));
  }
}

/* ---------- 收集源码 ---------- */
const ENGINE_FILES = ['src/blocks.js', 'src/model.js', 'src/render2d.js', 'src/render3d.js', 'src/models.js', 'src/runtime.js'];
const EDITOR_FILES = ['src/samples.js', 'src/workspace.js', 'src/app.js'];

const parts = [];
ENGINE_FILES.forEach(f => {
  const t = read(f);
  assertInlineSafe(f, t);
  parts.push('/* ==================== ' + f + ' ==================== */\n' + t);
});
const engineSrc = parts.join('\n');

const eparts = [];
EDITOR_FILES.forEach(f => {
  const t = read(f);
  assertInlineSafe(f, t);
  eparts.push('/* ==================== ' + f + ' ==================== */\n' + t);
});
const editorSrc = eparts.join('\n');

const threeSrc = read('vendor/three.min.js');
assertInlineSafe('vendor/three.min.js', threeSrc);

const css = read('src/engine.css');
assertInlineSafe('src/engine.css', css);

let html = read('index.html');

/* ---------- 1. 内联 CSS ---------- */
const cssTag = '<link rel="stylesheet" href="src/engine.css">';
if (!html.includes(cssTag)) throw new Error('index.html 里找不到 CSS 引用');
html = html.replace(cssTag, '<style>\n' + css + '\n</style>');

/* ---------- 2. 把外部脚本换成内嵌源码 ---------- */
const scriptRe = /[ \t]*<script src="([^"]+)"><\/script>\r?\n?/g;
const found = [];
let m;
while ((m = scriptRe.exec(html)) !== null) found.push(m[1]);
if (found.length < 8) throw new Error('index.html 里的外部脚本数量异常：' + found.length);

const boot = [
  '<script id="eh5-three-src" type="text/plain">',
  threeSrc,
  '<\/script>',
  '<script id="eh5-engine-src" type="text/plain">',
  engineSrc,
  '<\/script>',
  '<script id="eh5-editor-src" type="text/plain">',
  editorSrc,
  '<\/script>',
  '<script>',
  '(function(){',
  "  var IDS = ['eh5-three-src', 'eh5-engine-src', 'eh5-editor-src'];",
  '  for (var i = 0; i < IDS.length; i++) {',
  '    var host = document.getElementById(IDS[i]);',
  '    if (!host) continue;',
  '    var s = document.createElement("script");',
  '    s.textContent = host.textContent;',
  '    document.head.appendChild(s);',
  '  }',
  '})();',
  '<\/script>'
].join('\n');

/* 替换第一个脚本标签为整块内嵌内容，删掉其余 */
let first = true;
html = html.replace(scriptRe, () => {
  if (first) { first = false; return '\n' + boot + '\n'; }
  return '';
});

/* ---------- 3. 加个生成标记 ---------- */
html = html.replace('<title>', '<!-- 由 build.js 生成，请勿直接编辑；改 src/ 后重新构建 -->\n<title>');

fs.writeFileSync(OUT, html, 'utf8');

const size = fs.statSync(OUT).size;
console.log('构建完成 ->', path.relative(ROOT, OUT));
console.log('  大小：', (size / 1024).toFixed(1), 'KB');
console.log('  引擎源码：', (engineSrc.length / 1024).toFixed(1), 'KB');
console.log('  编辑器源码：', (editorSrc.length / 1024).toFixed(1), 'KB');
console.log('  three.js：', (threeSrc.length / 1024).toFixed(1), 'KB');
