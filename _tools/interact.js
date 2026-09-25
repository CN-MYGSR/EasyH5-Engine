/* ============================================================
   interact.js — 拖拽吸附交互的端到端验证
   模拟真实指针事件（pointerdown/move/up），检查积木树真的变了
   ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

/* 临时 profile 放系统临时目录，避免污染项目 */
const os = require('os');
const TMPPROF = (n) => path.join(os.tmpdir(), n + '-' + process.pid + '-' + Date.now());
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9339;
const TARGET = 'file:///' + path.join(ROOT, 'EasyH5Engine.html').replace(/\\/g, '/');

function httpGet(u) {
  return new Promise((res, rej) => {
    const r = http.get(u, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); });
    r.on('error', rej); r.setTimeout(3000, () => r.destroy(new Error('t')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(f, ms, l) { const e = Date.now() + ms; while (Date.now() < e) { try { const v = await f(); if (v) return v; } catch (x) {} await sleep(300); } throw new Error('超时 ' + l); }
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.p = new Map(); this.errs = [];
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.p.has(m.id)) { const { resolve, reject } = this.p.get(m.id); this.p.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
      else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; this.errs.push((d.exception && d.exception.description) || d.text); }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
      this.p.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

const results = [];
function check(n, ok, d) {
  results.push({ n, ok: !!ok, d: d === undefined ? '' : String(d) });
  console.log((ok ? '  [OK]   ' : '  [FAIL] ') + n + (d !== undefined && d !== '' ? '  → ' + d : ''));
}

/* 页面内注入的拖拽助手 */
const HELPER = `
window.__T = {
  pt: function(x,y,type){ return new PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1,pointerId:1,isPrimary:true}); },
  drag: function(srcEl, tx, ty){
    var r = srcEl.getBoundingClientRect();
    var sx = r.left + 18, sy = r.top + 12;
    srcEl.dispatchEvent(this.pt(sx, sy, 'pointerdown'));
    var steps = 8;
    for (var i=1;i<=steps;i++){
      window.dispatchEvent(this.pt(sx + (tx-sx)*i/steps, sy + (ty-sy)*i/steps, 'pointermove'));
    }
    window.dispatchEvent(this.pt(tx, ty, 'pointerup'));
  },
  /** 某积木 next 连接点的屏幕坐标 */
  nextPoint: function(blockEl){
    var r = blockEl.getBoundingClientRect();
    return { x: r.left + 16, y: r.bottom + 2 };
  },
  slotPoint: function(slotEl){
    var r = slotEl.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  },
  /** 统计积木树 */
  stats: function(){
    var sp = EH5App.current;
    var n = 0, depth = 0;
    function walk(b, d){
      var cur = b;
      while (cur){
        n++; if (d > depth) depth = d;
        Object.keys(cur.inputs||{}).forEach(function(k){
          var v = cur.inputs[k];
          if (v && typeof v === 'object' && v.type) walk(v, d+1);
        });
        if (cur.branches) Object.keys(cur.branches).forEach(function(k){ if (cur.branches[k]) walk(cur.branches[k], d+1); });
        cur = cur.next;
      }
    }
    (sp.scripts||[]).forEach(function(s){ walk(s, 1); });
    return { scripts: (sp.scripts||[]).length, blocks: n, maxDepth: depth };
  },
  /** 找调色板里指定积木类型 */
  pal: function(type){
    var list = document.querySelectorAll('#block-list .blk');
    for (var i=0;i<list.length;i++) if (list[i].dataset.id && EH5App.ws.idMap.get(list[i].dataset.id) === undefined) {}
    return list;
  },
  findByType: function(type){
    var r = EH5Blocks.get(type);
    var list = document.querySelectorAll('#block-list .blk');
    for (var i=0;i<list.length;i++){
      // 调色板积木按顺序对应 blocksOf(cat)
      var label = list[i].textContent;
      if (label.indexOf(String(r.text).split('%')[0]) === 0) return list[i];
    }
    return list[0];
  }
};
`;

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--window-size=1680,1000', '--user-data-dir=' + TMPPROF('eh5-interact'), TARGET], { stdio: 'ignore' });
  let cdp;
  try {
    const list = await waitFor(() => httpGet('http://127.0.0.1:' + PORT + '/json/list').then(l => l && l.length ? l : null), 25000, 'dt');
    const page = list.find(t => t.type === 'page' && t.url.startsWith('file:')) || list[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('ws')), 10000); ws.addEventListener('open', () => { clearTimeout(t); res(); }); ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('ws err')); }); });
    cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await waitFor(() => cdp.ev('!!window.EH5App'), 20000, 'app');
    await sleep(900);
    await cdp.ev(HELPER);

    /* ---------- 场景：从空白项目开始 ---------- */
    await cdp.ev("EH5App.loadSample('blank')");
    await cdp.ev("EH5App.category='events'; EH5App._buildPalette();");
    await sleep(300);

    console.log('=== 1. 从调色板拖「当 ▶ 被点击」到工作区 ===');
    let s0 = JSON.parse(await cdp.ev('JSON.stringify(__T.stats())'));
    check('初始为空', s0.blocks === 0 && s0.scripts === 0, JSON.stringify(s0));

    await cdp.ev(`(function(){
      var hat = __T.findByType('event_whenflagclicked');
      var ws = document.getElementById('workspace').getBoundingClientRect();
      __T.drag(hat, ws.left + 120, ws.top + 90);
    })()`);
    await sleep(300);
    let s1 = JSON.parse(await cdp.ev('JSON.stringify(__T.stats())'));
    check('拖入后产生 1 条脚本', s1.scripts === 1 && s1.blocks === 1, JSON.stringify(s1));

    console.log('');
    console.log('=== 2. 拖一块「移动 10 步」吸附到帽块下方 ===');
    await cdp.ev("EH5App.category='motion'; EH5App._buildPalette();");
    await sleep(250);
    await cdp.ev(`(function(){
      var mv = __T.findByType('motion_movesteps');
      var hatEl = document.querySelector('#ws-scripts .blk');
      var p = __T.nextPoint(hatEl);
      __T.drag(mv, p.x, p.y);
    })()`);
    await sleep(350);
    let s2 = JSON.parse(await cdp.ev('JSON.stringify(__T.stats())'));
    check('吸附后变成 1 条脚本 2 块积木（接住了，不是新脚本）',
      s2.scripts === 1 && s2.blocks === 2, JSON.stringify(s2));

    console.log('');
    console.log('=== 3. 拖一块「重复执行」并把「移动」拖进它的内部 ===');
    await cdp.ev("EH5App.category='control'; EH5App._buildPalette();");
    await sleep(250);
    await cdp.ev(`(function(){
      var rep = __T.findByType('control_repeat');
      var ws = document.getElementById('workspace').getBoundingClientRect();
      __T.drag(rep, ws.left + 120, ws.top + 260);
    })()`);
    await sleep(350);
    let s3 = JSON.parse(await cdp.ev('JSON.stringify(__T.stats())'));
    check('新增了「重复执行」脚本', s3.scripts === 2 && s3.blocks === 3, JSON.stringify(s3));

    /* 把「移动」从帽块下面拖到「重复执行」内部。
       注意：积木一被摘下，后面的积木会往上挪，所以落点必须在拖拽过程中重新取，
       不能事先算好（这正是「落点指示线」存在的原因）。 */
    const dropInfo = await cdp.ev(`(function(){
      function findEl(type){
        var out = null;
        document.querySelectorAll('#ws-scripts .blk').forEach(function(e){
          var n = EH5App.ws.idMap.get(e.dataset.id);
          if (n && n.type === type && !out) out = e;
        });
        return out;
      }
      var mv = findEl('motion_movesteps');
      var r0 = mv.getBoundingClientRect();
      var sx = r0.left + 18, sy = r0.top + 12;
      mv.dispatchEvent(__T.pt(sx, sy, 'pointerdown'));
      window.dispatchEvent(__T.pt(sx + 6, sy + 6, 'pointermove'));   // 触发摘下 + 重排

      /* 现在重新定位「重复执行」的内部 */
      var rep = findEl('control_repeat');
      var ss = rep.querySelector(':scope > .body > .substack');
      var r = ss.getBoundingClientRect();
      var tx = r.left + 30, ty = r.top + 8;

      var conns = EH5App.ws.debugConns(tx, ty, 'stack');
      for (var i=1;i<=6;i++) window.dispatchEvent(__T.pt(sx + (tx-sx)*i/6, sy + (ty-sy)*i/6, 'pointermove'));
      var picked = EH5App.ws._findConn(tx, ty, 'stack');
      window.dispatchEvent(__T.pt(tx, ty, 'pointerup'));
      return JSON.stringify({
        target: { x: Math.round(tx), y: Math.round(ty) },
        substackRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        top3: conns.slice(0, 3),
        picked: picked ? { kind: picked.kind, host: (picked.node && picked.node.type) || null } : null
      });
    })()`);
    console.log('  落点诊断: ' + dropInfo);
    await sleep(400);
    let s4 = JSON.parse(await cdp.ev('JSON.stringify(__T.stats())'));
    check('积木搬进了 C 型积木内部（总块数不变、嵌套深度增加）',
      s4.blocks === 3 && s4.maxDepth >= 2, JSON.stringify(s4));
    const nested = await cdp.ev(`(function(){
      var rep = null;
      document.querySelectorAll('#ws-scripts .blk').forEach(function(e){
        var n = EH5App.ws.idMap.get(e.dataset.id);
        if (n && n.type === 'control_repeat') rep = e;
      });
      if (!rep) return 'no-repeat';
      var inner = rep.querySelector(':scope > .body > .substack > .slot-zone > .blk');
      return inner ? (EH5App.ws.idMap.get(inner.dataset.id) || {}).type : 'empty';
    })()`);
    check('C 型积木内部确实是「移动 10 步」', nested === 'motion_movesteps', nested);

    console.log('');
    console.log('=== 4. 拖一个报告块进输入槽 ===');
    await cdp.ev("EH5App.category='operators'; EH5App._buildPalette();");
    await sleep(250);
    const beforeSlot = await cdp.ev(`(function(){
      var mv = null;
      document.querySelectorAll('#ws-scripts .blk').forEach(function(e){
        var n = EH5App.ws.idMap.get(e.dataset.id);
        if (n && n.type === 'motion_movesteps') mv = e;
      });
      var slot = mv.querySelector('.slot.num');
      var n = EH5App.ws.idMap.get(mv.dataset.id);
      return JSON.stringify({ slotText: slot.textContent, isBlock: !!(n.inputs.STEPS && n.inputs.STEPS.type) });
    })()`);
    await cdp.ev(`(function(){
      var add = __T.findByType('operator_add');
      var mv = null;
      document.querySelectorAll('#ws-scripts .blk').forEach(function(e){
        var n = EH5App.ws.idMap.get(e.dataset.id);
        if (n && n.type === 'motion_movesteps') mv = e;
      });
      var slot = mv.querySelector('.slot.num');
      var p = __T.slotPoint(slot);
      __T.drag(add, p.x, p.y);
    })()`);
    await sleep(400);
    const afterSlot = await cdp.ev(`(function(){
      var mv = null;
      document.querySelectorAll('#ws-scripts .blk').forEach(function(e){
        var n = EH5App.ws.idMap.get(e.dataset.id);
        if (n && n.type === 'motion_movesteps') mv = e;
      });
      if (!mv) return 'no-mv';
      var n = EH5App.ws.idMap.get(mv.dataset.id);
      var slot = mv.querySelector('.slot.num');
      return JSON.stringify({ filled: slot.classList.contains('filled'),
        isBlock: !!(n.inputs.STEPS && n.inputs.STEPS.type),
        innerType: (n.inputs.STEPS && n.inputs.STEPS.type) || null });
    })()`);
    const as = JSON.parse(afterSlot);
    check('输入槽变成了嵌套报告块', as.isBlock && as.innerType === 'operator_add', afterSlot);
    check('槽加上 filled 样式（去掉白底）', as.filled === true);
    check('嵌套后总数 +1', JSON.parse(await cdp.ev('JSON.stringify(__T.stats())')).blocks === 4);

    console.log('');
    console.log('=== 5. 右键菜单 & 删除 ===');
    await cdp.ev(`(function(){
      var mv = null;
      document.querySelectorAll('#ws-scripts .blk').forEach(function(e){
        var n = EH5App.ws.idMap.get(e.dataset.id);
        if (n && n.type === 'motion_movesteps') mv = e;
      });
      var r = mv.getBoundingClientRect();
      mv.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:r.left+20, clientY:r.top+10}));
    })()`);
    await sleep(250);
    const menuOk = await cdp.ev("document.querySelectorAll('.menu button').length");
    check('右键弹出积木菜单', menuOk >= 3, menuOk + ' 项');
    await cdp.ev("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
    await sleep(150);

    console.log('');
    console.log('=== 6. 拖到调色板上删除 ===');
    const before6 = JSON.parse(await cdp.ev('JSON.stringify(__T.stats())')).blocks;
    await cdp.ev(`(function(){
      var rep = null;
      document.querySelectorAll('#ws-scripts .blk').forEach(function(e){
        var n = EH5App.ws.idMap.get(e.dataset.id);
        if (n && n.type === 'control_repeat') rep = e;
      });
      var pal = document.getElementById('palette').getBoundingClientRect();
      __T.drag(rep, pal.left + 100, pal.top + 200);
    })()`);
    await sleep(400);
    const after6 = JSON.parse(await cdp.ev('JSON.stringify(__T.stats())'));
    check('拖到调色板 = 删除（含内部积木一起删）',
      after6.blocks < before6, before6 + ' → ' + after6.blocks);

    console.log('');
    console.log('=== 7. 撤销式操作：再次运行仍然正常 ===');
    await cdp.ev("EH5App.loadSample('platformer')");
    await sleep(500);
    await cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1300);
    const runOk = await cdp.ev(`(function(){
      var rt = EH5App.rt;
      var coin = rt.sprites.find(function(s){return s.name==='金币';});
      return JSON.stringify({frames: rt.frameCount, coinDir: Math.round(coin.direction), err: rt.lastError||''});
    })()`);
    const ro = JSON.parse(runOk);
    check('拖拽之后引擎仍能正常运行', ro.frames > 30 && !ro.err, runOk);

    console.log('');
    console.log('=== 未捕获异常 ===');
    check('全程无未捕获异常', cdp.errs.length === 0, cdp.errs.slice(0, 3).join(' | ') || '无');

  } finally {
    try { if (cdp) cdp.ws.close(); } catch (e) {}
    proc.kill();
  }

  const fail = results.filter(r => !r.ok);
  console.log('\n============================================');
  console.log('  共 ' + results.length + ' 项，通过 ' + (results.length - fail.length) + '，失败 ' + fail.length);
  console.log('============================================');
  if (fail.length) { fail.forEach(f => console.log('  ✗ ' + f.n + ' → ' + f.d)); process.exitCode = 1; }
})().catch(e => { console.error('测试出错：', e.message, '\n', e.stack); process.exitCode = 2; });
