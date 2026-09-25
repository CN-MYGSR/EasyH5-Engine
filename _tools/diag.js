/* 诊断：C 型底脚宽度 & 嵌套报告块的背景色 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

/* 临时 profile 放系统临时目录，避免污染项目 */
const os = require('os');
const TMPPROF = (n) => path.join(os.tmpdir(), n + '-' + process.pid + '-' + Date.now());
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const TARGET = 'file:///' + path.join(ROOT, 'EasyH5Engine.html').replace(/\\/g, '/');

function httpGet(u) {
  return new Promise((res, rej) => {
    const r = http.get(u, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); });
    r.on('error', rej); r.setTimeout(3000, () => r.destroy(new Error('t')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(f, ms, l) { const e = Date.now() + ms; while (Date.now() < e) { try { const v = await f(); if (v) return v; } catch (x) {} await sleep(300); } throw new Error('timeout ' + l); }
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.p = new Map();
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.p.has(m.id)) { const { resolve, reject } = this.p.get(m.id); this.p.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
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

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--window-size=1680,1000',
    '--user-data-dir=' + TMPPROF('eh5-diag'), TARGET], { stdio: 'ignore' });
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

    await cdp.ev("EH5App.loadSample('fps')");
    await sleep(800);

    console.log('=== C 型积木：头部宽度 vs 底脚宽度 ===');
    console.log(await cdp.ev(`(function(){
      var out = [];
      document.querySelectorAll('#ws-scripts .blk.c').forEach(function(b){
        var hdr = b.querySelector(':scope > .hdr');
        var foot = b.querySelector(':scope > .body > .c-foot');
        var txt = hdr ? hdr.textContent.slice(0,14) : '?';
        out.push(txt + ' | hdr=' + (hdr?Math.round(hdr.offsetWidth):'-') +
                 ' foot=' + (foot?Math.round(foot.offsetWidth):'-') +
                 ' inlineW="' + (foot?foot.style.width:'-') + '"');
      });
      return out.join('\\n');
    })()`));

    console.log('');
    console.log('=== 嵌套报告块的背景色（应为积木自身的颜色，不是白色） ===');
    console.log(await cdp.ev(`(function(){
      var out = [];
      document.querySelectorAll('#ws-scripts .slot.filled > .blk').forEach(function(b){
        var cs = getComputedStyle(b);
        var hs = b.querySelector(':scope > .hdr');
        out.push(b.className.replace(/\\s+/g,'.') + ' type=' + b.dataset.id +
          ' bg=' + cs.backgroundColor + ' hdrBg=' + (hs?getComputedStyle(hs).backgroundColor:'-'));
      });
      return out.slice(0,10).join('\\n');
    })()`));

    console.log('');
    console.log('=== 这些 slot 自身的背景 ===');
    console.log(await cdp.ev(`(function(){
      var out = [];
      document.querySelectorAll('#ws-scripts .slot').forEach(function(s){
        if (!s.classList.contains('filled')) return;
        out.push(s.className + ' bg=' + getComputedStyle(s).backgroundColor + ' pad=' + getComputedStyle(s).padding);
      });
      return out.slice(0,8).join('\\n');
    })()`));

  } finally { try { if (cdp) cdp.ws.close(); } catch (e) {} proc.kill(); }
})().catch(e => { console.error('出错：', e.message); process.exitCode = 1; });
