/* ============================================================
   model.js — 项目数据模型
   项目 = JSON，可导出/导入/编译运行
   ============================================================ */
(function (global) {
  'use strict';

  const B = () => global.EH5Blocks;

  let _uid = 0;
  function uid(p) { return (p || 'i') + (++_uid) + Math.random().toString(36).slice(2, 6); }

  /* ============================================================
     程序化素材（零外部资源）
     ============================================================ */
  const SHAPES = [
    ['矩形', 'rect'], ['圆形', 'circle'], ['三角形', 'triangle'], ['五角星', 'star'],
    ['箭头', 'arrow'], ['心形', 'heart'], ['胶囊', 'capsule'], ['圆环', 'ring'],
    ['六边形', 'hexagon'], ['菱形', 'diamond'], ['文字', 'text'], ['图片', 'image']
  ];

  const PALETTE_COSTUME = ['#4c97ff', '#ff6b6b', '#ffd93d', '#59c059', '#9966ff',
    '#ff8c1a', '#e2498a', '#0fbd8c', '#5cb1d6', '#8b95a7'];

  /* ============================================================
     素材库：上传的图片按 id 存一份，造型/贴图只引用 id
     ============================================================ */
  let _assets = Object.create(null);   // id -> dataURL
  let _assetMeta = [];                 // [{id, name, src, w, h}]

  function setAssets(list) {
    _assets = Object.create(null);
    _assetMeta = Array.isArray(list) ? list : [];
    _assetMeta.forEach(a => { if (a && a.id) _assets[a.id] = a.src; });
  }
  function assetSrc(id) { return (id && _assets[id]) || ''; }
  function assetList() { return _assetMeta; }
  function assetById(id) { return _assetMeta.find(a => a.id === id) || null; }

  function addAsset(project, opts) {
    if (!project.assets) project.assets = [];
    opts = opts || {};
    const a = {
      id: uid('a'),
      name: opts.name || '素材',
      kind: opts.kind || 'image',          // image | model
      src: opts.src || '',
      w: opts.w || 0, h: opts.h || 0,      // 图片：原始像素尺寸
      format: opts.format || '',           // 模型：glb / gltf / obj / stl
      stats: opts.stats || null            // 模型：{meshes, triangles}
    };
    project.assets.push(a);
    _assets[a.id] = a.src;
    _assetMeta = project.assets;
    return a;
  }

  /** 素材占用的近似字节数（用于提示项目体积） */
  function assetBytes(project) {
    let n = 0;
    (project.assets || []).forEach(a => { n += (a.src || '').length; });
    return n;
  }

  /* ---------- 图片缓存（加载是异步的，渲染时拿不到就先画占位） ---------- */
  const _imgCache = Object.create(null);

  function getImage(src) {
    if (!src) return null;
    let rec = _imgCache[src];
    if (!rec) {
      rec = _imgCache[src] = { img: null, ready: false, failed: false };
      const im = new Image();
      im.onload = () => { rec.ready = true; };
      im.onerror = () => { rec.failed = true; };
      im.src = src;
      rec.img = im;
    }
    return rec.ready ? rec.img : null;
  }
  function imageState(src) {
    if (!src) return 'none';
    const r = _imgCache[src];
    if (!r) { getImage(src); return 'loading'; }
    return r.ready ? 'ready' : (r.failed ? 'failed' : 'loading');
  }
  /** 预加载（绿旗前调用，减少第一帧空窗） */
  function preloadAll(list) {
    (list || []).forEach(a => { if (a && a.src) getImage(a.src); });
  }

  /* ============================================================
     图片读入：读文件 -> 解码 -> 必要时降采样 -> dataURL
     ============================================================ */
  const MAX_TEX = 512;          // 最长边上限，控制项目体积

  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error('读取文件失败'));
      fr.readAsDataURL(file);
    });
  }

  function decodeImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('图片解码失败（格式可能不被支持）'));
      im.src = src;
    });
  }

  /**
   * 把上传的文件变成可用的素材
   * @returns {Promise<{src, w, h, name}>} w/h 是原始像素尺寸
   */
  async function importImageFile(file, maxDim) {
    const MAX = maxDim || MAX_TEX;
    if (!file) throw new Error('没有选择文件');
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');
    const dataUrl = await readAsDataURL(file);
    const im = await decodeImage(dataUrl);

    let w = im.naturalWidth || im.width || 0;
    let h = im.naturalHeight || im.height || 0;
    if (!w || !h) { w = 300; h = 150; }   // 无固有尺寸的 SVG，浏览器默认 300×150

    const k = Math.min(1, MAX / Math.max(w, h));
    const needRedraw = k < 1 || isSvg;    // SVG 一律栅格化，避免各处渲染不一致

    let out = dataUrl;
    if (needRedraw) {
      const cw = Math.max(1, Math.round(w * k));
      const ch = Math.max(1, Math.round(h * k));
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(im, 0, 0, cw, ch);
      /* 有透明通道的用 png，照片类用 jpeg 更小 */
      const isPhoto = /^image\/(jpeg|jpg|webp)$/i.test(file.type || '');
      out = isPhoto ? cv.toDataURL('image/jpeg', 0.9) : cv.toDataURL('image/png');
    }

    return { src: out, w: w, h: h, name: (file.name || '素材').replace(/\.[^.]+$/, '') };
  }

  /** 把图片像素尺寸换算成合适的舞台尺寸（最长边不超过 240） */
  function fitStageSize(w, h, maxSide) {
    const m = maxSide || 240;
    const k = Math.min(1, m / Math.max(w || 1, h || 1));
    return { w: Math.max(4, Math.round(w * k)), h: Math.max(4, Math.round(h * k)) };
  }

  /* ============================================================
     3D 模型导入
     ============================================================ */
  function readAsArrayBuffer(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error('读取文件失败'));
      fr.readAsArrayBuffer(file);
    });
  }

  function blobToDataURL(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error('读取文件失败'));
      fr.readAsDataURL(file);
    });
  }

  function disposeObject(obj) {
    if (!obj) return;
    obj.traverse && obj.traverse(n => {
      if (n.geometry && n.geometry.dispose) n.geometry.dispose();
      if (n.material) {
        const ms = Array.isArray(n.material) ? n.material : [n.material];
        ms.forEach(m => { if (m.dispose) m.dispose(); });
      }
    });
  }

  /**
   * 导入 3D 模型文件。
   * 会先真解析一遍再入库 —— 早失败好过用户点了运行才发现模型是空的。
   * @returns {Promise<{src,format,name,stats,size,bytes}>}
   */
  async function importModelFile(file) {
    if (!file) throw new Error('没有选择文件');
    const M = global.EH5Models;
    if (!M) throw new Error('模型解析器未加载');

    const buf = await readAsArrayBuffer(file);
    const det = M.detectModelFormat(file.name, buf);

    if (M.SUPPORTED.indexOf(det.format) < 0) {
      const advice = M.formatAdvice(det.format);
      const err = new Error(advice ? advice.title : ('不支持的模型格式：' + det.format));
      err.advice = advice;
      err.format = det.format;
      throw err;
    }

    /* 试解析 + 试归一化，确认真的能用 */
    let parsed, norm;
    try {
      parsed = M.parseModel(buf.slice(0), det.format);
      norm = M.normalizeModel(parsed.root, 2);
    } catch (e) {
      const err = new Error('模型解析失败：' + e.message);
      err.advice = M.formatAdvice(det.format);
      throw err;
    } finally {
      if (parsed && parsed.root) disposeObject(parsed.root);
    }

    const src = await blobToDataURL(file);
    return {
      src,
      format: det.format,
      name: String(file.name || '模型').replace(/\.[^.]+$/, ''),
      stats: parsed.stats,
      size: norm.size,
      bytes: buf.byteLength
    };
  }

  /** 在 (cx,cy) 为中心、宽 w 高 h 的框内绘制造型 */
  function drawCostume(ctx, c, cx, cy, w, h) {
    const x = cx - w / 2, y = cy - h / 2;
    const rx = w / 2, ry = h / 2;
    ctx.save();
    ctx.fillStyle = c.color || '#4c97ff';
    ctx.strokeStyle = c.color || '#4c97ff';
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.14);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    switch (c.shape) {
      case 'image': {
        const src = c.src || assetSrc(c.assetId);
        const im = getImage(src);
        if (im) {
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(im, x, y, w, h);
        } else {
          /* 图片还没加载完（或加载失败）—— 画个虚线占位框，别让角色凭空消失 */
          ctx.setLineDash([6, 5]);
          ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.05);
          ctx.strokeStyle = 'rgba(120,132,150,.9)';
          ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(120,132,150,.85)';
          ctx.font = '600 ' + Math.max(9, Math.min(w, h) * 0.2) + 'px system-ui,sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('图片', cx, cy);
        }
        break;
      }

      case 'circle':
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); break;

      case 'rect': {
        const r = Math.min(w, h) * 0.14;
        roundRect(ctx, x, y, w, h, r); ctx.fill(); break;
      }

      case 'capsule':
        roundRect(ctx, x, y, w, h, Math.min(w, h) / 2); ctx.fill(); break;

      case 'triangle':
        ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h);
        ctx.closePath(); ctx.fill(); break;

      case 'diamond':
        ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(x + w, cy); ctx.lineTo(cx, y + h); ctx.lineTo(x, cy);
        ctx.closePath(); ctx.fill(); break;

      case 'hexagon': {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 180 * (60 * i - 90);
          const px = cx + rx * Math.cos(a), py = cy + ry * Math.sin(a);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill(); break;
      }

      case 'ring':
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx - ctx.lineWidth / 2, ry - ctx.lineWidth / 2, 0, 0, Math.PI * 2);
        ctx.stroke(); break;

      case 'star': {
        const n = 5, inner = 0.42;
        ctx.beginPath();
        for (let i = 0; i < n * 2; i++) {
          const a = Math.PI / n * i - Math.PI / 2;
          const k = i % 2 ? inner : 1;
          const px = cx + rx * k * Math.cos(a), py = cy + ry * k * Math.sin(a);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill(); break;
      }

      case 'heart': {
        ctx.beginPath();
        const top = y + h * 0.28;
        ctx.moveTo(cx, y + h);
        ctx.bezierCurveTo(x - w * 0.16, top + h * 0.18, x + w * 0.16, y - h * 0.12, cx, top);
        ctx.bezierCurveTo(x + w * 0.84, y - h * 0.12, x + w * 1.16, top + h * 0.18, cx, y + h);
        ctx.closePath(); ctx.fill(); break;
      }

      case 'arrow': {
        const bw = w * 0.42;
        ctx.beginPath();
        ctx.moveTo(x, cy - h * 0.17); ctx.lineTo(x + w - bw, cy - h * 0.17);
        ctx.lineTo(x + w - bw, y); ctx.lineTo(x + w, cy);
        ctx.lineTo(x + w - bw, y + h); ctx.lineTo(x + w - bw, cy + h * 0.17);
        ctx.lineTo(x, cy + h * 0.17);
        ctx.closePath(); ctx.fill(); break;
      }

      case 'text': {
        const txt = c.text || '文字';
        ctx.font = `700 ${Math.max(8, h * 0.72)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(txt, cx, cy + h * 0.03);
        break;
      }

      default:
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function makeCostume(name, shape, color, w, h, text) {
    return { id: uid('c'), name: name, shape: shape || 'rect', color: color || '#4c97ff',
      w: w || 50, h: h || 50, text: text || '' };
  }

  /** 用素材库里的图片做造型 */
  function makeImageCostume(name, assetId, w, h) {
    return { id: uid('c'), name: name || '图片', shape: 'image',
      color: '#8b95a7', w: w || 80, h: h || 80, text: '', assetId: assetId || '' };
  }

  /* ============================================================
     积木构造辅助（用于内置示例工程）
     ============================================================ */
  /**
   * 造一个积木节点。
   * 第 2、3 个参数会合并后**自动路由**：参数名对上「下拉字段」就进 fields，
   * 否则进 inputs。这样作者不用记哪个参数是哪种类型
   * —— 之前手动分 inputs/fields 时踩过坑：颜色参数被写进 fields，
   *    运行时就一直读到默认色，画面毫无变化却不报错。
   */
  function Bk(type, a, b) {
    const node = B().make(type);
    const def = B().get(type);
    const fieldNames = new Set();
    (def && def.args ? def.args : []).forEach(x => {
      if (x.kind === 'field') fieldNames.add(x.name);
    });
    const src = Object.assign({}, a || {}, b || {});
    for (const k in src) {
      const v = src[k];
      if (v === undefined || v === null) continue;
      if (fieldNames.has(k)) node.fields[k] = v;
      else node.inputs[k] = v;
    }
    return node;
  }
  /** 把若干堆叠积木串成一条链 */
  function chain() {
    const list = Array.prototype.slice.call(arguments);
    for (let i = 0; i < list.length - 1; i++) list[i].next = list[i + 1];
    return list[0];
  }
  /** 给 C 型积木填充分支 */
  function sub(block, key, inner) { block.branches[key] = inner || null; return block; }

  /* ============================================================
     工程骨架
     ============================================================ */
  function createProject(name) {
    return {
      format: 'easyh5-engine',
      version: 1,
      meta: {
        name: name || '未命名项目',
        author: '',
        desc: '',
        created: new Date().toISOString()
      },
      stage: {
        mode: '2d',            // 2d | 3d
        width: 480,
        height: 360,
        bgColor: '#ffffff',
        skyColor: '#87ceeb',
        fps: 60,
        physics: { gravity: -20 }
      },
      variables: [],
      lists: [],
      broadcasts: [],
      assets: [],
      sprites: [createSprite('角色1')],
      objects3d: [],
      scene3d: { fog: 0, fogColor: '#cfe6ff', firstPerson: false, eyeHeight: 1.7 }
    };
  }

  function createSprite(name, shape, color) {
    const c = makeCostume('造型1', shape || 'rect', color || '#4c97ff', 50, 50);
    return {
      id: uid('s'),
      name: name || '角色',
      x: 0, y: 0,
      direction: 90,
      size: 100,
      visible: true,
      rotationStyle: 'all',      // all | leftright | none
      effects: { color: 0, brightness: 0, ghost: 0, pixelate: 0 },
      say: null,                 // {text, until, kind}
      costumes: [c],
      currentCostume: 0,
      draggable: false,
      scripts: []
    };
  }

  function createObject3d(name, type, color) {
    return {
      id: uid('o'),
      name: name || '物体',
      type: type || 'box',
      color: color || '#4c97ff',
      texture: '',              // 素材库里的图片 id（空 = 纯色）
      model: '',                // 素材库里的模型 id（type === 'model' 时用）
      w: 1, h: 1, d: 1, r: 0.5,
      text: '',
      x: 0, y: 1, z: 0,
      rx: 0, ry: 0, rz: 0,
      scale: 1,
      visible: true,
      opacity: 1,
      physics: 'static',        // static | dynamic
      vx: 0, vy: 0, vz: 0,
      bounce: 0.4,
      onGround: false,
      keys: null,
      speed: 0.15
    };
  }

  /* ============================================================
     规范化 / 迁移（保证旧 JSON 也能打开）
     ============================================================ */
  function normalize(p) {
    if (!p || typeof p !== 'object') throw new Error('不是合法的项目文件');
    if (p.format && p.format !== 'easyh5-engine') throw new Error('不是 EasyH5 项目文件（format 不匹配）');

    const base = createProject();
    p.format = 'easyh5-engine';
    p.version = p.version || 1;
    p.meta = Object.assign(base.meta, p.meta || {});
    p.stage = Object.assign(base.stage, p.stage || {});
    p.stage.physics = Object.assign({ gravity: -20 }, p.stage.physics || {});
    p.scene3d = Object.assign(base.scene3d, p.scene3d || {});
    p.variables = Array.isArray(p.variables) ? p.variables : [];
    p.lists = Array.isArray(p.lists) ? p.lists : [];
    p.broadcasts = Array.isArray(p.broadcasts) ? p.broadcasts : [];
    p.assets = Array.isArray(p.assets) ? p.assets : [];
    p.assets = p.assets.filter(a => a && a.id && typeof a.src === 'string');
    p.assets.forEach(a => { a.name = a.name || '素材'; });
    setAssets(p.assets);
    p.objects3d = Array.isArray(p.objects3d) ? p.objects3d : [];
    p.sprites = Array.isArray(p.sprites) && p.sprites.length ? p.sprites : [createSprite('角色1')];

    p.variables.forEach(v => { if (v.visible === undefined) v.visible = false; });
    p.lists.forEach(v => { if (v.visible === undefined) v.visible = false; });

    p.sprites.forEach(s => {
      const def = createSprite(s.name || '角色');
      Object.assign(def, s);
      s.id = s.id || def.id;
      s.costumes = Array.isArray(s.costumes) && s.costumes.length ? s.costumes : def.costumes;
      s.costumes.forEach(c => { Object.assign(makeCostume('造型', 'rect', '#4c97ff'), {}); });
      s.effects = Object.assign({ color: 0, brightness: 0, ghost: 0, pixelate: 0 }, s.effects || {});
      s.scripts = Array.isArray(s.scripts) ? s.scripts : [];
      s.size = num(s.size, 100);
      s.direction = num(s.direction, 90);
      s.x = num(s.x, 0); s.y = num(s.y, 0);
      s.currentCostume = Math.min(Math.max(0, s.currentCostume | 0), s.costumes.length - 1);
      s.rotationStyle = s.rotationStyle || 'all';
      /* 递归补全积木 id */
      s.scripts.forEach(walkBlocks);
    });

    p.objects3d.forEach(o => {
      const def = createObject3d(o.name, o.type, o.color);
      Object.assign(def, o);
      Object.assign(o, def);
    });

    p.broadcasts = p.broadcasts.filter(x => typeof x === 'string');
    return p;
  }

  function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }

  function walkBlocks(node) {
    if (!node || typeof node !== 'object' || !node.type) return;
    node.id = node.id || uid('b');
    node.inputs = node.inputs || {};
    node.fields = node.fields || {};
    for (const k in node.inputs) {
      const v = node.inputs[k];
      if (v && typeof v === 'object' && v.type) walkBlocks(v);
    }
    if (node.branches) for (const k in node.branches) walkBlocks(node.branches[k]);
    if (node.next) walkBlocks(node.next);
  }

  /* 内置示例工程见 samples.js（在 EH5Model.SAMPLES 上注册） */

  /* ============================================================
     工具：深拷贝 / 序列化
     ============================================================ */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function serialize(p) {
    const out = clone(p);
    out.format = 'easyh5-engine';
    out.version = 1;
    out.meta.saved = new Date().toISOString();
    return out;
  }

  function parse(text) {
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { throw new Error('JSON 解析失败：' + e.message); }
    return normalize(obj);
  }

  global.EH5Model = {
    SHAPES, PALETTE_COSTUME, MAX_TEX,
    drawCostume, makeCostume, makeImageCostume, roundRect,
    setAssets, assetSrc, assetList, assetById, addAsset, assetBytes,
    getImage, imageState, preloadAll,
    importImageFile, importModelFile, fitStageSize, disposeObject,
    createProject, createSprite, createObject3d,
    normalize, serialize, parse, clone,
    Bk, chain, sub, uid,
    SAMPLES: []
  };
})(typeof window !== 'undefined' ? window : globalThis);
