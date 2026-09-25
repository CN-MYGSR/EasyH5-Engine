/* ============================================================
   export-test.js — 端到端验证「导出独立 HTML」
   1) 在编辑器里真的生成一份独立 HTML
   2) 写盘
   3) 用另一个 Chrome 打开它，确认游戏真的跑起来
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
const OUT_HTML = path.join(ROOT, '_tools', 'out', 'exported.html');
const OUT_HTML2 = path.join(ROOT, '_tools', 'out', 'exported-assets.html');

function httpGet(u) {
  return new Promise((res, rej) => {
    const r = http.get(u, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); });
    r.on('error', rej); r.setTimeout(3000, () => r.destroy(new Error('t')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(f, ms, l) {
  const e = Date.now() + ms;
  while (Date.now() < e) { try { const v = await f(); if (v) return v; } catch (x) {} await sleep(300); }
  throw new Error('等待超时：' + l);
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.p = new Map(); this.errs = [];
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.p.has(m.id)) { const { resolve, reject } = this.p.get(m.id); this.p.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
      else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errs.push((d.exception && d.exception.description) || d.text);
      }
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

async function launch(port, url, profile) {
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--window-size=1400,900',
    '--user-data-dir=' + profile, url], { stdio: 'ignore' });
  const list = await waitFor(() => httpGet('http://127.0.0.1:' + port + '/json/list').then(l => l && l.length ? l : null), 25000, 'devtools@' + port);
  const page = list.find(t => t.type === 'page' && t.url.startsWith('file:')) || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws 超时')), 10000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('ws 错误')); });
  });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  return { proc, cdp };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  [OK]   ' : '  [FAIL] ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

(async () => {
  if (!fs.existsSync(path.dirname(OUT_HTML))) fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });

  /* ---------- 第 1 阶段：从编辑器导出 ---------- */
  console.log('=== 阶段 1：在编辑器里生成独立 HTML ===');
  const A = await launch(9337,
    'file:///' + path.join(ROOT, 'EasyH5Engine.html').replace(/\\/g, '/'),
    TMPPROF('eh5-export-1'));
  let html = '';
  try {
    await waitFor(() => A.cdp.ev('!!window.EH5App'), 20000, '编辑器启动');
    await sleep(900);

    /* 3D 示例：能同时验证 2D 画布、3D 渲染、积木逻辑 */
    await A.cdp.ev("EH5App.loadSample('fps')");
    await sleep(600);

    html = await A.cdp.ev(`(async function(){
      var src = await EH5App._runtimeSource();
      return EH5BuildStandalone(EH5App.projectJSON(), src);
    })()`);
    check('生成了独立 HTML 文本', html.length > 700000, (html.length / 1024).toFixed(0) + ' KB');
    check('HTML 结构完整', html.indexOf('<!DOCTYPE html>') === 0 && html.indexOf('</html>') > 0);
    check('内嵌了 three.js', html.indexOf('WebGLRenderer') > 0);
    check('内嵌了引擎运行时', html.indexOf('EH5Runtime') > 0);
    check('内嵌了项目 JSON', html.indexOf('"easyh5-engine"') > 0);
    check('没有把编辑器也打包进去', html.indexOf('EH5Workspace') < 0, '不含 workspace');
    const cnt = (html.match(/<\/script>/g) || []).length;
    check('脚本标签闭合数量正常', cnt === 3, cnt + ' 个 </script>');
    fs.writeFileSync(OUT_HTML, html, 'utf8');

    /* ---------- 带素材的导出（图片造型 + 模型贴图） ---------- */
    console.log('\n=== 阶段 1b：带上传素材的项目导出 ===');
    await A.cdp.ev(`(async function(){
      EH5App.loadSample('blank');
      var cv = document.createElement('canvas');
      cv.width = 128; cv.height = 128;
      var g = cv.getContext('2d');
      g.fillStyle = '#00c8ff'; g.fillRect(0,0,128,128);
      g.fillStyle = '#ff2d55'; g.fillRect(32,32,64,64);
      var url = cv.toDataURL('image/png');
      var bin = atob(url.split(',')[1]);
      var u8 = new Uint8Array(bin.length);
      for (var i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
      await EH5App.importFiles([new File([u8], '标记.png', {type:'image/png'})]);
    })()`);
    await sleep(700);
    const html2 = await A.cdp.ev(`(async function(){
      var src = await EH5App._runtimeSource();
      return EH5BuildStandalone(EH5App.projectJSON(), src);
    })()`);
    check('带素材的 HTML 已生成', html2.length > 700000, (html2.length / 1024).toFixed(0) + ' KB');
    check('素材 dataURL 进了导出物', html2.indexOf('data:image/png;base64') > 0);
    check('素材引用没有破坏 HTML 结构', html2.indexOf('</html>') > 0 && html2.indexOf('<!DOCTYPE html>') === 0);
    fs.writeFileSync(OUT_HTML2, html2, 'utf8');
  } finally {
    try { A.cdp.ws.close(); } catch (e) {}
    A.proc.kill();
  }

  /* ---------- 第 2 阶段：打开导出的 HTML ---------- */
  console.log('\n=== 阶段 2：直接打开导出的 HTML（模拟用户双击） ===');
  const B = await launch(9338, 'file:///' + OUT_HTML.replace(/\\/g, '/'), TMPPROF('eh5-export-2'));
  try {
    await waitFor(() => B.cdp.ev('!!window.EH5'), 20000, '导出版运行时启动');
    await sleep(2200);

    const st = await B.cdp.ev(`(function(){
      var rt = window.EH5;
      return {
        hasRt: !!rt,
        mode: rt.mode,
        frames: rt.frameCount,
        fps: rt.fps,
        threads: rt.threads.length,
        objs: rt.r3d ? rt.r3d.names() : [],
        err: rt.lastError,
        title: document.title,
        canvas: !!document.querySelector('#stage canvas'),
        firstPerson: rt.r3d ? rt.r3d.fp.on : null
      };
    })()`);
    check('导出版运行时已启动', st.hasRt);
    check('导出版标题正确', st.title === '3D 第一人称', st.title);
    check('导出版渲染循环在跑', st.frames > 40, st.frames + ' 帧 / ' + st.fps + ' FPS');
    check('导出版切到 3D 模式', st.mode === '3d');
    check('导出版 3D 场景已建立', st.objs.length >= 5, st.objs.join(', '));
    check('导出版第一人称已启用', st.firstPerson === true);
    check('导出版脚本线程在跑', st.threads > 0, st.threads + ' 个');
    check('导出版无脚本错误', !st.err, st.err || '无');
    check('导出版无未捕获异常', B.cdp.errs.length === 0, B.cdp.errs.slice(0, 3).join(' | ') || '无');

    /* 真的动起来了吗：等一会看金块旋转角度是否变化 */
    const ANGLE = "(function(){ var o = window.EH5.r3d.get('金块'); return o ? Math.round(o.ry*10)/10 : -1; })()";
    const a1 = await B.cdp.ev(ANGLE);
    await sleep(900);
    const a2 = await B.cdp.ev(ANGLE);
    check('导出版积木逻辑在推进（金块旋转）', a2 !== a1 && a2 > 0, a1 + '° → ' + a2 + '°');

    const shot = await B.cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, '_tools', 'shots', '30-exported.png'), Buffer.from(shot.data, 'base64'));
    console.log('  -> 30-exported.png');

  } finally {
    try { B.cdp.ws.close(); } catch (e) {}
    B.proc.kill();
  }

  /* ---------- 第 3 阶段：打开带素材的导出版，确认图片真的画出来了 ---------- */
  console.log('\n=== 阶段 3：带素材的导出版 ===');
  const C = await launch(9339, 'file:///' + OUT_HTML2.replace(/\\/g, '/'), TMPPROF('eh5-export-3'));
  try {
    await waitFor(() => C.cdp.ev('!!window.EH5'), 20000, '带素材导出版启动');
    await sleep(2000);

    const st2 = await C.cdp.ev(`(function(){
      var rt = window.EH5;
      return JSON.stringify({
        frames: rt.frameCount, assets: rt.project.assets.length,
        shape: rt.sprites[0].costumes[rt.sprites[0].currentCostume].shape,
        err: rt.lastError || ''
      });
    })()`);
    const s2 = JSON.parse(st2);
    check('带素材导出版在运行', s2.frames > 20 && !s2.err, st2);
    check('导出版里素材还在', s2.assets === 1, s2.assets + ' 个');
    check('导出版里造型是图片造型', s2.shape === 'image', s2.shape);

    /* 直接数画布上的两种颜色 */
    const px = await C.cdp.ev(`(function(){
      var c = document.querySelector('#stage canvas');
      var g = c.getContext('2d');
      var d = g.getImageData(0,0,c.width,c.height).data;
      var cyan = 0, red = 0;
      for (var i=0;i<d.length;i+=4){
        if (Math.abs(d[i]-0)<20 && Math.abs(d[i+1]-200)<26 && Math.abs(d[i+2]-255)<26) cyan++;
        if (Math.abs(d[i]-255)<20 && Math.abs(d[i+1]-45)<26 && Math.abs(d[i+2]-85)<26) red++;
      }
      return JSON.stringify({cyan:cyan, red:red});
    })()`);
    const p = JSON.parse(px);
    check('导出版画出了图片的外层（青色）', p.cyan > 2000, p.cyan + ' px');
    check('导出版画出了图片的内层（红色）', p.red > 800, p.red + ' px');

    const shot2 = await C.cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, '_tools', 'shots', '31-exported-assets.png'), Buffer.from(shot2.data, 'base64'));
    console.log('  -> 31-exported-assets.png');
    check('带素材导出版无未捕获异常', (C.cdp.errs || []).length === 0, (C.cdp.errs || []).slice(0, 2).join(' | ') || '无');

  } finally {
    try { C.cdp.ws.close(); } catch (e) {}
    C.proc.kill();
  }

  const fail = results.filter(r => !r.ok);
  console.log('\n============================================');
  console.log('  共 ' + results.length + ' 项，通过 ' + (results.length - fail.length) + '，失败 ' + fail.length);
  console.log('============================================');
  if (fail.length) { fail.forEach(f => console.log('  ✗ ' + f.name + ' → ' + f.detail)); process.exitCode = 1; }
})().catch(e => { console.error('测试出错：', e.message, '\n', e.stack); process.exitCode = 2; });
