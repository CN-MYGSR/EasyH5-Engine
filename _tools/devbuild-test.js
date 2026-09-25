/* ============================================================
   devbuild-test.js — 验证开发版（index.html + src/）在 HTTP 下能跑
   单文件版走的是内联源码，这条路径不一样，得单独验
   ============================================================ */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { launch, waitFor, sleep } = require('./cdp.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8931;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  [OK]   ' : '  [FAIL] ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(res => srv.listen(PORT, '127.0.0.1', () => res(srv)));
}

(async () => {
  const srv = await serve();
  console.log('静态服务器 http://127.0.0.1:' + PORT + '\n');
  const B = await launch({ url: 'http://127.0.0.1:' + PORT + '/index.html', port: 9451, windowSize: '1680,1000' });
  try {
    await waitFor(() => B.cdp.ev('!!window.EH5App'), 25000, '开发版启动');
    await sleep(1200);

    console.log('=== 开发版（多文件） ===');
    check('页面无未捕获异常', B.cdp.errors.length === 0, B.cdp.errors.slice(0, 3).join(' | ') || '无');

    const mods = await B.cdp.ev(`JSON.stringify({
      blocks: typeof EH5Blocks !== 'undefined',
      model: typeof EH5Model !== 'undefined',
      samples: typeof EH5Samples !== 'undefined' && EH5Samples.length,
      models3d: typeof EH5Models !== 'undefined',
      runtime: typeof EH5Runtime !== 'undefined',
      render2d: typeof EH5Render2D !== 'undefined',
      render3d: typeof EH5Render3D !== 'undefined',
      workspace: typeof EH5Workspace !== 'undefined',
      three: typeof THREE !== 'undefined' && THREE.REVISION
    })`);
    const m = JSON.parse(mods);
    check('9 个模块都加载了', m.blocks && m.model && m.runtime && m.render2d && m.render3d && m.workspace && m.models3d, mods);
    check('示例齐全', m.samples >= 7, m.samples + ' 个');
    check('Three.js 就位', !!m.three, 'r' + m.three);

    const ui = await B.cdp.ev(`JSON.stringify({
      cats: document.querySelectorAll('#cat-rail .cat').length,
      blocks: document.querySelectorAll('#block-list .blk').length,
      search: !!document.getElementById('block-search'),
      pause: !!document.getElementById('sbtn-pause'),
      pad: !!document.getElementById('st-pad'),
      assets: !!document.getElementById('st-assets')
    })`);
    const u = JSON.parse(ui);
    check('分类栏完整', u.cats === 11, u.cats);
    check('调色板有积木', u.blocks > 0, u.blocks);
    check('新增控件都在（搜索/暂停/手柄/素材）', u.search && u.pause && u.pad && u.assets, ui);

    /* 跑一遍 2D */
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1400);
    const run = await B.cdp.ev(`JSON.stringify({
      frames: EH5App.rt.frameCount,
      coinDir: Math.round(EH5App.rt.sprites.find(function(s){return s.name==='金币';}).direction),
      err: EH5App.rt.lastError || ''
    })`);
    check('2D 示例正常运行', JSON.parse(run).frames > 30 && !JSON.parse(run).err, run);

    /* 3D */
    await B.cdp.ev("EH5App.loadSample('fps')");
    await sleep(1300);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1400);
    const run3 = await B.cdp.ev(`JSON.stringify({
      objs: EH5App.rt.r3d.names().length,
      proj: EH5App.rt.r3d.projection,
      err: EH5App.rt.lastError || ''
    })`);
    check('3D 示例正常运行', JSON.parse(run3).objs >= 5 && !JSON.parse(run3).err, run3);

    /* 开发版导出：走 fetch 读源码那条路径 */
    const exported = await B.cdp.ev(`(async function(){
      try {
        var src = await EH5App._runtimeSource();
        var html = EH5BuildStandalone(EH5App.projectJSON(), src);
        return 'ok:' + html.length;
      } catch (e) { return 'err:' + e.message; }
    })()`);
    check('开发版也能导出独立 HTML（走 fetch 路径）', String(exported).indexOf('ok:') === 0, exported);

    check('全程无未捕获异常', B.cdp.errors.length === 0, B.cdp.errors.slice(0, 3).join(' | ') || '无');

  } finally {
    B.close();
    srv.close();
  }

  const fail = results.filter(r => !r.ok);
  console.log('\n============================================');
  console.log('  共 ' + results.length + ' 项，通过 ' + (results.length - fail.length) + '，失败 ' + fail.length);
  console.log('============================================');
  if (fail.length) { fail.forEach(f => console.log('  ✗ ' + f.name + ' → ' + f.detail)); process.exitCode = 1; }
})().catch(e => {
  console.error('测试脚本出错：', e.message);
  console.error(e.stack);
  process.exitCode = 2;
});
