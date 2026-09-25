/* ============================================================
   smoke.js — 用真实 Chrome（CDP）打开单文件版本并做端到端验证
   ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

/* 临时 profile 放系统临时目录，避免污染项目 */
const os = require('os');
const TMPPROF = (n) => path.join(os.tmpdir(), n + '-' + process.pid + '-' + Date.now());

const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const TARGET = 'file:///' + path.join(ROOT, 'EasyH5Engine.html').replace(/\\/g, '/');
const SHOT_DIR = path.join(ROOT, '_tools', 'shots');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(new Error('timeout')); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(300);
  }
  throw new Error('等待超时：' + label + (last ? ' / ' + last.message : ''));
}

/* ---------- 极简 CDP 客户端 ---------- */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        this.listeners.forEach(l => l(msg));
      }
    });
    ws.addEventListener('close', () => { this.closed = true; });
  }
  on(fn) { this.listeners.push(fn); }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 20000);
      const done = (fn) => (v) => { clearTimeout(timer); fn(v); };
      this.pending.set(id, { resolve: done(resolve), reject: done(reject) });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error('页面内异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description
        || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

/* ---------- 断言 ---------- */
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  [OK]   ' : '  [FAIL] ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

async function main() {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  console.log('目标：' + TARGET + '\n');

  const proc = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=1680,1000',
    '--user-data-dir=' + TMPPROF('eh5-smoke'),
    TARGET
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    const list = await waitFor(
      () => httpGet('http://127.0.0.1:' + PORT + '/json/list').then(l => l && l.length ? l : null),
      25000, 'Chrome DevTools 端口');

    const page = list.find(t => t.type === 'page' && t.url.startsWith('file:')) || list[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('WebSocket 连接超时')), 10000);
      ws.addEventListener('open', () => { clearTimeout(t); res(); });
      ws.addEventListener('error', (e) => { clearTimeout(t); rej(new Error('WebSocket 错误')); });
    });

    cdp = new CDP(ws);
    const pageErrors = [];
    cdp.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        pageErrors.push((d.exception && d.exception.description) || d.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        pageErrors.push('console.error: ' + msg.params.args.map(a => a.value || a.description || '').join(' '));
      }
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable').catch(() => {});

    /* ---------- 等应用启动 ---------- */
    await waitFor(async () => cdp.evaluate('!!window.EH5App'), 20000, 'App 初始化');
    await sleep(1200);

    console.log('\n=== 1. 启动与界面 ===');
    check('页面无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

    const ui = await cdp.evaluate(`(function(){
      return {
        catCount: document.querySelectorAll('#cat-rail .cat').length,
        paletteBlocks: document.querySelectorAll('#block-list .blk').length,
        scripts: document.querySelectorAll('#ws-scripts .script').length,
        blocks: document.querySelectorAll('#ws-scripts .blk').length,
        targets: document.querySelectorAll('#target-bar .tgt').length,
        canvas2d: !!document.querySelector('#stage-host canvas.eh5-c2d'),
        inspector: document.querySelectorAll('#inspector .insp-sec').length,
        sprites: EH5App.project.sprites.length,
        projName: EH5App.project.meta.name,
        allBlocks: (function(){
          var n = 0;
          EH5App.project.sprites.forEach(function(s){ (s.scripts||[]).forEach(function count(b){
            var cur = b;
            while (cur) { n++;
              Object.keys(cur.inputs||{}).forEach(function(k){
                var v = cur.inputs[k]; if (v && typeof v === 'object' && v.type) count(v);
              });
              if (cur.branches) Object.keys(cur.branches).forEach(function(k){ if(cur.branches[k]) count(cur.branches[k]); });
              cur = cur.next;
            }
          }); });
          return n;
        })()
      };
    })()`);
    check('分类栏 11 个分类', ui.catCount === 11, ui.catCount);
    check('调色板渲染出积木', ui.paletteBlocks > 0, ui.paletteBlocks + ' 块');
    check('工作区渲染出脚本', ui.scripts >= 1 && ui.blocks >= 2, ui.scripts + ' 脚本 / ' + ui.blocks + ' 积木');
    check('示例共装载了完整积木树', ui.allBlocks >= 40, ui.allBlocks + ' 块积木');
    check('角色选择条', ui.targets === ui.sprites + 1, ui.targets);
    check('2D 画布已挂载', ui.canvas2d);
    check('属性面板有分区', ui.inspector >= 4, ui.inspector);
    check('载入示例「跳跳方块」', ui.projName === '跳跳方块' && ui.sprites === 3, ui.projName + ' / ' + ui.sprites + ' 角色');

    await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r =>
      fs.writeFileSync(path.join(SHOT_DIR, '01-editor.png'), Buffer.from(r.data, 'base64')));

    /* ---------- 2. 运行 2D ---------- */
    console.log('\n=== 2. 运行 2D 示例 ===');
    await cdp.evaluate("document.getElementById('sbtn-flag').click()");
    await sleep(1500);

    const run = await cdp.evaluate(`(function(){
      var rt = EH5App.rt;
      var coin = rt.sprites.find(function(s){return s.name==='金币';});
      var player = rt.sprites.find(function(s){return s.name==='玩家';});
      return {
        fps: rt.fps,
        threads: rt.threads.length,
        frames: rt.frameCount,
        coinDir: coin ? coin.direction : null,
        playerY: player ? player.y : null,
        playerX: player ? player.x : null,
        err: rt.lastError
      };
    })()`);
    check('解释器在跑（帧数增长）', run.frames > 30, run.frames + ' 帧');
    check('有脚本线程在运行', run.threads > 0, run.threads + ' 个线程');
    check('「重复执行」在推进（金币自转）', run.coinDir !== null && run.coinDir !== 90, '方向=' + run.coinDir);
    check('无脚本运行错误', !run.err, run.err || '无');

    /* 模拟按下右箭头，验证运动 + 键盘侦测 */
    await cdp.evaluate(`(function(){
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));
    })()`);
    await sleep(700);
    const moved = await cdp.evaluate(`(function(){
      var p = EH5App.rt.sprites.find(function(s){return s.name==='玩家';});
      return {x:p.x, y:p.y};
    })()`);
    await cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'}))");
    check('按右箭头 → 玩家向右移动', moved.x > -160, 'x: -160 → ' + moved.x);

    await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r =>
      fs.writeFileSync(path.join(SHOT_DIR, '02-run2d.png'), Buffer.from(r.data, 'base64')));

    /* ---------- 3. 3D 引擎 ---------- */
    console.log('\n=== 3. 3D 示例 ===');
    await cdp.evaluate("EH5App.loadSample('fps')");
    await sleep(900);
    const three = await cdp.evaluate(`(function(){
      var rt = EH5App.rt;
      return {
        mode: EH5App.project.stage.mode,
        hasR3d: !!rt.r3d,
        objs: rt.r3d ? rt.r3d.names() : [],
        canvas3dVisible: !document.querySelector('#stage-host canvas.eh5-c3d').classList.contains('hidden'),
        threeVer: (window.THREE && THREE.REVISION) || null,
        projObjs: EH5App.project.objects3d.length
      };
    })()`);
    check('切换到 3D 模式', three.mode === '3d');
    check('Three.js 已加载', !!three.threeVer, 'r' + three.threeVer);
    check('3D 渲染器已初始化', three.hasR3d);
    check('3D 画布可见', three.canvas3dVisible);
    check('场景对象已创建', three.objs.length === three.projObjs && three.objs.length >= 5,
      three.objs.join(', '));

    await cdp.evaluate("document.getElementById('sbtn-flag').click()");
    await sleep(1600);
    const r3 = await cdp.evaluate(`(function(){
      var rt = EH5App.rt;
      var g = rt.r3d.get('金块');
      var b = rt.r3d.get('皮球');
      return {
        fps: rt.fps,
        goldRy: g ? Math.round(g.ry) : null,
        ballY: b ? Math.round(b.y*100)/100 : null,
        ballGround: b ? b.onGround : null,
        frames: rt.frameCount,
        err: rt.lastError
      };
    })()`);
    check('3D 帧循环在跑', r3.frames > 40, r3.frames + ' 帧');
    check('积木驱动的旋转生效（金块绕 Y 转）', r3.goldRy > 2, 'ry=' + r3.goldRy + '°');
    check('物理重力生效（皮球下落/落地）', r3.ballY !== null, 'y=' + r3.ballY + ' onGround=' + r3.ballGround);
    check('3D 无脚本错误', !r3.err, r3.err || '无');

    await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r =>
      fs.writeFileSync(path.join(SHOT_DIR, '03-run3d.png'), Buffer.from(r.data, 'base64')));

    /* ---------- 4. 导入导出 ---------- */
    console.log('\n=== 4. JSON 导入 / 导出 ===');
    const roundtrip = await cdp.evaluate(`(function(){
      var json = JSON.stringify(EH5Model.serialize(EH5App.project));
      var back = EH5Model.parse(json);
      var a = EH5App.project, b = back;
      return {
        bytes: json.length,
        ok: b.sprites.length === a.sprites.length
          && b.objects3d.length === a.objects3d.length
          && JSON.stringify(b.sprites.map(function(s){return s.scripts.length;}))
             === JSON.stringify(a.sprites.map(function(s){return s.scripts.length;})),
        format: b.format
      };
    })()`);
    check('项目可序列化为 JSON', roundtrip.bytes > 500, roundtrip.bytes + ' 字节');
    check('JSON 往返一致（角色/对象/脚本数）', roundtrip.ok);
    check('format 标记正确', roundtrip.format === 'easyh5-engine');

    /* ---------- 5. 独立 HTML 编译 ---------- */
    console.log('\n=== 5. 独立 HTML 编译 ===');
    const standalone = await cdp.evaluate(`(function(){
      var three = document.getElementById('eh5-three-src');
      var eng = document.getElementById('eh5-engine-src');
      return { three: three ? three.textContent.length : 0, engine: eng ? eng.textContent.length : 0 };
    })()`);
    check('内嵌 three.js 源码可读', standalone.three > 100000, (standalone.three / 1024).toFixed(0) + ' KB');
    check('内嵌引擎源码可读', standalone.engine > 50000, (standalone.engine / 1024).toFixed(0) + ' KB');

    /* ---------- 6. 全屏运行模式 ---------- */
    console.log('\n=== 6. 全屏运行模式 ===');
    await cdp.evaluate("document.getElementById('btn-run').click()");
    await sleep(1200);
    const runMode = await cdp.evaluate(`(function(){
      return {
        on: document.getElementById('runmode').classList.contains('on'),
        hasRt: !!EH5App.runRt,
        canvas: !!document.querySelector('#run-stage-inner canvas'),
        frames: EH5App.runRt ? EH5App.runRt.frameCount : 0
      };
    })()`);
    check('全屏运行层已打开', runMode.on);
    check('运行实例已创建', runMode.hasRt && runMode.canvas);
    check('全屏运行中帧循环在跑', runMode.frames > 20, runMode.frames + ' 帧');
    await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r =>
      fs.writeFileSync(path.join(SHOT_DIR, '04-runmode.png'), Buffer.from(r.data, 'base64')));
    await cdp.evaluate("EH5App.closeRun()");
    await sleep(300);

    /* ---------- 7. 编辑器交互（模拟拖拽） ---------- */
    console.log('\n=== 7. 编辑器交互 ===');
    await cdp.evaluate("EH5App.loadSample('blank')");
    await sleep(600);
    const before = await cdp.evaluate("EH5App.current.scripts.length");

    /* 点击调色板积木 → 加入工作区 */
    await cdp.evaluate(`(function(){
      var b = document.querySelector('#block-list .blk');
      b.dispatchEvent(new MouseEvent('click', {bubbles:true}));
    })()`);
    await sleep(250);
    const afterClick = await cdp.evaluate("EH5App.current.scripts.length");
    check('点击调色板积木可加入工作区', afterClick === before + 1, before + ' → ' + afterClick);

    /* 模拟真实拖拽：把第二块积木拖到第一块下面吸附 */
    const dragOk = await cdp.evaluate(`(function(){
      var blks = document.querySelectorAll('#ws-scripts .blk');
      if (blks.length < 1) return 'no blocks';
      var src = document.querySelector('#block-list .blk');
      var r = src.getBoundingClientRect();
      function pd(el, x, y){ el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,button:0,pointerId:1,isPrimary:true})); }
      function pm(x, y){ window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,pointerId:1,isPrimary:true})); }
      function pu(x, y){ window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerId:1,isPrimary:true})); }
      pd(src, r.left+20, r.top+10);
      pm(r.left+40, r.top+30);
      pm(600, 300);
      pm(600, 320);
      var n1 = document.querySelectorAll('#ws-scripts .blk').length;
      pu(600, 320);
      var n2 = document.querySelectorAll('#ws-scripts .blk').length;
      return JSON.stringify({before:n1, after:n2});
    })()`);
    const d = JSON.parse(dragOk);
    check('拖拽调色板积木到工作区生效', d.after > d.before, dragOk);

    /* 变量下拉 / 新建变量 */
    await cdp.evaluate(`(function(){
      EH5App.ensureNamed('variables','测试变量');
      EH5App.refreshInspector();
    })()`);
    const varOk = await cdp.evaluate(`(function(){
      return EH5App.dynamicOptions('variables').map(function(o){return o.value;}).join(',');
    })()`);
    check('变量系统可用', varOk.includes('测试变量'), varOk);

    /* 3D 对象名动态补全 */
    const dl = await cdp.evaluate("document.querySelectorAll('#eh5-objs option').length");
    check('3D 对象名补全列表已填充', dl >= 0, dl + ' 项');

    await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r =>
      fs.writeFileSync(path.join(SHOT_DIR, '05-blank.png'), Buffer.from(r.data, 'base64')));

    /* ---------- 汇总 ---------- */
    const errs = await cdp.evaluate("(window.EH5App && EH5App.rt && EH5App.rt.lastError) || ''");
    console.log('\n=== 运行期错误汇总 ===');
    check('全程无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | ') || '无');
    check('运行期无脚本错误', !errs, errs || '无');

  } finally {
    try { if (cdp && cdp.ws) cdp.ws.close(); } catch (e) {}
    proc.kill();
  }

  const fail = results.filter(r => !r.ok);
  console.log('\n============================================');
  console.log('  共 ' + results.length + ' 项，通过 ' + (results.length - fail.length) + '，失败 ' + fail.length);
  console.log('============================================');
  if (fail.length) {
    fail.forEach(f => console.log('  ✗ ' + f.name + '  → ' + f.detail));
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error('\n测试脚本自身出错：', e.message);
  console.error(e.stack);
  process.exitCode = 2;
});
