/* 量一下舞台画布的真实尺寸与映射，并定位金币的实际绘制位置 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

/* 临时 profile 放系统临时目录，避免污染项目 */
const os = require('os');
const TMPPROF = (n) => path.join(os.tmpdir(), n + '-' + process.pid + '-' + Date.now());
const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
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
    '--user-data-dir=' + TMPPROF('eh5-measure'), TARGET], { stdio: 'ignore' });
  let cdp;
  try {
    const list = await waitFor(() => httpGet('http://127.0.0.1:' + PORT + '/json/list').then(l => l && l.length ? l : null), 25000, 'dt');
    const page = list.find(t => t.type === 'page' && t.url.startsWith('file:')) || list[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('ws')), 10000); ws.addEventListener('open', () => { clearTimeout(t); res(); }); ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('ws err')); }); });
    cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await waitFor(() => cdp.ev('!!window.EH5App'), 20000, 'app');
    await sleep(1000);

    console.log('--- 舞台几何 ---');
    console.log(JSON.stringify(await cdp.ev(`(function(){
      var f = document.getElementById('stage-frame').getBoundingClientRect();
      var h = document.getElementById('stage-host').getBoundingClientRect();
      var c = document.querySelector('#stage-host canvas.eh5-c2d');
      var cr = c.getBoundingClientRect();
      return {
        frame: [Math.round(f.width), Math.round(f.height)],
        host: [Math.round(h.width), Math.round(h.height)],
        canvasCss: [Math.round(cr.width), Math.round(cr.height)],
        canvasAttr: [c.width, c.height],
        stage: [EH5App.project.stage.width, EH5App.project.stage.height]
      };
    })()`), null, 1));

    console.log('--- 运行 2D 示例后各角色坐标 ---');
    await cdp.ev("EH5App.loadSample('platformer')");
    await sleep(600);
    await cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1200);
    console.log(JSON.stringify(await cdp.ev(`(function(){
      return EH5App.rt.sprites.map(function(s){
        return {name:s.name, x:Math.round(s.x*10)/10, y:Math.round(s.y*10)/10, vis:s.visible,
                cw:s.costumes[s.currentCostume].w, ch:s.costumes[s.currentCostume].h};
      });
    })()`), null, 1));

    console.log('--- 画布上各颜色块的包围盒（换算回舞台坐标） ---');
    console.log(JSON.stringify(await cdp.ev(`(function(){
      var r2 = EH5App.rt.r2d;
      var c = r2.canvas, g = c.getContext('2d');
      var W = c.width, H = c.height;
      var d = g.getImageData(0,0,W,H).data;
      var SW = EH5App.project.stage.width, SH = EH5App.project.stage.height;
      function toStage(px, py){
        return [ Math.round(((px - r2._ox)/r2._k - SW/2)*10)/10,
                 Math.round((SH/2 - (py - r2._oy)/r2._k)*10)/10 ];
      }
      function bbox(test){
        var minx=1e9,maxx=-1,miny=1e9,maxy=-1,n=0;
        for (var y=0;y<H;y++) for (var x=0;x<W;x++){
          var i=(y*W+x)*4;
          if (test(d[i],d[i+1],d[i+2])) { n++; if(x<minx)minx=x; if(x>maxx)maxx=x; if(y<miny)miny=y; if(y>maxy)maxy=y; }
        }
        if (!n) return null;
        return { n:n, px:[minx,miny,maxx,maxy],
          center: toStage((minx+maxx)/2,(miny+maxy)/2),
          sizeStage: [ Math.round((maxx-minx)/r2._k*10)/10, Math.round((maxy-miny)/r2._k*10)/10 ] };
      }
      return {
        k: Math.round(r2._k*1000)/1000, ox: Math.round(r2._ox*100)/100, oy: Math.round(r2._oy*100)/100,
        canvas: [W,H],
        gold:  bbox(function(r,g,b){ return r>220 && g>190 && g<235 && b<110; }),
        blue:  bbox(function(r,g,b){ return b>220 && r>50 && r<110 && g>130 && g<180; }),
        green: bbox(function(r,g,b){ return g>170 && g<210 && r>60 && r<110 && b>60 && b<110; })
      };
    })()`), null, 1));

    /* 同时截图，便于把「坐标」和「画面」对照起来 */
    const rect = await cdp.ev(`(function(){
      var b = document.getElementById('stage-frame').getBoundingClientRect();
      return {x:b.left,y:b.top,width:b.width,height:b.height};
    })()`);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 3 }
    });
    require('fs').writeFileSync(path.join(ROOT, '_tools', 'shots', '20-measure.png'), Buffer.from(shot.data, 'base64'));
    console.log('clip =', JSON.stringify(rect), ' 图片已存 20-measure.png');

  } finally { try { if (cdp) cdp.ws.close(); } catch (e) {} proc.kill(); }
})().catch(e => { console.error('出错：', e.message); process.exitCode = 1; });
