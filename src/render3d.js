/* ============================================================
   render3d.js — Three.js 场景管理器
   提供积木可直接调用的 3D 操作，并内置一个轻量刚体物理
   ============================================================ */
(function (global) {
  'use strict';

  const T = () => global.THREE;

  class Render3D {
    constructor(rt) {
      const THREE = T();
      this.rt = rt;
      this.canvas = rt.canvas3d;
      this.objects = Object.create(null);   // name -> record
      this.groundSize = 40;
      this.gravity = -20;
      this.fogDensity = 0;
      this.cameraMode = 'free';
      this.followTarget = null;
      this.followDist = 8;
      this.followHeight = 4;
      this.fp = { on: false, yaw: 0, pitch: 0, vy: 0, y: 1.7, locked: false };
      this._boxCache = Object.create(null);
      this._tmpBoxA = new THREE.Box3();
      this._tmpBoxB = new THREE.Box3();
      this._modelCache = Object.create(null);   // assetId -> {root, error}
      this._texCache = Object.create(null);     // assetId -> THREE.Texture

      /* --- 渲染器 --- */
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
      } catch (e) {
        renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false });
      }
      renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
      if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer = renderer;

      /* --- 场景 --- */
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(rt.project.stage.skyColor || '#87ceeb');
      /* 透视 / 正交 两个相机都留着，切换时只换 this.camera 指向 */
      this.cameraPersp = new THREE.PerspectiveCamera(58, 4 / 3, 0.1, 800);
      this.cameraOrtho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 800);
      this.camera = this.cameraPersp;
      this.projection = 'perspective';
      this.frustumSize = 10;
      this._camAspect = 4 / 3;
      this.camera.position.set(0, 6, 12);
      this.camera.lookAt(0, 1, 0);

      this.lights = new THREE.Group();
      this.scene.add(this.lights);
      this._addLight('ambient', 0.75);
      this._addLight('directional', 1.1);

      this.worldGroup = new THREE.Group();
      this.scene.add(this.worldGroup);

      this._bindInput();
    }

    /* ============================================================
       尺寸
       ============================================================ */
    resize(w, h) {
      this.renderer.setSize(w, h, false);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this._camAspect = h > 0 ? w / h : 4 / 3;
      this.cameraPersp.aspect = this._camAspect;
      this.cameraPersp.updateProjectionMatrix();
      this._applyOrtho();
    }

    _applyOrtho() {
      const a = this._camAspect, f = this.frustumSize;
      const c = this.cameraOrtho;
      c.left = -f * a / 2; c.right = f * a / 2;
      c.top = f / 2; c.bottom = -f / 2;
      c.updateProjectionMatrix();
    }

    /** 切换投影方式（正交适合等距 / 像素风游戏） */
    setProjection(mode, frustum) {
      const want = mode === 'ortho' ? 'ortho' : 'perspective';
      if (frustum != null && isFinite(Number(frustum))) {
        this.frustumSize = Math.max(0.5, Math.min(400, num(frustum, 10)));
      }
      if (want === this.projection) { this._applyOrtho(); return; }
      const old = this.camera;
      this.projection = want;
      this.camera = want === 'ortho' ? this.cameraOrtho : this.cameraPersp;
      this.camera.position.copy(old.position);
      this.camera.quaternion.copy(old.quaternion);
      this._applyOrtho();
    }

    /** 广告牌：让物体永远正对相机（做血条 / 立牌 / 精灵很有用） */
    setBillboard(name, on) {
      const o = this.get(name); if (!o) return;
      o.billboard = !!on;
      if (!on && o._mesh) o._mesh.rotation.set(deg(o.rx), deg(o.ry), deg(o.rz));
    }

    /* ============================================================
       输入（第一人称）
       ============================================================ */
    _bindInput() {
      this._onKey = (e) => {
        if (!this.fp.on) return;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      };
      this._onMove = (e) => {
        if (!this.fp.on || !this.fp.locked) return;
        this.fp.yaw -= e.movementX * 0.0022;
        this.fp.pitch -= e.movementY * 0.0022;
        this.fp.pitch = Math.max(-1.35, Math.min(1.35, this.fp.pitch));
      };
      this._onClick = () => {
        if (this.fp.on && !this.fp.locked && this.canvas.requestPointerLock) {
          this.canvas.requestPointerLock();
        }
      };
      this._onLockChange = () => {
        this.fp.locked = (document.pointerLockElement === this.canvas);
      };
      global.addEventListener('keydown', this._onKey);
      global.addEventListener('mousemove', this._onMove);
      this.canvas.addEventListener('click', this._onClick);
      document.addEventListener('pointerlockchange', this._onLockChange);
    }

    _unbindInput() {
      global.removeEventListener('keydown', this._onKey);
      global.removeEventListener('mousemove', this._onMove);
      this.canvas.removeEventListener('click', this._onClick);
      document.removeEventListener('pointerlockchange', this._onLockChange);
      if (document.pointerLockElement === this.canvas && document.exitPointerLock) document.exitPointerLock();
    }

    /* ============================================================
       几何体 / 材质
       ============================================================ */
    _geometry(o) {
      const THREE = T();
      if (o.type === 'model') return null;      // 模型单独处理
      switch (o.type) {
        case 'sphere':   return new THREE.SphereGeometry(o.r, 26, 18);
        case 'cylinder': return new THREE.CylinderGeometry(o.r, o.r, o.h, 26);
        case 'cone':     return new THREE.ConeGeometry(o.r, o.h, 26);
        case 'torus':    return new THREE.TorusGeometry(o.r, o.r * 0.36, 14, 34);
        case 'plane':    return new THREE.PlaneGeometry(o.w || 1, o.d || 1);
        case 'capsule':  return new THREE.CapsuleGeometry(o.r, o.h, 6, 16);
        case 'text':     return this._textGeometry(o);
        case 'box':
        default:         return new THREE.BoxGeometry(o.w || 1, o.h || 1, o.d || 1);
      }
    }

    _textGeometry(o) {
      const THREE = T();
      const txt = String(o.text || o.name || '文字');
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      const fs = 96;
      ctx.font = `700 ${fs}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
      const tw = Math.ceil(ctx.measureText(txt).width) + 24;
      c.width = Math.max(16, tw); c.height = Math.round(fs * 1.5);
      const c2 = c.getContext('2d');
      c2.clearRect(0, 0, c.width, c.height);
      c2.font = `700 ${fs}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
      c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillStyle = o.color || '#ffffff';
      c2.fillText(txt, c.width / 2, c.height / 2);
      const tex = new THREE.CanvasTexture(c);
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      const hh = 1.0;
      const ww = hh * (c.width / c.height);
      const g = new THREE.PlaneGeometry(ww, hh);
      g.userData.texture = tex;
      return g;
    }

    _material(o) {
      const THREE = T();
      if (o.type === 'text') {
        const g = o._geo;
        return new THREE.MeshBasicMaterial({
          map: g && g.userData.texture, transparent: true, side: THREE.DoubleSide, depthWrite: false
        });
      }
      const params = {
        color: new THREE.Color(o.color || '#4c97ff'),
        roughness: 0.62, metalness: 0.06,
        transparent: (o.opacity || 1) < 1,
        opacity: o.opacity == null ? 1 : o.opacity
      };
      /* 贴图：有图时基色设白，否则贴图会被染色 */
      const tex = this._texture(o.texture);
      if (tex) { params.map = tex; params.color = new THREE.Color(0xffffff); }
      return new THREE.MeshStandardMaterial(params);
    }

    /** 按素材 id 取（并缓存）贴图；素材还没加载好时返回 null */
    _texture(assetId) {
      const THREE = T();
      if (!assetId) return null;
      if (assetId in this._texCache) return this._texCache[assetId];
      const src = global.EH5Model.assetSrc(assetId);
      if (!src) { this._texCache[assetId] = null; return null; }
      const t = new THREE.Texture();
      if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
      const img = new Image();
      img.onload = () => { t.image = img; t.needsUpdate = true; };
      img.onerror = () => { /* 保留空纹理，不炸 */ };
      img.src = src;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      this._texCache[assetId] = t;
      return t;
    }

    /* ============================================================
       3D 模型（glb / gltf / obj / stl）
       ============================================================ */
    /** 取模型模板；首次调用会异步解析，好了返回 {root} */
    _model(assetId) {
      if (!assetId) return null;
      const cached = this._modelCache[assetId];
      if (cached) return cached;
      const src = global.EH5Model.assetSrc(assetId);
      const meta = global.EH5Model.assetById(assetId);
      const rec = { root: null, error: null, loading: true };
      this._modelCache[assetId] = rec;
      if (!src) { rec.error = '素材不存在'; rec.loading = false; return rec; }

      fetch(src).then(r => r.arrayBuffer()).then(buf => {
        const M = global.EH5Models;
        const parsed = M.parseModel(buf, (meta && meta.format) || 'glb');
        M.normalizeModel(parsed.root, 2);
        parsed.root.traverse(n => {
          if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
        });
        rec.root = parsed.root;
        rec.loading = false;
        this.rt.notifyObjectsChanged();
      }).catch(e => {
        rec.error = e.message || String(e);
        rec.loading = false;
        console.warn('[EasyH5] 模型解析失败：', rec.error);
      });
      return rec;
    }

    /** 把等待中的模型对象替换成真实网格 */
    _buildModelMesh(o) {
      const THREE = T();
      const rec = this._modelCache[o._pendingModel];
      if (!rec || !rec.root) return false;

      const inst = rec.root.clone(true);
      /* 每个实例独立材质，这样改颜色互不影响 */
      inst.traverse(n => {
        if (n.isMesh && n.material) n.material = n.material.clone();
      });
      const wrap = new THREE.Group();
      wrap.add(inst);
      wrap.position.set(o.x, o.y, o.z);
      wrap.rotation.set(deg(o.rx), deg(o.ry), deg(o.rz));
      wrap.scale.setScalar(o.scale);

      const box = new THREE.Box3().setFromObject(inst);
      const s = new THREE.Vector3();
      box.getSize(s);
      o._half = { x: Math.abs(s.x) / 2, y: Math.abs(s.y) / 2, z: Math.abs(s.z) / 2 };
      o._radius = Math.max(o._half.x, o._half.y, o._half.z);

      /* 换掉占位体 */
      this.worldGroup.remove(o._mesh);
      if (o._mesh.geometry) o._mesh.geometry.dispose();
      if (o._mesh.material) o._mesh.material.dispose();

      o._mesh = wrap;
      o._mesh.visible = o.visible;
      o._geo = null;
      o._pendingModel = null;
      this.worldGroup.add(wrap);
      /* 这个对象如果指定了贴图，套到模型的所有材质上 */
      if (o.texture) this.setTexture(o.name, o.texture);
      return true;
    }

    /* ============================================================
       对象增删改
       ============================================================ */
    create(name, type, opts) {
      name = String(name == null || name === '' ? '物体' : name);
      opts = opts || {};
      const existing = this.objects[name];
      if (existing) this.remove(name);

      const o = {
        name, type: type || 'box',
        color: opts.color || '#4c97ff',
        texture: opts.texture || '',      // 素材库图片 id（空 = 纯色）
        model: opts.model || '',          // 素材库模型 id
        w: num(opts.w, 1), h: num(opts.h, 1), d: num(opts.d, 1), r: num(opts.r, 0.5),
        text: opts.text || '',
        x: num(opts.x, 0), y: num(opts.y, num(opts.r, 0.5)), z: num(opts.z, 0),
        rx: num(opts.rx, 0), ry: num(opts.ry, 0), rz: num(opts.rz, 0),
        scale: num(opts.scale, 1),
        visible: opts.visible !== false,
        opacity: opts.opacity == null ? 1 : opts.opacity,
        physics: opts.physics || 'static',
        vx: 0, vy: 0, vz: 0,
        bounce: num(opts.bounce, 0.4),
        onGround: false,
        billboard: false,
        keys: null, speed: 0.15
      };
      /* sphere / cylinder / cone 用 r、h 派生尺寸 */
      if (o.type === 'sphere') { o.w = o.h = o.d = o.r * 2; }
      if (o.type === 'cylinder' || o.type === 'cone') { o.w = o.d = o.r * 2; }

      /* ---- 模型：先放线框占位体，模型解析好了在 update() 里换成真网格 ---- */
      if (o.type === 'model') {
        o.texture = opts.texture || '';
        o.model = opts.model || opts.assetId || '';
        o._pendingModel = o.model;
        this._model(o.model);          // 先把解析任务挂上（异步）
        const ph = new (T().Mesh)(
          new (T().BoxGeometry)(1, 1, 1),
          new (T().MeshStandardMaterial)({ color: new (T().Color)(0x9aa6bb), wireframe: true })
        );
        ph.position.set(o.x, o.y, o.z);
        ph.rotation.set(deg(o.rx), deg(o.ry), deg(o.rz));
        ph.scale.setScalar(o.scale);
        ph.visible = o.visible;
        ph.userData.name = name;
        o._mesh = ph;
        o._geo = ph.geometry;
        o._half = { x: 0.5, y: 0.5, z: 0.5 };
        o._radius = 0.5;
        this.worldGroup.add(ph);
        this.objects[name] = o;
        /* 已经缓存过就直接换 */
        this._buildModelMesh(o);
        this.rt.notifyObjectsChanged();
        return o;
      }

      const geo = this._geometry(o);
      o._geo = geo;
      geo.computeBoundingBox();
      const mat = this._material(o);
      const mesh = new (T().Mesh)(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(o.x, o.y, o.z);
      mesh.rotation.set(deg(o.rx), deg(o.ry), deg(o.rz));
      mesh.scale.setScalar(o.scale);
      mesh.visible = o.visible;
      mesh.userData.name = name;

      o._mesh = mesh;
      this.worldGroup.add(mesh);
      this.objects[name] = o;
      this._applyHalf(o);
      this._syncHalfFromScale(o);
      this.rt.notifyObjectsChanged();
      return o;
    }

    _applyHalf(o) {
      const bb = o._geo.boundingBox;
      o._half = {
        x: Math.abs(bb.max.x - bb.min.x) / 2,
        y: Math.abs(bb.max.y - bb.min.y) / 2,
        z: Math.abs(bb.max.z - bb.min.z) / 2
      };
      o._radius = Math.max(o._half.x, o._half.y, o._half.z);
    }

    _syncHalfFromScale(o) {
      if (o._mesh) o._mesh.scale.setScalar(o.scale);
    }

    get(name) { return this.objects[String(name)] || null; }

    remove(name) {
      const o = this.objects[String(name)];
      if (!o) return false;
      const mesh = o._mesh;
      this.worldGroup.remove(mesh);

      if (mesh && mesh.isMesh) {
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      } else if (mesh && mesh.traverse) {
        /* 模型是 Group：几何体和材质都是每实例克隆的，可以安全销毁；
           贴图是 _texCache 共享的，这里不能动 */
        mesh.traverse(n => {
          if (!n.isMesh) return;
          if (n.geometry) n.geometry.dispose();
          if (n.material) n.material.dispose();
        });
      }
      delete this.objects[String(name)];
      this.rt.notifyObjectsChanged();
      return true;
    }

    names() { return Object.keys(this.objects); }

    setPos(name, x, y, z) {
      const o = this.get(name); if (!o) return;
      o.x = num(x, o.x); o.y = num(y, o.y); o.z = num(z, o.z);
      o._mesh.position.set(o.x, o.y, o.z);
    }

    move(name, n) {
      const o = this.get(name); if (!o) return;
      const THREE = T();
      const fwd = new THREE.Vector3(0, 0, 1).applyEuler(o._mesh.rotation);
      const d = num(n, 1);
      this.setPos(name, o.x + fwd.x * d, o.y + fwd.y * d, o.z + fwd.z * d);
    }

    rotate(name, axis, degv) {
      const o = this.get(name); if (!o) return;
      const d = num(degv, 0);
      if (axis === 'x') o.rx += d; else if (axis === 'z') o.rz += d; else o.ry += d;
      o._mesh.rotation.set(deg(o.rx), deg(o.ry), deg(o.rz));
    }

    setRot(name, x, y, z) {
      const o = this.get(name); if (!o) return;
      o.rx = num(x, 0); o.ry = num(y, 0); o.rz = num(z, 0);
      o._mesh.rotation.set(deg(o.rx), deg(o.ry), deg(o.rz));
    }

    setScale(name, s) {
      const o = this.get(name); if (!o) return;
      o.scale = num(s, 1);
      o._mesh.scale.setScalar(o.scale);
    }

    setColor(name, color) {
      const o = this.get(name); if (!o) return;
      o.color = color;
      if (o.type === 'model') {
        o._mesh.traverse(n => {
          if (n.isMesh && n.material && n.material.color && !n.material.map) n.material.color.set(color);
        });
        return;
      }
      if (o.type === 'text') {
        /* 文字需要重绘贴图 */
        const geo = this._textGeometry(Object.assign({}, o, { color }));
        const old = o._geo;
        o._geo = geo; geo.computeBoundingBox();
        o._mesh.geometry = geo;
        o._mesh.material.map.dispose();
        o._mesh.material.map = geo.userData.texture;
        o._mesh.material.needsUpdate = true;
        old.dispose();
        this._applyHalf(o);
      } else if (o._mesh.material.color) {
        o._mesh.material.color.set(color);
      }
    }

    setText(name, text) {
      const o = this.get(name); if (!o) return;
      o.text = text;
      this.setColor(name, o.color);
    }

    /** 设置贴图（assetId 为空 = 恢复纯色） */
    setTexture(name, assetId) {
      const o = this.get(name); if (!o) return;
      o.texture = assetId || '';
      const tex = this._texture(o.texture);
      const apply = (mat) => {
        if (!mat) return;
        if (mat.map && mat.map.dispose && mat.map !== tex) { /* 共享纹理不销毁 */ }
        mat.map = tex || null;
        if (mat.color) mat.color.set(tex ? 0xffffff : (o.color || '#4c97ff'));
        mat.needsUpdate = true;
      };
      if (o.type === 'model') {
        o._mesh.traverse(n => { if (n.isMesh) apply(n.material); });
      } else if (o._mesh && o._mesh.material) {
        apply(o._mesh.material);
      }
    }

    setVisible(name, v) {
      const o = this.get(name); if (!o) return;
      o.visible = !!v;
      o._mesh.visible = o.visible;
    }

    setOpacity(name, v) {
      const o = this.get(name); if (!o) return;
      o.opacity = Math.max(0, Math.min(1, num(v, 1)));
      o._mesh.material.transparent = o.opacity < 1;
      o._mesh.material.opacity = o.opacity;
      o._mesh.material.needsUpdate = true;
    }

    setMode(name, mode) {
      const o = this.get(name); if (!o) return;
      o.physics = mode === 'dynamic' ? 'dynamic' : 'static';
      if (o.physics === 'static') { o.vx = o.vy = o.vz = 0; }
    }

    setSpeed(name, x, y, z) {
      const o = this.get(name); if (!o) return;
      o.vx = num(x, 0); o.vy = num(y, 0); o.vz = num(z, 0);
    }

    impulse(name, x, y, z) {
      const o = this.get(name); if (!o) return;
      o.vx += num(x, 0); o.vy += num(y, 0); o.vz += num(z, 0);
    }

    setBounce(name, b) {
      const o = this.get(name); if (!o) return;
      o.bounce = Math.max(0, Math.min(1.2, num(b, 0.4)));
    }

    keyControl(name, keys, speed) {
      const o = this.get(name); if (!o) return;
      o.keys = keys || 'wasd';
      o.speed = num(speed, 0.15);
    }

    getPos(name, axis) {
      const o = this.get(name); if (!o) return 0;
      return o[axis] || 0;
    }

    onGround(name) {
      const o = this.get(name); return o ? !!o.onGround : false;
    }

    /* ============================================================
       场景级设置
       ============================================================ */
    ground(size, color) {
      const THREE = T();
      const s = num(size, 40);
      this.groundSize = s;
      if (this._ground) {
        this.worldGroup.remove(this._ground);
        this._ground.geometry.dispose();
        this._ground.material.dispose();
      }
      const geo = new THREE.PlaneGeometry(s, s, 1, 1);
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color || '#8fbf6a'), roughness: 0.95 });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.receiveShadow = true;
      this.worldGroup.add(m);
      this._ground = m;

      /* 网格线辅助（视觉参考） */
      if (this._grid) { this.worldGroup.remove(this._grid); this._grid.geometry.dispose(); }
      const grid = new THREE.GridHelper(s, Math.min(80, Math.round(s / 2)), 0x000000, 0x000000);
      grid.material.opacity = 0.12;
      grid.material.transparent = true;
      grid.position.y = 0.012;
      this.worldGroup.add(grid);
      this._grid = grid;
    }

    setBg(color) {
      this.scene.background = new (T().Color)(color || '#87ceeb');
    }

    addLight(kind, intensity) {
      this._addLight(kind, num(intensity, 0.8));
    }

    _addLight(kind, intensity) {
      const THREE = T();
      let l;
      if (kind === 'directional') {
        l = new THREE.DirectionalLight(0xffffff, intensity);
        l.position.set(12, 22, 10);
        l.castShadow = true;
        l.shadow.mapSize.set(1024, 1024);
        const c = l.shadow.camera;
        c.left = -35; c.right = 35; c.top = 35; c.bottom = -35; c.far = 90;
        c.updateProjectionMatrix();
      } else if (kind === 'point') {
        l = new THREE.PointLight(0xffffff, intensity * 40, 90);
        l.position.set(0, 10, 0);
        l.castShadow = true;
      } else {
        l = new THREE.AmbientLight(0xffffff, intensity);
      }
      this.lights.add(l);
      return l;
    }

    clearLights() {
      const THREE = T();
      this.lights.children.slice().forEach(l => {
        this.lights.remove(l);
        if (l.dispose) l.dispose();
      });
    }

    setFog(v, color) {
      const THREE = T();
      const d = num(v, 0);
      this.fogDensity = d;
      if (d <= 0) { this.scene.fog = null; return; }
      this.scene.fog = new THREE.FogExp2(new THREE.Color(color || '#cfe6ff').getHex(), d);
    }

    /* ============================================================
       相机
       ============================================================ */
    cameraPos(x, y, z, lx, ly, lz) {
      this.cameraMode = 'free';
      this.camera.position.set(num(x, 0), num(y, 5), num(z, 10));
      this.camera.lookAt(num(lx, 0), num(ly, 0), num(lz, 0));
    }

    cameraLook(name) {
      const o = this.get(name); if (!o) return;
      this.cameraMode = 'free';
      this.camera.lookAt(o._mesh.position);
    }

    cameraFollow(name, dist, height) {
      this.cameraMode = 'follow';
      this.followTarget = String(name);
      this.followDist = num(dist, 8);
      this.followHeight = num(height, 4);
    }

    firstPerson(on) {
      this.fp.on = !!on;
      if (on) {
        this.cameraMode = 'firstperson';
        this.fp.y = num(this.rt.project.scene3d.eyeHeight, 1.7);
        this.fp.vy = 0;
        const p = this.camera.position;
        /* 从当前相机位置起步 */
        this.fp.pos = { x: p.x, z: p.z };
        this.fp.yaw = 0; this.fp.pitch = 0;
      } else {
        this.cameraMode = 'free';
        if (document.pointerLockElement === this.canvas && document.exitPointerLock) document.exitPointerLock();
      }
    }

    /* ============================================================
       碰撞
       ============================================================ */
    _box(o) {
      const THREE = T();
      if (!this._boxCache[o.name]) {
        this._boxCache[o.name] = new THREE.Box3().setFromObject(o._mesh);
      }
      return this._boxCache[o.name];
    }

    collide(a, b) {
      const oa = this.get(a), ob = this.get(b);
      if (!oa || !ob || !oa.visible || !ob.visible) return false;
      return this._box(oa).intersectsBox(this._box(ob));
    }

    /* ============================================================
       每帧更新
       ============================================================ */
    update(dt) {
      dt = Math.min(0.05, Math.max(0.001, dt));
      this._boxCache = Object.create(null);
      const names = Object.keys(this.objects);

      /* 模型解析完成 -> 把占位线框换成真网格 */
      for (const n of names) {
        const o = this.objects[n];
        if (!o._pendingModel) continue;
        const rec = this._model(o._pendingModel);       // 幂等：首次调用会启动解析
        if (rec && rec.root) this._buildModelMesh(o);
        else if (rec && rec.error) o._pendingModel = ''; // 失败就留占位体，别每帧重试
      }

      /* 键盘控制的对象 */
      for (const n of names) {
        const o = this.objects[n];
        if (!o.keys || !o.visible) continue;
        const k = this.rt.keys;
        const sp = o.speed;
        let dx = 0, dz = 0;
        const wasd = o.keys === 'wasd' || o.keys === 'both';
        const arr = o.keys === 'arrows' || o.keys === 'both';
        if ((wasd && k.has('a')) || (arr && k.has('ArrowLeft'))) dx -= 1;
        if ((wasd && k.has('d')) || (arr && k.has('ArrowRight'))) dx += 1;
        if ((wasd && k.has('w')) || (arr && k.has('ArrowUp'))) dz -= 1;
        if ((wasd && k.has('s')) || (arr && k.has('ArrowDown'))) dz += 1;
        if (dx || dz) {
          const len = Math.hypot(dx, dz);
          this.setPos(n, o.x + dx / len * sp, o.y, o.z + dz / len * sp);
          if (o.type !== 'text') {
            o.ry = Math.atan2(dx, dz) * 180 / Math.PI;
            o._mesh.rotation.y = deg(o.ry);
          }
        }
      }

      /* 刚体 */
      const bound = this.groundSize / 2;
      for (const n of names) {
        const o = this.objects[n];
        if (o.physics !== 'dynamic') continue;
        o.vy += this.gravity * dt;
        o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;

        const hy = (o._half ? o._half.y : 0.5) * o.scale;
        const hx = (o._half ? o._half.x : 0.5) * o.scale;
        const hz = (o._half ? o._half.z : 0.5) * o.scale;

        if (o.y <= hy) {
          o.y = hy;
          if (o.vy < 0) o.vy = -o.vy * o.bounce;
          o.vx *= 0.99; o.vz *= 0.99;
          o.onGround = Math.abs(o.vy) < 0.9;
          if (o.onGround && Math.abs(o.vy) < 0.35) o.vy = 0;
        } else {
          o.onGround = false;
        }
        /* 场景边界反弹 */
        if (o.x > bound - hx) { o.x = bound - hx; o.vx = -Math.abs(o.vx) * o.bounce; }
        if (o.x < -bound + hx) { o.x = -bound + hx; o.vx = Math.abs(o.vx) * o.bounce; }
        if (o.z > bound - hz) { o.z = bound - hz; o.vz = -Math.abs(o.vz) * o.bounce; }
        if (o.z < -bound + hz) { o.z = -bound + hz; o.vz = Math.abs(o.vz) * o.bounce; }

        o._mesh.position.set(o.x, o.y, o.z);
      }

      /* 相机 */
      if (this.cameraMode === 'follow' && this.followTarget) {
        const o = this.get(this.followTarget);
        if (o) {
          const tx = o.x, ty = o.y, tz = o.z;
          const cx = tx, cy = ty + this.followHeight, cz = tz + this.followDist;
          this.camera.position.lerp(new (T().Vector3)(cx, cy, cz), 1 - Math.pow(0.001, dt));
          this.camera.lookAt(tx, ty + 0.8, tz);
        }
      } else if (this.cameraMode === 'firstperson' && this.fp.on) {
        this._updateFP(dt);
      }

      /* 广告牌：放在相机更新之后，用的是本帧的相机朝向 */
      for (const n of names) {
        const o = this.objects[n];
        if (o.billboard && o._mesh) o._mesh.quaternion.copy(this.camera.quaternion);
      }
    }

    _updateFP(dt) {
      const THREE = T();
      const k = this.rt.keys;
      const pad = this.rt.pad;
      const sp = 5.2;

      /* 键盘给 -1/0/1，摇杆给模拟量，两者叠加 */
      let mx = 0, mz = 0;
      if (k.has('w') || k.has('ArrowUp')) mz -= 1;
      if (k.has('s') || k.has('ArrowDown')) mz += 1;
      if (k.has('a') || k.has('ArrowLeft')) mx -= 1;
      if (k.has('d') || k.has('ArrowRight')) mx += 1;
      if (pad) {
        const ax = (pad.axes || [])[0] || 0;
        const ay = (pad.axes || [])[1] || 0;
        if (Math.abs(ax) > 0.16) mx += ax;
        if (Math.abs(ay) > 0.16) mz += ay;
      }
      /* 只在超过单位长度时归一化，这样摇杆轻推=慢走 */
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }
      if (len > 0.02) {
        const sin = Math.sin(this.fp.yaw), cos = Math.cos(this.fp.yaw);
        this.fp.pos.x += (mx * cos - mz * sin) * sp * dt;
        this.fp.pos.z += (mx * sin + mz * cos) * sp * dt;
      }

      /* 右摇杆转视角 */
      if (pad) {
        const rx = (pad.axes || [])[2] || 0;
        const ry = (pad.axes || [])[3] || 0;
        if (Math.abs(rx) > 0.16) this.fp.yaw -= rx * 2.6 * dt;
        if (Math.abs(ry) > 0.16) this.fp.pitch -= ry * 1.8 * dt;
        this.fp.pitch = Math.max(-1.35, Math.min(1.35, this.fp.pitch));
      }

      const eye = num(this.rt.project.scene3d.eyeHeight, 1.7);
      /* 空格 / A 键 / RT 都能跳 */
      const wantJump = k.has(' ') || (pad && (this.rt.padButton('0') || this.rt.padButton('7')));
      if (wantJump && this.fp.y <= eye + 0.02) this.fp.vy = 6.2;
      this.fp.vy += this.gravity * dt;
      this.fp.y += this.fp.vy * dt;
      if (this.fp.y < eye) { this.fp.y = eye; this.fp.vy = 0; }

      const b = this.groundSize / 2 - 1;
      this.fp.pos.x = Math.max(-b, Math.min(b, this.fp.pos.x));
      this.fp.pos.z = Math.max(-b, Math.min(b, this.fp.pos.z));

      this.camera.position.set(this.fp.pos.x, this.fp.y, this.fp.pos.z);
      const dir = new THREE.Vector3(
        -Math.sin(this.fp.yaw) * Math.cos(this.fp.pitch),
        Math.sin(this.fp.pitch),
        -Math.cos(this.fp.yaw) * Math.cos(this.fp.pitch)
      );
      this.camera.lookAt(
        this.camera.position.x + dir.x,
        this.camera.position.y + dir.y,
        this.camera.position.z + dir.z
      );
    }

    render() {
      this.renderer.render(this.scene, this.camera);
    }

    dispose() {
      this._unbindInput();
      const names = Object.keys(this.objects);
      names.forEach(n => this.remove(n));
      if (this._ground) { this._ground.geometry.dispose(); this._ground.material.dispose(); }
      if (this._grid) this._grid.geometry.dispose();
      this.clearLights();
      try { this.renderer.dispose(); } catch (e) { /* ignore */ }
    }
  }

  function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }
  function deg(d) { return num(d, 0) * Math.PI / 180; }

  global.EH5Render3D = Render3D;
})(typeof window !== 'undefined' ? window : globalThis);
