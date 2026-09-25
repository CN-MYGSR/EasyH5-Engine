/* ============================================================
   shot-final.js — 最终演示截图
   ============================================================ */
const path = require('path');
const fs = require('fs');
const { launch, waitFor, sleep } = require('./cdp.js');

const ROOT = path.resolve(__dirname, '..');
const TARGET = 'file:///' + path.join(ROOT, 'EasyH5Engine.html').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, '_tools', 'shots');

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const B = await launch({ url: TARGET, port: 9471, windowSize: '1680,1000' });
  try {
    await waitFor(() => B.cdp.ev('!!window.EH5App'), 20000, 'App');
    await sleep(1000);

    /* ---------- 贴图演示：透视 ---------- */
    await B.cdp.ev("EH5App.loadSample('textures')");
    await sleep(1200);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1800);
    await B.cdp.ev("EH5App.rt.r3d.cameraPos(0, 5.5, 13, 0, 1.6, 0)");
    await sleep(900);
    await B.cdp.shot(path.join(SHOTS, '80-demo-persp.png'), '#stage-frame', 3);

    /* ---------- 贴图演示：正交 ---------- */
    await B.cdp.ev(`(function(){
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'r'}));
      window.dispatchEvent(new KeyboardEvent('keyup',{key:'r'}));
    })()`);
    await sleep(900);
    const p = await B.cdp.ev("EH5App.rt.r3d.projection");
    console.log('  按 R 后投影 =', p);
    await B.cdp.shot(path.join(SHOTS, '81-demo-ortho.png'), '#stage-frame', 3);

    /* ---------- 整页总览（含搜索 + 贴图示例的积木） ---------- */
    await B.cdp.ev("EH5App.category='three'; EH5App._buildPalette();");
    await sleep(400);
    await B.cdp.shot(path.join(SHOTS, '82-overview.png'), null, 1);

    /* ---------- 搜索界面 ---------- */
    await B.cdp.ev(`(function(){
      var i = document.getElementById('block-search');
      i.value = '手柄';
      i.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(500);
    await B.cdp.shot(path.join(SHOTS, '83-search.png'), '#palette', 2);
    await B.cdp.ev("document.getElementById('block-search-clear').click()");

    console.log('截图完成');
  } finally {
    B.close();
  }
})().catch(e => { console.error('截图出错：', e.message, '\n', e.stack); process.exitCode = 1; });
