/* ============================================================
   app.js — 编辑器主控
   ============================================================ */
(function (global) {
  'use strict';

  const B = global.EH5Blocks;
  const M = global.EH5Model;

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  };

  /* ============================================================
     菜单 / 弹窗 工具
     ============================================================ */
  let openMenuEl = null;
  function closeMenus() {
    if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
  }
  function menu(x, y, items) {
    closeMenus();
    const m = el('div', 'menu');
    items.forEach(it => {
      if (it.sep) { m.appendChild(el('div', 'msep')); return; }
      const b = el('button', it.danger ? 'danger' : '');
      b.textContent = (it.icon ? it.icon + '  ' : '') + it.label;
      b.addEventListener('click', () => { closeMenus(); it.run(); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, global.innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, global.innerHeight - r.height - 8) + 'px';
    openMenuEl = m;
  }
  document.addEventListener('pointerdown', (e) => {
    if (openMenuEl && !e.target.closest('.menu')) closeMenus();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

  /** 打开系统文件选择框，返回选中的文件（取消则永不 resolve） */
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      if (accept) inp.accept = accept;
      if (multiple) inp.multiple = true;
      inp.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(inp);
      inp.addEventListener('change', () => {
        const files = Array.from(inp.files || []);
        inp.remove();
        resolve(files);
      });
      inp.click();
    });
  }

  function modal(opt) {    const mask = el('div', 'modal-mask');
    const box = el('div', 'modal');
    box.appendChild(el('h3', '', opt.title || ''));
    const body = el('div', 'm-body');
    if (typeof opt.body === 'string') body.innerHTML = opt.body;
    else if (opt.body) body.appendChild(opt.body);
    box.appendChild(body);
    const foot = el('div', 'm-foot');
    (opt.buttons || [{ label: '关闭' }]).forEach(b => {
      const btn = el('button', 'btn' + (b.primary ? ' primary' : ''));
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        let keep = false;
        if (b.run) keep = b.run(box) === false;
        if (!keep) mask.remove();
      });
      foot.appendChild(btn);
    });
    box.appendChild(foot);
    mask.appendChild(box);
    mask.addEventListener('pointerdown', e => { if (e.target === mask && opt.dismissable !== false) mask.remove(); });
    document.body.appendChild(mask);
    return mask;
  }

  /* ============================================================
     主应用
     ============================================================ */
  class App {
    constructor() {
      this.project = M.createProject('我的作品');
      this.current = this.project.sprites[0];
      this.dirty = false;
      this.rt = null;
      this.runRt = null;
      this.category = 'motion';

      this.ws = new global.EH5Workspace(this, {
        root: $('#workspace'),
        inner: $('#ws-inner'),
        scripts: $('#ws-scripts')
      });

      this._buildCatRail();
      this._buildPalette();
      this._bindSearch();
      this._bindToolbar();
      this._bindStageButtons();
      this._bindKeyboard();
      this._bindDropZone();

      this.loadSample('platformer');
      this.setMsg('欢迎使用 EasyH5 Engine —— 拖积木就能做 2D / 3D 游戏');
    }

    /* ============================================================
       项目载入 / 预览
       ============================================================ */
    loadProject(p, opts) {
      this.project = M.normalize(p);
      this.current = this.project.sprites[0];
      if (opts && opts.keepName !== true) $('#proj-name').value = this.project.meta.name || '我的作品';
      this.syncModeSeg();
      this.ws.setTarget(this.current);
      this.refreshAll();
      this.startPreview();
      this.dirty = false;
    }

    loadSample(id) {
      const s = M.SAMPLES.find(x => x.id === id) || M.SAMPLES[0];
      this.loadProject(s.build());
      this.setMsg('已载入示例：' + s.name + '　（' + s.desc + '）');
    }

    startPreview() {
      if (this.rt) { try { this.rt.dispose(); } catch (e) {} this.rt = null; }
      const host = $('#stage-host');
      this.rt = new global.EH5Runtime(this.project, host, {
        share: true,
        editable: true,
        onFrame: (rt) => {
          const p = $('#fps-pill');
          if (p) p.textContent = rt.fps + ' FPS';
          /* 手柄状态不用每帧刷 DOM */
          if (!this._padT || performance.now() - this._padT > 500) {
            this._padT = performance.now();
            this.updatePadStatus();
          }
        }
      });
      this.rt.onObjectsChanged = () => this.refreshObjDatalist();
      this.rt.start();
      this.refreshObjDatalist();
      this.updateStageChrome();
    }

    refreshObjDatalist() {
      const dl = $('#eh5-objs');
      if (!dl) return;
      const names = new Set();
      (this.project.objects3d || []).forEach(o => names.add(o.name));
      if (this.rt && this.rt.r3d) this.rt.r3d.names().forEach(n => names.add(n));
      dl.innerHTML = '';
      names.forEach(n => {
        const o = document.createElement('option');
        o.value = n;
        dl.appendChild(o);
      });
    }

    updateStageChrome() {
      const is3d = this.project.stage.mode === '3d';
      $('#stage-badge').textContent = is3d ? '3D' : '2D';
      $('#stage-info').textContent = this.project.stage.width + ' × ' + this.project.stage.height;
      $('#st-mode').innerHTML = '模式 <b>' + (is3d ? '3D' : '2D') + '</b>';
    }

    /* ============================================================
       状态刷新
       ============================================================ */
    refreshAll() {
      this.renderTargetBar();
      this.ws.render();
      this.refreshInspector();
      this.updateStatus();
      this.refreshObjDatalist();
      this.updateStageChrome();
      $('#proj-name').value = this.project.meta.name || '我的作品';
      this.syncModeSeg();
    }

    updateStatus() {
      $('#st-sprites').textContent = this.project.sprites.length;
      $('#st-blocks').textContent = countBlocks(this.project);
      $('#st-vars').textContent = this.project.variables.length + this.project.lists.length;
      const sa = $('#st-assets');
      if (sa) sa.textContent = (this.project.assets || []).length;
    }

    onChanged() {
      this.dirty = true;
      this.updateStatus();
      if (this._inspT) clearTimeout(this._inspT);
      this._inspT = setTimeout(() => this.refreshInspector(), 320);
    }

    setMsg(t) { $('#st-msg').textContent = t; }
    toast(t) {
      const n = $('#toast');
      n.textContent = t;
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => { n.textContent = ''; }, 1800);
    }

    ensureNamed(kind, name) {
      const p = this.project;
      if (kind === 'variables') {
        if (!p.variables.some(v => v.name === name)) p.variables.push({ name, value: 0, visible: false });
      } else if (kind === 'lists') {
        if (!p.lists.some(v => v.name === name)) p.lists.push({ name, value: [], visible: false });
      } else if (kind === 'broadcasts') {
        if (!p.broadcasts.includes(name)) p.broadcasts.push(name);
      }
      this.updateStatus();
      if (this.rt) this.rt._monKeyCache = null;
    }

    noteBroadcast(node) {
      const def = B.get(node.type);
      if (!def) return;
      (def.args || []).forEach(a => {
        if (a.dynamic === 'broadcasts') {
          const v = node.fields && node.fields[a.name];
          if (v && !this.project.broadcasts.includes(v)) this.project.broadcasts.push(v);
        }
      });
    }

    dynamicOptions(kind, target) {
      const p = this.project;
      const spr = (target && target.costumes) ? target : (p.sprites[0] || { costumes: [] });
      switch (kind) {
        case 'variables': return p.variables.map(v => ({ value: v.name, label: v.name }));
        case 'lists': return p.lists.map(v => ({ value: v.name, label: v.name }));
        case 'broadcasts': return p.broadcasts.map(v => ({ value: v, label: v }));
        case 'costumes': return (spr.costumes || []).map(c => ({ value: c.name, label: c.name }));
        case 'targets':
          return [{ value: '_mouse_', label: '鼠标指针' }].concat(
            p.sprites.map(s => ({ value: s.name, label: s.name })));
        case 'edgeTargets':
          return [{ value: '_edge_', label: '舞台边缘' }, { value: '_mouse_', label: '鼠标指针' }]
            .concat(p.sprites.map(s => ({ value: s.name, label: s.name })));
        case 'cloneTargets':
          return [{ value: '_myself_', label: '自己' }].concat(
            p.sprites.map(s => ({ value: s.name, label: s.name })));
        case 'objects3d': return [];
        case 'models':
          return (p.assets || []).filter(a => a.kind === 'model')
            .map(a => ({ value: a.id, label: a.name + '（' + a.format + '）' }));
        case 'textures':
          return [{ value: '', label: '（纯色）' }].concat(
            (p.assets || []).filter(a => a.kind !== 'model')
              .map(a => ({ value: a.id, label: a.name })));
        default: return [];
      }
    }

    /* ============================================================
       调色板
       ============================================================ */
    _buildCatRail() {
      const rail = $('#cat-rail');
      rail.innerHTML = '';
      B.CATS.forEach(c => {
        const b = el('button', 'cat' + (c.id === this.category ? ' on' : ''));
        b.dataset.cat = c.id;
        const dot = el('span', 'dot', c.icon);
        dot.style.background = c.color;
        b.appendChild(dot);
        b.appendChild(el('span', '', c.name));
        b.addEventListener('click', () => {
          this.category = c.id;
          rail.querySelectorAll('.cat').forEach(x => x.classList.toggle('on', x.dataset.cat === c.id));
          this._buildPalette();
        });
        rail.appendChild(b);
      });
    }

    _buildPalette() {
      const list = $('#block-list');
      list.innerHTML = '';
      const q = String(this._search || '').trim().toLowerCase();
      if (q) { this._renderSearch(list, q); return; }

      const cat = B.CATS.find(c => c.id === this.category);
      list.appendChild(el('h4', '', cat ? cat.name + ' 积木' : '积木'));
      const defs = B.blocksOf(this.category);
      if (!defs.length) { list.appendChild(el('div', 'pal-empty', '这个分类还没有积木')); return; }
      defs.forEach(d => list.appendChild(this._paletteItem(d)));
    }

    _paletteItem(d) {
      const node = B.make(d.type);
      const nodeEl = this.ws.renderPaletteBlock(d.type);
      nodeEl.addEventListener('click', () => this.ws.addToWorkspace(node));
      nodeEl.title = '点击加入工作区，或直接拖到右边';
      return nodeEl;
    }

    /** 跨分类搜索积木（120 多块，找起来靠这个） */
    _renderSearch(list, q) {
      const cats = Object.create(null);
      B.CATS.forEach(c => { cats[c.id] = c; });
      const hits = [];
      B.DEFS.forEach(d => {
        if (d.hidden) return;
        const label = String(d.text).replace(/%[A-Z_0-9]+/g, ' ');
        const cat = cats[d.cat] || {};
        if (label.toLowerCase().indexOf(q) >= 0 ||
            d.type.toLowerCase().indexOf(q) >= 0 ||
            String(cat.name || '').toLowerCase().indexOf(q) >= 0) {
          hits.push(d);
        }
      });

      list.appendChild(el('h4', '', hits.length
        ? '搜索「' + q + '」 · ' + hits.length + ' 个结果'
        : '没找到匹配的积木'));

      if (!hits.length) {
        list.appendChild(el('div', 'pal-empty',
          '换个词试试，比如「移动」「重复」「碰撞」「3D」「手柄」「贴图」'));
        return;
      }

      const byCat = Object.create(null);
      hits.forEach(d => { (byCat[d.cat] = byCat[d.cat] || []).push(d); });
      B.CATS.forEach(c => {
        const arr = byCat[c.id];
        if (!arr) return;
        const h = el('div', 'pal-cat-head');
        const dot = el('span', 'dot', c.icon);
        dot.style.background = c.color;
        h.appendChild(dot);
        h.appendChild(el('span', '', c.name));
        list.appendChild(h);
        arr.forEach(d => list.appendChild(this._paletteItem(d)));
      });
    }

    _bindSearch() {
      const wrap = $('#palette-search');
      const inp = $('#block-search');
      const clear = $('#block-search-clear');
      let t = null;
      const apply = () => {
        this._search = inp.value;
        wrap.classList.toggle('has-text', !!inp.value);
        this._buildPalette();
      };
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(apply, 110);
      });
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { inp.value = ''; apply(); inp.blur(); }
        if (e.key === 'Enter') { clearTimeout(t); apply(); }
      });
      clear.addEventListener('click', () => { inp.value = ''; apply(); inp.focus(); });
      this._focusSearch = () => { inp.focus(); inp.select(); };
    }

    /* ============================================================
       角色 / 对象 选择条
       ============================================================ */
    renderTargetBar() {
      const bar = $('#target-bar');
      bar.innerHTML = '';
      this.project.sprites.forEach(sp => {
        const b = el('button', 'tgt' + (sp === this.current ? ' on' : ''));
        const sw = el('span', 'swatch');
        const cos = sp.costumes[sp.currentCostume] || sp.costumes[0] || {};
        sw.style.background = cos.color || '#ccc';
        b.appendChild(sw);
        b.appendChild(el('span', '', sp.name));
        b.addEventListener('click', () => {
          this.current = sp;
          this.ws.setTarget(sp);
          this.renderTargetBar();
          this.refreshInspector();
        });
        bar.appendChild(b);
      });
      const add = el('button', 'tgt');
      add.innerHTML = '<span style="font-size:15px;line-height:1">＋</span><span>添加角色</span>';
      add.addEventListener('click', (e) => this.addSpriteMenu(e.clientX, e.clientY));
      bar.appendChild(add);
    }

    addSpriteMenu(x, y) {
      const items = [
        { label: '新角色（矩形）', icon: '🟦', run: () => this.addSprite('rect', '#4c97ff') },
        { label: '新角色（圆形）', icon: '🔵', run: () => this.addSprite('circle', '#ff6b6b') },
        { label: '新角色（三角）', icon: '🔺', run: () => this.addSprite('triangle', '#59c059') },
        { label: '新角色（星星）', icon: '⭐', run: () => this.addSprite('star', '#ffd93d') }
      ];
      menu(x, y, items);
    }

    addSprite(shape, color) {
      const n = this.project.sprites.length + 1;
      const sp = M.createSprite('角色' + n, shape, color);
      this.project.sprites.push(sp);
      this.current = sp;
      this.ws.setTarget(sp);
      this.renderTargetBar();
      this.refreshInspector();
      this.updateStatus();
      this.reloadPreviewSoon();
      this.toast('已添加 ' + sp.name);
    }

    reloadPreviewSoon() {
      clearTimeout(this._reloadT);
      this._reloadT = setTimeout(() => this.startPreview(), 60);
    }

    /* ============================================================
       属性面板
       ============================================================ */
    refreshInspector() {
      const host = $('#inspector');
      const scroll = host.scrollTop;
      host.innerHTML = '';
      const p = this.project;

      /* ---- 角色属性 ---- */
      host.appendChild(this._sec('角色属性 · ' + this.current.name, this._spriteBody(), true));

      /* ---- 造型 ---- */
      host.appendChild(this._sec('造型', this._costumeBody(), true));

      /* ---- 素材库 ---- */
      const assets = p.assets || [];
      host.appendChild(this._sec('素材库（' + assets.length + '）', this._assetBody(), true));

      /* ---- 舞台 ---- */
      host.appendChild(this._sec('舞台', this._stageBody(), true));

      /* ---- 变量 / 列表 ---- */
      host.appendChild(this._sec('变量与列表', this._varBody(), true));

      /* ---- 3D 对象 ---- */
      if (p.stage.mode === '3d') {
        host.appendChild(this._sec('3D 对象（' + (p.objects3d.length) + '）', this._obj3dBody(), true));
      }

      host.scrollTop = scroll;
    }

    _sec(title, bodyEl, open) {
      const sec = el('div', 'insp-sec' + (open === false ? ' collapsed' : ''));
      const head = el('div', 'insp-head');
      head.appendChild(el('span', 'chev', '▼'));
      head.appendChild(el('span', '', title));
      head.addEventListener('click', () => sec.classList.toggle('collapsed'));
      sec.appendChild(head);
      const body = el('div', 'insp-body');
      body.appendChild(bodyEl);
      sec.appendChild(body);
      return sec;
    }

    _row(label, input) {
      const r = el('div', 'row');
      r.appendChild(el('label', '', label));
      if (input) r.appendChild(input);
      return r;
    }

    _num(label, value, onInput, step) {
      const inp = el('input', 'inp grow');
      inp.type = 'number';
      if (step) inp.step = step;
      inp.value = value;
      inp.addEventListener('input', () => onInput(Number(inp.value)));
      return this._row(label, inp);
    }

    _txt(label, value, onInput) {
      const inp = el('input', 'inp grow');
      inp.type = 'text';
      inp.value = value;
      inp.addEventListener('input', () => onInput(inp.value));
      return this._row(label, inp);
    }

    _spriteBody() {
      const s = this.current;
      const box = el('div');

      box.appendChild(this._txt('名称', s.name, v => {
        s.name = v;
        this.renderTargetBar();
        this.updateStatus();
      }));

      box.appendChild(this._num('x 坐标', round(s.x), v => { s.x = v; }, 1));
      box.appendChild(this._num('y 坐标', round(s.y), v => { s.y = v; }, 1));
      box.appendChild(this._num('方向', round(s.direction), v => { s.direction = v; }, 5));
      box.appendChild(this._num('大小 %', round(s.size), v => { s.size = v; }, 5));

      const vis = el('div', 'row');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = s.visible !== false;
      cb.addEventListener('change', () => { s.visible = cb.checked; });
      const lb = el('label', '', '显示');
      lb.style.flex = '0 0 auto';
      vis.appendChild(lb); vis.appendChild(cb);
      vis.appendChild(el('span', '', ' 旋转方式 '));
      const sel = el('select', 'inp');
      [['任意方向', 'all'], ['左右翻转', 'leftright'], ['不旋转', 'none']].forEach(([t, v]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        if (s.rotationStyle === v) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => { s.rotationStyle = sel.value; });
      vis.appendChild(sel);
      box.appendChild(vis);

      const acts = el('div', 'row');
      const bDup = el('button', 'btn', '复制角色');
      bDup.addEventListener('click', () => {
        const c = M.clone(s);
        c.id = M.uid('s');
        c.name = s.name + '2';
        c.scripts = c.scripts || [];
        this.project.sprites.push(c);
        this.current = c;
        this.ws.setTarget(c);
        this.refreshAll();
        this.reloadPreviewSoon();
      });
      const bDel = el('button', 'btn stop', '删除角色');
      bDel.disabled = this.project.sprites.length <= 1;
      bDel.addEventListener('click', () => {
        if (this.project.sprites.length <= 1) return;
        const i = this.project.sprites.indexOf(s);
        this.project.sprites.splice(i, 1);
        this.current = this.project.sprites[0];
        this.ws.setTarget(this.current);
        this.refreshAll();
        this.reloadPreviewSoon();
      });
      acts.appendChild(bDup); acts.appendChild(bDel);
      box.appendChild(acts);
      return box;
    }

    _costumeBody() {
      const s = this.current;
      const box = el('div');
      const grid = el('div', 'asset-grid');
      (s.costumes || []).forEach((c, i) => {
        const a = el('div', 'asset' + (i === s.currentCostume ? ' on' : ''));
        a.appendChild(this._costumeThumb(c));
        a.appendChild(el('div', 'nm', c.name));
        a.addEventListener('click', () => {
          s.currentCostume = i;
          this.refreshInspector();
          this.renderTargetBar();
        });
        a.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          menu(e.clientX, e.clientY, [
            { label: '编辑造型', icon: '✏️', run: () => this.editCostume(s, i) },
            { label: '删除造型', icon: '🗑', danger: true, run: () => {
              if (s.costumes.length <= 1) { this.toast('至少保留一个造型'); return; }
              s.costumes.splice(i, 1);
              s.currentCostume = Math.min(s.currentCostume, s.costumes.length - 1);
              this.refreshInspector();
              this.renderTargetBar();
            } }
          ]);
        });
        grid.appendChild(a);
      });
      const add = el('div', 'asset add', '＋');
      add.title = '新增造型';
      add.addEventListener('click', (e) => {
        menu(e.clientX, e.clientY, [
          { label: '程序化形状', icon: '🔷', run: () => {
            const c = M.makeCostume('造型' + (s.costumes.length + 1),
              M.SHAPES[s.costumes.length % (M.SHAPES.length - 1)][1],
              M.PALETTE_COSTUME[s.costumes.length % M.PALETTE_COSTUME.length], 50, 50);
            s.costumes.push(c);
            s.currentCostume = s.costumes.length - 1;
            this.refreshInspector();
            this.renderTargetBar();
          } },
          { label: '从素材库选图片', icon: '🗂', run: () => this.pickAssetForCostume() },
          { label: '上传图片', icon: '📤', run: () => {
            pickFiles('image/*').then(f => this.importFiles(f));
          } }
        ]);
      });
      grid.appendChild(add);
      box.appendChild(grid);
      return box;
    }

    _costumeThumb(c) {
      /* 图片造型直接用 <img>：浏览器自己处理加载态，不用轮询重绘 */
      if (c.shape === 'image') {
        const src = c.src || M.assetSrc(c.assetId);
        const im = document.createElement('img');
        im.src = src || '';
        im.alt = c.name;
        im.style.cssText = 'width:100%;height:100%;object-fit:contain;padding:9px;box-sizing:border-box';
        if (!src) {
          const ph = el('div', 'ph', '无图');
          return ph;
        }
        return im;
      }
      const cv = document.createElement('canvas');
      cv.width = 96; cv.height = 96;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, 96, 96);
      const w = 96 * 0.66, h = 96 * 0.66;
      try { M.drawCostume(ctx, c, 48, 48, w, h); } catch (e) {}
      return cv;
    }

    /* ============================================================
       素材库（上传的图片 / 3D 模型）
       ============================================================ */
    _assetBody() {
      const p = this.project;
      const assets = p.assets || [];
      const box = el('div');

      if (!assets.length) {
        box.appendChild(el('div', 'empty-note',
          '还没有素材。\n上传 PNG / JPG / SVG 当造型或贴图，\n上传 GLB / GLTF / OBJ / STL 当 3D 模型。\n也可以直接把文件拖进窗口。'));
      }

      const grid = el('div', 'asset-grid');
      assets.forEach(a => {
        const isModel = a.kind === 'model';
        const cell = el('div', 'asset' + (isModel ? ' is-model' : '') +
          (this._selectedObj3d && (this._selectedObj3d.texture === a.id || this._selectedObj3d.model === a.id) ? ' on' : ''));
        if (isModel) {
          cell.appendChild(el('div', 'model-ph', '🧊'));
          cell.appendChild(el('span', 'badge', String(a.format || '').toUpperCase()));
        } else {
          const im = document.createElement('img');
          im.src = a.src;
          im.alt = a.name;
          cell.appendChild(im);
        }
        cell.appendChild(el('div', 'nm', a.name));
        cell.title = isModel
          ? (a.name + '　' + String(a.format).toUpperCase() +
             (a.stats ? '　' + (a.stats.triangles || 0) + ' 面' : '') + '　点击查看操作')
          : (a.name + '　' + a.w + '×' + a.h + '　点击查看操作');
        cell.addEventListener('click', (e) => this.assetMenu(e.clientX, e.clientY, a));
        grid.appendChild(cell);
      });

      const add = el('div', 'asset add', '＋');
      add.title = '上传素材';
      add.addEventListener('click', (e) => {
        menu(e.clientX, e.clientY, [
          { label: '上传图片（PNG / JPG / SVG / WebP）', icon: '🖼', run: () => this.uploadImages() },
          { label: '上传 3D 模型（GLB / GLTF / OBJ / STL）', icon: '🧊', run: () => this.uploadModels() },
          { sep: true },
          { label: '我有 .blend 文件，怎么导入？', icon: '❔', run: () => this.showBlendHelp() }
        ]);
      });
      grid.appendChild(add);
      box.appendChild(grid);

      const row = el('div', 'row');
      const bI = el('button', 'btn', '＋ 图片');
      bI.addEventListener('click', () => this.uploadImages());
      const bM = el('button', 'btn', '＋ 3D 模型');
      bM.addEventListener('click', () => this.uploadModels());
      row.appendChild(bI); row.appendChild(bM);
      box.appendChild(row);

      if (assets.length) {
        const kb = Math.round(global.EH5Model.assetBytes(p) / 1024);
        box.appendChild(el('div', 'hint',
          '素材占用约 ' + (kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB') +
          '　·　图片自动缩到最长边 512px'));
      }
      return box;
    }

    assetMenu(x, y, a) {
      const items = [];
      if (a.kind === 'model') {
        items.push({ label: '加入 3D 对象列表', icon: '🧊', run: () => this.addModelObject(a) });
      } else {
        items.push({ label: '作为「' + this.current.name + '」的新造型', icon: '🎨', run: () => this.useAssetAsCostume(a) });
        items.push({ label: '替换当前造型', icon: '🔁', run: () => this.replaceCurrentCostume(a) });
        items.push({ label: '设为选中 3D 物体的贴图', icon: '🖼', run: () => this.applyTextureToSelected(a) });
      }
      items.push({ sep: true });
      items.push({
        label: '重命名', icon: '✏️', run: () => {
          const n = prompt('素材名：', a.name);
          if (n && n.trim()) { a.name = n.trim(); this.refreshInspector(); this.ws.render(); }
        }
      });
      items.push({ label: '删除素材', icon: '🗑', danger: true, run: () => this.removeAsset(a) });
      menu(x, y, items);
    }

    uploadImages() { pickFiles('image/*', true).then(f => this.importFiles(f)); }
    uploadModels() {
      pickFiles('.glb,.gltf,.obj,.stl,.blend,.blend1,.fbx,.dae,.3ds,.ply', true)
        .then(f => this.importFiles(f));
    }

    /** 判断拖进来/选中的文件属于哪一类 */
    async guessFileKind(file) {
      const name = String(file.name || '');
      const ext = name.toLowerCase().split('.').pop();
      if (/^(png|jpg|jpeg|gif|webp|bmp|svg|avif|ico)$/.test(ext)) return 'image';
      if (/^(glb|gltf|obj|stl)$/.test(ext)) return 'model';
      if (/^(blend|blend1|fbx|dae|3ds|ply)$/.test(ext)) return ext;
      /* 扩展名不认识就嗅探头部 */
      try {
        const buf = await file.slice(0, 512).arrayBuffer();
        const det = global.EH5Models.detectModelFormat(name, buf);
        if (det.format === 'glb') return 'model';
        if (det.format === 'blend') return 'blend';
        if (det.format === 'obj' || det.format === 'stl') return 'model';
      } catch (e) { /* 忽略 */ }
      if (/^image\//.test(file.type || '')) return 'image';
      return 'unknown';
    }

    async importFiles(files) {
      if (!files || !files.length) return;
      const M2 = global.EH5Model;
      let nImg = 0, nModel = 0, nFail = 0;
      let firstImage = null;

      for (const f of files) {
        let kind;
        try { kind = await this.guessFileKind(f); }
        catch (e) { kind = 'unknown'; }

        try {
          if (kind === 'image') {
            const r = await M2.importImageFile(f);
            const a = M2.addAsset(this.project, { name: r.name, kind: 'image', src: r.src, w: r.w, h: r.h });
            nImg++; if (!firstImage) firstImage = a;
          } else if (kind === 'model') {
            const r = await M2.importModelFile(f);
            M2.addAsset(this.project, {
              name: r.name, kind: 'model', src: r.src, format: r.format, stats: r.stats
            });
            nModel++;
          } else {
            nFail++;
            this.showFormatAdvice(f.name, global.EH5Models.formatAdvice(kind), kind);
          }
        } catch (e) {
          nFail++;
          this.showFormatAdvice(f.name, e.advice || null, kind, e.message);
        }
      }

      M2.setAssets(this.project.assets);
      this.refreshInspector();
      this.refreshObjDatalist();
      if (this.rt) this.rt._monKeyCache = null;

      /* 只传了图片且当前角色只有一个默认造型时，直接把它换掉 —— 少点两下 */
      if (nImg === 1 && nModel === 0 && firstImage) {
        const s = this.current;
        if (s.costumes.length === 1 && s.costumes[0].shape !== 'image') {
          this.replaceCurrentCostume(firstImage);
        }
      }
      if (nModel) this.reloadPreviewSoon();

      const parts = [];
      if (nImg) parts.push(nImg + ' 张图片');
      if (nModel) parts.push(nModel + ' 个模型');
      if (parts.length) { this.toast('已导入 ' + parts.join(' + ')); this.setMsg('素材库：' + parts.join(' + ')); }
      if (!parts.length && nFail) this.toast('没有导入成功');
    }

    showFormatAdvice(fileName, advice, format, extra) {
      if (!advice) {
        modal({
          title: '无法导入这个文件',
          body: '<p style="margin-top:0">' + escapeHtml(fileName) + '</p>' +
            '<p>' + escapeHtml(extra || '无法识别的文件格式。') + '</p>' +
            '<p class="hint">支持的图片：PNG / JPG / GIF / WebP / BMP / SVG<br>' +
            '支持的模型：GLB / GLTF / OBJ / STL</p>'
        });
        return;
      }
      modal({
        title: advice.title,
        body: '<p style="margin-top:0;color:#8b95a7;font-size:12px">' + escapeHtml(fileName) + '</p>' +
          '<p>' + escapeHtml(advice.why) + '</p>' +
          (extra ? '<p style="color:#e5484d">' + escapeHtml(extra) + '</p>' : '') +
          '<p style="margin-bottom:4px"><b>怎么做：</b></p>' +
          '<ol style="padding-left:20px;line-height:2;margin:0">' +
          advice.how.map(s => '<li>' + escapeHtml(s) + '</li>').join('') + '</ol>' +
          (advice.tip ? '<p class="hint">' + escapeHtml(advice.tip) + '</p>' : ''),
        buttons: [{ label: '知道了', primary: true }]
      });
    }

    showBlendHelp() {
      this.showFormatAdvice('（.blend 文件）', global.EH5Models.formatAdvice('blend'), 'blend');
    }

    /* ---------- 素材 -> 造型 / 贴图 / 模型 ---------- */
    useAssetAsCostume(a) {
      const s = this.current;
      const fit = M.fitStageSize(a.w, a.h);
      const c = M.makeImageCostume(a.name, a.id, fit.w, fit.h);
      s.costumes.push(c);
      s.currentCostume = s.costumes.length - 1;
      this.refreshInspector();
      this.renderTargetBar();
      this.toast('已添加造型：' + a.name);
    }

    replaceCurrentCostume(a) {
      const s = this.current;
      const i = s.currentCostume | 0;
      const fit = M.fitStageSize(a.w, a.h);
      s.costumes[i] = M.makeImageCostume(a.name, a.id, fit.w, fit.h);
      this.refreshInspector();
      this.renderTargetBar();
      this.toast('已替换造型');
    }

    applyTextureToSelected(a) {
      const o = this._selectedObj3d || (this.project.objects3d || [])[0];
      if (!o) { this.toast('先在下面「3D 对象」里添加一个物体'); return; }
      o.texture = a.id;
      if (this.rt && this.rt.r3d) this.rt.r3d.setTexture(o.name, a.id);
      this.refreshInspector();
      this.toast('已把「' + a.name + '」贴到 ' + o.name + ' 上');
    }

    addModelObject(a) {
      const o = M.createObject3d(a.name || '模型', 'model', '#ffffff');
      o.model = a.id;
      o.x = 0; o.y = 0; o.z = 0;
      this.project.objects3d.push(o);
      this._selectedObj3d = o;
      if (this.project.stage.mode !== '3d') this.setMode('3d');
      this.refreshInspector();
      this.reloadPreviewSoon();
      this.toast('已加入 3D 对象：' + o.name);
    }

    removeAsset(a) {
      const p = this.project;
      const used = [];
      p.sprites.forEach(s => (s.costumes || []).forEach(c => { if (c.assetId === a.id) used.push(s.name); }));
      p.objects3d.forEach(o => {
        if (o.texture === a.id) used.push(o.name + '（贴图）');
        if (o.model === a.id) used.push(o.name + '（模型）');
      });
      const doIt = () => {
        const i = (p.assets || []).indexOf(a);
        if (i >= 0) p.assets.splice(i, 1);
        /* 引用它的造型退回矩形，避免出现空白角色 */
        p.sprites.forEach(s => (s.costumes || []).forEach(c => {
          if (c.assetId === a.id) { c.assetId = ''; c.shape = 'rect'; c.color = c.color || '#8b95a7'; }
        }));
        p.objects3d.forEach(o => { if (o.texture === a.id) o.texture = ''; });
        M.setAssets(p.assets);
        this.refreshInspector();
        this.renderTargetBar();
        this.reloadPreviewSoon();
        this.toast('已删除素材');
      };
      if (used.length) {
        modal({
          title: '这个素材正在被使用',
          body: '<p>被引用位置：' + escapeHtml(used.join('、')) + '</p>' +
            '<p>删除后，用到它的造型会退回成矩形，贴图会变回纯色。</p>',
          buttons: [{ label: '取消' }, { label: '仍然删除', primary: true, run: doIt }]
        });
      } else doIt();
    }

    /* ---------- 全局拖拽上传 ---------- */
    _bindDropZone() {
      const mask = el('div', 'drop-mask');
      mask.innerHTML = '<div class="drop-box"><div class="big">📥</div>' +
        '松手导入<br><span>图片 → 造型 / 贴图　·　GLB/GLTF/OBJ/STL → 3D 模型</span></div>';
      document.body.appendChild(mask);
      let depth = 0;
      const show = (v) => mask.classList.toggle('on', v);

      global.addEventListener('dragenter', (e) => {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
        e.preventDefault();
        depth++;
        show(true);
      });
      global.addEventListener('dragover', (e) => {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      global.addEventListener('dragleave', (e) => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) show(false);
      });
      global.addEventListener('drop', (e) => {
        if (!e.dataTransfer) return;
        const files = Array.from(e.dataTransfer.files || []);
        if (!files.length) return;
        e.preventDefault();
        depth = 0;
        show(false);
        this.importFiles(files);
      });
    }

    /** 从素材库里挑一张图当造型 */
    pickAssetForCostume() {
      const imgs = (this.project.assets || []).filter(a => a.kind !== 'model');
      if (!imgs.length) {
        this.toast('素材库里还没有图片，先上传一张');
        this.uploadImages();
        return;
      }
      const box = el('div');
      const grid = el('div', 'asset-grid');
      const mask = modal({
        title: '选择素材图片',
        body: (() => {
          imgs.forEach(a => {
            const cell = el('div', 'asset');
            const im = document.createElement('img');
            im.src = a.src;
            cell.appendChild(im);
            cell.appendChild(el('div', 'nm', a.name));
            cell.addEventListener('click', () => { mask.remove(); this.useAssetAsCostume(a); });
            grid.appendChild(cell);
          });
          box.appendChild(grid);
          return box;
        })(),
        buttons: [{ label: '取消' }]
      });
    }

    editCostume(s, i) {
      const c = s.costumes[i];
      const body = el('div');
      const isImg = c.shape === 'image';

      const nameIn = el('input', 'inp'); nameIn.type = 'text'; nameIn.value = c.name;

      const shapeSel = el('select', 'inp');
      M.SHAPES.forEach(([t, v]) => {
        const o = document.createElement('option'); o.value = v; o.textContent = t;
        if (c.shape === v) o.selected = true;
        shapeSel.appendChild(o);
      });

      const color = el('input', 'inp'); color.type = 'color'; color.value = toHex(c.color) || '#4c97ff';
      const wIn = el('input', 'inp'); wIn.type = 'number'; wIn.value = c.w; wIn.min = 4; wIn.max = 960;
      const hIn = el('input', 'inp'); hIn.type = 'number'; hIn.value = c.h; hIn.min = 4; hIn.max = 720;
      const textIn = el('input', 'inp'); textIn.type = 'text'; textIn.value = c.text || ''; textIn.placeholder = '文字内容';

      /* --- 图片造型专用的素材选择行 --- */
      let assetId = c.assetId || '';
      const assetSel = el('select', 'inp grow');
      const fillAssets = () => {
        assetSel.innerHTML = '';
        const imgs = (this.project.assets || []).filter(a => a.kind !== 'model');
        if (!imgs.length) {
          const o = document.createElement('option'); o.value = ''; o.textContent = '（素材库是空的）';
          assetSel.appendChild(o);
          return;
        }
        imgs.forEach(a => {
          const o = document.createElement('option');
          o.value = a.id; o.textContent = a.name;
          if (a.id === assetId) o.selected = true;
          assetSel.appendChild(o);
        });
      };
      fillAssets();
      assetSel.addEventListener('change', () => {
        assetId = assetSel.value;
        const a = M.assetById(assetId);
        if (a) {
          const fit = M.fitStageSize(a.w, a.h);
          wIn.value = fit.w; hIn.value = fit.h;
          if (nameIn.value === c.name) nameIn.value = a.name;
        }
        redraw();
      });
      const upBtn = el('button', 'btn', '上传');
      upBtn.addEventListener('click', () => {
        pickFiles('image/*').then(async (files) => {
          if (!files.length) return;
          const before = (this.project.assets || []).length;
          await this.importFiles(files);
          const list = (this.project.assets || []).filter(a => a.kind !== 'model');
          if (list.length > before) {
            const a = list[list.length - 1];
            assetId = a.id;
            fillAssets();
            const fit = M.fitStageSize(a.w, a.h);
            wIn.value = fit.w; hIn.value = fit.h;
            redraw();
          }
        });
      });
      const assetRow = el('div', 'row');
      assetRow.appendChild(el('label', '', '图片'));
      assetRow.appendChild(assetSel);
      assetRow.appendChild(upBtn);

      const colorRow = this._row('颜色', color);
      const textRow = this._row('文字', textIn);

      const preview = document.createElement('canvas');
      preview.width = 200; preview.height = 150;
      preview.style.cssText = 'border:1px solid #e2e5ea;border-radius:8px;background:#fff';
      const redraw = () => {
        const img = shapeSel.value === 'image';
        assetRow.style.display = img ? '' : 'none';
        colorRow.style.display = img ? 'none' : '';
        textRow.style.display = shapeSel.value === 'text' ? '' : 'none';
        const ctx = preview.getContext('2d');
        ctx.clearRect(0, 0, 200, 150);
        const tmp = {
          shape: shapeSel.value, color: color.value,
          w: +wIn.value, h: +hIn.value, text: textIn.value, assetId
        };
        const k = Math.min(1, 170 / Math.max(4, tmp.w), 120 / Math.max(4, tmp.h));
        try { M.drawCostume(ctx, tmp, 100, 75, Math.max(4, tmp.w) * k, Math.max(4, tmp.h) * k); } catch (e) {}
        /* 图片是异步加载的，加载好之后补画一次 */
        if (tmp.shape === 'image') {
          const st = M.imageState(M.assetSrc(assetId));
          if (st === 'loading') setTimeout(() => {
            if (document.body.contains(preview)) redraw();
          }, 260);
        }
      };
      [shapeSel, color, wIn, hIn, textIn].forEach(x => x.addEventListener('input', redraw));
      redraw();

      body.appendChild(this._row('名称', nameIn));
      body.appendChild(this._row('形状', shapeSel));
      body.appendChild(assetRow);
      body.appendChild(colorRow);
      body.appendChild(this._row('宽 / 高', (() => {
        const d = el('div', 'grow'); d.style.display = 'flex'; d.style.gap = '8px';
        d.appendChild(wIn); d.appendChild(hIn); return d;
      })()));
      body.appendChild(textRow);
      body.appendChild(this._row('预览', preview));

      modal({
        title: '编辑造型',
        body,
        buttons: [
          { label: '取消' },
          { label: '确定', primary: true, run: () => {
            c.name = nameIn.value || c.name;
            c.shape = shapeSel.value;
            c.color = color.value;
            c.w = Math.max(4, +wIn.value || 50);
            c.h = Math.max(4, +hIn.value || 50);
            c.text = textIn.value;
            if (c.shape === 'image') { c.assetId = assetId; delete c.src; }
            else delete c.assetId;
            this.refreshInspector();
            this.renderTargetBar();
          } }
        ]
      });
    }

    _stageBody() {
      const st = this.project.stage;
      const box = el('div');

      const seg = el('div', 'seg');
      [['2D', '2d'], ['3D', '3d']].forEach(([t, v]) => {
        const b = el('button', st.mode === v ? 'on' : '', t);
        b.addEventListener('click', () => this.setMode(v));
        seg.appendChild(b);
      });
      box.appendChild(this._row('渲染模式', seg));

      const color = el('input', 'inp'); color.type = 'color';
      color.value = toHex(st.mode === '3d' ? st.skyColor : st.bgColor) || '#ffffff';
      color.addEventListener('input', () => {
        if (st.mode === '3d') {
          st.skyColor = color.value;
          if (this.rt && this.rt.r3d) this.rt.r3d.setBg(color.value);
        } else {
          st.bgColor = color.value;
          if (this.rt) this.rt.bgColor = color.value;
        }
      });
      box.appendChild(this._row(st.mode === '3d' ? '天空颜色' : '背景颜色', color));

      const g = el('input', 'inp grow');
      g.type = 'number'; g.value = st.physics.gravity;
      g.addEventListener('input', () => {
        st.physics.gravity = Number(g.value);
        if (this.rt && this.rt.r3d) this.rt.r3d.gravity = Number(g.value);
      });
      if (st.mode === '3d') box.appendChild(this._row('重力', g));

      const w = el('input', 'inp'); w.type = 'number'; w.value = st.width; w.style.width = '72px';
      const h = el('input', 'inp'); h.type = 'number'; h.value = st.height; h.style.width = '72px';
      const apply = () => {
        st.width = Math.max(160, Math.min(1920, +w.value || 480));
        st.height = Math.max(120, Math.min(1080, +h.value || 360));
        this.updateStageChrome();
        this.reloadPreviewSoon();
      };
      w.addEventListener('change', apply); h.addEventListener('change', apply);
      const wh = el('div', 'grow'); wh.style.display = 'flex'; wh.style.gap = '8px';
      wh.appendChild(w); wh.appendChild(h);
      box.appendChild(this._row('舞台尺寸', wh));

      const d = el('div', 'row');
      d.appendChild(el('div', 'grow', ''));
      const bDel = el('button', 'btn stop', '清空所有积木');
      bDel.addEventListener('click', () => {
        modal({
          title: '确认清空',
          body: '<p>将删除所有角色的全部脚本积木。这个操作不可撤销。</p>',
          buttons: [
            { label: '取消' },
            { label: '确定清空', primary: true, run: () => {
              this.project.sprites.forEach(s => { s.scripts = []; });
              this.ws.render();
              this.updateStatus();
              this.toast('已清空所有积木');
            } }
          ]
        });
      });
      d.appendChild(bDel);
      box.appendChild(d);
      return box;
    }

    _varBody() {
      const p = this.project;
      const box = el('div');

      const wrap = el('div');
      if (!p.variables.length && !p.lists.length) {
        wrap.appendChild(el('div', 'empty-note', '还没有变量或列表'));
      }
      p.variables.forEach(v => {
        const chip = el('span', 'var-chip');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!v.visible; cb.title = '在舞台上显示';
        cb.addEventListener('change', () => {
          v.visible = cb.checked;
          if (this.rt) this.rt._monKeyCache = null;
        });
        chip.appendChild(cb);
        chip.appendChild(el('span', '', v.name));
        const x = el('span', 'x', '×');
        x.title = '删除变量';
        x.addEventListener('click', () => {
          const i = p.variables.indexOf(v);
          p.variables.splice(i, 1);
          this.refreshInspector();
          this.updateStatus();
        });
        chip.appendChild(x);
        wrap.appendChild(chip);
      });
      p.lists.forEach(v => {
        const chip = el('span', 'var-chip');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!v.visible; cb.title = '在舞台上显示';
        cb.addEventListener('change', () => {
          v.visible = cb.checked;
          if (this.rt) this.rt._monKeyCache = null;
        });
        chip.appendChild(cb);
        chip.appendChild(el('span', '', '📋 ' + v.name));
        const x = el('span', 'x', '×');
        x.addEventListener('click', () => {
          const i = p.lists.indexOf(v);
          p.lists.splice(i, 1);
          this.refreshInspector();
          this.updateStatus();
        });
        chip.appendChild(x);
        wrap.appendChild(chip);
      });
      box.appendChild(wrap);

      const row = el('div', 'row');
      const bV = el('button', 'btn', '＋ 变量');
      bV.addEventListener('click', () => {
        const name = prompt('变量名：', '新变量');
        if (name && name.trim()) {
          this.ensureNamed('variables', name.trim());
          this.refreshInspector();
          this.ws.render();
        }
      });
      const bL = el('button', 'btn', '＋ 列表');
      bL.addEventListener('click', () => {
        const name = prompt('列表名：', '新列表');
        if (name && name.trim()) {
          this.ensureNamed('lists', name.trim());
          this.refreshInspector();
          this.ws.render();
        }
      });
      row.appendChild(bV); row.appendChild(bL);
      box.appendChild(row);
      return box;
    }

    _obj3dBody() {
      const p = this.project;
      const box = el('div');
      const assets = p.assets || [];
      const imgAssets = assets.filter(a => a.kind !== 'model');
      const modelAssets = assets.filter(a => a.kind === 'model');

      if (!p.objects3d.length) {
        box.appendChild(el('div', 'empty-note',
          '还没有 3D 对象。\n可以用「3D」分类的积木在运行时创建，\n也可以在这里预置，或从素材库放一个模型进来。'));
      }

      p.objects3d.forEach((o, i) => {
        const selected = this._selectedObj3d === o;
        const wrap = el('div', 'obj-card' + (selected ? ' on' : ''));
        wrap.addEventListener('click', (e) => {
          if (e.target.closest('input,select,button')) return;
          this._selectedObj3d = o;
          this.refreshInspector();
        });

        const head = el('div', 'row');
        const nm = el('input', 'inp grow'); nm.type = 'text'; nm.value = o.name;
        nm.addEventListener('input', () => {
          const old = o.name;
          o.name = nm.value;
          if (this.rt && this.rt.r3d) {
            const rec = this.rt.r3d.get(old);
            if (rec) { delete this.rt.r3d.objects[old]; rec.name = o.name; rec._mesh.userData.name = o.name; this.rt.r3d.objects[o.name] = rec; }
          }
          this.refreshObjDatalist();
        });
        head.appendChild(nm);
        const del = el('button', 'btn stop', '删除');
        del.addEventListener('click', () => {
          p.objects3d.splice(i, 1);
          if (this._selectedObj3d === o) this._selectedObj3d = null;
          this.refreshInspector();
          this.reloadPreviewSoon();
        });
        head.appendChild(del);
        wrap.appendChild(head);

        /* 类型 + 颜色 */
        const r2 = el('div', 'row');
        const typeSel = el('select', 'inp grow');
        B.GEO.concat([['模型（上传的 GLB/OBJ/STL）', 'model']]).forEach(([t, v]) => {
          const op = document.createElement('option'); op.value = v; op.textContent = t;
          if (o.type === v) op.selected = true;
          typeSel.appendChild(op);
        });
        typeSel.addEventListener('change', () => {
          o.type = typeSel.value;
          if (o.type !== 'model') o.model = '';
          this.refreshInspector();
          this.reloadPreviewSoon();
        });
        r2.appendChild(typeSel);
        if (o.type !== 'model') {
          const col = el('input', 'inp'); col.type = 'color'; col.value = toHex(o.color) || '#4c97ff';
          col.addEventListener('input', () => {
            o.color = col.value;
            if (this.rt && this.rt.r3d) this.rt.r3d.setColor(o.name, col.value);
          });
          r2.appendChild(col);
        }
        wrap.appendChild(r2);

        /* 模型选择 */
        if (o.type === 'model') {
          const rm = el('div', 'row');
          rm.appendChild(el('label', '', '模型'));
          const msel = el('select', 'inp grow');
          if (!modelAssets.length) {
            const op = document.createElement('option');
            op.value = ''; op.textContent = '（素材库还没有模型）';
            msel.appendChild(op);
          }
          modelAssets.forEach(a => {
            const op = document.createElement('option');
            op.value = a.id; op.textContent = a.name + '（' + a.format + '）';
            if (o.model === a.id) op.selected = true;
            msel.appendChild(op);
          });
          msel.addEventListener('change', () => { o.model = msel.value; this.reloadPreviewSoon(); });
          rm.appendChild(msel);
          const up = el('button', 'btn', '上传');
          up.addEventListener('click', () => this.uploadModels());
          rm.appendChild(up);
          wrap.appendChild(rm);
        }

        /* 贴图 */
        if (o.type !== 'text' && o.type !== 'model') {
          const rt = el('div', 'row');
          rt.appendChild(el('label', '', '贴图'));
          const tsel = el('select', 'inp grow');
          const none = document.createElement('option');
          none.value = ''; none.textContent = imgAssets.length ? '（纯色）' : '（先上传图片）';
          tsel.appendChild(none);
          imgAssets.forEach(a => {
            const op = document.createElement('option');
            op.value = a.id; op.textContent = a.name;
            if (o.texture === a.id) op.selected = true;
            tsel.appendChild(op);
          });
          tsel.addEventListener('change', () => {
            o.texture = tsel.value;
            if (this.rt && this.rt.r3d) this.rt.r3d.setTexture(o.name, tsel.value);
          });
          rt.appendChild(tsel);
          wrap.appendChild(rt);
        }

        /* 位置 */
        const pos = el('div', 'row');
        ['x', 'y', 'z'].forEach(k => {
          const inp = el('input', 'inp'); inp.type = 'number'; inp.step = '0.5';
          inp.style.width = '52px'; inp.value = Math.round(o[k] * 100) / 100;
          inp.addEventListener('change', () => {
            o[k] = Number(inp.value);
            if (this.rt && this.rt.r3d) this.rt.r3d.setPos(o.name, o.x, o.y, o.z);
          });
          pos.appendChild(el('label', '', k));
          pos.appendChild(inp);
        });
        const modeSel = el('select', 'inp');
        [['静态', 'static'], ['动态', 'dynamic']].forEach(([t, v]) => {
          const op = document.createElement('option'); op.value = v; op.textContent = t;
          if (o.physics === v) op.selected = true;
          modeSel.appendChild(op);
        });
        modeSel.addEventListener('change', () => { o.physics = modeSel.value; this.reloadPreviewSoon(); });
        pos.appendChild(modeSel);
        wrap.appendChild(pos);

        box.appendChild(wrap);
      });

      const row = el('div', 'row');
      const add = el('button', 'btn grow', '＋ 添加 3D 对象');
      add.addEventListener('click', () => {
        const n = p.objects3d.length + 1;
        const o = M.createObject3d('物体' + n, 'box', M.PALETTE_COSTUME[n % M.PALETTE_COSTUME.length]);
        p.objects3d.push(o);
        this._selectedObj3d = o;
        this.refreshInspector();
        this.reloadPreviewSoon();
      });
      row.appendChild(add);
      if (modelAssets.length) {
        const addM = el('button', 'btn', '＋ 放模型');
        addM.addEventListener('click', (e) => {
          menu(e.clientX, e.clientY, modelAssets.map(a => ({
            label: a.name, icon: '🧊', run: () => this.addModelObject(a)
          })));
        });
        row.appendChild(addM);
      }
      box.appendChild(row);
      return box;
    }

    /* ============================================================
       模式切换
       ============================================================ */
    setMode(mode) {
      this.project.stage.mode = mode;
      if (this.rt) this.rt.setMode(mode);
      this.syncModeSeg();
      this.updateStageChrome();
      this.refreshInspector();
      this.setMsg(mode === '3d' ? '已切到 3D 模式 —— 用「3D」分类的积木搭场景' : '已切到 2D 模式');
    }
    syncModeSeg() {
      const m = this.project.stage.mode === '3d' ? '3d' : '2d';
      document.querySelectorAll('#mode-seg button').forEach(b => {
        b.classList.toggle('on', b.dataset.mode === m);
      });
    }

    /* ============================================================
       舞台按钮 / 运行
       ============================================================ */
    _bindStageButtons() {
      $('#sbtn-flag').addEventListener('click', () => {
        this.startPreviewIfNeeded();
        this.setPaused(false);
        this.rt.greenFlag();
        this.setMsg('▶ 运行中');
        $('#run-state').textContent = '运行中';
      });
      $('#sbtn-stop').addEventListener('click', () => {
        if (this.rt) this.rt.stopAll();
        this.setPaused(false);
        this.setMsg('■ 已停止');
        $('#run-state').textContent = '就绪';
      });
      $('#sbtn-pause').addEventListener('click', () => this.togglePause());
      $('#sbtn-full').addEventListener('click', () => this.openRun());
    }

    /** 暂停：冻结渲染与脚本推进（不丢状态） */
    togglePause() { this.setPaused(!this.paused); }

    setPaused(v) {
      this.paused = !!v;
      const rts = [this.rt, this.runRt].filter(Boolean);
      rts.forEach(rt => {
        if (this.paused) rt.pause(); else rt.resume();
      });
      /* 工具栏按钮里有 .ico，舞台上的圆形按钮没有 —— 两种都要能更新 */
      ['#sbtn-pause', '#btn-pause'].forEach(sel => {
        const b = $(sel);
        if (!b) return;
        b.classList.toggle('on', this.paused);
        const ico = b.querySelector('.ico');
        const glyph = this.paused ? '▶' : '⏸';
        if (ico) ico.textContent = glyph;
        else b.textContent = glyph;
        b.title = this.paused ? '继续' : '暂停';
      });
      const st = $('#run-state');
      if (st) st.textContent = this.paused ? '已暂停' : (this.rt && this.rt.threads.length ? '运行中' : '就绪');
      if (this.paused) this.setMsg('⏸ 已暂停');
    }

    /** 状态栏 / 运行条上的手柄指示 */
    updatePadStatus() {
      const rt = this.runRt || this.rt;
      const n = rt ? rt.gamepadCount : 0;
      const name = rt && rt.pad ? String(rt.pad.id).slice(0, 26) : '';
      const txt = n ? ('已连接' + (n > 1 ? ' ×' + n : '')) : '未连接';
      const el1 = $('#st-pad');
      if (el1) el1.innerHTML = '手柄 <b>' + escapeHtml(txt) + '</b>';
      const el2 = $('#run-pad');
      if (el2) el2.textContent = n ? ('🎮 ' + name) : '';
    }

    startPreviewIfNeeded() {
      if (!this.rt) this.startPreview();
    }

    openRun() {
      const inner = $('#run-stage-inner');
      inner.innerHTML = '';
      const p = M.clone(this.project);
      const W = p.stage.width, H = p.stage.height;
      inner.style.aspectRatio = W + ' / ' + H;
      inner.style.width = 'min(100%, calc((100vh - 130px) * ' + (W / H) + '))';
      $('#run-title').textContent = p.meta.name || '运行中';

      if (this.runRt) { try { this.runRt.dispose(); } catch (e) {} }
      this.runRt = new global.EH5Runtime(p, inner, {
        onFrame: (rt) => { $('#run-fps').textContent = rt.fps + ' FPS'; }
      });
      this.runRt.start();
      this.runRt.greenFlag();
      $('#runmode').classList.add('on');
      this.setPaused(false);
      this.setMsg('全屏运行中');
    }

    closeRun() {
      if (this.runRt) { try { this.runRt.dispose(); } catch (e) {} this.runRt = null; }
      $('#runmode').classList.remove('on');
      this.setPaused(false);
      this.setMsg('已退出运行');
    }

    /* ============================================================
       工具栏
       ============================================================ */
    _bindToolbar() {
      $('#btn-new').addEventListener('click', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        menu(r.left, r.bottom + 6, M.SAMPLES.map(s => ({
          label: s.name + ' — ' + s.desc,
          icon: s.icon,
          run: () => {
            if (this.dirty && !confirm('当前项目有未保存的改动，确定要新建吗？')) return;
            this.loadSample(s.id);
          }
        })));
      });

      $('#btn-open').addEventListener('click', () => $('#file-input').click());
      $('#file-input').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = () => {
          try {
            const p = M.parse(String(fr.result));
            this.loadProject(p);
            this.setMsg('已导入项目：' + (p.meta.name || f.name));
            this.toast('导入成功');
          } catch (err) {
            modal({ title: '导入失败', body: '<p>' + escapeHtml(err.message) + '</p>' });
          }
        };
        fr.readAsText(f);
        e.target.value = '';
      });

      $('#btn-save').addEventListener('click', () => this.exportJSON());
      $('#btn-export').addEventListener('click', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        menu(r.left, r.bottom + 6, [
          { label: '项目 JSON（.json）', icon: '📄', run: () => this.exportJSON() },
          { label: '独立 HTML（可直接双击运行）', icon: '🌐', run: () => this.exportStandalone() },
          { sep: true },
          { label: '导出全部示例为 JSON', icon: '📚', run: () => this.exportAllSamples() }
        ]);
      });

      $('#btn-run').addEventListener('click', () => this.openRun());
      $('#btn-pause').addEventListener('click', () => this.togglePause());
      $('#btn-stop').addEventListener('click', () => {
        if (this.rt) this.rt.stopAll();
        this.setPaused(false);
        this.setMsg('■ 已停止');
      });

      $('#mode-seg').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) this.setMode(b.dataset.mode);
      });

      const nameInp = $('#proj-name');
      nameInp.addEventListener('input', () => {
        this.project.meta.name = nameInp.value;
        this.dirty = true;
      });

      $('#btn-help').addEventListener('click', () => this.showHelp());
    }

    showHelp() {
      modal({
        title: 'EasyH5 Engine · 使用说明',
        body: `
<p style="margin-top:0"><b>它是什么</b>：一个跑在浏览器里的图形化游戏引擎。用积木写逻辑，
可以做出 2D 和 3D 的游戏 / 小应用，作品存成 JSON，导入回来就能编译运行。</p>

<p><b>基本流程</b></p>
<ol style="padding-left:18px;line-height:1.9;margin:6px 0">
  <li>左边选分类 → 把积木<b>拖到中间</b>（或直接点击积木）</li>
  <li>积木靠在一起就自动吸附；拖到左侧调色板上松手 = 删除</li>
  <li>点舞台上的 <b>▶</b> 直接预览，点工具栏 <b>运行</b> 全屏跑，<b>⏸</b> 可以随时暂停</li>
  <li><b>导出 → 独立 HTML</b> 会生成一个能直接双击打开、能发给别人玩的文件</li>
</ol>

<p><b>上传自己的素材</b>（不再局限内置图形）</p>
<ul style="padding-left:18px;line-height:1.9;margin:6px 0">
  <li><b>图片</b>（PNG / JPG / SVG / WebP）→ 当 2D 造型，或贴到 3D 物体表面</li>
  <li><b>3D 模型</b>（GLB / GLTF / OBJ / STL）→ 直接拖进场景，自带颜色和贴图</li>
  <li>直接把文件<b>拖进窗口</b>也能导入，会自动缩到最长边 512px 控制体积</li>
  <li style="color:#e5484d">.blend 读不了 —— 那是 Blender 的工程文件不是模型格式。
      在 Blender 里「文件 → 导出 → glTF 2.0」存成 .glb 再拖进来就行。</li>
</ul>

<p><b>2D / 3D</b>：右上角切换。2D 用画布绘制角色；3D 用 WebGL 搭场景，
「3D」分类里有创建物体、物理、相机跟随、第一人称控制、正交投影、广告牌等积木。</p>

<p><b>手柄</b>：插上即用，不需要配置。「侦测」分类里有手柄按键 / 摇杆模拟量 /
震动积木，3D 第一人称也直接支持手柄（左摇杆走、右摇杆转视角、A 或 RT 跳）。</p>

<p><b>常用快捷键</b></p>
<p><span class="kbd">Ctrl</span>+<span class="kbd">S</span> 保存　
<span class="kbd">Ctrl</span>+<span class="kbd">O</span> 打开　
<span class="kbd">Ctrl</span>+<span class="kbd">F</span> 搜积木　
<span class="kbd">Ctrl</span>+<span class="kbd">P</span> 暂停　
<span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> 运行　
<span class="kbd">Esc</span> 退出运行<br>
在积木上<span class="kbd">右键</span>：复制 / 断开 / 删除　
在空白处<span class="kbd">右键</span>：粘贴</p>
<p style="color:#8b95a7;font-size:12px;margin-bottom:0">
提示：3D 第一人称需要先用鼠标点一下画面才能锁定视角。</p>`
      });
    }

    /* ============================================================
       积木右键菜单
       ============================================================ */
    showBlockMenu(x, y, node) {
      const def = B.get(node.type);
      const isStack = def && (def.shape === 'stack' || def.shape === 'hat' || def.shape === 'c' || def.shape === 'cap');
      const items = [];
      items.push({ label: '复制积木', icon: '⧉', run: () => { this._clip = node; this.toast('已复制到剪贴板'); } });
      if (isStack) {
        items.push({ label: '原地复制一份', icon: '📑', run: () => {
          const c = global.EH5Workspace.cloneTree(node);
          const tail = (function (n) { let k = n; while (k && k.next) k = k.next; return k || n; })(c);
          tail.next = node.next || null;
          node.next = c;
          this.ws.render();
          this.updateStatus();
          this.toast('已复制一份');
        } });
        if (this._clip) {
          items.push({ label: '粘贴到后面', icon: '📋', run: () => this.ws.appendAfterSelected(node) });
        }
      }
      items.push({ sep: true });
      if (isStack && node.next) {
        items.push({ label: '从此处断开', icon: '✂️', run: () => {
          const rest = node.next;
          node.next = null;
          this.current.scripts.push(rest);
          this.ws.render();
          this.updateStatus();
          this.toast('已断开');
        } });
      }
      if (def && def.shape === 'hat') {
        items.push({ label: '单独运行这一段', icon: '▶', run: () => this.runSingleScript(node) });
      }
      items.push({ label: '删除积木', icon: '🗑', danger: true, run: () => this.deleteBlock(node) });
      menu(x, y, items);
    }

    showWorkspaceMenu(x, y) {
      const items = [
        { label: '粘贴积木', icon: '📋', run: () => {
          if (!this._clip) { this.toast('剪贴板是空的'); return; }
          const c = global.EH5Workspace.cloneTree(this._clip);
          this.current.scripts.push(c);
          this.ws.render();
          this.updateStatus();
        } },
        { label: '整理积木（重新排版）', icon: '🧹', run: () => this.ws.render() },
        { sep: true },
        { label: '清空本角色的积木', icon: '🗑', danger: true, run: () => {
          this.current.scripts = [];
          this.ws.render();
          this.updateStatus();
        } }
      ];
      menu(x, y, items);
    }

    deleteBlock(node) {
      const detached = this.ws._detach(node);
      if (detached) {
        this.ws.render();
        this.updateStatus();
        this.toast('已删除积木');
      }
    }

    runSingleScript(hatNode) {
      this.startPreviewIfNeeded();
      this.rt.stopAll();
      const sp = this.current;
      const live = this.rt.sprites.find(s => s.name === sp.name && !s.isClone) || this.rt.sprites[0];
      if (!live) return;
      // 用编辑器里的脚本临时替换运行时的脚本引用
      live.scriptSrc = [hatNode];
      this.rt.startThread(live, hatNode);
      this.setMsg('单跑脚本：' + (B.get(hatNode.type) || {}).text);
      this.toast('已单独运行这段脚本');
    }

    /* ============================================================
       导出
       ============================================================ */
    projectJSON() {
      const p = M.serialize(this.project);
      p.meta.name = $('#proj-name').value || p.meta.name;
      return p;
    }

    exportJSON() {
      const p = this.projectJSON();
      const name = safeName(p.meta.name) + '.json';
      download(name, JSON.stringify(p, null, 2), 'application/json');
      this.dirty = false;
      this.setMsg('已导出 ' + name);
      this.toast('已保存 ' + name);
    }

    exportAllSamples() {
      const all = {
        format: 'easyh5-collection',
        version: 1,
        projects: M.SAMPLES.map(s => M.serialize(s.build()))
      };
      download('EasyH5-示例合集.json', JSON.stringify(all, null, 2), 'application/json');
      this.toast('已导出示例合集');
    }

    async exportStandalone() {
      const btn = $('#btn-export');
      btn.disabled = true;
      this.setMsg('正在编译独立 HTML…');
      try {
        const src = await this._runtimeSource();
        const p = this.projectJSON();
        const html = buildStandalone(p, src);
        download(safeName(p.meta.name) + '.html', html, 'text/html');
        this.setMsg('已编译出独立 HTML（双击即可运行）');
        this.toast('编译完成');
      } catch (e) {
        modal({
          title: '编译失败',
          body: '<p>' + escapeHtml(e.message) + '</p>' +
            '<p class="hint">如果你是把 index.html 直接双击打开的（file://），浏览器会阻止读取源码。<br>' +
            '请改用本地服务器打开，或使用单文件版 EasyH5Engine.html。</p>'
        });
      } finally {
        btn.disabled = false;
      }
    }

    async _runtimeSource() {
      /* 单文件版：源码已经内嵌在页面里 */
      const three = document.getElementById('eh5-three-src');
      const rt = document.getElementById('eh5-engine-src');
      if (three && rt) {
        return { three: three.textContent, engine: rt.textContent };
      }
      /* 开发模式：从 src/ 读 */
      const files = ['blocks.js', 'model.js', 'render2d.js', 'render3d.js', 'runtime.js'];
      const parts = [];
      for (const f of files) {
        const r = await fetch('src/' + f);
        if (!r.ok) throw new Error('无法读取 src/' + f);
        parts.push('/* ==== ' + f + ' ==== */\n' + await r.text());
      }
      const r3 = await fetch('vendor/three.min.js');
      if (!r3.ok) throw new Error('无法读取 vendor/three.min.js');
      return { three: await r3.text(), engine: parts.join('\n') };
    }

    /* ============================================================
       快捷键
       ============================================================ */
    _bindKeyboard() {
      document.addEventListener('keydown', (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
        if (e.ctrlKey || e.metaKey) {
          if (e.key === 's') { e.preventDefault(); this.exportJSON(); return; }
          if (e.key === 'o') { e.preventDefault(); $('#file-input').click(); return; }
          if (e.key === 'f') { e.preventDefault(); if (this._focusSearch) this._focusSearch(); return; }
          if (e.key === 'p') { e.preventDefault(); this.togglePause(); return; }
          if (e.key === 'Enter') { e.preventDefault(); this.openRun(); return; }
          return;
        }
        if (typing) return;
        if (e.key === 'Escape') { if ($('#runmode').classList.contains('on')) this.closeRun(); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (this.ws.selected) { e.preventDefault(); this.deleteBlock(this.ws.selected); }
        }
      });
      $('#run-close').addEventListener('click', () => this.closeRun());
      $('#run-restart').addEventListener('click', () => { if (this.runRt) this.runRt.greenFlag(); });
    }
  }

  /* ============================================================
     独立 HTML 生成
     ============================================================ */
  function buildStandalone(project, src) {
    const W = project.stage.width, H = project.stage.height;
    /* 防止项目名/字符串里出现脚本结束标签把导出的 HTML 截断 */
    const json = JSON.stringify(project).replace(/<\//g, '<\\/').replace(/\u2028|\u2029/g, '');
    const title = escapeHtml(project.meta.name || 'EasyH5 作品');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
html,body{margin:0;height:100%;background:#0f1218;overflow:hidden;
  font:13px/1.5 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#cfd6e4}
#wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:12px;box-sizing:border-box}
#bar{display:flex;align-items:center;gap:10px;font-size:12px;color:#7c8798}
#bar b{color:#cfd6e4}
#bar button{height:28px;padding:0 12px;border:1px solid #333b4b;background:#232936;color:#cfd6e4;
  border-radius:7px;cursor:pointer;font-size:12px;font-weight:600}
#bar button:hover{background:#2c3444;color:#fff}
#stage{position:relative;background:#fff;border-radius:10px;overflow:hidden;
  box-shadow:0 20px 60px rgba(0,0,0,.55);width:min(100%,calc((100vh - 96px) * ${(W / H).toFixed(6)}));aspect-ratio:${W} / ${H}}
#made{font-size:11px;color:#4d5768}
</style>
</head>
<body>
<div id="wrap">
  <div id="bar">
    <button id="rf">▶ 重新开始</button>
    <b>${title}</b>
    <span id="fps">-- FPS</span>
  </div>
  <div id="stage"></div>
  <div id="made">由 EasyH5 Engine 编译 · 图形化 2D / 3D 游戏引擎</div>
</div>
<script>${src.three}<\/script>
<script>${src.engine}<\/script>
<script>
(function(){
  var PROJECT = ${json};
  var rt = new EH5Runtime(PROJECT, document.getElementById('stage'), {
    onFrame: function(r){ var f=document.getElementById('fps'); if(f) f.textContent = r.fps + ' FPS'; }
  });
  rt.start();
  rt.greenFlag();
  document.getElementById('rf').addEventListener('click', function(){ rt.greenFlag(); });
  document.addEventListener('keydown', function(e){
    if (e.key === 'r' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); rt.greenFlag(); }
  });
  window.EH5 = rt;
})();
<\/script>
</body>
</html>`;
  }

  /* ============================================================
     小工具
     ============================================================ */
  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function safeName(s) {
    return String(s || 'project').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'project';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : ''; }
  function round(n) { const x = Number(n); return isFinite(x) ? Math.round(x * 100) / 100 : 0; }

  function countBlocks(project) {
    let n = 0;
    const walk = (b) => {
      let cur = b;
      while (cur) {
        n++;
        for (const k in (cur.inputs || {})) {
          const v = cur.inputs[k];
          if (v && typeof v === 'object' && v.type) walk(v);
        }
        if (cur.branches) for (const k in cur.branches) { if (cur.branches[k]) walk(cur.branches[k]); }
        cur = cur.next;
      }
    };
    project.sprites.forEach(s => (s.scripts || []).forEach(walk));
    return n;
  }

  /* 供自动化测试直接调用 */
  global.EH5BuildStandalone = buildStandalone;

  /* ============================================================
     启动
     ============================================================ */
  function boot() {
    try {
      global.EH5App = new App();
    } catch (e) {
      console.error(e);
      document.body.innerHTML =
        '<div style="padding:40px;font:14px sans-serif;color:#c0392b">' +
        '<h2>启动失败</h2><pre style="white-space:pre-wrap">' + escapeHtml(e.stack || e.message) + '</pre></div>';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
