/* ============================================================
   runtime.js — 解释器 + 运行时
   把积木树变成真正会跑的游戏。编辑器与独立导出版共用这一份。
   ============================================================ */
(function (global) {
  'use strict';

  const M = global.EH5Model;
  const B = global.EH5Blocks;

  const STOP_THIS = Symbol('stopThis');
  const STOP_ALL = Symbol('stopAll');

  /* ============================================================
     数值 / 文本工具
     ============================================================ */
  function numv(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  function strv(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return String(v);
      return String(Math.round(v * 1e10) / 1e10);
    }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v);
  }
  function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v).trim().toLowerCase();
    return !(s === '' || s === '0' || s === 'false');
  }
  function cmp(a, b) {
    const na = parseFloat(a), nb = parseFloat(b);
    if (isFinite(na) && isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
      return na === nb ? 0 : (na < nb ? -1 : 1);
    }
    const sa = String(a).toLowerCase(), sb = String(b).toLowerCase();
    return sa === sb ? 0 : (sa < sb ? -1 : 1);
  }

  /* ============================================================
     声音（WebAudio，无外部音频资源）
     ============================================================ */
  const NOTES = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, E5: 659.25, G5: 783.99 };

  class Sound {
    constructor(rt) { this.rt = rt; this.ctx = null; this.noise = null; }
    ensure() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        try { this.ctx = new AC(); } catch (e) { return null; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    _noiseBuf(ctx) {
      if (this.noise) return this.noise;
      const len = Math.floor(ctx.sampleRate * 1.2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      return buf;
    }
    tone(note, secs) {
      const ctx = this.ensure(); if (!ctx) return;
      const f = NOTES[note] || 440;
      const t = ctx.currentTime;
      const dur = Math.max(0.04, numv(secs));
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const vol = (this.rt.volume / 100) * 0.28;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + dur + 0.03);
    }
    drum(kind, secs) {
      const ctx = this.ensure(); if (!ctx) return;
      const t = ctx.currentTime;
      const dur = Math.max(0.05, numv(secs));
      const vol = (this.rt.volume / 100) * 0.34;
      if (kind === 'kick') {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t); osc.stop(t + dur + 0.02);
      } else {
        const src = ctx.createBufferSource();
        src.buffer = this._noiseBuf(ctx);
        const g = ctx.createGain();
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = kind === 'hat' ? 7000 : (kind === 'crash' ? 4500 : 1200);
        const d = kind === 'hat' ? Math.min(dur, 0.12) : dur;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        src.connect(f); f.connect(g); g.connect(ctx.destination);
        src.start(t); src.stop(t + d + 0.02);
      }
    }
    stopAll() {
      if (this.ctx) { try { this.ctx.close(); } catch (e) {} this.ctx = null; this.noise = null; }
    }
  }

  /* ============================================================
     线程
     ============================================================ */
  class Thread {
    constructor(rt, target, top) {
      this.rt = rt; this.target = target; this.top = top;
      this.dead = false;
      this.id = ++rt._threadSeq;
    }
    start() {
      this.p = this.run();
      return this;
    }
    async run() {
      try {
        await this.rt.runStack(this.top, this);
      } catch (e) {
        if (e !== STOP_THIS && e !== STOP_ALL) {
          console.error('[EasyH5] 脚本出错：', e);
          this.rt.lastError = (e && e.message) || String(e);
        }
      } finally {
        this.rt.removeThread(this);
      }
    }
    stop() { this.dead = true; }
  }

  /* ============================================================
     运行时
     ============================================================ */
  class Runtime {
    constructor(project, container, opts) {
      opts = opts || {};
      this.opts = opts;
      this.container = container;
      /* share:true 时直接复用编辑器里的项目对象（改动即时可见） */
      if (opts.share) {
        this.project = M.normalize(project);
      } else {
        this.project = M.normalize(M.clone(project));
      }
      this.editable = !!opts.editable;

      this._threadSeq = 0;
      this.threads = [];
      this.volume = 100;
      this.answer = '';
      this.keys = new Set();
      this.mouse = { x: 0, y: 0, down: false };
      /* 手柄：每帧轮询 navigator.getGamepads() */
      this.pads = [];
      this.pad = null;
      this.gamepadCount = 0;
      this._padNow = Object.create(null);
      this.timerStart = performance.now();
      this.fps = 60;
      this.frameCount = 0;
      this.lastError = '';
      this.running = false;
      this._paused = false;
      this._resumeHooks = [];
      this.bgColor = this.project.stage.bgColor || '#ffffff';
      this.dragging = null;
      this._lastYield = performance.now();
      this._sayTimers = [];
      this.onObjectsChanged = null;

      this.sound = new Sound(this);
      this._buildDom();
      this._buildState();
      this._bindInput();

      this.mode = this.project.stage.mode === '3d' ? '3d' : '2d';
      this._applyMode();

      this._ro = null;
      if (global.ResizeObserver) {
        this._ro = new ResizeObserver(() => this._onResize());
        this._ro.observe(container);
      }
      this._onResizeWin = () => this._onResize();
      global.addEventListener('resize', this._onResizeWin);
      this._onResize();
    }

    /* ============================================================
       状态初始化
       ============================================================ */
    _buildState() {
      const p = this.project;
      this.stage = { kind: 'stage', name: '舞台' };

      /* 素材库是全局共享的（造型/贴图/模型都按 id 引用） */
      M.setAssets(p.assets || []);
      M.preloadAll((p.assets || []).filter(a => a.kind !== 'model'));

      this.vars = Object.create(null);
      p.variables.forEach(v => { this.vars[v.name] = v.value; });
      this.lists = Object.create(null);
      p.lists.forEach(l => { this.lists[l.name] = Array.isArray(l.value) ? l.value.slice() : []; });

      this.sprites = [];
      this._makeSprites();
      this.origin = M.clone(p.sprites);   // 绿旗复位用的原始快照
    }

    _makeSprites() {
      this.sprites = this.project.sprites.map(sp => {
        const s = M.clone(sp);
        s.kind = 'sprite';
        s.isClone = false;
        s.scriptSrc = sp.scripts || [];
        s.effects = Object.assign({ color: 0, brightness: 0, ghost: 0, pixelate: 0 }, s.effects || {});
        s.say = null;
        return s;
      });
    }

    get targets() { return [this.stage].concat(this.sprites); }

    /* ============================================================
       DOM
       ============================================================ */
    _buildDom() {
      const c = this.container;
      c.classList.add('eh5-stage');
      c.innerHTML = '';
      if (!document.getElementById('eh5-runtime-css')) {
        const st = document.createElement('style');
        st.id = 'eh5-runtime-css';
        st.textContent = RUNTIME_CSS;
        document.head.appendChild(st);
      }
      const c2 = document.createElement('canvas');
      c2.className = 'eh5-c2d';
      const c3 = document.createElement('canvas');
      c3.className = 'eh5-c3d hidden';
      const mon = document.createElement('div');
      mon.className = 'eh5-monitors';
      const ov = document.createElement('div');
      ov.className = 'eh5-overlay';
      c.appendChild(c2); c.appendChild(c3); c.appendChild(mon); c.appendChild(ov);
      this.canvas2d = c2;
      this.canvas3d = c3;
      this.monitorEl = mon;
      this.overlayEl = ov;
    }

    _applyMode() {
      const is3d = this.mode === '3d';
      this.canvas2d.classList.toggle('hidden', is3d);
      this.canvas3d.classList.toggle('hidden', !is3d);
      if (is3d) {
        if (!this.r3d) {
          this.r3d = new global.EH5Render3D(this);
          this._init3dScene();
        }
        this._onResize();
      } else {
        if (!this.r2d) this.r2d = new global.EH5Render2D(this);
        this._onResize();
      }
    }

    setMode(mode) {
      if (this.mode === mode) return;
      this.mode = mode;
      this.project.stage.mode = mode;
      this._applyMode();
    }

    _init3dScene() {
      const p = this.project;
      const r3 = this.r3d;
      /* 重建对象 */
      Object.keys(r3.objects).forEach(n => r3.remove(n));
      r3.clearLights();
      r3._addLight('ambient', 0.75);
      r3._addLight('directional', 1.1);
      r3.gravity = numv(p.stage.physics && p.stage.physics.gravity) || -20;
      r3.setBg(p.stage.skyColor || '#87ceeb');
      r3.setFog(0, '#ffffff');
      r3.cameraMode = 'free';
      r3.camera = r3.cameraPersp;
      r3.projection = 'perspective';
      r3.camera.position.set(0, 6, 12);
      r3.camera.lookAt(0, 1, 0);
      r3.fp.on = false;
      r3.groundSize = 40;
      if (r3._ground) { r3.worldGroup.remove(r3._ground); r3._ground.geometry.dispose(); r3._ground.material.dispose(); r3._ground = null; }
      if (r3._grid) { r3.worldGroup.remove(r3._grid); r3._grid.geometry.dispose(); r3._grid = null; }
      r3.ground(40, '#8fbf6a');
      M.setAssets(p.assets || []);
      (p.objects3d || []).forEach(o => {
        r3.create(o.name, o.type, o);
      });
    }

    _onResize() {
      const c = this.container;
      const w = c.clientWidth || 480, h = c.clientHeight || 360;
      if (this.r2d) {
        this.r2d.resize(w, h);
      }
      if (this.r3d && w > 0 && h > 0) {
        this.r3d.resize(w, h);
      }
    }

    /* ============================================================
       输入
       ============================================================ */
    _bindInput() {
      this._onKeyDown = (e) => {
        if (this._keyTargetGuard(e)) return;
        const already = this.keys.has(e.key);
        this.keys.add(e.key);
        if (e.key === ' ') this.keys.add(' ');
        if (e.key.length === 1) this.keys.add(e.key.toLowerCase());
        /* 只在「刚按下」时触发帽子积木，长按不会每帧重放 */
        if (!already) this._fireKeyHats(e.key);
      };
      this._onKeyUp = (e) => {
        this.keys.delete(e.key);
        if (e.key.length === 1) this.keys.delete(e.key.toLowerCase());
      };
      this._onBlur = () => { this.keys.clear(); };
      this._onDown = (e) => {
        this.mouse.down = true;
        this._pointer(e);
        this._fireClickHats();
      };
      this._onUp = () => { this.mouse.down = false; };
      this._onMove = (e) => this._pointer(e);

      global.addEventListener('keydown', this._onKeyDown);
      global.addEventListener('keyup', this._onKeyUp);
      global.addEventListener('blur', this._onBlur);
      this.container.addEventListener('pointerdown', this._onDown);
      global.addEventListener('pointerup', this._onUp);
      this.container.addEventListener('pointermove', this._onMove);
    }

    /** 「当按下 X 键」帽子 */
    _fireKeyHats(key) {
      const k = String(key);
      const lower = k.length === 1 ? k.toLowerCase() : k;
      this.startHats(sc => {
        if (sc.type !== 'event_whenkeypressed') return false;
        const want = strv(sc.fields && sc.fields.KEY);
        if (want === 'any') return true;
        if (want === k) return true;
        return want.length === 1 && want.toLowerCase() === lower;
      });
    }

    /** 「当角色被点击」/「当舞台被点击」帽子 */
    _fireClickHats() {
      const mx = this.mouse.x, my = this.mouse.y;
      let hit = null;
      /* 从上往下找第一个命中的角色（图层顺序） */
      for (let i = this.sprites.length - 1; i >= 0; i--) {
        const s = this.sprites[i];
        if (!s.visible || s.kind !== 'sprite') continue;
        const hw = this._halfW(s), hh = this._halfH(s);
        if (Math.abs(mx - s.x) < hw && Math.abs(my - s.y) < hh) { hit = s; break; }
      }
      if (hit) {
        this.startHats((sc, tgt) => tgt === hit && sc.type === 'event_whenthisspriteclicked');
      }
      this.startHats(sc => sc.type === 'event_whenstageclicked');
    }

    /** 输入框获得焦点时不要抢按键 */
    _keyTargetGuard(e) {
      const t = e.target;
      if (!t) return false;
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (t.isContentEditable) return true;
      return false;
    }

    _pointer(e) {
      const r = this.container.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const W = this.project.stage.width, H = this.project.stage.height;
      this.mouse.x = Math.round((px - 0.5) * W);
      this.mouse.y = Math.round((0.5 - py) * H);
    }

    _unbindInput() {
      global.removeEventListener('keydown', this._onKeyDown);
      global.removeEventListener('keyup', this._onKeyUp);
      global.removeEventListener('blur', this._onBlur);
      this.container.removeEventListener('pointerdown', this._onDown);
      global.removeEventListener('pointerup', this._onUp);
      this.container.removeEventListener('pointermove', this._onMove);
    }

    /* ============================================================
       变量 / 列表
       ============================================================ */
    varGet(name) {
      if (!(name in this.vars)) this.vars[name] = 0;
      return this.vars[name];
    }
    varSet(name, v) {
      if (!name) return;
      this.vars[name] = v;
      if (!this.project.variables.some(x => x.name === name)) {
        this.project.variables.push({ name, value: v, visible: false });
      }
    }
    listGet(name) {
      if (!(name in this.lists)) this.lists[name] = [];
      if (!Array.isArray(this.lists[name])) this.lists[name] = [];
      return this.lists[name];
    }
    listEnsure(name) {
      this.listGet(name);
      if (!this.project.lists.some(x => x.name === name)) {
        this.project.lists.push({ name, value: [], visible: false });
      }
    }

    notifyObjectsChanged() {
      if (this.onObjectsChanged) {
        try { this.onObjectsChanged(this.r3d ? this.r3d.names() : []); } catch (e) {}
      }
    }

    /* ============================================================
       目标解析
       ============================================================ */
    resolve(name, ctx) {
      if (name === '_myself_') return ctx ? ctx.target : null;
      if (name === '_stage_') return this.stage;
      if (name === '_mouse_') return { kind: 'mouse', name: '_mouse_', x: this.mouse.x, y: this.mouse.y };
      if (name === '_edge_') return { kind: 'edge', name: '_edge_' };
      const list = this.sprites;
      for (let i = 0; i < list.length; i++) {
        if (list[i].name === name && !list[i].isClone) return list[i];
      }
      for (let i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
      return null;
    }

    _cos(t) { return (t.costumes && (t.costumes[t.currentCostume] || t.costumes[0])) || { w: 40, h: 40 }; }
    _halfW(t) { const c = this._cos(t); return Math.abs(c.w * t.size / 100) / 2; }
    _halfH(t) { const c = this._cos(t); return Math.abs(c.h * t.size / 100) / 2; }

    touching(target, otherName, ctx) {
      if (!target || target.kind !== 'sprite' || !target.visible) return false;
      const W = this.project.stage.width, H = this.project.stage.height;
      const hw = this._halfW(target), hh = this._halfH(target);
      if (otherName === '_edge_') {
        return (target.x + hw > W / 2) || (target.x - hw < -W / 2) ||
               (target.y + hh > H / 2) || (target.y - hh < -H / 2);
      }
      if (otherName === '_mouse_') {
        return Math.abs(this.mouse.x - target.x) < hw && Math.abs(this.mouse.y - target.y) < hh;
      }
      const o = this.resolve(otherName, ctx);
      if (!o || o.kind !== 'sprite' || !o.visible) return false;
      const ohw = this._halfW(o), ohh = this._halfH(o);
      return Math.abs(target.x - o.x) < hw + ohw && Math.abs(target.y - o.y) < hh + ohh;
    }

    distanceTo(target, otherName, ctx) {
      const o = this.resolve(otherName, ctx);
      if (!o || !target) return 0;
      return Math.round(Math.hypot((o.x || 0) - target.x, (o.y || 0) - target.y) * 10) / 10;
    }

    /* ============================================================
       求值
       ============================================================ */
    inp(blk, name, ctx) {
      const v = blk.inputs ? blk.inputs[name] : undefined;
      if (v && typeof v === 'object' && v.type) return this.evalBlock(v, ctx);
      if (v === undefined || v === null) {
        const d = B.get(blk.type);
        const a = d && (d.args || []).find(x => x.name === name);
        if (a && a.kind === 'bool') return false;
        return a && a.def !== undefined ? a.def : '';
      }
      return v;
    }
    numIn(blk, n, ctx) { return numv(this.inp(blk, n, ctx)); }
    strIn(blk, n, ctx) { return strv(this.inp(blk, n, ctx)); }
    boolIn(blk, n, ctx) { return truthy(this.inp(blk, n, ctx)); }
    fieldOf(blk, n) { return blk.fields ? blk.fields[n] : ''; }

    evalBlock(blk, ctx) {
      if (!blk || !blk.type) return '';
      const fn = REPORTERS[blk.type];
      if (!fn) return '';
      try { return fn(this, blk, ctx); }
      catch (e) { console.warn('[EasyH5] 求值失败', blk.type, e); return ''; }
    }

    /* ============================================================
       执行
       ============================================================ */
    async tick(ctx) {
      const now = performance.now();
      if (now - this._lastYield > 8) {
        this._lastYield = now;
        await this.frame();
      }
      if (ctx && ctx.dead) throw STOP_ALL;
    }

    frame() {
      /* 暂停时脚本也冻住：不 resolve，等 resume 再统一放行 */
      if (this._paused) {
        return new Promise(res => {
          (this._resumeHooks = this._resumeHooks || []).push(res);
        });
      }
      return new Promise(res => {
        let done = false;
        const fin = () => { if (!done) { done = true; res(); } };
        if (global.requestAnimationFrame) global.requestAnimationFrame(fin);
        setTimeout(fin, 120);
      });
    }

    async runStack(block, ctx) {
      let b = block;
      while (b) {
        if (ctx.dead) throw STOP_ALL;
        await this.exec(b, ctx);
        b = b.next;
      }
    }

    async exec(blk, ctx) {
      await this.tick(ctx);
      const fn = STACKS[blk.type];
      if (!fn) return;
      await fn(this, blk, ctx);
    }

    /** 运行一个分支（C 型积木内部） */
    async runBranch(blk, key, ctx) {
      const inner = blk.branches ? blk.branches[key] : null;
      if (inner) await this.runStack(inner, ctx);
    }

    /* ============================================================
       线程调度
       ============================================================ */
    startThread(target, top) {
      const t = new Thread(this, target, top);
      this.threads.push(t);
      t.start();
      return t;
    }

    removeThread(t) {
      const i = this.threads.indexOf(t);
      if (i >= 0) this.threads.splice(i, 1);
      if (this.threads.length === 0 && this.opts.onIdle) {
        try { this.opts.onIdle(); } catch (e) {}
      }
    }

    /** 启动所有匹配的帽子积木 */
    startHats(match) {
      const out = [];
      const spawn = (target, script) => {
        if (!script || !script.type) return;
        if (!B.isHat(script.type)) return;
        if (!match(script, target)) return;
        out.push(this.startThread(target, script));
      };
      this.sprites.forEach(s => {
        (s.scriptSrc || []).forEach(sc => spawn(s, sc));
      });
      return out;
    }

    greenFlag() {
      this.reset();
      this.timerStart = performance.now();
      const r3 = this.r3d;
      if (r3 && r3.fp.on) {
        /* 需要用户点击画面才能锁定鼠标 */
      }
      this.startHats(sc => sc.type === 'event_whenflagclicked');
      return this;
    }

    stopAll() {
      this.threads.slice().forEach(t => t.stop());
      this.threads.length = 0;
      this.keys.clear();
      this.mouse.down = false;
      if (this.r3d && this.r3d.fp.locked && document.exitPointerLock) document.exitPointerLock();
      this.clearClones();
    }

    /** 绿旗复位：清空克隆体、恢复角色/变量/列表/3D 对象到项目初始状态 */
    reset() {
      this.stopAll();
      this.vars = Object.create(null);
      this.project.variables.forEach(v => { this.vars[v.name] = M.clone(v.value); });
      this.lists = Object.create(null);
      this.project.lists.forEach(l => { this.lists[l.name] = M.clone(l.value || []); });
      this.answer = '';
      this.bgColor = this.project.stage.bgColor || '#ffffff';
      this._makeSprites();
      if (this.r3d) this._init3dScene();
      this._syncMonitors();
      this.lastError = '';
    }

    clearClones() {
      this.sprites = this.sprites.filter(s => !s.isClone);
    }

    createClone(target, ctx) {
      if (!target || target.kind !== 'sprite') return;
      if (this.sprites.length > 400) return;
      const c = M.clone(target);
      c.isClone = true;
      c.id = 'clone' + Math.random().toString(36).slice(2, 7);
      c.say = null;
      c.effects = Object.assign({ color: 0, brightness: 0, ghost: 0, pixelate: 0 }, c.effects || {});
      c.scriptSrc = target.scriptSrc;
      this.sprites.push(c);
      this.startHats((sc, tgt) => tgt === c && sc.type === 'control_whencloned');
    }

    deleteClone(t) {
      const i = this.sprites.indexOf(t);
      if (i >= 0) this.sprites.splice(i, 1);
      t.dead = true;
    }

    broadcast(msg) {
      if (!msg) return [];
      if (!this.project.broadcasts.includes(msg)) this.project.broadcasts.push(msg);
      return this.startHats(sc => sc.type === 'event_whenbroadcastreceived' && strv(sc.fields && sc.fields.MSG) === String(msg));
    }

    /* ============================================================
       手柄
       ============================================================ */
    _pollGamepads() {
      const nav = global.navigator;
      if (!nav || !nav.getGamepads) return;
      let list;
      try { list = nav.getGamepads(); } catch (e) { return; }
      const pads = [];
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        if (g && g.connected) pads.push(g);
      }
      this.pads = pads;
      this.pad = pads[0] || null;
      this.gamepadCount = pads.length;

      /* 记录本帧按键状态，并检测「刚按下」的边沿（给帽子积木用） */
      const prev = this._padNow;
      const now = Object.create(null);
      let any = false;
      if (this.pad) {
        const bs = this.pad.buttons || [];
        for (let i = 0; i < bs.length; i++) {
          const b = bs[i];
          const on = !!(b && (b.pressed || b.value > 0.5));
          now[i] = on;
          if (on) any = true;
        }
      }
      now.any = any;
      this._padNow = now;

      if (!this.pad) return;
      for (const k in now) {
        if (now[k] && !prev[k]) {
          this.startHats(sc => sc.type === 'event_whengamepadbutton' &&
            (strv(sc.fields && sc.fields.BTN) === k || strv(sc.fields && sc.fields.BTN) === 'any'));
        }
      }
    }

    padButton(key) {
      if (!this.pad) return false;
      if (key === 'any') return !!this._padNow.any;
      const b = (this.pad.buttons || [])[+key];
      return !!(b && (b.pressed || b.value > 0.5));
    }

    padAxis(stick, dir) {
      if (!this.pad) return 0;
      const base = stick === 'right' ? 2 : 0;
      const idx = base + (dir === 'v' ? 1 : 0);
      const v = (this.pad.axes || [])[idx] || 0;
      /* 摇杆向上是 -1，这里翻成 +1，跟舞台的 y 轴方向一致 */
      const out = dir === 'v' ? -v : v;
      return Math.round(out * 100) / 100;
    }

    vibrate(intensity, ms) {
      const i = Math.max(0, Math.min(1, numv(intensity) / 100));
      const d = Math.max(0, numv(ms));
      (this.pads || []).forEach(p => {
        const act = p.vibrationActuator;
        if (act && act.playEffect) {
          try {
            const r = act.playEffect('dual-rumble', {
              duration: d, strongMagnitude: i, weakMagnitude: i * 0.6
            });
            if (r && r.catch) r.catch(() => {});
          } catch (e) { /* 不支持就算了 */ }
        }
      });
    }

    /* ============================================================
       主循环
       ============================================================ */
    start() {
      if (this.running) return;
      this.running = true;
      this._last = performance.now();
      this._fpsAcc = 0; this._fpsN = 0;
      const step = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.1, (now - this._last) / 1000);
        this._last = now;
        this.frameCount++;
        this._fpsAcc += dt; this._fpsN++;
        if (this._fpsAcc >= 0.5) {
          this.fps = Math.round(this._fpsN / this._fpsAcc);
          this._fpsAcc = 0; this._fpsN = 0;
        }
        this.updateSay(dt);
        this._pollGamepads();
        try {
          if (this.mode === '3d' && this.r3d) { this.r3d.update(dt); this.r3d.render(); }
          else if (this.r2d) { this.r2d.render(); }
        } catch (e) {
          console.error('[EasyH5] 渲染出错', e);
        }
        this._syncMonitors();
        if (this.opts.onFrame) { try { this.opts.onFrame(this); } catch (e) {} }
        this._raf = global.requestAnimationFrame(step);
      };
      this._raf = global.requestAnimationFrame(step);
    }

    pause() {
      this._paused = true;
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
    }

    resume() {
      this._paused = false;
      const hooks = this._resumeHooks || [];
      this._resumeHooks = [];
      hooks.forEach(h => { try { h(); } catch (e) {} });
      if (!this.running) this.start();
    }

    dispose() {
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this.stopAll();
      this._unbindInput();
      if (this._ro) this._ro.disconnect();
      global.removeEventListener('resize', this._onResizeWin);
      if (this.r3d) this.r3d.dispose();
      this.sound.stopAll();
      this.container.innerHTML = '';
    }

    /* ============================================================
       说话气泡计时
       ============================================================ */
    say(target, text, secs, kind) {
      target.say = { text: String(text), kind: kind || 'say' };
      if (secs > 0) {
        const t = { target, at: performance.now() + secs * 1000 };
        this._sayTimers.push(t);
      }
    }
    updateSay() {
      const now = performance.now();
      if (this._sayTimers.length) {
        this._sayTimers = this._sayTimers.filter(t => {
          if (now >= t.at) { if (t.target.say) t.target.say = null; return false; }
          return true;
        });
      }
    }

    /* ============================================================
       监视器
       ============================================================ */
    _monKey() {
      const v = this.project.variables.filter(x => x.visible).map(x => 'v:' + x.name);
      const l = this.project.lists.filter(x => x.visible).map(x => 'l:' + x.name);
      return v.concat(l).join('|');
    }

    _syncMonitors() {
      const key = this._monKey();
      if (key !== this._monKeyCache) {
        this._monKeyCache = key;
        this._rebuildMonitors();
      }
      /* 刷新数值 */
      const nodes = this.monitorEl.children;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const name = el.dataset.name;
        if (el.dataset.kind === 'var') {
          const val = el.querySelector('.v');
          const s = strv(this.varGet(name));
          if (val.textContent !== s) val.textContent = s;
        } else {
          const body = el.querySelector('.lv-body');
          const arr = this.listGet(name);
          const sig = arr.length + ':' + arr.slice(0, 40).join('\u0001');
          if (body.dataset.sig !== sig) {
            body.dataset.sig = sig;
            body.innerHTML = '';
            const max = Math.min(arr.length, 40);
            for (let j = 0; j < max; j++) {
              const r = document.createElement('div');
              r.className = 'lv-row';
              const idx = document.createElement('span'); idx.className = 'lv-i'; idx.textContent = (j + 1);
              const v = document.createElement('span'); v.className = 'lv-v'; v.textContent = strv(arr[j]);
              r.appendChild(idx); r.appendChild(v);
              body.appendChild(r);
            }
            if (arr.length === 0) {
              const r = document.createElement('div');
              r.className = 'lv-empty'; r.textContent = '（空）';
              body.appendChild(r);
            }
          }
        }
      }
    }

    _rebuildMonitors() {
      this.monitorEl.innerHTML = '';
      const mk = (kind, name) => {
        const el = document.createElement('div');
        el.className = 'eh5-mon ' + kind;
        el.dataset.name = name;
        el.dataset.kind = kind === 'var' ? 'var' : 'list';
        const k = document.createElement('div'); k.className = 'k'; k.textContent = name;
        el.appendChild(k);
        if (kind === 'var') {
          const v = document.createElement('div'); v.className = 'v'; v.textContent = '0';
          el.appendChild(v);
        } else {
          const body = document.createElement('div'); body.className = 'lv-body';
          el.appendChild(body);
        }
        this.monitorEl.appendChild(el);
      };
      this.project.variables.forEach(v => { if (v.visible) mk('var', v.name); });
      this.project.lists.forEach(l => { if (l.visible) mk('list', l.name); });
    }

    /* ============================================================
       询问（App 场景用）
       ============================================================ */
    ask(question) {
      return new Promise(resolve => {
        const wrap = document.createElement('div');
        wrap.className = 'eh5-ask';
        const q = document.createElement('div'); q.className = 'eh5-ask-q'; q.textContent = String(question);
        const inp = document.createElement('input');
        inp.className = 'eh5-ask-i'; inp.type = 'text'; inp.autocomplete = 'off';
        const btn = document.createElement('button');
        btn.className = 'eh5-ask-b'; btn.textContent = '确定';
        wrap.appendChild(q); wrap.appendChild(inp); wrap.appendChild(btn);
        this.overlayEl.appendChild(wrap);
        setTimeout(() => inp.focus(), 30);

        const finish = () => {
          const val = inp.value;
          this.answer = val;
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
          resolve(val);
        };
        btn.addEventListener('click', finish);
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.stopPropagation(); finish(); }
        });
      });
    }
  }

  /* ============================================================
     运行时的样式（独立导出时自带）
     ============================================================ */
  const RUNTIME_CSS = `
.eh5-stage{position:relative;overflow:hidden;background:#fff}
.eh5-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.eh5-stage canvas.hidden{display:none}
.eh5-monitors{position:absolute;left:6px;top:6px;z-index:6;display:flex;flex-direction:column;gap:4px;pointer-events:none;
  font:11px/1.45 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;max-width:60%}
.eh5-mon{display:flex;border-radius:5px;overflow:hidden;background:rgba(255,255,255,.94);
  box-shadow:0 1px 3px rgba(0,0,0,.22);align-items:stretch}
.eh5-mon .k{padding:1px 6px;background:#ff8c1a;color:#fff;font-weight:700;white-space:nowrap}
.eh5-mon .v{padding:1px 8px;min-width:26px;font-family:ui-monospace,Consolas,monospace;font-weight:700;color:#1f2430;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eh5-mon.list{flex-direction:column}
.eh5-mon.list .k{background:#ff661a}
.eh5-mon .lv-body{background:rgba(255,255,255,.94);max-height:110px;overflow:hidden}
.eh5-mon .lv-row{display:flex;gap:4px;padding:0 6px;font-family:ui-monospace,Consolas,monospace;color:#1f2430}
.eh5-mon .lv-i{color:#8b95a7;min-width:14px;text-align:right}
.eh5-mon .lv-v{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eh5-mon .lv-empty{padding:1px 6px;color:#8b95a7}
.eh5-overlay{position:absolute;inset:0;pointer-events:none;z-index:8}
.eh5-ask{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px;align-items:center;
  padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.98);box-shadow:0 6px 24px rgba(16,24,40,.22);
  pointer-events:auto;max-width:92%}
.eh5-ask-q{font:12px "PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#5b6474;white-space:nowrap}
.eh5-ask-i{height:28px;border:1px solid #cdd3dc;border-radius:6px;padding:0 8px;font-size:12px;outline:none;min-width:160px}
.eh5-ask-i:focus{border-color:#2f6df6;box-shadow:0 0 0 3px rgba(47,109,246,.15)}
.eh5-ask-b{height:28px;padding:0 12px;border:0;border-radius:6px;background:#2f6df6;color:#fff;font-size:12px;font-weight:600;cursor:pointer}
`;

  /* ============================================================
     积木实现：报告块 / 布尔块
     ============================================================ */
  const REPORTERS = {
    /* --- 运动 --- */
    motion_xposition: (rt, b, c) => Math.round((c.target.x || 0) * 10) / 10,
    motion_yposition: (rt, b, c) => Math.round((c.target.y || 0) * 10) / 10,
    motion_direction: (rt, b, c) => Math.round(c.target.direction || 0),

    /* --- 外观 --- */
    looks_size: (rt, b, c) => Math.round(c.target.size || 100),
    looks_costumenumber: (rt, b, c) => (c.target.currentCostume || 0) + 1,

    /* --- 声音 --- */
    sound_volume: (rt) => rt.volume,

    /* --- 侦测 --- */
    sensing_mousex: (rt) => rt.mouse.x,
    sensing_mousey: (rt) => rt.mouse.y,
    sensing_timer: (rt) => Math.round((performance.now() - rt.timerStart) / 100) / 10,
    sensing_answer: (rt) => rt.answer,
    sensing_fps: (rt) => rt.fps,
    sensing_username: () => '创作者',
    sensing_distanceto: (rt, b, c) => rt.distanceTo(c.target, rt.fieldOf(b, 'TARGET'), c),
    sensing_gamepadconnected: (rt) => !!rt.pad,
    sensing_gamepadname: (rt) => (rt.pad && rt.pad.id) ? String(rt.pad.id).slice(0, 48) : '',
    sensing_gamepadbutton: (rt, b) => rt.padButton(rt.fieldOf(b, 'BTN')),
    sensing_gamepadaxis: (rt, b) => rt.padAxis(rt.fieldOf(b, 'STICK'), rt.fieldOf(b, 'DIR')),
    sensing_of: (rt, b, c) => {
      const t = rt.resolve(rt.fieldOf(b, 'TARGET'), c);
      if (!t) return 0;
      switch (rt.fieldOf(b, 'PROP')) {
        case 'x': return Math.round((t.x || 0) * 10) / 10;
        case 'y': return Math.round((t.y || 0) * 10) / 10;
        case 'direction': return Math.round(t.direction || 0);
        case 'size': return Math.round(t.size || 100);
        case 'costume': return (t.currentCostume || 0) + 1;
        case 'visible': return !!t.visible;
        default: return 0;
      }
    },
    sensing_keypressed: null, /* 布尔，见下 */

    /* --- 运算 --- */
    operator_add: (rt, b, c) => rt.numIn(b, 'A', c) + rt.numIn(b, 'B', c),
    operator_subtract: (rt, b, c) => rt.numIn(b, 'A', c) - rt.numIn(b, 'B', c),
    operator_multiply: (rt, b, c) => rt.numIn(b, 'A', c) * rt.numIn(b, 'B', c),
    operator_divide: (rt, b, c) => { const d = rt.numIn(b, 'B', c); return d === 0 ? 0 : rt.numIn(b, 'A', c) / d; },
    operator_mod: (rt, b, c) => { const d = rt.numIn(b, 'B', c); return d === 0 ? 0 : rt.numIn(b, 'A', c) % d; },
    operator_round: (rt, b, c) => Math.round(rt.numIn(b, 'N', c)),
    operator_mathop: (rt, b, c) => {
      const n = rt.numIn(b, 'N', c);
      switch (rt.fieldOf(b, 'OP')) {
        case 'abs': return Math.abs(n);
        case 'floor': return Math.floor(n);
        case 'ceil': return Math.ceil(n);
        case 'sqrt': return n < 0 ? 0 : Math.sqrt(n);
        case 'sin': return Math.round(Math.sin(n * Math.PI / 180) * 1e10) / 1e10;
        case 'cos': return Math.round(Math.cos(n * Math.PI / 180) * 1e10) / 1e10;
        case 'tan': return Math.round(Math.tan(n * Math.PI / 180) * 1e10) / 1e10;
        case 'ln': return n <= 0 ? 0 : Math.round(Math.log(n) * 1e10) / 1e10;
        case 'log': return n <= 0 ? 0 : Math.round(Math.log10(n) * 1e10) / 1e10;
        case 'pow10': return Math.pow(10, n);
        default: return n;
      }
    },
    operator_random: (rt, b, c) => {
      let a = rt.numIn(b, 'FROM', c), z = rt.numIn(b, 'TO', c);
      if (a > z) { const t = a; a = z; z = t; }
      const intA = Number.isInteger(a) && Number.isInteger(z);
      return intA ? Math.floor(Math.random() * (z - a + 1)) + a
                  : Math.random() * (z - a) + a;
    },
    operator_join: (rt, b, c) => rt.strIn(b, 'A', c) + rt.strIn(b, 'B', c),
    operator_letter_of: (rt, b, c) => {
      const s = rt.strIn(b, 'STR', c), n = Math.round(rt.numIn(b, 'N', c));
      return (n >= 1 && n <= s.length) ? s[n - 1] : '';
    },
    operator_length: (rt, b, c) => rt.strIn(b, 'STR', c).length,
    operator_indexof: (rt, b, c) => {
      const a = rt.strIn(b, 'A', c), s = rt.strIn(b, 'B', c);
      const i = a.toLowerCase().indexOf(s.toLowerCase());
      return i < 0 ? 0 : i + 1;
    },

    /* --- 变量 --- */
    data_variable: (rt, b) => {
      const n = rt.fieldOf(b, 'VAR');
      if (!n) return 0;
      if (n in rt.lists) return rt.listGet(n).join(', ');
      return rt.varGet(n);
    },

    /* --- 列表 --- */
    data_itemoflist: (rt, b, c) => {
      const arr = rt.listGet(rt.fieldOf(b, 'LIST'));
      const i = Math.round(rt.numIn(b, 'INDEX', c));
      const idx = i < 0 ? arr.length + i : i - 1;
      return (idx >= 0 && idx < arr.length) ? arr[idx] : '';
    },
    data_itemnumoflist: (rt, b, c) => {
      const arr = rt.listGet(rt.fieldOf(b, 'LIST'));
      const item = rt.strIn(b, 'ITEM', c);
      const i = arr.findIndex(x => strv(x).toLowerCase() === item.toLowerCase());
      return i < 0 ? 0 : i + 1;
    },
    data_lengthoflist: (rt, b) => rt.listGet(rt.fieldOf(b, 'LIST')).length,
    data_listastext: (rt, b) => rt.listGet(rt.fieldOf(b, 'LIST')).join(', '),

    /* --- 3D --- */
    three_pos: (rt, b) => (rt.r3d ? rt.r3d.getPos(rt.fieldOf(b, 'OBJ'), rt.fieldOf(b, 'AXIS')) : 0)
  };

  /* 布尔块（也走 REPORTERS，返回 true/false） */
  REPORTERS.sensing_keypressed = (rt, b) => {
    const k = rt.fieldOf(b, 'KEY');
    if (k === 'any') return rt.keys.size > 0;
    return rt.keys.has(k);
  };
  REPORTERS.sensing_mousedown = (rt) => rt.mouse.down;
  REPORTERS.sensing_touching = (rt, b, c) => rt.touching(c.target, rt.fieldOf(b, 'TARGET'), c);
  REPORTERS.operator_gt = (rt, b, c) => cmp(rt.inp(b, 'A', c), rt.inp(b, 'B', c)) > 0;
  REPORTERS.operator_lt = (rt, b, c) => cmp(rt.inp(b, 'A', c), rt.inp(b, 'B', c)) < 0;
  REPORTERS.operator_equals = (rt, b, c) => cmp(rt.inp(b, 'A', c), rt.inp(b, 'B', c)) === 0;
  REPORTERS.operator_and = (rt, b, c) => rt.boolIn(b, 'A', c) && rt.boolIn(b, 'B', c);
  REPORTERS.operator_or = (rt, b, c) => rt.boolIn(b, 'A', c) || rt.boolIn(b, 'B', c);
  REPORTERS.operator_not = (rt, b, c) => !rt.boolIn(b, 'A', c);
  REPORTERS.operator_contains = (rt, b, c) =>
    rt.strIn(b, 'A', c).toLowerCase().includes(rt.strIn(b, 'B', c).toLowerCase());
  REPORTERS.data_listcontainsitem = (rt, b, c) => {
    const arr = rt.listGet(rt.fieldOf(b, 'LIST'));
    const item = rt.strIn(b, 'ITEM', c).toLowerCase();
    return arr.some(x => strv(x).toLowerCase() === item);
  };
  REPORTERS.three_onground = (rt, b) => (rt.r3d ? rt.r3d.onGround(rt.fieldOf(b, 'OBJ')) : false);
  REPORTERS.three_collide = (rt, b) => (rt.r3d ? rt.r3d.collide(rt.fieldOf(b, 'A'), rt.fieldOf(b, 'B')) : false);

  /* ============================================================
     积木实现：堆叠块
     ============================================================ */
  const STACKS = {
    /* --- 事件 --- */
    event_broadcast: async (rt, b, c) => { rt.broadcast(rt.fieldOf(b, 'MSG')); },
    event_broadcastandwait: async (rt, b, c) => {
      const list = rt.broadcast(rt.fieldOf(b, 'MSG'));
      while (list.some(t => !t.dead && rt.threads.includes(t))) {
        if (c.dead) throw STOP_ALL;
        await rt.frame();
      }
    },

    /* --- 运动 --- */
    motion_movesteps: async (rt, b, c) => {
      const t = c.target, n = rt.numIn(b, 'STEPS', c);
      const rad = (t.direction - 90) * Math.PI / 180;
      t.x = (t.x || 0) + Math.cos(rad) * n;
      t.y = (t.y || 0) + Math.sin(rad) * n;
    },
    motion_turnright: async (rt, b, c) => {
      c.target.direction = normDeg((c.target.direction || 0) + rt.numIn(b, 'DEG', c));
    },
    motion_turnleft: async (rt, b, c) => {
      c.target.direction = normDeg((c.target.direction || 0) - rt.numIn(b, 'DEG', c));
    },
    motion_gotoxy: async (rt, b, c) => {
      c.target.x = rt.numIn(b, 'X', c);
      c.target.y = rt.numIn(b, 'Y', c);
    },
    motion_glideto: async (rt, b, c) => {
      const t = c.target;
      const secs = Math.max(0, rt.numIn(b, 'SECS', c));
      const tx = rt.numIn(b, 'X', c), ty = rt.numIn(b, 'Y', c);
      const sx = t.x || 0, sy = t.y || 0;
      if (secs <= 0) { t.x = tx; t.y = ty; return; }
      const dur = secs * 1000, start = performance.now();
      for (;;) {
        if (c.dead) throw STOP_ALL;
        const p = Math.min(1, (performance.now() - start) / dur);
        t.x = sx + (tx - sx) * p;
        t.y = sy + (ty - sy) * p;
        if (p >= 1) break;
        await rt.frame();
      }
    },
    motion_changexby: async (rt, b, c) => { c.target.x = (c.target.x || 0) + rt.numIn(b, 'DX', c); },
    motion_setx: async (rt, b, c) => { c.target.x = rt.numIn(b, 'X', c); },
    motion_changeyby: async (rt, b, c) => { c.target.y = (c.target.y || 0) + rt.numIn(b, 'DY', c); },
    motion_sety: async (rt, b, c) => { c.target.y = rt.numIn(b, 'Y', c); },
    motion_pointindirection: async (rt, b, c) => { c.target.direction = normDeg(rt.numIn(b, 'DIR', c)); },
    motion_pointtowards: async (rt, b, c) => {
      const t = c.target, o = rt.resolve(rt.fieldOf(b, 'TARGET'), c);
      if (!o) return;
      t.direction = normDeg(Math.atan2((o.y || 0) - t.y, (o.x || 0) - t.x) * 180 / Math.PI + 90);
    },
    motion_bounce: async (rt, b, c) => {
      const t = c.target, W = rt.project.stage.width / 2, H = rt.project.stage.height / 2;
      const hw = rt._halfW(t), hh = rt._halfH(t);
      let hit = false;
      if (t.x + hw > W) { t.x = W - hw; hit = true; }
      else if (t.x - hw < -W) { t.x = -W + hw; hit = true; }
      if (t.y + hh > H) { t.y = H - hh; hit = true; }
      else if (t.y - hh < -H) { t.y = -H + hh; hit = true; }
      if (hit) {
        /* 沿法线镜像方向 */
        const rad = (t.direction - 90) * Math.PI / 180;
        let dx = Math.cos(rad), dy = Math.sin(rad);
        if ((t.x + hw >= W - 0.01 && dx > 0) || (t.x - hw <= -W + 0.01 && dx < 0)) dx = -dx;
        if ((t.y + hh >= H - 0.01 && dy > 0) || (t.y - hh <= -H + 0.01 && dy < 0)) dy = -dy;
        t.direction = normDeg(Math.atan2(dy, dx) * 180 / Math.PI + 90);
      }
    },

    /* --- 外观 --- */
    looks_say: async (rt, b, c) => { rt.say(c.target, rt.strIn(b, 'MSG', c), 0, 'say'); },
    looks_think: async (rt, b, c) => { rt.say(c.target, rt.strIn(b, 'MSG', c), 0, 'think'); },
    looks_sayforsecs: async (rt, b, c) => {
      const secs = Math.max(0, rt.numIn(b, 'SECS', c));
      rt.say(c.target, rt.strIn(b, 'MSG', c), secs, 'say');
      await sleep(secs, c, rt);
    },
    looks_switchcostume: async (rt, b, c) => {
      const t = c.target, name = rt.fieldOf(b, 'COSTUME');
      const i = t.costumes.findIndex(x => x.name === name);
      if (i >= 0) t.currentCostume = i;
    },
    looks_nextcostume: async (rt, b, c) => {
      const t = c.target;
      t.currentCostume = ((t.currentCostume || 0) + 1) % t.costumes.length;
    },
    looks_setsize: async (rt, b, c) => { c.target.size = rt.numIn(b, 'SIZE', c); },
    looks_changesize: async (rt, b, c) => { c.target.size = (c.target.size || 100) + rt.numIn(b, 'SIZE', c); },
    looks_show: async (rt, b, c) => { c.target.visible = true; },
    looks_hide: async (rt, b, c) => { c.target.visible = false; },
    looks_setlayer: async (rt, b, c) => {
      const t = c.target, i = rt.sprites.indexOf(t);
      if (i < 0) return;
      rt.sprites.splice(i, 1);
      if (rt.fieldOf(b, 'LAYER') === 'back') rt.sprites.unshift(t);
      else rt.sprites.push(t);
    },
    looks_seteffect: async (rt, b, c) => {
      const e = rt.fieldOf(b, 'EFFECT'), v = rt.numIn(b, 'VAL', c);
      c.target.effects = c.target.effects || {};
      c.target.effects[e] = v;
    },

    /* --- 声音 --- */
    sound_playtone: async (rt, b, c) => { rt.sound.tone(rt.fieldOf(b, 'NOTE'), rt.numIn(b, 'SECS', c)); },
    sound_playdrum: async (rt, b, c) => { rt.sound.drum(rt.fieldOf(b, 'KIND'), rt.numIn(b, 'SECS', c)); },
    sound_setvolume: async (rt, b, c) => { rt.volume = Math.max(0, Math.min(100, rt.numIn(b, 'V', c))); },
    sound_stopallsounds: async (rt) => { rt.sound.stopAll(); },

    /* --- 控制 --- */
    control_wait: async (rt, b, c) => { await sleep(Math.max(0, rt.numIn(b, 'SECS', c)), c, rt); },
    control_repeat: async (rt, b, c) => {
      const n = Math.round(rt.numIn(b, 'TIMES', c));
      for (let i = 0; i < n; i++) {
        if (c.dead) throw STOP_ALL;
        await rt.runBranch(b, 'SUBSTACK', c);
        await rt.tick(c);
      }
    },
    control_forever: async (rt, b, c) => {
      for (;;) {
        if (c.dead) throw STOP_ALL;
        await rt.runBranch(b, 'SUBSTACK', c);
        await rt.frame();
      }
    },
    control_if: async (rt, b, c) => {
      if (rt.boolIn(b, 'COND', c)) await rt.runBranch(b, 'SUBSTACK', c);
    },
    control_if_else: async (rt, b, c) => {
      if (rt.boolIn(b, 'COND', c)) await rt.runBranch(b, 'SUBSTACK', c);
      else await rt.runBranch(b, 'SUBSTACK2', c);
    },
    control_waituntil: async (rt, b, c) => {
      for (;;) {
        if (c.dead) throw STOP_ALL;
        if (rt.boolIn(b, 'COND', c)) return;
        await rt.frame();
      }
    },
    control_repeat_until: async (rt, b, c) => {
      for (;;) {
        if (c.dead) throw STOP_ALL;
        if (rt.boolIn(b, 'COND', c)) return;
        await rt.runBranch(b, 'SUBSTACK', c);
        await rt.tick(c);
      }
    },
    control_stop: async (rt, b, c) => {
      const m = rt.fieldOf(b, 'MODE');
      if (m === 'all') { rt.stopAll(); throw STOP_ALL; }
      if (m === 'this') { throw STOP_THIS; }
      /* other */
      rt.threads.slice().forEach(t => { if (t !== c && t.target === c.target) t.stop(); });
    },
    control_createclone: async (rt, b, c) => {
      const t = rt.resolve(rt.fieldOf(b, 'TARGET'), c);
      if (t && t.kind === 'sprite') rt.createClone(t, c);
    },
    control_whencloned: async () => {},
    control_deletethisclone: async (rt, b, c) => {
      if (c.target && c.target.isClone) { rt.deleteClone(c.target); throw STOP_THIS; }
    },
    control_breakpoint: async (rt, b, c) => { await sleep(rt.numIn(b, 'SECS', c), c, rt); },

    /* --- 侦测 --- */
    sensing_resettimer: async (rt) => { rt.timerStart = performance.now(); },
    sensing_ask: async (rt, b, c) => {
      await rt.ask(rt.strIn(b, 'Q', c));
    },
    sensing_gamepadvibrate: async (rt, b, c) => {
      rt.vibrate(rt.numIn(b, 'I', c), rt.numIn(b, 'MS', c));
    },
    event_whengamepadbutton: async () => {},

    /* --- 变量 --- */
    data_setvariableto: async (rt, b, c) => { rt.varSet(rt.fieldOf(b, 'VAR'), rt.inp(b, 'VALUE', c)); },
    data_changevariableby: async (rt, b, c) => {
      const n = rt.fieldOf(b, 'VAR');
      rt.varSet(n, numv(rt.varGet(n)) + rt.numIn(b, 'VALUE', c));
    },
    data_showvariable: async (rt, b) => { setVis(rt, 'variables', rt.fieldOf(b, 'VAR'), true); },
    data_hidevariable: async (rt, b) => { setVis(rt, 'variables', rt.fieldOf(b, 'VAR'), false); },

    /* --- 列表 --- */
    data_addtolist: async (rt, b, c) => {
      const n = rt.fieldOf(b, 'LIST');
      rt.listEnsure(n);
      rt.listGet(n).push(rt.inp(b, 'ITEM', c));
    },
    data_deleteoflist: async (rt, b, c) => {
      const arr = rt.listGet(rt.fieldOf(b, 'LIST'));
      const i = Math.round(rt.numIn(b, 'INDEX', c));
      if (i === 0) { arr.length = 0; return; }
      const idx = i < 0 ? arr.length + i : i - 1;
      if (idx >= 0 && idx < arr.length) arr.splice(idx, 1);
    },
    data_deletealloflist: async (rt, b) => { rt.listGet(rt.fieldOf(b, 'LIST')).length = 0; },
    data_insertatlist: async (rt, b, c) => {
      const n = rt.fieldOf(b, 'LIST');
      rt.listEnsure(n);
      const arr = rt.listGet(n);
      let i = Math.round(rt.numIn(b, 'INDEX', c));
      let idx = i < 0 ? arr.length + i + 1 : i - 1;
      idx = Math.max(0, Math.min(arr.length, idx));
      arr.splice(idx, 0, rt.inp(b, 'ITEM', c));
    },
    data_replaceitemoflist: async (rt, b, c) => {
      const arr = rt.listGet(rt.fieldOf(b, 'LIST'));
      const i = Math.round(rt.numIn(b, 'INDEX', c));
      const idx = i < 0 ? arr.length + i : i - 1;
      if (idx >= 0 && idx < arr.length) arr[idx] = rt.inp(b, 'ITEM', c);
    },
    data_showlist: async (rt, b) => { rt.listEnsure(rt.fieldOf(b, 'LIST')); setVis(rt, 'lists', rt.fieldOf(b, 'LIST'), true); },
    data_hidelist: async (rt, b) => { setVis(rt, 'lists', rt.fieldOf(b, 'LIST'), false); },

    /* --- 3D --- */
    three_create: async (rt, b, c) => {
      if (!rt.r3d) return;
      rt.r3d.create(rt.strIn(b, 'NAME', c), rt.fieldOf(b, 'SHAPE'),
        { color: rt.strIn(b, 'COLOR', c) });
    },
    three_createx: async (rt, b, c) => {
      if (!rt.r3d) return;
      rt.r3d.create(rt.strIn(b, 'NAME', c), rt.fieldOf(b, 'SHAPE'), {
        color: rt.strIn(b, 'COLOR', c),
        w: rt.numIn(b, 'W', c), h: rt.numIn(b, 'H', c), d: rt.numIn(b, 'D', c)
      });
    },
    three_createtext: async (rt, b, c) => {
      if (!rt.r3d) return;
      rt.r3d.create(rt.strIn(b, 'NAME', c), 'text',
        { color: rt.strIn(b, 'COLOR', c), text: rt.strIn(b, 'TEXT', c) });
    },
    three_createmodel: async (rt, b, c) => {
      if (!rt.r3d) return;
      const assetId = rt.fieldOf(b, 'MODEL');
      if (!assetId) return;
      rt.r3d.create(rt.strIn(b, 'NAME', c), 'model', { model: assetId });
    },
    three_settexture: async (rt, b) => {
      if (!rt.r3d) return;
      rt.r3d.setTexture(rt.fieldOf(b, 'OBJ'), rt.fieldOf(b, 'TEX'));
    },
    three_ground: async (rt, b, c) => { if (rt.r3d) rt.r3d.ground(rt.numIn(b, 'S', c), rt.strIn(b, 'COLOR', c)); },
    three_delete: async (rt, b) => { if (rt.r3d) rt.r3d.remove(rt.fieldOf(b, 'OBJ')); },
    three_setpos: async (rt, b, c) => { if (rt.r3d) rt.r3d.setPos(rt.fieldOf(b, 'OBJ'), rt.numIn(b, 'X', c), rt.numIn(b, 'Y', c), rt.numIn(b, 'Z', c)); },
    three_move: async (rt, b, c) => { if (rt.r3d) rt.r3d.move(rt.fieldOf(b, 'OBJ'), rt.numIn(b, 'N', c)); },
    three_rotate: async (rt, b, c) => { if (rt.r3d) rt.r3d.rotate(rt.fieldOf(b, 'OBJ'), rt.fieldOf(b, 'AXIS'), rt.numIn(b, 'DEG', c)); },
    three_setrot: async (rt, b, c) => { if (rt.r3d) rt.r3d.setRot(rt.fieldOf(b, 'OBJ'), rt.numIn(b, 'X', c), rt.numIn(b, 'Y', c), rt.numIn(b, 'Z', c)); },
    three_setscale: async (rt, b, c) => { if (rt.r3d) rt.r3d.setScale(rt.fieldOf(b, 'OBJ'), rt.numIn(b, 'S', c)); },
    three_setcolor: async (rt, b, c) => { if (rt.r3d) rt.r3d.setColor(rt.fieldOf(b, 'OBJ'), rt.strIn(b, 'COLOR', c)); },
    three_setvisible: async (rt, b) => { if (rt.r3d) rt.r3d.setVisible(rt.fieldOf(b, 'OBJ'), rt.fieldOf(b, 'MODE') === 'show'); },
    three_setspeed: async (rt, b, c) => { if (rt.r3d) rt.r3d.setSpeed(rt.fieldOf(b, 'OBJ'), rt.numIn(b, 'X', c), rt.numIn(b, 'Y', c), rt.numIn(b, 'Z', c)); },
    three_impulse: async (rt, b, c) => { if (rt.r3d) rt.r3d.impulse(rt.fieldOf(b, 'OBJ'), rt.numIn(b, 'X', c), rt.numIn(b, 'Y', c), rt.numIn(b, 'Z', c)); },
    three_setmode: async (rt, b) => { if (rt.r3d) rt.r3d.setMode(rt.fieldOf(b, 'OBJ'), rt.fieldOf(b, 'MODE')); },
    three_setgravity: async (rt, b, c) => {
      if (!rt.r3d) return;
      rt.r3d.gravity = rt.numIn(b, 'G', c);
      rt.project.stage.physics.gravity = rt.r3d.gravity;
    },
    three_setbounce: async (rt, b, c) => { if (rt.r3d) rt.r3d.setBounce(rt.fieldOf(b, 'OBJ'), rt.numIn(b, 'B', c)); },
    three_camerafollow: async (rt, b, c) => { if (rt.r3d) rt.r3d.cameraFollow(rt.fieldOf(b, 'OBJ'), rt.numIn(b, 'D', c), rt.numIn(b, 'H', c)); },
    three_camerapos: async (rt, b, c) => {
      if (!rt.r3d) return;
      rt.r3d.cameraPos(rt.numIn(b, 'X', c), rt.numIn(b, 'Y', c), rt.numIn(b, 'Z', c),
        rt.numIn(b, 'LX', c), rt.numIn(b, 'LY', c), rt.numIn(b, 'LZ', c));
    },
    three_cameralook: async (rt, b) => { if (rt.r3d) rt.r3d.cameraLook(rt.fieldOf(b, 'OBJ')); },
    three_cameramode: async (rt, b, c) => {
      if (!rt.r3d) return;
      rt.r3d.setProjection(rt.fieldOf(b, 'MODE'), rt.numIn(b, 'F', c));
    },
    three_setbillboard: async (rt, b) => {
      if (rt.r3d) rt.r3d.setBillboard(rt.fieldOf(b, 'OBJ'), rt.fieldOf(b, 'MODE') === 'on');
    },
    three_firstperson: async (rt, b) => { if (rt.r3d) rt.r3d.firstPerson(rt.fieldOf(b, 'MODE') === 'on'); },
    three_setbg: async (rt, b, c) => {
      if (!rt.r3d) return;
      const col = rt.strIn(b, 'COLOR', c);
      rt.r3d.setBg(col);
      rt.project.stage.skyColor = col;
    },
    three_addlight: async (rt, b, c) => { if (rt.r3d) rt.r3d.addLight(rt.fieldOf(b, 'KIND'), rt.numIn(b, 'I', c)); },
    three_fog: async (rt, b, c) => { if (rt.r3d) rt.r3d.setFog(rt.numIn(b, 'V', c), rt.strIn(b, 'COLOR', c)); },
    three_keycontrol: async (rt, b, c) => { if (rt.r3d) rt.r3d.keyControl(rt.fieldOf(b, 'OBJ'), rt.fieldOf(b, 'KEYS'), rt.numIn(b, 'SPD', c)); },

    /* --- 应用 --- */
    app_alert: async (rt, b, c) => {
      if (rt.opts.silent) return;
      global.setTimeout(() => global.alert(rt.strIn(b, 'MSG', c)), 0);
    },
    app_settitle: async (rt, b, c) => { try { document.title = rt.strIn(b, 'TITLE', c); } catch (e) {} },
    app_openurl: async (rt, b, c) => {
      const u = rt.strIn(b, 'URL', c);
      if (u) try { global.open(u, '_blank', 'noopener'); } catch (e) {}
    },
    app_log: async (rt, b, c) => { console.log('[作品日志]', rt.strIn(b, 'MSG', c)); },
    app_setbg: async (rt, b, c) => { rt.bgColor = rt.strIn(b, 'COLOR', c); },
    app_savefile: async (rt, b, c) => {
      try {
        const name = rt.strIn(b, 'NAME', c) || 'download.txt';
        const blob = new Blob([rt.strIn(b, 'TEXT', c)], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      } catch (e) { console.warn(e); }
    },
    app_readfile: async (rt, b) => {
      const name = rt.fieldOf(b, 'VAR');
      if (!name) return;
      const val = await new Promise(res => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.txt,.json,.csv,text/*';
        inp.style.display = 'none';
        document.body.appendChild(inp);
        inp.addEventListener('change', () => {
          const f = inp.files && inp.files[0];
          if (!f) { inp.remove(); return res(''); }
          const fr = new FileReader();
          fr.onload = () => { inp.remove(); res(String(fr.result)); };
          fr.onerror = () => { inp.remove(); res(''); };
          fr.readAsText(f);
        });
        inp.click();
      });
      rt.varSet(name, val);
    },
    app_fullscreen: async (rt) => {
      const el = rt.container;
      try {
        if (!document.fullscreenElement) await (el.requestFullscreen && el.requestFullscreen());
        else await document.exitFullscreen();
      } catch (e) {}
    },
    app_restart: async (rt) => { rt.greenFlag(); throw STOP_ALL; }
  };

  /* ---------- 辅助 ---------- */
  function setVis(rt, key, name, val) {
    if (!name) return;
    const arr = rt.project[key];
    let item = arr.find(x => x.name === name);
    if (!item) { item = { name, value: key === 'lists' ? [] : 0, visible: val }; arr.push(item); }
    item.visible = val;
    rt._monKeyCache = null;
  }

  async function sleep(secs, ctx, rt) {
    if (!(secs > 0)) return;
    const end = performance.now() + secs * 1000;
    for (;;) {
      if (ctx.dead) throw STOP_ALL;
      const left = end - performance.now();
      if (left <= 0) return;
      await rt.frame();
    }
  }

  function normDeg(d) {
    let x = d % 360;
    if (x < 0) x += 360;
    return Math.round(x * 100) / 100;
  }

  Runtime.REPORTERS = REPORTERS;
  Runtime.STACKS = STACKS;
  Runtime.NOTE_FREQ = NOTES;
  global.EH5Runtime = Runtime;
})(typeof window !== 'undefined' ? window : globalThis);
