/* ============================================================
   shot-assets.js — 素材功能的演示截图
   现场造一张棋盘格贴图 + 一个八面体 GLB，摆好位置再拍
   ============================================================ */
const path = require('path');
const fs = require('fs');
const { launch, waitFor, sleep } = require('./cdp.js');

const ROOT = path.resolve(__dirname, '..');
const TARGET = 'file:///' + path.join(ROOT, 'EasyH5Engine.html').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, '_tools', 'shots');

const HELPERS = `
window.__S = {
  /* 棋盘格图片：能一眼看出 UV 贴得对不对 */
  checker: function(n, a, b){
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var g = cv.getContext('2d');
    var c = 256 / n;
    for (var y=0;y<n;y++) for (var x=0;x<n;x++){
      g.fillStyle = ((x+y)%2) ? a : b;
      g.fillRect(x*c, y*c, c, c);
    }
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 8;
    g.strokeRect(4,4,248,248);
    var url = cv.toDataURL('image/png');
    var bin = atob(url.split(',')[1]);
    var u8 = new Uint8Array(bin.length);
    for (var i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], '棋盘格.png', {type:'image/png'});
  },

  /* 八面体 GLB（8 个面，非索引） */
  octaGLB: function(color){
    var V = [
      [0,1,0],[1,0,0],[0,0,1],   [0,1,0],[0,0,1],[-1,0,0],
      [0,1,0],[-1,0,0],[0,0,-1], [0,1,0],[0,0,-1],[1,0,0],
      [0,-1,0],[0,0,1],[1,0,0],  [0,-1,0],[-1,0,0],[0,0,1],
      [0,-1,0],[0,0,-1],[-1,0,0],[0,-1,0],[1,0,0],[0,0,-1]
    ];
    var pos = new Float32Array(V.length * 3);
    V.forEach(function(v,i){ pos[i*3]=v[0]; pos[i*3+1]=v[1]; pos[i*3+2]=v[2]; });
    var json = {
      asset:{version:'2.0'}, scene:0,
      scenes:[{nodes:[0]}], nodes:[{mesh:0}],
      meshes:[{primitives:[{attributes:{POSITION:0}, material:0}]}],
      materials:[{pbrMetallicRoughness:{baseColorFactor:color, roughnessFactor:0.45, metallicFactor:0.1}}],
      accessors:[{bufferView:0, componentType:5126, count:V.length, type:'VEC3',
                  min:[-1,-1,-1], max:[1,1,1]}],
      bufferViews:[{buffer:0, byteOffset:0, byteLength:pos.byteLength}],
      buffers:[{byteLength:pos.byteLength}]
    };
    var js = new TextEncoder().encode(JSON.stringify(json));
    var jp = (4 - (js.length % 4)) % 4, jl = js.length + jp;
    var bp = (4 - (pos.byteLength % 4)) % 4, bl = pos.byteLength + bp;
    var total = 12 + 8 + jl + 8 + bl;
    var out = new ArrayBuffer(total);
    var dv = new DataView(out), u8 = new Uint8Array(out);
    dv.setUint32(0,0x46546C67,true); dv.setUint32(4,2,true); dv.setUint32(8,total,true);
    dv.setUint32(12,jl,true); dv.setUint32(16,0x4E4F534A,true);
    u8.set(js,20); for (var i=0;i<jp;i++) u8[20+js.length+i]=0x20;
    var bo = 20+jl;
    dv.setUint32(bo,bl,true); dv.setUint32(bo+4,0x004E4942,true);
    u8.set(new Uint8Array(pos.buffer), bo+8);
    return new File([out], '八面体.glb', {type:'model/gltf-binary'});
  }
};
`;

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const B = await launch({ url: TARGET, port: 9421, windowSize: '1680,1000' });
  try {
    await waitFor(() => B.cdp.ev('!!window.EH5App'), 20000, 'App');
    await sleep(1000);
    await B.cdp.ev(HELPERS);

    /* ---------- 准备一个素材齐全的项目 ---------- */
    await B.cdp.ev(`(async function(){
      EH5App.loadSample('blank');
      EH5App.project.meta.name = '素材上传演示';
      document.getElementById('proj-name').value = '素材上传演示';
      await EH5App.importFiles([
        __S.checker(8, '#2f6df6', '#ffd93d'),
        __S.checker(6, '#e2498a', '#0fbd8c'),
        __S.octaGLB([0.95, 0.35, 0.15, 1])
      ]);
    })()`);
    await sleep(1200);

    /* ---------- 1. 2D：图片造型 ---------- */
    await B.cdp.ev(`(function(){
      var p = EH5App.project;
      var imgA = p.assets[0], imgB = p.assets[1];
      var s = p.sprites[0];
      s.name = '图片角色';
      s.costumes = [
        EH5Model.makeImageCostume(imgA.name, imgA.id, 120, 120),
        EH5Model.makeImageCostume(imgB.name, imgB.id, 90, 90)
      ];
      s.currentCostume = 0;
      s.x = -110; s.y = 40;
      var s2 = EH5Model.createSprite('旋转的小块');
      s2.costumes = [EH5Model.makeImageCostume(imgB.name, imgB.id, 70, 70)];
      s2.x = 110; s2.y = -30;
      p.sprites.push(s2);
      p.stage.bgColor = '#eef3fb';
      p.variables = [{name:'已上传素材', value: 3, visible: true}];
      EH5App.current = s;
      EH5App.ws.setTarget(s);
      EH5App.renderTargetBar();
      EH5App.refreshInspector();
    })()`);
    await sleep(1400);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(900);
    await B.cdp.shot(path.join(SHOTS, '50-assets-2d.png'), '#stage-frame', 3);

    /* ---------- 2. 素材库面板 ---------- */
    await B.cdp.ev(`(function(){
      /* 展开「素材库」分区并滚到它 */
      var secs = document.querySelectorAll('#inspector .insp-sec');
      secs.forEach(function(s){ s.classList.remove('collapsed'); });
      var heads = document.querySelectorAll('#inspector .insp-head');
      for (var i=0;i<heads.length;i++){
        if (heads[i].textContent.indexOf('素材库') >= 0) {
          heads[i].parentNode.scrollIntoView({block:'start'});
        }
      }
    })()`);
    await sleep(500);
    await B.cdp.shot(path.join(SHOTS, '51-asset-panel.png'), '#inspector', 2);

    /* ---------- 3. 3D：贴图 + 模型 ---------- */
    await B.cdp.ev(`(function(){
      var p = EH5App.project;
      var imgA = p.assets[0], imgB = p.assets[1];
      var mdl  = p.assets[2];
      p.stage.mode = '3d';
      p.stage.skyColor = '#8fc9f0';
      p.objects3d = [];

      var box = EH5Model.createObject3d('贴图箱', 'box', '#ffffff');
      box.w = box.h = box.d = 2; box.x = -3.2; box.y = 1; box.z = 0;
      box.texture = imgA.id;
      p.objects3d.push(box);

      var ball = EH5Model.createObject3d('贴图球', 'sphere', '#ffffff');
      ball.r = 1.1; ball.x = 0; ball.y = 1.1; ball.z = 0;
      ball.texture = imgB.id;
      p.objects3d.push(ball);

      var mo = EH5Model.createObject3d('八面体', 'model', '#ffffff');
      mo.model = mdl.id; mo.x = 3.4; mo.y = 0; mo.z = 0;
      p.objects3d.push(mo);

      EH5App._selectedObj3d = mo;
      EH5App.setMode('3d');
      EH5App.refreshInspector();
      EH5App.reloadPreviewSoon();
    })()`);
    await sleep(1800);
    await B.cdp.ev(`(function(){
      var rt = EH5App.rt;
      rt.greenFlag();
      rt.r3d.cameraPos(0, 4.2, 11, 0, 1.2, 0);
      rt.r3d.ground(40, '#7cb342');
    })()`);
    await sleep(1500);
    await B.cdp.shot(path.join(SHOTS, '52-assets-3d.png'), '#stage-frame', 3);

    /* ---------- 4. 整页总览 ---------- */
    await B.cdp.ev("EH5App.category='three'; EH5App._buildPalette();");
    await sleep(400);
    await B.cdp.shot(path.join(SHOTS, '53-overview.png'), null, 1);

    /* 核对一下三种素材都真的在场景里 */
    const st = await B.cdp.ev(`(function(){
      var rt = EH5App.rt;
      var mo = rt.r3d.get('八面体');
      var tris = 0;
      if (mo) mo._mesh.traverse(function(n){
        if (n.isMesh && n.geometry && n.geometry.attributes.position) tris += n.geometry.attributes.position.count/3;
      });
      return JSON.stringify({
        objs: rt.r3d.names(),
        modelIsGroup: mo ? mo._mesh.type === 'Group' : null,
        modelTris: Math.round(tris),
        boxMapped: !!(rt.r3d.get('贴图箱')||{})._mesh.material.map,
        ballMapped: !!(rt.r3d.get('贴图球')||{})._mesh.material.map
      });
    })()`);
    console.log('  场景核对：' + st);

  } finally {
    B.close();
  }
  console.log('演示截图完成');
})().catch(e => { console.error('截图脚本出错：', e.message, '\n', e.stack); process.exitCode = 1; });
