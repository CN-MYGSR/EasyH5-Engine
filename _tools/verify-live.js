/* 验证线上发布的作品真的能跑（含 3D 渲染） */
const { launch, sleep } = require('./cdp.js');
const U = 'https://apps.gamesvibe.app/easyh5-engine/_releases/is3ZilDX_x8tbDbBP7hkN/';
const q = (B, e, ms) => Promise.race([
  B.cdp.ev(e), new Promise((_, r) => setTimeout(() => r(new Error('超时')), ms || 15000))
]);
const R = [];
const ck = (n, ok, d) => { R.push({ n, ok, d }); console.log((ok ? '  [OK]   ' : '  [FAIL] ') + n + (d ? '  → ' + d : '')); };
(async () => {
  const B = await launch({ url: U, port: 9506, windowSize: '1680,1000' });
  try {
    await sleep(7000);
    ck('线上页面无未捕获异常', B.cdp.errors.length === 0, B.cdp.errors.slice(0, 2).join(' | ') || '无');
    ck('引擎已初始化', (await q(B, 'typeof window.EH5App')) === 'object');
    ck('积木分类齐全', (await q(B, 'document.querySelectorAll("#cat-rail .cat").length')) === 11);
    ck('积木数量正确', (await q(B, 'EH5Blocks.DEFS.filter(function(d){return !d.hidden;}).length')) >= 147);
    ck('Three.js 就位', (await q(B, 'THREE.REVISION')) === '160');

    /* 跑 2D 示例 */
    await B.cdp.ev("EH5App.loadSample('platformer')");
    await sleep(1200);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1800);
    const r2 = await q(B, `JSON.stringify({frames: EH5App.rt.frameCount, err: EH5App.rt.lastError || ''})`);
    const o2 = JSON.parse(r2);
    ck('线上 2D 示例正常运行', o2.frames > 30 && !o2.err, r2);

    /* 跑 3D 示例 */
    await B.cdp.ev("EH5App.loadSample('textures')");
    await sleep(1500);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(2400);
    const r3 = await q(B, `JSON.stringify({
      objs: EH5App.rt.r3d.names().length,
      mapped: !!(EH5App.rt.r3d.get('贴图箱')||{})._mesh.material.map,
      billboard: (EH5App.rt.r3d.get('广告牌')||{}).billboard,
      frames: EH5App.rt.frameCount, err: EH5App.rt.lastError || ''
    })`);
    const o3 = JSON.parse(r3);
    ck('线上 3D 示例正常运行', o3.objs >= 4 && o3.frames > 30 && !o3.err, r3);
    ck('线上贴图生效', o3.mapped === true, r3);
    ck('线上广告牌生效', o3.billboard === true, r3);

    await B.cdp.shot('D:/EasyH5Engie/_tools/shots/91-live.png', null, 1);
    console.log('  -> 91-live.png');
    const fail = R.filter(x => !x.ok);
    console.log('\n线上验证：共 ' + R.length + ' 项，通过 ' + (R.length - fail.length) + '，失败 ' + fail.length);
    if (fail.length) process.exitCode = 1;
  } finally { B.close(); }
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; });
