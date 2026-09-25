/* ============================================================
   shot.js — 定点截图（放大看细节）
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
const PORT = 9334;
const TARGET = 'file:///' + path.join(ROOT, 'EasyH5Engine.html').replace(/\\/g, '/');
const OUT = path.join(ROOT, '_tools', 'shots');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) {}
    await sleep(300);
  }
  throw new Error('等待超时：' + label);
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('超时 ' + method)); } }, 20000);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async shot(name, selector, scale) {
    let clip = null;
    if (selector) {
      const r = await this.evaluate(`(function(){
        var e = document.querySelector(${JSON.stringify(selector)});
        if (!e) return null;
        var b = e.getBoundingClientRect();
        return {x:b.left, y:b.top, width:b.width, height:b.height};
      })()`);
      if (r) clip = { x: r.x, y: r.y, width: r.width, height: r.height, scale: scale || 2 };
    }
    const res = await this.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(res.data, 'base64'));
    console.log('  -> ' + name);
  }
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--window-size=1680,1000',
    '--user-data-dir=' + TMPPROF('eh5-shot'),
    TARGET
  ], { stdio: 'ignore' });

  let cdp;
  try {
    const list = await waitFor(() => httpGet('http://127.0.0.1:' + PORT + '/json/list').then(l => l && l.length ? l : null), 25000, 'devtools');
    const page = list.find(t => t.type === 'page' && t.url.startsWith('file:')) || list[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('ws 超时')), 10000);
      ws.addEventListener('open', () => { clearTimeout(t); res(); });
      ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('ws 错误')); });
    });
    cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await waitFor(() => cdp.evaluate('!!window.EH5App'), 20000, 'App');
    await sleep(900);

    /* --- 1. 跳跳方块：玩家角色的积木（含嵌套 C 块） --- */
    await cdp.evaluate(`(function(){
      var p = EH5App.project.sprites.find(function(s){return s.name==='玩家';});
      EH5App.current = p; EH5App.ws.setTarget(p); EH5App.renderTargetBar();
    })()`);
    await sleep(400);
    await cdp.shot('10-blocks-2d.png', '#workspace', 2);

    /* --- 2. 3D 示例的积木（最深的嵌套） --- */
    await cdp.evaluate("EH5App.loadSample('fps')");
    await sleep(700);
    await cdp.shot('11-blocks-3d.png', '#workspace', 2);

    /* --- 3. 条件积木（如果/否则）+ 布尔槽 --- */
    await cdp.evaluate(`(function(){
      EH5App.loadSample('blank');
    })()`);
    await sleep(500);
    await cdp.evaluate(`(function(){
      var M = EH5Model, B = EH5Blocks;
      var sp = EH5App.current;
      sp.scripts = [
        M.chain(
          M.Bk('event_whenflagclicked'),
          M.C = M.Bk('control_if_else', { COND: M.Bk('operator_and', {
              A: M.Bk('sensing_keypressed', null, {KEY:' '}),
              B: M.Bk('operator_gt', { A: M.Bk('data_variable', null, {VAR:'分数'}), B: 10 })
            }) }),
          M.Bk('control_forever'),
          M.Bk('control_repeat', { TIMES: 10 })
        )
      ];
      // 手工补分支
      var sc = sp.scripts[0];
      var ifElse = sc.next;
      var forever = ifElse.next;
      var repeat = forever.next;
      ifElse.branches.SUBSTACK = M.chain(
        M.Bk('motion_movesteps', { STEPS: M.Bk('operator_add', { A: 1, B: M.Bk('operator_random',{FROM:1,TO:5}) }) }),
        M.Bk('looks_say', { MSG: 'hi' })
      );
      ifElse.branches.SUBSTACK2 = M.Bk('motion_turnright', { DEG: 15 });
      forever.branches.SUBSTACK = M.chain(
        M.Bk('motion_movesteps', { STEPS: 10 }),
        M.Bk('looks_nextcostume')
      );
      repeat.branches.SUBSTACK = M.Bk('sound_playtone', { SECS: 0.2 }, { NOTE: 'C5' });
      EH5App.ws.render();
      EH5App.updateStatus();
    })()`);
    await sleep(400);
    await cdp.shot('12-blocks-control.png', '#workspace', 2);

    /* --- 4. 调色板全分类 --- */
    await cdp.evaluate(`(function(){
      var tabs = document.querySelectorAll('#cat-rail .cat');
      tabs[9].click();
    })()`);
    await sleep(300);
    await cdp.shot('13-palette-3d.png', '#palette', 2);

    /* --- 5. 3D 场景近景 --- */
    await cdp.evaluate("EH5App.loadSample('fps')");
    await sleep(600);
    await cdp.evaluate("document.getElementById('sbtn-flag').click()");
    await sleep(1800);
    await cdp.shot('14-stage-3d.png', '#stage-frame', 3);

    /* --- 6. 2D 舞台近景 --- */
    await cdp.evaluate("EH5App.loadSample('platformer')");
    await sleep(700);
    await cdp.evaluate("document.getElementById('sbtn-flag').click()");
    await sleep(1200);
    await cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))");
    await sleep(500);
    await cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'}))");
    await cdp.shot('15-stage-2d.png', '#stage-frame', 3);

    /* --- 7. 全屏运行模式 --- */
    await cdp.evaluate("document.getElementById('btn-run').click()");
    await sleep(1500);
    await cdp.shot('16-runmode.png', null);
    await cdp.evaluate("EH5App.closeRun()");

  } finally {
    try { if (cdp) cdp.ws.close(); } catch (e) {}
    proc.kill();
  }
  console.log('截图完成');
}

main().catch(e => { console.error('截图脚本出错：', e.message); process.exitCode = 1; });
