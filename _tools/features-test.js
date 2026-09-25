/* ============================================================
   features-test.js — 手柄 / 广告牌 / 正交相机 / 积木搜索 / 暂停
   手柄用「替换 navigator.getGamepads」的方式注入模拟设备
   ============================================================ */
const path = require('path');
const fs = require('fs');
const { launch, waitFor, sleep } = require('./cdp.js');

const ROOT = path.resolve(__dirname, '..');
const TARGET = 'file:///' + path.join(ROOT, 'EasyH5Engine.html').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, '_tools', 'shots');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  [OK]   ' : '  [FAIL] ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

const MOCK_PAD = `
window.__pad = {
  id: 'Mock Pad (STANDARD GAMEPAD Vendor: 0000 Product: 0000)',
  index: 0, connected: true, mapping: 'standard', timestamp: 0,
  buttons: [], axes: [0, 0, 0, 0],
  vibrationActuator: {
    playEffect: function(type, o){ window.__vib = { type: type, o: o }; return Promise.resolve('complete'); }
  }
};
for (var i = 0; i < 17; i++) window.__pad.buttons.push({ pressed: false, touched: false, value: 0 });
window.__pads = [window.__pad];
Object.defineProperty(navigator, 'getGamepads', {
  configurable: true,
  value: function(){ return window.__pads; }
});
window.__setBtn = function(i, on){
  window.__pad.buttons[i].pressed = !!on;
  window.__pad.buttons[i].value = on ? 1 : 0;
};
window.__setAxis = function(i, v){ window.__pad.axes[i] = v; };
`;

/* 搭一个把所有手柄状态写进变量的脚本 */
const BUILD_SCRIPT = `
(function(){
  var M = EH5Model;
  EH5App.loadSample('blank');
  var p = EH5App.project;
  p.variables = [
    {name:'连接', value:'', visible:true},
    {name:'按钮A', value:'', visible:true},
    {name:'摇杆X', value:'', visible:true},
    {name:'名字', value:'', visible:true},
    {name:'按下次数', value:0, visible:true}
  ];

  /* 每帧刷新状态的循环 */
  var forever = M.Bk('control_forever');
  M.sub(forever, 'SUBSTACK', M.chain(
    M.Bk('data_setvariableto', { VALUE: M.Bk('sensing_gamepadbutton', null, { BTN: '0' }) }, { VAR: '按钮A' }),
    M.Bk('data_setvariableto', { VALUE: M.Bk('sensing_gamepadaxis', null, { STICK: 'left', DIR: 'h' }) }, { VAR: '摇杆X' })
  ));

  var s = p.sprites[0];
  s.scripts = [
    M.chain(
      M.Bk('event_whenflagclicked'),
      M.Bk('data_setvariableto', { VALUE: M.Bk('sensing_gamepadconnected') }, { VAR: '连接' }),
      M.Bk('data_setvariableto', { VALUE: M.Bk('sensing_gamepadbutton', null, { BTN: '0' }) }, { VAR: '按钮A' }),
      M.Bk('data_setvariableto', { VALUE: M.Bk('sensing_gamepadaxis', null, { STICK: 'left', DIR: 'h' }) }, { VAR: '摇杆X' }),
      M.Bk('data_setvariableto', { VALUE: M.Bk('sensing_gamepadname') }, { VAR: '名字' }),
      M.Bk('sensing_gamepadvibrate', { I: 80, MS: 120 }),
      forever
    ),
    M.chain(
      M.Bk('event_whengamepadbutton', null, { BTN: '0' }),
      M.Bk('data_changevariableby', { VALUE: 1 }, { VAR: '按下次数' })
    )
  ];
  EH5App.refreshAll();
})();
`;

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const B = await launch({ url: TARGET, port: 9431, windowSize: '1680,1000' });
  try {
    await waitFor(() => B.cdp.ev('!!window.EH5App'), 20000, 'App');
    await sleep(1000);
    await B.cdp.ev(MOCK_PAD);

    /* ============================================================
       1. 手柄
       ============================================================ */
    console.log('=== 1. 手柄支持 ===');
    await B.cdp.ev(BUILD_SCRIPT);
    await sleep(600);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(700);

    const pad0 = await B.cdp.ev(`(function(){
      var rt = EH5App.rt;
      return JSON.stringify({
        count: rt.gamepadCount,
        hasPad: !!rt.pad,
        v连接: rt.varGet('连接'),
        v按钮A: rt.varGet('按钮A'),
        v摇杆X: rt.varGet('摇杆X'),
        v名字: String(rt.varGet('名字')).slice(0, 20),
        vib: window.__vib ? window.__vib.type : null
      });
    })()`);
    const p0 = JSON.parse(pad0);
    check('运行时检测到手柄', p0.count === 1 && p0.hasPad, pad0);
    check('「手柄已连接?」积木返回真', p0.v连接 === true, String(p0.v连接));
    check('未按时「手柄按下 A?」为假', p0.v按钮A === false, String(p0.v按钮A));
    check('「手柄名称」积木读到了设备名', p0.v名字.indexOf('Mock Pad') === 0, p0.v名字);
    check('震动积木调用了 haptic 接口', p0.vib === 'dual-rumble', String(p0.vib));

    /* 按下 A */
    await B.cdp.ev("__setBtn(0, true)");
    await sleep(500);
    const pad1 = await B.cdp.ev(`JSON.stringify({v按钮A: EH5App.rt.varGet('按钮A'), 次数: EH5App.rt.varGet('按下次数')})`);
    const p1 = JSON.parse(pad1);
    check('按下 A 后「手柄按下 A?」为真', p1.v按钮A === true, pad1);
    check('「当按下手柄 A 键」帽子积木被触发', p1.次数 >= 1, p1.次数 + ' 次');

    /* 摇杆 */
    await B.cdp.ev("__setAxis(0, 0.75); __setAxis(1, -0.5)");
    await sleep(400);
    const pad2 = await B.cdp.ev(`(function(){
      var rt = EH5App.rt;
      return JSON.stringify({
        v摇杆X: rt.varGet('摇杆X'),
        axisH: rt.padAxis('left','h'),
        axisV: rt.padAxis('left','v')
      });
    })()`);
    const p2 = JSON.parse(pad2);
    check('摇杆水平值能读到模拟量', p2.v摇杆X === 0.75, pad2);
    check('摇杆垂直方向已翻转（上=正）', p2.axisV === 0.5, 'raw -0.5 → ' + p2.axisV);

    /* 拔掉手柄 */
    await B.cdp.ev("window.__pads = []");
    await sleep(400);
    const pad3 = await B.cdp.ev(`JSON.stringify({count: EH5App.rt.gamepadCount, has: !!EH5App.rt.pad})`);
    check('拔掉后运行时状态跟着变', JSON.parse(pad3).count === 0 && !JSON.parse(pad3).has, pad3);
    await B.cdp.ev("window.__pads = [window.__pad]; __setBtn(0,false); __setAxis(0,0)");
    await sleep(300);

    const padStatus = await B.cdp.ev("document.getElementById('st-pad').textContent");
    check('状态栏显示手柄状态', padStatus.indexOf('手柄') >= 0, padStatus);

    /* ============================================================
       1b. 键盘 / 点击 帽子积木
       ============================================================ */
    console.log('\n=== 1b. 键盘与点击帽子积木 ===');
    await B.cdp.ev(`(function(){
      var M = EH5Model;
      EH5App.loadSample('blank');
      var p = EH5App.project;
      p.variables = [
        {name:'按R次数', value:0, visible:true},
        {name:'点角色次数', value:0, visible:true},
        {name:'点舞台次数', value:0, visible:true}
      ];
      var s = p.sprites[0];
      s.name = '可点角色'; s.x = 0; s.y = 0;
      s.costumes[0].w = 120; s.costumes[0].h = 120;
      s.scripts = [
        M.chain(M.Bk('event_whenkeypressed', null, { KEY: 'r' }),
          M.Bk('data_changevariableby', { VALUE: 1 }, { VAR: '按R次数' })),
        M.chain(M.Bk('event_whenthisspriteclicked'),
          M.Bk('data_changevariableby', { VALUE: 1 }, { VAR: '点角色次数' })),
        M.chain(M.Bk('event_whenstageclicked'),
          M.Bk('data_changevariableby', { VALUE: 1 }, { VAR: '点舞台次数' }))
      ];
      EH5App.refreshAll();
    })()`);
    await sleep(600);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(600);

    const hat0 = await B.cdp.ev(`JSON.stringify({
      r: EH5App.rt.varGet('按R次数'), s: EH5App.rt.varGet('点角色次数'), t: EH5App.rt.varGet('点舞台次数')
    })`);
    check('帽子积木初始未触发', JSON.parse(hat0).r === 0 && JSON.parse(hat0).t === 0, hat0);

    /* 按 R */
    await B.cdp.ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'r'}))");
    await sleep(400);
    const hat1 = await B.cdp.ev("JSON.stringify({r: EH5App.rt.varGet('按R次数')})");
    check('「当按下 R 键」触发一次', JSON.parse(hat1).r === 1, hat1);

    /* 长按（不发 keyup 再来一次 keydown）不应该重复触发 */
    await B.cdp.ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'r'}))");
    await sleep(300);
    const hat2 = await B.cdp.ev("JSON.stringify({r: EH5App.rt.varGet('按R次数')})");
    check('长按不会每帧重放', JSON.parse(hat2).r === 1, hat2);

    /* 松开再按 -> 再触发一次 */
    await B.cdp.ev("window.dispatchEvent(new KeyboardEvent('keyup',{key:'r'}))");
    await sleep(150);
    await B.cdp.ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'r'}))");
    await sleep(350);
    const hat3 = await B.cdp.ev("JSON.stringify({r: EH5App.rt.varGet('按R次数')})");
    check('松开再按会再次触发', JSON.parse(hat3).r === 2, hat3);
    await B.cdp.ev("window.dispatchEvent(new KeyboardEvent('keyup',{key:'r'}))");

    /* 点角色：在舞台正中按一下 */
    await B.cdp.ev(`(function(){
      var host = document.getElementById('stage-host');
      var r = host.getBoundingClientRect();
      host.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, isPrimary: true,
        clientX: r.left + r.width/2, clientY: r.top + r.height/2
      }));
    })()`);
    await sleep(400);
    const hat4 = await B.cdp.ev("JSON.stringify({s: EH5App.rt.varGet('点角色次数'), t: EH5App.rt.varGet('点舞台次数')})");
    check('点中角色触发「当角色被点击」', JSON.parse(hat4).s === 1, hat4);
    check('点角色同时触发「当舞台被点击」', JSON.parse(hat4).t === 1, hat4);

    /* 点空白角落：只触发舞台 */
    await B.cdp.ev(`(function(){
      var host = document.getElementById('stage-host');
      var r = host.getBoundingClientRect();
      host.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, isPrimary: true,
        clientX: r.left + 6, clientY: r.top + 6
      }));
    })()`);
    await sleep(400);
    const hat5 = await B.cdp.ev("JSON.stringify({s: EH5App.rt.varGet('点角色次数'), t: EH5App.rt.varGet('点舞台次数')})");
    check('点空白处只触发「当舞台被点击」', JSON.parse(hat5).s === 1 && JSON.parse(hat5).t === 2, hat5);

    /* ============================================================
       2. 广告牌 + 正交相机
       ============================================================ */
    console.log('\n=== 2. 3D 广告牌 / 正交相机 ===');
    await B.cdp.ev(`(function(){
      var M = EH5Model;
      EH5App.loadSample('blank');
      EH5App.setMode('3d');                 // 走正规路径，别直接改 stage.mode
      var p = EH5App.project;
      var o = M.createObject3d('立牌', 'plane', '#ffd93d');
      o.w = 2; o.d = 2; o.y = 2; o.z = -3;
      p.objects3d.push(o);
      EH5App.refreshAll();
    })()`);
    await sleep(900);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(600);

    /* 开广告牌 */
    await B.cdp.ev("EH5App.rt.r3d.setBillboard('立牌', true)");
    await sleep(300);
    const bb = await B.cdp.ev(`(function(){
      var rt = EH5App.rt;
      var o = rt.r3d.get('立牌');
      var q1 = o._mesh.quaternion.clone();
      rt.r3d.cameraPos(9, 7, 9, 0, 1, 0);      // 换个相机角度
      return JSON.stringify({ before: [q1.x, q1.y, q1.z, q1.w] });
    })()`);
    await sleep(400);
    const bb2 = await B.cdp.ev(`(function(){
      var rt = EH5App.rt;
      var o = rt.r3d.get('立牌');
      var c = rt.r3d.camera;
      var d = Math.abs(o._mesh.quaternion.x - c.quaternion.x) +
              Math.abs(o._mesh.quaternion.y - c.quaternion.y) +
              Math.abs(o._mesh.quaternion.z - c.quaternion.z) +
              Math.abs(o._mesh.quaternion.w - c.quaternion.w);
      return JSON.stringify({ billboard: o.billboard, diff: Math.round(d*1e5)/1e5 });
    })()`);
    const b2 = JSON.parse(bb2);
    check('广告牌标记已生效', b2.billboard === true, bb2);
    check('换相机角度后物体朝向跟着转（差值≈0）', b2.diff < 0.001, 'quaternion 差 ' + b2.diff);
    void bb;

    /* 关广告牌 -> 恢复固定朝向 */
    await B.cdp.ev("EH5App.rt.r3d.setBillboard('立牌', false)");
    await sleep(200);
    const bb3 = await B.cdp.ev(`JSON.stringify({billboard: EH5App.rt.r3d.get('立牌').billboard})`);
    check('关掉广告牌后恢复固定朝向', JSON.parse(bb3).billboard === false, bb3);

    /* 正交相机 */
    const ortho = await B.cdp.ev(`(function(){
      var rt = EH5App.rt;
      rt.r3d.setProjection('ortho', 12);
      return JSON.stringify({
        proj: rt.r3d.projection,
        isOrtho: !!rt.r3d.camera.isOrthographicCamera,
        frustum: rt.r3d.frustumSize,
        top: Math.round(rt.r3d.camera.top*10)/10
      });
    })()`);
    const or = JSON.parse(ortho);
    check('切到正交投影', or.proj === 'ortho' && or.isOrtho, ortho);
    check('正交视野大小生效', or.frustum === 12 && or.top === 6, 'frustum=' + or.frustum + ' top=' + or.top);

    await B.cdp.shot(path.join(SHOTS, '60-ortho.png'), '#stage-frame', 3);

    const back = await B.cdp.ev(`(function(){
      EH5App.rt.r3d.setProjection('perspective', 10);
      return JSON.stringify({proj: EH5App.rt.r3d.projection, isPersp: !!EH5App.rt.r3d.camera.isPerspectiveCamera});
    })()`);
    check('能切回透视投影', JSON.parse(back).proj === 'perspective' && JSON.parse(back).isPersp, back);

    /* 积木层 */
    const viaBlock = await B.cdp.ev(`(function(){
      var M = EH5Model;
      var b = M.Bk('three_cameramode', { F: 8 }, { MODE: 'ortho' });
      var rt = EH5App.rt;
      EH5Runtime.STACKS.three_cameramode(rt, b, { target: rt.sprites[0] });
      var ok = rt.r3d.projection === 'ortho' && rt.r3d.frustumSize === 8;
      var b2 = M.Bk('three_setbillboard', null, { OBJ: '立牌', MODE: 'on' });
      EH5Runtime.STACKS.three_setbillboard(rt, b2, { target: rt.sprites[0] });
      return JSON.stringify({ camMode: ok, billboard: rt.r3d.get('立牌').billboard });
    })()`);
    check('「相机用…投影」积木生效', JSON.parse(viaBlock).camMode, viaBlock);
    check('「将…设为始终面向相机」积木生效', JSON.parse(viaBlock).billboard === true, viaBlock);

    /* ============================================================
       3. 积木搜索
       ============================================================ */
    console.log('\n=== 3. 积木搜索 ===');
    const searchOff = await B.cdp.ev("document.querySelectorAll('#block-list .blk').length");
    await B.cdp.ev(`(function(){
      var i = document.getElementById('block-search');
      i.value = '手柄';
      i.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(400);
    const s1 = await B.cdp.ev(`(function(){
      return JSON.stringify({
        heads: document.querySelectorAll('#block-list .pal-cat-head').length,
        blocks: document.querySelectorAll('#block-list .blk').length,
        hasSearchClass: document.getElementById('palette-search').classList.contains('has-text'),
        firstText: (document.querySelector('#block-list h4')||{}).textContent || ''
      });
    })()`);
    const sr = JSON.parse(s1);
    check('搜索「手柄」有结果', sr.blocks >= 4, sr.blocks + ' 块');
    check('结果按分类分组显示', sr.heads >= 1, sr.heads + ' 个分类标题');
    check('搜索框进入激活态（出现清除按钮）', sr.hasSearchClass);
    check('标题显示结果数', /结果/.test(sr.firstText), sr.firstText);

    /* 跨分类：搜「3D」应该同时命中 3D 分类和别的分类里的 3D 积木 */
    await B.cdp.ev(`(function(){
      var i = document.getElementById('block-search');
      i.value = '随机';
      i.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(400);
    const s2 = await B.cdp.ev("document.querySelectorAll('#block-list .blk').length");
    check('换关键词结果跟着变', s2 !== sr.blocks && s2 >= 1, '手柄=' + sr.blocks + ' → 随机=' + s2);

    /* 搜积木类型名（英文） */
    await B.cdp.ev(`(function(){
      var i = document.getElementById('block-search');
      i.value = 'three_';
      i.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(400);
    const s3 = await B.cdp.ev("document.querySelectorAll('#block-list .blk').length");
    check('能用英文类型名搜索', s3 >= 20, s3 + ' 块 3D 积木');

    /* 无结果 */
    await B.cdp.ev(`(function(){
      var i = document.getElementById('block-search');
      i.value = 'zzzz不存在zzzz';
      i.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(400);
    const s4 = await B.cdp.ev("document.querySelector('#block-list .pal-empty') ? 'yes' : 'no'");
    check('无结果时给出提示', s4 === 'yes', s4);

    /* 清除 -> 回到分类视图 */
    await B.cdp.ev("document.getElementById('block-search-clear').click()");
    await sleep(400);
    const s5 = await B.cdp.ev(`JSON.stringify({
      blocks: document.querySelectorAll('#block-list .blk').length,
      hasText: document.getElementById('palette-search').classList.contains('has-text')
    })`);
    const s5o = JSON.parse(s5);
    check('清除后回到分类视图', s5o.blocks === searchOff && !s5o.hasText,
      s5o.blocks + ' 块（原来 ' + searchOff + '）');

    await B.cdp.ev(`(function(){
      var i = document.getElementById('block-search');
      i.value = '碰撞';
      i.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(400);
    await B.cdp.shot(path.join(SHOTS, '61-search.png'), '#palette', 2);
    await B.cdp.ev("document.getElementById('block-search-clear').click()");
    await sleep(300);

    /* ============================================================
       4. 暂停
       ============================================================ */
    console.log('\n=== 4. 暂停 / 继续 ===');
    await B.cdp.ev("EH5App.loadSample('platformer')");
    await sleep(700);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(900);

    const before = await B.cdp.ev(`JSON.stringify({frames: EH5App.rt.frameCount, coinDir: Math.round(EH5App.rt.sprites.find(function(s){return s.name==='金币';}).direction)})`);
    await B.cdp.ev("document.getElementById('sbtn-pause').click()");
    await sleep(300);
    const pausedState = await B.cdp.ev(`JSON.stringify({paused: !!EH5App.paused, running: EH5App.rt.running, hooks: (EH5App.rt._resumeHooks||[]).length})`);
    const ps = JSON.parse(pausedState);
    check('暂停后渲染循环停止', ps.paused === true && ps.running === false, pausedState);

    await sleep(900);
    const during = await B.cdp.ev(`JSON.stringify({frames: EH5App.rt.frameCount, coinDir: Math.round(EH5App.rt.sprites.find(function(s){return s.name==='金币';}).direction)})`);
    const bf = JSON.parse(before), dr = JSON.parse(during);
    check('暂停期间帧数不再增长', dr.frames === bf.frames, bf.frames + ' → ' + dr.frames);
    check('暂停期间脚本也冻住（金币不再转）', dr.coinDir === bf.coinDir, bf.coinDir + '° → ' + dr.coinDir + '°');
    check('被冻结的脚本挂在等待队列里', ps.hooks > 0, ps.hooks + ' 个等待中的脚本');

    await B.cdp.ev("document.getElementById('sbtn-pause').click()");
    await sleep(900);
    const after = await B.cdp.ev(`JSON.stringify({paused: !!EH5App.paused, frames: EH5App.rt.frameCount, coinDir: Math.round(EH5App.rt.sprites.find(function(s){return s.name==='金币';}).direction)})`);
    const af = JSON.parse(after);
    check('继续后帧数恢复增长', af.frames > dr.frames && !af.paused, dr.frames + ' → ' + af.frames);
    check('继续后脚本恢复推进', af.coinDir !== dr.coinDir, dr.coinDir + '° → ' + af.coinDir + '°');

    /* ============================================================
       5. 回归
       ============================================================ */
    console.log('\n=== 5. 回归 ===');
    await B.cdp.ev("EH5App.loadSample('fps')");
    await sleep(1200);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1400);
    const reg = await B.cdp.ev(`(function(){
      var rt = EH5App.rt;
      var g = rt.r3d.get('金块');
      return JSON.stringify({objs: rt.r3d.names().length, ry: Math.round(g.ry), err: rt.lastError || ''});
    })()`);
    check('3D 示例仍正常', JSON.parse(reg).objs >= 5 && !JSON.parse(reg).err, reg);

    const blocks = await B.cdp.ev("EH5Blocks.DEFS.filter(function(d){return !d.hidden;}).length");
    check('积木总数已扩充', blocks >= 130, blocks + ' 块');

    console.log('');
    check('全程无未捕获异常', B.cdp.errors.length === 0, B.cdp.errors.slice(0, 3).join(' | ') || '无');

  } finally {
    B.close();
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
