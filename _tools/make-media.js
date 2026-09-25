/* ============================================================
   make-media.js — 生成发布用封面 + 截图
   封面用页面里的 canvas 现画，3D 场景用 CDP 截屏后回灌进去
   ============================================================ */
const path = require('path');
const fs = require('fs');
const { launch, waitFor, sleep } = require('./cdp.js');

const ROOT = path.resolve(__dirname, '..');
const TARGET = 'file:///' + path.join(ROOT, 'dist', 'index.html').replace(/\\/g, '/');
const MEDIA = path.join(ROOT, 'dist', 'media');

/* 在页面里把截到的 3D 画面合成一张封面 */
const COVER_JS = `
(function(shotDataUrl){
  return new Promise(function(resolve){
    var W = 1200, H = 630;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');

    /* 背景渐变 */
    var bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0d1220');
    bg.addColorStop(0.55, '#141c33');
    bg.addColorStop(1, '#1d2748');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    /* 网格 */
    g.strokeStyle = 'rgba(120,160,255,.07)'; g.lineWidth = 1;
    for (var x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (var y = 0; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

    /* 左上角光晕 */
    var glow = g.createRadialGradient(180, 120, 10, 180, 120, 520);
    glow.addColorStop(0, 'rgba(47,109,246,.30)');
    glow.addColorStop(1, 'rgba(47,109,246,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);

    function rr(x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }

    var img = new Image();
    img.onload = function(){
      /* 右侧：3D 画面卡片 */
      var iw = 620, ih = iw * img.height / img.width;
      var ix = W - iw - 62, iy = (H - ih) / 2;
      g.save();
      g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 40; g.shadowOffsetY = 14;
      g.fillStyle = '#0b1020';
      rr(ix - 8, iy - 8, iw + 16, ih + 16, 18); g.fill();
      g.restore();
      g.save();
      rr(ix - 8, iy - 8, iw + 16, ih + 16, 18); g.clip();
      g.drawImage(img, ix, iy, iw, ih);
      g.restore();
      /* 卡片描边 */
      g.strokeStyle = 'rgba(140,180,255,.35)'; g.lineWidth = 2;
      rr(ix - 8, iy - 8, iw + 16, ih + 16, 18); g.stroke();

      /* 左侧文字 */
      var tx = 74;
      g.fillStyle = '#ffd93d';
      g.font = '700 20px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
      g.fillText('图形化编程 · 零依赖 · 纯前端', tx, 132);

      g.fillStyle = '#ffffff';
      g.font = '800 74px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
      g.fillText('EasyH5', tx, 226);
      var w1 = g.measureText('EasyH5').width;
      g.fillStyle = '#4c97ff';
      g.fillText('Engine', tx + w1 + 18, 226);

      g.fillStyle = '#aab6d0';
      g.font = '600 30px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
      g.fillText('用积木搭 2D / 3D 游戏', tx, 286);

      var lines = [
        ['147 块积木', '拖拽吸附，C 型嵌套'],
        ['双渲染引擎', 'Canvas 2D + WebGL 3D'],
        ['上传素材', '图片造型 · GLB/OBJ/STL 模型'],
        ['一键导出', '独立 HTML，双击就能玩']
      ];
      var ly = 360;
      lines.forEach(function(l){
        g.fillStyle = '#4c97ff';
        g.beginPath(); g.arc(tx + 7, ly - 7, 5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#e8edf7';
        g.font = '700 22px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
        g.fillText(l[0], tx + 26, ly);
        g.fillStyle = '#7c8798';
        g.font = '500 19px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
        g.fillText(l[1], tx + 26 + g.measureText(l[0]).width + 22, ly);
        ly += 46;
      });

      resolve(cv.toDataURL('image/png'));
    };
    img.onerror = function(){ resolve(''); };
    img.src = shotDataUrl;
  });
})`;

(async () => {
  if (!fs.existsSync(MEDIA)) fs.mkdirSync(MEDIA, { recursive: true });
  const B = await launch({ url: TARGET, port: 9491, windowSize: '1680,1000' });
  try {
    await waitFor(() => B.cdp.ev('!!window.EH5App'), 25000, 'App');
    await sleep(1200);

    /* ---------- 截一张最漂亮的 3D 画面 ---------- */
    console.log('准备 3D 场景…');
    await B.cdp.ev("EH5App.loadSample('textures')");
    await sleep(1300);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(2000);
    await B.cdp.ev("EH5App.rt.r3d.cameraPos(0.5, 5.2, 12.5, 0, 1.6, 0)");
    await sleep(900);

    const stageShot = await B.cdp.shot(path.join(MEDIA, 'shot-stage.png'), '#stage-frame', 3);
    console.log('  舞台截图 ->', path.basename(stageShot));

    const b64 = fs.readFileSync(stageShot).toString('base64');
    const cover = await B.cdp.ev(COVER_JS + '("data:image/png;base64,' + b64 + '")');
    if (cover && cover.indexOf('data:image/png') === 0) {
      fs.writeFileSync(path.join(MEDIA, 'cover.png'), Buffer.from(cover.split(',')[1], 'base64'));
      console.log('  封面 -> cover.png');
    } else {
      throw new Error('封面生成失败');
    }

    /* ---------- 编辑器全貌 ---------- */
    console.log('准备编辑器截图…');
    await B.cdp.ev(`(function(){
      EH5App.loadSample('platformer');
      var p = EH5App.project.sprites.find(function(s){return s.name==='玩家';});
      EH5App.current = p; EH5App.ws.setTarget(p); EH5App.renderTargetBar();
      EH5App.refreshInspector();
    })()`);
    await sleep(900);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1200);
    await B.cdp.shot(path.join(MEDIA, 'shot-editor.png'), null, 1);
    console.log('  编辑器全貌 -> shot-editor.png');

    /* ---------- 积木嵌套细节 ---------- */
    await B.cdp.ev(`(function(){
      EH5App.loadSample('fps');
    })()`);
    await sleep(900);
    await B.cdp.shot(path.join(MEDIA, 'shot-blocks.png'), '#workspace', 2);
    console.log('  积木细节 -> shot-blocks.png');

    /* ---------- 素材库 ---------- */
    await B.cdp.ev(`(function(){
      EH5App.loadSample('blank');
      var cv = document.createElement('canvas');
      cv.width = 128; cv.height = 128;
      var g = cv.getContext('2d');
      g.fillStyle = '#2f6df6'; g.fillRect(0,0,128,128);
      g.fillStyle = '#ffd93d';
      for (var y=0;y<8;y++) for (var x=0;x<8;x++) if ((x+y)%2) g.fillRect(x*16,y*16,16,16);
      var url = cv.toDataURL('image/png');
      var bin = atob(url.split(',')[1]);
      var u8 = new Uint8Array(bin.length);
      for (var i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
      EH5App.importFiles([new File([u8],'棋盘格.png',{type:'image/png'})]);
    })()`);
    await sleep(1400);
    await B.cdp.ev(`(function(){
      document.querySelectorAll('#inspector .insp-sec').forEach(function(s){ s.classList.remove('collapsed'); });
      var heads = document.querySelectorAll('#inspector .insp-head');
      for (var i=0;i<heads.length;i++) if (heads[i].textContent.indexOf('素材库') >= 0) heads[i].parentNode.scrollIntoView({block:'start'});
    })()`);
    await sleep(500);
    await B.cdp.shot(path.join(MEDIA, 'shot-assets.png'), '#inspector', 2);
    console.log('  素材库 -> shot-assets.png');

    /* ---------- 积木搜索 ---------- */
    await B.cdp.ev(`(function(){
      var i = document.getElementById('block-search');
      i.value = '手柄'; i.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await sleep(500);
    await B.cdp.shot(path.join(MEDIA, 'shot-search.png'), '#palette', 2);
    console.log('  积木搜索 -> shot-search.png');

    /* ---------- 清理：把临时舞台截图从 media 里删掉（不能混进部署目录） ---------- */
    fs.unlinkSync(stageShot);
    console.log('\nmedia 内容：');
    fs.readdirSync(MEDIA).forEach(f => {
      console.log('  ' + f + '  ' + (fs.statSync(path.join(MEDIA, f)).size / 1024).toFixed(0) + ' KB');
    });

  } finally {
    B.close();
  }
})().catch(e => { console.error('出错：', e.message, '\n', e.stack); process.exitCode = 1; });
