/* ============================================================
   assets-test.js — 素材上传（图片造型 / 3D 模型 / 贴图）端到端验证
   图片和模型都在页面里现造，不依赖任何外部文件
   ============================================================ */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launch, waitFor, sleep } = require('./cdp.js');

const ROOT = path.resolve(__dirname, '..');
const TARGET = 'file:///' + path.join(ROOT, 'EasyH5Engine.html').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, '_tools', 'shots');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  [OK]   ' : '  [FAIL] ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

/* 页面内注入：造测试文件 + 工具 */
const HELPERS = `
window.__A = {
  /* 造一张纯色图片（PNG） */
  makeImageFile: function(w, h, color, name){
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d');
    g.fillStyle = color; g.fillRect(0,0,w,h);
    /* 加一条黑边，方便肉眼在截图里认出来 */
    g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeRect(2,2,w-4,h-4);
    var url = cv.toDataURL('image/png');
    var bin = atob(url.split(',')[1]);
    var u8 = new Uint8Array(bin.length);
    for (var i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], name || 'test.png', {type:'image/png'});
  },

  /* 造一个最小但合法的 GLB（三角形） */
  makeGLB: function(){
    var pos = new Float32Array([-1,0,0, 1,0,0, 0,2,0]);
    var binBuf = pos.buffer;
    var json = {
      asset:{version:'2.0'}, scene:0,
      scenes:[{nodes:[0]}], nodes:[{mesh:0}],
      meshes:[{primitives:[{attributes:{POSITION:0}, material:0}]}],
      materials:[{pbrMetallicRoughness:{baseColorFactor:[1,0.35,0.1,1]}}],
      accessors:[{bufferView:0, componentType:5126, count:3, type:'VEC3',
                  min:[-1,0,0], max:[1,2,0]}],
      bufferViews:[{buffer:0, byteOffset:0, byteLength:36}],
      buffers:[{byteLength:36}]
    };
    var js = new TextEncoder().encode(JSON.stringify(json));
    var jp = (4 - (js.length % 4)) % 4;
    var jl = js.length + jp;
    var bp = (4 - (binBuf.byteLength % 4)) % 4;
    var bl = binBuf.byteLength + bp;
    var total = 12 + 8 + jl + 8 + bl;
    var out = new ArrayBuffer(total);
    var dv = new DataView(out), u8 = new Uint8Array(out);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jl, true); dv.setUint32(16, 0x4E4F534A, true);
    u8.set(js, 20);
    for (var i=0;i<jp;i++) u8[20+js.length+i] = 0x20;
    var bo = 20 + jl;
    dv.setUint32(bo, bl, true); dv.setUint32(bo+4, 0x004E4942, true);
    u8.set(new Uint8Array(binBuf), bo+8);
    return new File([out], 'tri.glb', {type:'model/gltf-binary'});
  },

  /* 造一个 ASCII STL（四面体） */
  makeSTL: function(){
    var s = 'solid t\\n';
    var tris = [
      [[0,0,0],[1,0,0],[0,1,0]],
      [[0,0,0],[0,1,0],[0,0,1]],
      [[0,0,0],[0,0,1],[1,0,0]],
      [[1,0,0],[0,0,1],[0,1,0]]
    ];
    tris.forEach(function(t){
      s += 'facet normal 0 0 1\\n outer loop\\n';
      t.forEach(function(v){ s += '  vertex ' + v[0] + ' ' + v[1] + ' ' + v[2] + '\\n'; });
      s += ' endloop\\nendfacet\\n';
    });
    s += 'endsolid t\\n';
    return new File([s], 'tetra.stl', {type:'model/stl'});
  },

  /* 造一个假的 .blend（只要文件头对，应该被识别并给出指引） */
  makeBlend: function(){
    var head = new TextEncoder().encode('BLENDER-v403');
    var pad = new Uint8Array(64);
    var all = new Uint8Array(head.length + pad.length);
    all.set(head, 0); all.set(pad, head.length);
    return new File([all], 'scene.blend', {type:'application/octet-stream'});
  },

  /* 数一下画布上有多少指定颜色的像素 */
  countColor: function(rr, gg, bb, tol){
    var c = document.querySelector('#stage-host canvas.eh5-c2d');
    if (!c) return -1;
    var g = c.getContext('2d');
    var d = g.getImageData(0,0,c.width,c.height).data;
    var n = 0;
    for (var i=0;i<d.length;i+=4){
      if (Math.abs(d[i]-rr)<tol && Math.abs(d[i+1]-gg)<tol && Math.abs(d[i+2]-bb)<tol) n++;
    }
    return n;
  }
};
`;

(async () => {
  const B = await launch({ url: TARGET, port: 9411, windowSize: '1680,1000' });
  try {
    await waitFor(() => B.cdp.ev('!!window.EH5App'), 20000, 'App');
    await sleep(1000);
    await B.cdp.ev(HELPERS);

    console.log('=== 0. 基础状态 ===');
    check('页面无未捕获异常', B.cdp.errors.length === 0, B.cdp.errors.slice(0, 3).join(' | ') || '无');
    check('素材库初始为空', (await B.cdp.ev('EH5App.project.assets.length')) === 0);

    /* ============================================================
       1. 上传图片 -> 造型 -> 渲染
       ============================================================ */
    console.log('\n=== 1. 上传图片当造型 ===');
    await B.cdp.ev(`(async function(){
      EH5App.loadSample('blank');
      var f = __A.makeImageFile(96, 96, '#ff00ff', '方块.png');
      await EH5App.importFiles([f]);
    })()`);
    await sleep(700);

    const imgAsset = await B.cdp.ev(`(function(){
      var a = EH5App.project.assets;
      return JSON.stringify({
        n: a.length, kind: a[0] && a[0].kind, name: a[0] && a[0].name,
        w: a[0] && a[0].w, h: a[0] && a[0].h,
        isData: !!(a[0] && a[0].src && a[0].src.indexOf('data:image') === 0),
        bytes: a[0] ? a[0].src.length : 0
      });
    })()`);
    const ia = JSON.parse(imgAsset);
    check('图片已进入素材库', ia.n === 1 && ia.kind === 'image', imgAsset);
    check('保存为内嵌 dataURL', ia.isData, (ia.bytes / 1024).toFixed(1) + ' KB');
    check('记录了原始像素尺寸', ia.w === 96 && ia.h === 96, ia.w + '×' + ia.h);

    const cos = await B.cdp.ev(`(function(){
      var c = EH5App.current.costumes[EH5App.current.currentCostume];
      return JSON.stringify({shape:c.shape, w:c.w, h:c.h, assetId:!!c.assetId, name:c.name});
    })()`);
    check('当前造型已变成图片造型', JSON.parse(cos).shape === 'image', cos);

    /* 运行并数像素 */
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1200);
    const px = await B.cdp.ev("__A.countColor(255, 0, 255, 12)");
    check('画布上真的画出了这张图（洋红像素）', px > 2000, px + ' 个像素');

    const state = await B.cdp.ev("EH5Model.imageState(EH5Model.assetSrc(EH5App.current.costumes[EH5App.current.currentCostume].assetId))");
    check('图片已加载完成', state === 'ready', state);

    await B.cdp.shot(path.join(SHOTS, '40-image-costume.png'), '#stage-frame', 3);

    /* ============================================================
       2. 图片当 3D 贴图
       ============================================================ */
    console.log('\n=== 2. 图片当 3D 贴图 ===');
    await B.cdp.ev(`(function(){
      EH5App.setMode('3d');
      var p = EH5App.project;
      var o = EH5Model.createObject3d('贴图箱', 'box', '#ffffff');
      o.w = 2; o.h = 2; o.d = 2; o.y = 1;
      o.texture = p.assets[0].id;
      p.objects3d.push(o);
      EH5App._selectedObj3d = o;
      EH5App.refreshInspector();
      EH5App.reloadPreviewSoon();
    })()`);
    await sleep(1400);

    const tex = await B.cdp.ev(`(function(){
      var o = EH5App.rt.r3d.get('贴图箱');
      if (!o) return 'no-obj';
      var m = o._mesh.material;
      return JSON.stringify({ hasMap: !!m.map, mapLoaded: !!(m.map && m.map.image),
        color: m.color ? m.color.getHexString() : null });
    })()`);
    const tx = JSON.parse(tex);
    check('3D 物体拿到了贴图对象', tx.hasMap, tex);
    check('贴图图像已解码', tx.mapLoaded, 'image=' + tx.mapLoaded);
    check('贴图生效时基色变白（否则会被染色）', tx.color === 'ffffff', '#' + tx.color);

    await B.cdp.shot(path.join(SHOTS, '41-texture-3d.png'), '#stage-frame', 3);

    /* ============================================================
       3. 上传 3D 模型（GLB / STL）
       ============================================================ */
    console.log('\n=== 3. 上传 3D 模型 ===');
    await B.cdp.ev(`(async function(){
      await EH5App.importFiles([__A.makeGLB(), __A.makeSTL()]);
    })()`);
    await sleep(900);

    const models = await B.cdp.ev(`(function(){
      var m = EH5App.project.assets.filter(function(a){return a.kind==='model';});
      return JSON.stringify(m.map(function(a){
        return {name:a.name, format:a.format, tri:a.stats && a.stats.triangles,
                isData:a.src.indexOf('data:')===0, kb:Math.round(a.src.length/1024)};
      }));
    })()`);
    const ms = JSON.parse(models);
    check('两个模型都进入素材库', ms.length === 2, models);
    check('GLB 解析出三角形', ms.some(x => x.format === 'glb' && x.tri >= 1), JSON.stringify(ms.find(x => x.format === 'glb') || {}));
    check('STL 解析出 4 个面', ms.some(x => x.format === 'stl' && x.tri === 4), JSON.stringify(ms.find(x => x.format === 'stl') || {}));

    /* 把 GLB 放进场景 */
    await B.cdp.ev(`(function(){
      var a = EH5App.project.assets.filter(function(x){return x.kind==='model' && x.format==='glb';})[0];
      EH5App.addModelObject(a);
    })()`);
    await sleep(1800);

    const inst = await B.cdp.ev(`(function(){
      var o = EH5App.rt.r3d.get('tri');
      if (!o) {
        var ks = EH5App.rt.r3d.names();
        return 'not-found: ' + ks.join(',');
      }
      var isGroup = o._mesh.type === 'Group';
      var meshes = 0, tris = 0;
      o._mesh.traverse(function(n){
        if (n.isMesh) { meshes++; if (n.geometry && n.geometry.index) tris += n.geometry.index.count/3;
                        else if (n.geometry && n.geometry.attributes.position) tris += n.geometry.attributes.position.count/3; }
      });
      return JSON.stringify({ isGroup:isGroup, meshes:meshes, tris:Math.round(tris),
        half:o._half, pending:!!o._pendingModel, err:(EH5App.rt.r3d._modelCache[o.model]||{}).error||null });
    })()`);
    check('模型对象已实例化（占位体换成了真网格）', inst.indexOf('isGroup') > 0, inst);
    if (inst.indexOf('isGroup') > 0) {
      const ii = JSON.parse(inst);
      check('网格里有真实几何体', ii.isGroup && ii.meshes >= 1 && ii.tris >= 1, ii.meshes + ' 个 mesh / ' + ii.tris + ' 个三角形');
      check('没有解析错误', !ii.err, ii.err || '无');
      check('包围盒已按模型计算（不是占位体的 0.5）', ii.half && Math.abs(ii.half.y - 0.5) > 0.01,
        'half=' + JSON.stringify(ii.half));
    }

    await B.cdp.shot(path.join(SHOTS, '42-model-3d.png'), '#stage-frame', 3);

    /* ============================================================
       4. .blend 应该被识别并给出导出指引
       ============================================================ */
    console.log('\n=== 4. .blend 文件的处理 ===');
    await B.cdp.ev(`(async function(){ await EH5App.importFiles([__A.makeBlend()]); })()`);
    await sleep(600);
    const blend = await B.cdp.ev(`(function(){
      var h = document.querySelector('.modal h3');
      var b = document.querySelector('.modal .m-body');
      return JSON.stringify({
        shown: !!h, title: h ? h.textContent : '',
        mentionsGlb: b ? /glb/i.test(b.textContent) : false,
        mentionsExport: b ? /导出/.test(b.textContent) : false,
        assetCount: EH5App.project.assets.length
      });
    })()`);
    const bl = JSON.parse(blend);
    check('.blend 被识别并弹出说明', bl.shown && /blend/i.test(bl.title), bl.title);
    check('说明里给出了 glTF 导出步骤', bl.mentionsGlb && bl.mentionsExport, blend);
    check('.blend 没有被错误地塞进素材库', bl.assetCount === 3, bl.assetCount + ' 个素材');
    await B.cdp.ev("document.querySelector('.modal-mask').remove()");
    await sleep(200);

    /* ============================================================
       5. JSON 往返 + 独立 HTML
       ============================================================ */
    console.log('\n=== 5. 持久化 ===');
    const rt = await B.cdp.ev(`(function(){
      var json = JSON.stringify(EH5Model.serialize(EH5App.project));
      var back = EH5Model.parse(json);
      return JSON.stringify({
        kb: Math.round(json.length/1024),
        assets: back.assets.length,
        kinds: back.assets.map(function(a){return a.kind;}).join(','),
        costShape: back.sprites[0].costumes[back.sprites[0].currentCostume].shape,
        costAsset: !!back.sprites[0].costumes[back.sprites[0].currentCostume].assetId,
        texKept: back.objects3d.some(function(o){return !!o.texture;}),
        modelKept: back.objects3d.some(function(o){return o.type==='model' && !!o.model;})
      });
    })()`);
    const rj = JSON.parse(rt);
    check('项目 JSON 里带上了素材', rj.assets === 3, rj.assets + ' 个 / ' + rj.kb + ' KB');
    check('素材类型（图片/模型）都保留', rj.kinds === 'image,model,model', rj.kinds);
    check('图片造型的引用保留', rj.costShape === 'image' && rj.costAsset, rt);
    check('3D 贴图引用保留', rj.texKept);
    check('3D 模型引用保留', rj.modelKept);

    const exported = await B.cdp.ev(`(async function(){
      var src = await EH5App._runtimeSource();
      var html = EH5BuildStandalone(EH5App.projectJSON(), src);
      return html.length;
    })()`);
    check('能编译出带素材的独立 HTML', exported > 700000, (exported / 1024).toFixed(0) + ' KB');

    /* ============================================================
       6. 回归：老功能没坏
       ============================================================ */
    console.log('\n=== 6. 回归 ===');
    await B.cdp.ev("EH5App.loadSample('platformer')");
    await sleep(700);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1400);
    const reg = await B.cdp.ev(`(function(){
      var rt = EH5App.rt;
      var coin = rt.sprites.find(function(s){return s.name==='金币';});
      return JSON.stringify({frames:rt.frameCount, coinDir:Math.round(coin.direction), err:rt.lastError||''});
    })()`);
    const rg = JSON.parse(reg);
    check('内置 2D 示例仍正常', rg.frames > 30 && !rg.err, reg);

    await B.cdp.ev("EH5App.loadSample('fps')");
    await sleep(1200);
    await B.cdp.ev("document.getElementById('sbtn-flag').click()");
    await sleep(1500);
    const reg3 = await B.cdp.ev(`(function(){
      var rt = EH5App.rt;
      var g = rt.r3d.get('金块');
      return JSON.stringify({objs:rt.r3d.names().length, ry:Math.round(g.ry), err:rt.lastError||''});
    })()`);
    const rg3 = JSON.parse(reg3);
    check('内置 3D 示例仍正常', rg3.objs >= 5 && rg3.ry > 0 && !rg3.err, reg3);

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
