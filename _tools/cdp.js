/* ============================================================
   cdp.js — 零依赖的 Chrome DevTools Protocol 极简客户端
   依赖：Node >= 22（自带全局 WebSocket）、系统安装的 Chrome/Edge
   用法：const { launch, CDP } = require('./cdp.js');
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

/* ---------- 找浏览器 ---------- */
const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

function findBrowser(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 Chrome/Edge，请显式传入可执行文件路径');
}

/* ---------- HTTP 小工具（一定带超时，否则失败时会静默挂死） ---------- */
function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 3000, () => req.destroy(new Error('http 超时 ' + url)));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(250);
  }
  throw new Error('等待超时：' + label + (last ? ' / ' + last.message : ''));
}

/* ---------- CDP 客户端 ---------- */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];          // 未捕获异常 + console.error
    this.logs = [];
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errors.push((d.exception && d.exception.description) || d.text);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        const line = m.params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
        this.logs.push(m.params.type + ': ' + line);
        if (m.params.type === 'error') this.errors.push('console.error: ' + line);
      }
    });
  }

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 20000);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  /** 在页面里求值；页面抛异常会变成这里的 reject（不要吞掉） */
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面内异常: ' + ((d.exception && d.exception.description) || d.text));
    }
    return r.result.value;
  }

  /** 定点截图：selector 为空则整页；scale 建议 2~3 才看得清细节 */
  async shot(file, selector, scale) {
    let clip = null;
    if (selector) {
      const r = await this.ev(`(function(){
        var e = document.querySelector(${JSON.stringify(selector)});
        if (!e) return null;
        var b = e.getBoundingClientRect();
        return {x:b.left, y:b.top, width:b.width, height:b.height};
      })()`);
      if (r && r.width > 0 && r.height > 0) {
        clip = { x: r.x, y: r.y, width: r.width, height: r.height, scale: scale || 2 };
      }
    }
    const res = await this.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    return file;
  }
}

/* ---------- 启动一个受控浏览器 ---------- */
/**
 * @param {object} o
 *  url        要打开的地址（file:// 或 http://）
 *  port       调试端口，每个实例用不同端口
 *  windowSize '1680,1000'
 *  chrome     显式浏览器路径
 *  profileDir 临时 profile 目录（默认自动生成唯一目录）
 *  extraArgs  额外参数
 * @returns {{proc, cdp, profile, close}}
 */
async function launch(o) {
  o = o || {};
  const chrome = findBrowser(o.chrome);
  const port = o.port || (9300 + Math.floor(Math.random() * 500));
  const profile = o.profileDir || path.join(os.tmpdir(), 'wb-chrome-' + Date.now() + '-' + Math.floor(Math.random() * 1e5));

  const args = [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',            // 不加会在底部出现白条，容易被误判成布局 bug
    '--window-size=' + (o.windowSize || '1680,1000'),
    '--user-data-dir=' + profile,   // 必须唯一，否则会复用已有进程导致端口失效
    o.url
  ].concat(o.extraArgs || []);

  const proc = spawn(chrome, args, { stdio: 'ignore' });

  let list;
  try {
    list = await waitFor(
      () => httpGetJson('http://127.0.0.1:' + port + '/json/list').then(l => (l && l.length) ? l : null),
      25000, 'Chrome DevTools 端口 ' + port);
  } catch (e) {
    proc.kill();
    throw e;
  }

  const page = list.find(t => t.type === 'page' && (!o.url || t.url.indexOf(o.url.slice(0, 30)) === 0))
            || list.find(t => t.type === 'page')
            || list[0];

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WebSocket 连接超时')), 10000);
    ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
    ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('WebSocket 连接失败')); });
  });

  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  try { await cdp.send('Log.enable'); } catch (e) { /* 有些版本不支持，忽略 */ }

  const handle = {
    proc, cdp, profile, port,
    close(removeProfile) {
      try { ws.close(); } catch (e) {}
      try { proc.kill(); } catch (e) {}
      if (removeProfile !== false) {
        setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }, 400);
      }
    }
  };
  return handle;
}

module.exports = { launch, CDP, findBrowser, waitFor, sleep, httpGetJson };
