/* ============================================================
   models.js — 3D 模型解析（零外部依赖）
   支持：glTF 2.0 (.glb / .gltf 内嵌资源) · Wavefront OBJ · STL (二进制/ASCII)
   不支持 .blend —— 那是 Blender 的内部工程格式，不是模型交换格式，
   浏览器侧没有任何解析可能。见 detectModelFormat() 里的引导。
   ============================================================ */
(function (global) {
  'use strict';

  const T = () => global.THREE;

  /* ============================================================
     格式识别
     ============================================================ */
  const EXT_MAP = {
    glb: 'glb', gltf: 'gltf', obj: 'obj', stl: 'stl',
    blend: 'blend', blend1: 'blend', fbx: 'fbx', dae: 'dae',
    '3ds': '3ds', ply: 'ply'
  };

  const SUPPORTED = ['glb', 'gltf', 'obj', 'stl'];

  /** 从文件名 / 头部字节判断格式 */
  function detectModelFormat(fileName, buffer) {
    let ext = String(fileName || '').toLowerCase().split('.').pop();
    if (!ext || ext === fileName) ext = '';

    /* 用文件头再确认一次（防止扩展名骗人） */
    if (buffer && buffer.byteLength >= 12) {
      const dv = new DataView(buffer);
      const magic = dv.getUint32(0, true);
      if (magic === 0x46546C67) return { format: 'glb', confident: true };      // "glTF"
      /* Blender：未压缩是 "BLENDER"，压缩是 gzip 0x1f8b */
      const b0 = dv.getUint8(0), b1 = dv.getUint8(1);
      if (b0 === 0x1F && b1 === 0x8B) return { format: 'blend', confident: true };
      const head = new Uint8Array(buffer, 0, Math.min(7, buffer.byteLength));
      if (String.fromCharCode.apply(null, head) === 'BLENDER') return { format: 'blend', confident: true };
    }

    if (buffer) {
      const head = new TextDecoder('utf-8').decode(new Uint8Array(buffer, 0, Math.min(512, buffer.byteLength)));
      if (/^\s*solid\s/i.test(head) && /facet\s+normal/i.test(head)) return { format: 'stl', confident: true };
      if (/^\s*\{/.test(head) && /"asset"\s*:/.test(head)) return { format: 'gltf', confident: true };
      if (/^\s*(#|v\s|mtllib|o\s|g\s)/m.test(head)) return { format: 'obj', confident: false };
    }

    return { format: EXT_MAP[ext] || ext || 'unknown', confident: false };
  }

  /** 给人看的格式说明；null = 可以直接解析 */
  function formatAdvice(format) {
    switch (format) {
      case 'blend':
        return {
          title: '无法直接读取 .blend 文件',
          why: '.blend 是 Blender 的工程文件（内部是带指针的内存块 + 版本相关的 DNA 结构），' +
               '它不是模型交换格式。浏览器里没有任何办法解析它，Blender 自己也只认兼容版本的 .blend。',
          how: [
            '在 Blender 里打开你的 .blend',
            '点「文件 → 导出 → glTF 2.0 (.glb/.gltf)」',
            '右侧格式选「glTF Binary (.glb)」，直接导出',
            '把导出的 .glb 拖进这里'
          ],
          tip: '导出时如果勾了「压缩 / Draco」，浏览器解不开，请保持关闭。'
        };
      case 'fbx':
        return {
          title: '暂不支持 .fbx',
          why: 'FBX 是 Autodesk 的私有格式，解析器体积很大且授权受限。',
          how: ['在 Blender 里导入 FBX', '再导出为 glTF 2.0 (.glb)', '把 .glb 拖进来'],
          tip: null
        };
      case 'dae':
      case '3ds':
      case 'ply':
        return {
          title: '暂不支持 .' + format,
          why: '这个格式没有内置解析器。',
          how: ['用 Blender 打开', '导出为 glTF 2.0 (.glb)', '把 .glb 拖进来'],
          tip: null
        };
      default:
        return null;
    }
  }

  /* ============================================================
     OBJ
     ============================================================ */
  function parseOBJ(text) {
    const THREE = T();
    const v = [];      // 顶点
    const vt = [];     // uv
    const vn = [];     // 法线
    const positions = [];
    const uvs = [];
    const normals = [];
    let hasUV = false, hasNormal = false;

    const lines = text.split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (!line || line.charCodeAt(0) === 35) continue;   // '#'
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      const tag = line.slice(0, sp);

      if (tag === 'v') {
        const p = line.slice(sp + 1).trim().split(/\s+/);
        v.push(+p[0] || 0, +p[1] || 0, +p[2] || 0);
      } else if (tag === 'vt') {
        const p = line.slice(sp + 1).trim().split(/\s+/);
        vt.push(+p[0] || 0, +p[1] || 0);
      } else if (tag === 'vn') {
        const p = line.slice(sp + 1).trim().split(/\s+/);
        vn.push(+p[0] || 0, +p[1] || 0, +p[2] || 0);
      } else if (tag === 'f') {
        const parts = line.slice(sp + 1).trim().split(/\s+/);
        if (parts.length < 3) continue;
        /* 扇形三角化，支持多边形面 */
        for (let i = 1; i + 1 < parts.length; i++) {
          emit(parts[0]); emit(parts[i]); emit(parts[i + 1]);
        }
      }
    }

    function idx(s, n) {
      const i = parseInt(s, 10);
      if (!isFinite(i)) return -1;
      return i < 0 ? n + i : i - 1;
    }
    function emit(tok) {
      const seg = tok.split('/');
      const vi = idx(seg[0], v.length / 3) * 3;
      positions.push(v[vi] || 0, v[vi + 1] || 0, v[vi + 2] || 0);
      if (seg.length > 1 && seg[1] !== '') {
        const ti = idx(seg[1], vt.length / 2) * 2;
        uvs.push(vt[ti] || 0, vt[ti + 1] || 0);
        hasUV = true;
      }
      if (seg.length > 2 && seg[2] !== '') {
        const ni = idx(seg[2], vn.length / 3) * 3;
        normals.push(vn[ni] || 0, vn[ni + 1] || 0, vn[ni + 2] || 0);
        hasNormal = true;
      }
    }

    if (!positions.length) throw new Error('OBJ 里没有找到面（f）数据');

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (hasUV && uvs.length === positions.length / 3 * 2) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }
    if (hasNormal && normals.length === positions.length) {
      g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    } else {
      g.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }));
    const root = new THREE.Group();
    root.add(mesh);
    return { root, stats: { meshes: 1, triangles: positions.length / 9 } };
  }

  /* ============================================================
     STL
     ============================================================ */
  function parseSTL(buffer) {
    const THREE = T();
    const positions = [];
    const normals = [];
    const u8 = new Uint8Array(buffer);

    /* 二进制判断：文件头不是 "solid"，或长度刚好等于 84 + 50*n */
    let isBinary = true;
    const head = new TextDecoder('utf-8').decode(u8.slice(0, 5));
    if (head === 'solid') {
      const dv0 = new DataView(buffer);
      if (buffer.byteLength >= 84) {
        const n = dv0.getUint32(80, true);
        if (84 + n * 50 === buffer.byteLength) isBinary = true;
        else isBinary = false;
      } else isBinary = false;
    }

    if (isBinary) {
      const dv = new DataView(buffer);
      if (buffer.byteLength < 84) throw new Error('STL 文件不完整');
      const n = dv.getUint32(80, true);
      if (84 + n * 50 > buffer.byteLength) throw new Error('STL 面数与实际长度不符');
      let off = 84;
      for (let i = 0; i < n; i++) {
        const nx = dv.getFloat32(off, true), ny = dv.getFloat32(off + 4, true), nz = dv.getFloat32(off + 8, true);
        off += 12;
        for (let k = 0; k < 3; k++) {
          positions.push(dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true));
          normals.push(nx, ny, nz);
          off += 12;
        }
        off += 2;
      }
    } else {
      const text = new TextDecoder('utf-8').decode(u8);
      const re = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        positions.push(+m[1], +m[2], +m[3]);
      }
      if (!positions.length) throw new Error('STL 里没有找到顶点');
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length === positions.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }));
    const root = new THREE.Group();
    root.add(mesh);
    return { root, stats: { meshes: 1, triangles: positions.length / 9 } };
  }

  /* ============================================================
     glTF 2.0（.glb 二进制 / .gltf 内嵌 data: 资源）
     ============================================================ */
  const CT = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
    5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array
  };
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

  function dataUriToBuffer(uri) {
    const i = uri.indexOf(',');
    const meta = uri.slice(0, i);
    const body = uri.slice(i + 1);
    if (/;base64/i.test(meta)) {
      const bin = atob(body);
      const out = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
      return out.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(body)).buffer;
  }

  function parseGLB(buffer) {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('不是有效的 GLB 文件');
    const total = dv.getUint32(8, true);
    let off = 12, json = null, bin = null;
    while (off + 8 <= Math.min(total, buffer.byteLength)) {
      const len = dv.getUint32(off, true);
      const type = dv.getUint32(off + 4, true);
      const data = buffer.slice(off + 8, off + 8 + len);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(data)));
      else if (type === 0x004E4942) bin = data;
      off += 8 + len + ((4 - (len % 4)) % 4);
    }
    if (!json) throw new Error('GLB 里没有 JSON 块');
    return parseGLTF(json, bin);
  }

  function parseGLTF(json, binBuffer) {
    const THREE = T();

    /* Draco 压缩的没法在纯运行时解开 */
    const req = json.extensionsRequired || [];
    if (req.indexOf('KHR_draco_mesh_compression') >= 0) {
      throw new Error('这个模型用了 Draco 压缩，浏览器端解不开。请在 Blender 导出时把「压缩」选项关掉。');
    }
    if (req.indexOf('KHR_mesh_quantization') >= 0) {
      /* 量化只是数据表示，我们按 componentType 正常读，通常没问题 */
    }

    const buffers = (json.buffers || []).map(b => {
      if (b.uri) {
        if (b.uri.slice(0, 5) === 'data:') return dataUriToBuffer(b.uri);
        throw new Error('这个 .gltf 引用了外部文件（' + b.uri + '）。请改用单文件 .glb。');
      }
      return binBuffer;
    });

    function viewBufferView(i) {
      const bv = json.bufferViews[i];
      const buf = buffers[bv.buffer];
      if (!buf) throw new Error('缺少 buffer 数据');
      const off = bv.byteOffset || 0;
      return { buf, off, len: bv.byteLength, stride: bv.byteStride || 0 };
    }

    function readAccessor(i) {
      const a = json.accessors[i];
      const n = NC[a.type] || 1;
      const Arr = CT[a.componentType];
      if (!Arr) throw new Error('不支持的 componentType: ' + a.componentType);
      const bv = json.bufferViews[a.bufferView];
      const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
      const src = buffers[bv.buffer];
      const stride = bv.byteStride || 0;
      const itemBytes = n * Arr.BYTES_PER_ELEMENT;

      let out;
      if (!stride || stride === itemBytes) {
        out = new Arr(src, base, a.count * n);
      } else {
        /* 交错存储：逐元素搬出来 */
        out = new Arr(a.count * n);
        for (let k = 0; k < a.count; k++) {
          const view = new Arr(src, base + k * stride, n);
          for (let j = 0; j < n; j++) out[k * n + j] = view[j];
        }
      }
      /* 法线/切线有时是归一化的整型，这里只处理浮点；整型归一化按需转换 */
      if (a.normalized && Arr !== Float32Array) {
        const max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] || 1;
        const f = new Float32Array(out.length);
        for (let k = 0; k < out.length; k++) f[k] = Math.max(out[k] / max, -1);
        return f;
      }
      return out;
    }

    /* ---------- 贴图 ---------- */
    const texCache = Object.create(null);
    function getTexture(texIndex) {
      if (texIndex == null || texIndex < 0) return null;
      if (texCache[texIndex] !== undefined) return texCache[texIndex];
      texCache[texIndex] = null;      // 先占位，避免递归
      const tex = (json.textures || [])[texIndex];
      if (!tex) return null;
      const img = (json.images || [])[tex.source];
      if (!img) return null;
      let url = null;
      if (img.uri) {
        url = img.uri.slice(0, 5) === 'data:' ? img.uri : null;
        if (!url) return null;
      } else if (img.bufferView != null) {
        const bv = json.bufferViews[img.bufferView];
        const bytes = new Uint8Array(buffers[bv.buffer], bv.byteOffset || 0, bv.byteLength);
        url = URL.createObjectURL(new Blob([bytes], { type: img.mimeType || 'image/png' }));
      }
      if (!url) return null;
      const t = new THREE.Texture();
      const image = new Image();
      image.onload = () => { t.image = image; t.needsUpdate = true; };
      image.src = url;
      t.colorSpace = THREE.SRGBColorSpace || t.colorSpace;
      t.flipY = false;      // glTF 的 UV 原点在左上
      texCache[texIndex] = t;
      return t;
    }

    function makeMaterial(mi) {
      const m = (json.materials || [])[mi] || {};
      const pbr = m.pbrMetallicRoughness || {};
      const params = {
        roughness: pbr.roughnessFactor == null ? 0.7 : pbr.roughnessFactor,
        metalness: pbr.metallicFactor == null ? 0.05 : pbr.metallicFactor,
        side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide
      };
      const bc = pbr.baseColorFactor;
      params.color = new THREE.Color(
        bc ? bc[0] : 1, bc ? bc[1] : 1, bc ? bc[2] : 1);
      const mat = new THREE.MeshStandardMaterial(params);
      const bct = pbr.baseColorTexture;
      if (bct) {
        const t = getTexture(bct.index);
        if (t) mat.map = t;
      }
      return mat;
    }

    /* ---------- 网格 ---------- */
    const meshCache = Object.create(null);
    function buildMesh(mi) {
      if (meshCache[mi]) return meshCache[mi];
      const m = json.meshes[mi];
      const group = new THREE.Group();
      (m.primitives || []).forEach(p => {
        const g = new THREE.BufferGeometry();
        const attrs = p.attributes || {};
        if (attrs.POSITION != null) {
          g.setAttribute('position', new THREE.BufferAttribute(readAccessor(attrs.POSITION), 3));
        }
        if (attrs.NORMAL != null) {
          g.setAttribute('normal', new THREE.BufferAttribute(readAccessor(attrs.NORMAL), 3));
        }
        if (attrs.TEXCOORD_0 != null) {
          g.setAttribute('uv', new THREE.BufferAttribute(readAccessor(attrs.TEXCOORD_0), 2));
        }
        if (p.indices != null) {
          g.setIndex(new THREE.BufferAttribute(readAccessor(p.indices), 1));
        }
        if (attrs.NORMAL == null) g.computeVertexNormals();
        const mat = makeMaterial(p.material);
        group.add(new THREE.Mesh(g, mat));
      });
      meshCache[mi] = group;
      return group;
    }

    /* ---------- 节点树 ---------- */
    let triCount = 0;
    function buildNode(ni) {
      const n = json.nodes[ni];
      const obj = new THREE.Group();
      if (n.mesh != null) {
        const built = buildMesh(n.mesh);
        const prims = (json.meshes[n.mesh].primitives || []);
        prims.forEach(p => {
          try {
            /* 有索引就按索引数算，没有索引就按顶点数 / 3 算 */
            if (p.indices != null) triCount += json.accessors[p.indices].count / 3;
            else if (p.attributes && p.attributes.POSITION != null) {
              triCount += json.accessors[p.attributes.POSITION].count / 3;
            }
          } catch (e) { /* 统计失败不影响加载 */ }
        });
        obj.add(built);
      }
      if (n.matrix) {
        const m = new THREE.Matrix4().fromArray(n.matrix);
        m.decompose(obj.position, obj.quaternion, obj.scale);
      } else {
        if (n.translation) obj.position.fromArray(n.translation);
        if (n.rotation) obj.quaternion.fromArray(n.rotation);
        if (n.scale) obj.scale.fromArray(n.scale);
      }
      (n.children || []).forEach(c => obj.add(buildNode(c)));
      return obj;
    }

    const root = new THREE.Group();
    const sceneIdx = json.scene != null ? json.scene : 0;
    const scene = (json.scenes || [])[sceneIdx] || (json.scenes || [])[0];
    if (!scene) throw new Error('glTF 里没有场景');
    (scene.nodes || []).forEach(ni => root.add(buildNode(ni)));
    return { root, stats: { meshes: Object.keys(meshCache).length, triangles: Math.round(triCount) } };
  }

  /* ============================================================
     统一入口
     ============================================================ */
  /**
   * @param {ArrayBuffer|string} data  文件内容
   * @param {string} format            detectModelFormat 的结果
   * @returns {{root: THREE.Group, stats: object}}
   */
  function parseModel(data, format) {
    if (format === 'glb') {
      const buf = data instanceof ArrayBuffer ? data : data.buffer;
      return parseGLB(buf);
    }
    if (format === 'gltf') {
      const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(new Uint8Array(data));
      const json = JSON.parse(text);
      return parseGLTF(json, null);
    }
    if (format === 'obj') {
      const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(new Uint8Array(data));
      return parseOBJ(text);
    }
    if (format === 'stl') {
      const buf = data instanceof ArrayBuffer ? data : data.buffer;
      return parseSTL(buf);
    }
    const advice = formatAdvice(format);
    throw new Error(advice ? advice.title : ('不支持的模型格式：' + format));
  }

  /**
   * 归一化：居中、底面贴地、缩放到目标尺寸
   * 让不同来源的模型导入后大小观感一致
   */
  function normalizeModel(root, targetSize) {
    const THREE = T();
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return { size: [1, 1, 1], scale: 1 };

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const k = (targetSize || 2) / maxDim;

    root.scale.multiplyScalar(k);
    /* 缩放后重新计算，再平移到「原点居中 + 底面在 y=0」 */
    const box2 = new THREE.Box3().setFromObject(root);
    const c2 = new THREE.Vector3();
    box2.getCenter(c2);
    root.position.x -= c2.x;
    root.position.z -= c2.z;
    root.position.y -= box2.min.y;

    return {
      size: [size.x * k, size.y * k, size.z * k],
      scale: k,
      srcSize: [size.x, size.y, size.z]
    };
  }

  global.EH5Models = {
    SUPPORTED, EXT_MAP,
    detectModelFormat, formatAdvice,
    parseModel, normalizeModel,
    parseOBJ, parseSTL, parseGLB, parseGLTF
  };
})(typeof window !== 'undefined' ? window : globalThis);
