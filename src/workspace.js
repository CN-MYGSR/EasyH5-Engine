/* ============================================================
   workspace.js — 图形化积木编辑器
   拖拽 / 吸附 / 嵌套 / 输入槽 / 变量下拉 / 拖出删除
   ============================================================ */
(function (global) {
  'use strict';

  const B = global.EH5Blocks;
  const M = global.EH5Model;

  /* ---------- 文本测量（用于输入框自适应宽度） ---------- */
  const _mc = document.createElement('canvas').getContext('2d');
  function measure(text, font) {
    _mc.font = font || '600 12px "Segoe UI","PingFang SC",sans-serif';
    return _mc.measureText(String(text)).width;
  }

  /* ---------- 深拷贝积木树并重发 id ---------- */
  function cloneTree(node) {
    if (!node || typeof node !== 'object' || !node.type) return null;
    const out = { type: node.type, id: M.uid('b'), inputs: {}, fields: Object.assign({}, node.fields || {}) };
    for (const k in (node.inputs || {})) {
      const v = node.inputs[k];
      out.inputs[k] = (v && typeof v === 'object' && v.type) ? cloneTree(v) : v;
    }
    if (node.branches) {
      out.branches = {};
      for (const k in node.branches) out.branches[k] = cloneTree(node.branches[k]);
    }
    if (node.next) out.next = cloneTree(node.next);
    return out;
  }

  class Workspace {
    constructor(app, els) {
      this.app = app;
      this.root = els.root;       // #workspace（滚动容器）
      this.inner = els.inner;     // #ws-inner（定位容器）
      this.scriptsEl = els.scripts;
      this.conns = [];
      this.idMap = new Map();
      this.parentMap = new Map();
      this.selected = null;
      this.drag = null;
      this._bindGlobal();
    }

    /* ============================================================
       目标切换 & 渲染
       ============================================================ */
    setTarget(t) {
      this.target = t;
      this.selected = null;
      this.render();
    }

    get scripts() {
      if (!this.target) return [];
      if (!this.target.scripts) this.target.scripts = [];
      return this.target.scripts;
    }

    render() {
      const host = this.scriptsEl;
      host.innerHTML = '';
      this.conns = [];
      this.idMap.clear();
      this.parentMap.clear();

      const scripts = this.scripts;
      scripts.forEach((node, i) => {
        if (!node) return;
        const box = document.createElement('div');
        box.className = 'script';
        box.dataset.scriptIndex = i;
        host.appendChild(box);
        this.renderStack(node, box, { parent: scripts, key: i });
      });

      this._hint();
      this._fitCFeet();
    }

    /** C 型积木的底脚宽度 = 它的头部宽度（这样才能拼出 C 形） */
    _fitCFeet() {
      const cs = this.scriptsEl.querySelectorAll('.blk.c');
      for (let i = 0; i < cs.length; i++) {
        const hdr = cs[i].querySelector(':scope > .hdr');
        const foot = cs[i].querySelector(':scope > .body > .c-foot');
        if (!hdr || !foot) continue;
        const w = hdr.offsetWidth;
        if (w > 0) foot.style.width = w + 'px';
      }
    }

    _hint() {
      const old = this.inner.querySelector('.ws-hint');
      if (old) old.remove();
      if (this.scripts.length) return;
      const h = document.createElement('div');
      h.className = 'ws-hint';
      h.innerHTML = '<div><div class="big">🧩</div>' +
        '把左边的积木<b>拖到这里</b>，或<b>点击积木</b>直接加入<br>' +
        '<span style="font-size:11.5px">多个积木叠在一起就是一段脚本，点 ▶ 就能跑</span></div>';
      this.inner.appendChild(h);
    }

    /** 渲染一条堆叠链 */
    renderStack(node, container, parentRef) {
      let cur = node;
      let ref = parentRef;
      while (cur) {
        const el = this.renderBlockEl(cur);
        container.appendChild(el);
        if (!this._suppress) this.parentMap.set(cur, ref);
        const nextRef = { parent: cur, key: 'next' };
        const def = B.get(cur.type);
        if (!this._suppress && def && def.shape !== 'cap') {
          this.conns.push({ kind: 'next', el, node: cur });
        }
        ref = nextRef;
        cur = cur.next;
      }
    }

    /* ============================================================
       渲染单个积木
       ============================================================ */
    renderBlockEl(node, from) {
      const def = B.get(node.type);
      if (!def) {
        const bad = document.createElement('div');
        bad.className = 'blk stack';
        bad.style.background = '#8b95a7';
        bad.innerHTML = '<div class="hdr"><span class="label">未知积木：' + node.type + '</span></div>';
        return bad;
      }
      this._from = from || 'workspace';
      const shape = def.shape || 'stack';
      const el = document.createElement('div');
      el.className = 'blk ' + shape + (this._from === 'palette' ? ' readonly' : '');
      el.dataset.id = node.id;
      const bc = B.colorOf(node.type);
      el.style.background = bc;
      el.style.setProperty('--bc', bc);
      if (!this._suppress) this.idMap.set(node.id, node);

      const hdr = document.createElement('div');
      hdr.className = 'hdr';
      for (const part of B.parseText(def)) {
        if (part.t === 'label') {
          const s = document.createElement('span');
          s.className = 'label' + (part.v.length > 8 ? ' wrap' : '');
          s.textContent = part.v;
          hdr.appendChild(s);
        } else {
          hdr.appendChild(this.renderArg(node, part.arg));
        }
      }
      el.appendChild(hdr);

      if (shape === 'c') {
        const body = document.createElement('div');
        body.className = 'body';
        const brs = def.branches || ['SUBSTACK'];
        brs.forEach((key, i) => {
          if (i > 0) {
            const sep = document.createElement('div');
            sep.className = 'else-sep';
            sep.textContent = (def.branchLabels && def.branchLabels[i]) || '否则';
            body.appendChild(sep);
          }
          const ss = document.createElement('div');
          ss.className = 'substack';
          ss.dataset.branch = key;
          const zone = document.createElement('div');
          zone.className = 'slot-zone';
          ss.appendChild(zone);
          body.appendChild(ss);
          const inner = node.branches ? node.branches[key] : null;
          if (!this._suppress) this.conns.push({ kind: 'substack', el: ss, node, key });
          if (inner) this.renderStack(inner, zone, { parent: node.branches, key });
        });
        const foot = document.createElement('div');
        foot.className = 'c-foot';
        body.appendChild(foot);
        el.appendChild(body);
      }

      this._bindBlockEvents(el, node, this._from);
      return el;
    }

    /* ============================================================
       输入槽 / 下拉字段
       ============================================================ */
    renderArg(node, arg) {
      const val = node.inputs ? node.inputs[arg.name] : undefined;

      /* --- 3D 对象名：可输入 + 自动补全（因为对象可能是运行时动态创建的） --- */
      if (arg.kind === 'field' && arg.dynamic === 'objects3d') {
        const wrap = document.createElement('span');
        wrap.className = 'slot';
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.setAttribute('list', 'eh5-objs');
        inp.value = node.fields ? (node.fields[arg.name] || '') : '';
        inp.placeholder = '物体名';
        inp.spellcheck = false;
        const fit = () => {
          const w = Math.max(38, measure(inp.value || '物体名', '600 12px "Segoe UI",sans-serif') + 8);
          inp.style.width = Math.min(180, w) + 'px';
        };
        fit();
        inp.addEventListener('pointerdown', e => e.stopPropagation());
        inp.addEventListener('input', () => { fit(); node.fields[arg.name] = inp.value; this.app.onChanged(); });
        inp.addEventListener('change', () => { node.fields[arg.name] = inp.value; this.app.onChanged(); });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
        wrap.appendChild(inp);
        return wrap;
      }

      /* --- 下拉字段 --- */
      if (arg.kind === 'field') {
        const wrap = document.createElement('span');
        wrap.className = 'slot field';
        const sel = document.createElement('select');
        const opts = this._fieldOptions(arg, node);
        let cur = node.fields ? node.fields[arg.name] : '';
        let found = false;
        opts.forEach(o => {
          const op = document.createElement('option');
          op.value = o.value;
          op.textContent = o.label;
          if (String(o.value) === String(cur)) { op.selected = true; found = true; }
          sel.appendChild(op);
        });
        if (!found) {
          const op = document.createElement('option');
          op.value = cur;
          op.textContent = cur === '' ? '（空）' : cur;
          op.selected = true;
          sel.insertBefore(op, sel.firstChild);
        }
        if (arg.creatable) {
          const op = document.createElement('option');
          op.value = '__new__';
          op.textContent = '＋ 新建…';
          sel.appendChild(op);
        }
        sel.addEventListener('pointerdown', e => e.stopPropagation());
        sel.addEventListener('change', () => {
          if (sel.value === '__new__') {
            const name = global.prompt('请输入名称：', '');
            if (name && name.trim()) {
              this.app.ensureNamed(arg.dynamic, name.trim());
              node.fields[arg.name] = name.trim();
            }
          } else {
            node.fields[arg.name] = sel.value;
          }
          this.app.onChanged();
          this.render();
        });
        wrap.appendChild(sel);
        /* 宽度自适应 */
        const label = (sel.options[sel.selectedIndex] || {}).text || '';
        wrap.style.minWidth = Math.max(30, measure(label, '600 12px sans-serif') + 26) + 'px';
        return wrap;
      }

      /* --- 布尔槽（六边形） --- */
      if (arg.kind === 'bool') {
        const wrap = document.createElement('span');
        wrap.className = 'slot hex';
        if (val && typeof val === 'object' && val.type) {
          wrap.classList.add('filled');
          wrap.appendChild(this.renderBlockEl(val));
        } else {
          wrap.classList.add('empty');
        }
        if (!this._suppress) this.conns.push({ kind: 'input', el: wrap, node, key: arg.name, argKind: 'bool' });
        return wrap;
      }

      /* --- 颜色 --- */
      if (arg.kind === 'color') {
        const wrap = document.createElement('span');
        wrap.className = 'slot';
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.style.width = '22px';
        inp.style.height = '16px';
        inp.style.padding = '0';
        inp.style.border = '0';
        inp.style.background = 'transparent';
        inp.value = toHex(val) || '#4c97ff';
        inp.addEventListener('pointerdown', e => e.stopPropagation());
        inp.addEventListener('input', () => { node.inputs[arg.name] = inp.value; this.app.onChanged(); });
        wrap.appendChild(inp);
        return wrap;
      }

      /* --- 数值 / 文本 --- */
      const wrap = document.createElement('span');
      wrap.className = 'slot' + (arg.kind === 'num' ? ' num' : '');
      if (val && typeof val === 'object' && val.type) {
        wrap.classList.add('filled');
        wrap.appendChild(this.renderBlockEl(val));
        if (!this._suppress) this.conns.push({ kind: 'input', el: wrap, node, key: arg.name, argKind: arg.kind });
        return wrap;
      }
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = arg.kind === 'num' ? '' : 'ta';
      inp.value = val === undefined || val === null ? '' : String(val);
      inp.spellcheck = false;
      const fit = () => {
        const w = Math.max(14, measure(inp.value || '0', '600 12px "Segoe UI",sans-serif') + 6);
        inp.style.width = Math.min(190, w) + 'px';
      };
      fit();
      inp.addEventListener('pointerdown', e => e.stopPropagation());
      inp.addEventListener('input', () => {
        fit();
        node.inputs[arg.name] = coerce(arg.kind, inp.value);
        this.app.onChanged();
      });
      inp.addEventListener('change', () => {
        node.inputs[arg.name] = coerce(arg.kind, inp.value);
        this.app.onChanged();
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') inp.blur();
        e.stopPropagation();
      });
      wrap.appendChild(inp);
      if (!this._suppress) this.conns.push({ kind: 'input', el: wrap, node, key: arg.name, argKind: arg.kind, hasInput: true });
      return wrap;
    }

    /** 渲染一枚调色板积木（不可编辑、不参与吸附） */
    renderPaletteBlock(type) {
      this._suppress = true;
      try {
        return this.renderBlockEl(B.make(type), 'palette');
      } finally {
        this._suppress = false;
      }
    }

    _fieldOptions(arg, node) {
      if (arg.dynamic) {
        const list = this.app.dynamicOptions(arg.dynamic, this.target) || [];
        if (!list.length) {
          const hint = {
            models: '（还没有模型，去右侧素材库上传）',
            textures: '（还没有图片）',
            objects3d: '（无 3D 对象）'
          }[arg.dynamic] || '（无，点右边新建）';
          return [{ value: '', label: hint }];
        }
        return list;
      }
      return (arg.options || []).map(o => Array.isArray(o) ? { value: o[1], label: o[0] } : { value: o, label: String(o) });
    }

    /* ============================================================
       事件绑定
       ============================================================ */
    _bindBlockEvents(el, node, from) {
      el.addEventListener('pointerdown', (e) => {
        if (e.button === 2) return;
        const t = e.target;
        if (t && t.closest('input,select,textarea')) return;
        /* 只有点在「自己这一层」的头部才算拖自己 */
        const own = t.closest('.blk');
        if (own !== el) return;
        this._startDrag(e, node, el, from || 'workspace');
      });
      el.addEventListener('contextmenu', (e) => {
        const own = e.target.closest('.blk');
        if (own !== el) return;
        e.preventDefault();
        e.stopPropagation();
        if (from === 'palette') return;
        this.selected = node;
        this.app.showBlockMenu(e.clientX, e.clientY, node);
      });
    }

    /* ============================================================
       拖拽
       ============================================================ */
    _startDrag(e, node, el, from) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const grabX = e.clientX - rect.left;
      const grabY = e.clientY - rect.top;
      const startX = e.clientX, startY = e.clientY;
      let moved = false;

      const onMove = (ev) => {
        if (!moved) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
          moved = true;
          if (!this._beginDrag(node, el, from, grabX, grabY)) return;
        }
        this._moveDrag(ev.clientX, ev.clientY);
      };

      const onUp = (ev) => {
        global.removeEventListener('pointermove', onMove);
        global.removeEventListener('pointerup', onUp);
        global.removeEventListener('pointercancel', onUp);
        if (!moved) { this._onClick(node, el, from); return; }
        this._endDrag(ev.clientX, ev.clientY);
      };

      global.addEventListener('pointermove', onMove);
      global.addEventListener('pointerup', onUp);
      global.addEventListener('pointercancel', onUp);
    }

    _beginDrag(node, el, from, grabX, grabY) {
      let payload;
      if (from === 'workspace') {
        payload = this._detach(node);
        if (!payload) return false;
        this.render();          // render() 会重建 conns / parentMap
      } else {
        payload = cloneTree(node);
        if (!payload) return false;
      }

      const ghost = this._renderGhost(payload);
      document.body.appendChild(ghost);
      this.drag = { node: payload, ghost, grabX, grabY, from, last: null, trashOn: false };
      ghost.style.left = (grabX === undefined ? 0 : 0) + 'px';
      ghost.style.top = '0px';
      return true;
    }

    _renderGhost(node) {
      const layer = document.createElement('div');
      layer.id = 'drag-layer';
      this._suppress = true;
      try {
        layer.appendChild(this.renderBlockEl(node));
      } finally {
        this._suppress = false;
      }
      return layer;
    }

    _moveDrag(cx, cy) {
      const d = this.drag;
      if (!d) return;
      d.ghost.style.left = (cx - d.grabX) + 'px';
      d.ghost.style.top = (cy - d.grabY) + 'px';

      const shape = (B.get(d.node.type) || {}).shape || 'stack';
      d.last = this._findConn(cx, cy, shape);
      this._showIndicator(d.last);

      /* 删除区：拖到左侧调色板上 */
      const pal = document.getElementById('palette');
      const pr = pal ? pal.getBoundingClientRect() : null;
      const onTrash = !!(pr && cx < pr.right && cy > pr.top && cy < pr.bottom);
      if (onTrash !== d.trashOn) {
        d.trashOn = onTrash;
        const hint = document.getElementById('trash-hint');
        if (hint) {
          hint.classList.toggle('on', onTrash);
          if (onTrash) {
            hint.textContent = '🗑 松手删除这段积木';
            hint.style.left = (pr.right + 14) + 'px';
            hint.style.top = Math.min(global.innerHeight - 60, Math.max(20, cy - 20)) + 'px';
          }
        }
      }
    }

    _showIndicator(conn) {
      const old = this.inner.querySelector('.dropline,.dropslot');
      if (old) old.remove();
      if (!conn) return;
      const r = conn.el.getBoundingClientRect();
      const ir = this.inner.getBoundingClientRect();
      let el;
      if (conn.kind === 'input') {
        el = document.createElement('div');
        el.className = 'dropslot';
        el.style.left = (r.left - ir.left - 1) + 'px';
        el.style.top = (r.top - ir.top - 1) + 'px';
        el.style.width = (r.width + 2) + 'px';
        el.style.height = (r.height + 2) + 'px';
      } else {
        el = document.createElement('div');
        el.className = 'dropline';
        el.style.left = (r.left - ir.left + 8) + 'px';
        el.style.top = (r.top - ir.top + (conn.kind === 'next' ? r.height + 1 : 2)) + 'px';
        el.style.width = Math.max(48, r.width - 16) + 'px';
        el.style.height = '5px';
      }
      this.inner.appendChild(el);
    }

    _findConn(cx, cy, shape) {
      let best = null, bestD = 1e9;
      for (const c of this.conns) {
        if (!this._compatible(shape, c)) continue;
        const r = c.el.getBoundingClientRect();
        let px, py, limit;
        if (c.kind === 'next') { px = r.left + 16; py = r.bottom + 2; limit = 60; }
        else if (c.kind === 'substack') { px = r.left + 10; py = r.top + 5; limit = 52; }
        else { px = r.left + r.width / 2; py = r.top + r.height / 2; limit = 46; }
        const d = Math.hypot(cx - px, cy - py);
        if (d < limit && d < bestD) { bestD = d; best = c; }
      }
      return best;
    }

    _compatible(shape, conn) {
      if (conn.kind === 'input') {
        if (conn.argKind === 'bool') return shape === 'boolean';
        return shape === 'reporter';
      }
      /* next / substack：只能放堆叠型，帽子积木不行 */
      return shape === 'stack' || shape === 'c' || shape === 'cap';
    }

    _endDrag(cx, cy) {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      d.ghost.remove();
      const ind = this.inner.querySelector('.dropline,.dropslot');
      if (ind) ind.remove();
      const hint = document.getElementById('trash-hint');
      if (hint) hint.classList.remove('on');

      /* 删除 */
      if (d.trashOn) {
        this.app.onChanged();
        this.app.toast('已删除积木');
        return;
      }

      const conn = d.last;
      /* 记录本次落点，便于排查吸附问题 */
      this.lastDrop = conn
        ? { kind: conn.kind, key: conn.key || null, host: (conn.node && conn.node.type) || null }
        : { kind: 'newscript-or-drop' };
      if (conn) {
        this._insert(conn, d.node);
      } else {
        /* 落在空白处 -> 新脚本；落在工作区外 -> 丢弃 */
        const wr = this.root.getBoundingClientRect();
        const inside = cx >= wr.left && cx <= wr.right && cy >= wr.top - 40 && cy <= wr.bottom;
        if (inside && (B.isHat(d.node.type) || B.isStack(d.node.type))) {
          this.scripts.push(d.node);
          if (B.isHat(d.node.type)) this.app.noteBroadcast(d.node);
        } else if (!inside) {
          this.app.toast('积木已丢弃');
        }
      }
      this.app.onChanged();
      this.render();
    }

    _insert(conn, node) {
      const tail = tailOf(node);
      if (conn.kind === 'next') {
        tail.next = conn.node.next || null;
        conn.node.next = node;
      } else if (conn.kind === 'substack') {
        if (!conn.node.branches) conn.node.branches = {};
        tail.next = conn.node.branches[conn.key] || null;
        conn.node.branches[conn.key] = node;
      } else if (conn.kind === 'input') {
        tail.next = null;
        conn.node.inputs[conn.key] = node;
      }
      this._registerHats(node);
    }

    _registerHats(node) {
      let cur = node;
      while (cur) {
        if (B.isHat(cur.type)) this.app.noteBroadcast(cur);
        cur = cur.next;
      }
    }

    /** 从树上摘下 node（连同它后面的一串），返回摘下来的那段 */
    _detach(node) {
      const ref = this.parentMap.get(node);
      if (!ref) return null;
      const parent = ref.parent;
      const key = ref.key;
      if (Array.isArray(parent)) {
        const i = parent.indexOf(node);
        if (i < 0) return null;
        parent.splice(i, 1);
        return node;
      }
      if (key === 'next') {
        parent.next = node.next || null;
        node.next = null;
        return node;
      }
      if (parent.branches && parent.branches[key] === node) {
        parent.branches[key] = null;
        node.next = null;
        return node;
      }
      if (parent.inputs && parent.inputs[key] === node) {
        delete parent.inputs[key];
        node.next = null;
        return node;
      }
      return null;
    }

    /** 重新收集连接点（拖拽开始后 DOM 已变） */
    _rebuildConns() {
      this.render();
    }

    /** 调试用：列出某个落点附近的候选连接（按距离排序） */
    debugConns(cx, cy, shape) {
      const out = [];
      for (const c of this.conns) {
        if (!this._compatible(shape, c)) continue;
        const r = c.el.getBoundingClientRect();
        let px, py, limit;
        if (c.kind === 'next') { px = r.left + 16; py = r.bottom + 2; limit = 60; }
        else if (c.kind === 'substack') { px = r.left + 10; py = r.top + 5; limit = 52; }
        else { px = r.left + r.width / 2; py = r.top + r.height / 2; limit = 46; }
        const d = Math.hypot(cx - px, cy - py);
        out.push({
          kind: c.kind, key: c.key || null, host: (c.node && c.node.type) || null,
          at: [Math.round(px), Math.round(py)], dist: Math.round(d * 10) / 10, limit: limit, ok: d < limit
        });
      }
      out.sort((a, b) => a.dist - b.dist);
      return out;
    }

    /* ============================================================
       点击 / 菜单
       ============================================================ */
    _onClick(node, el, from) {
      if (from === 'palette') {
        this.addToWorkspace(node);
        return;
      }
      /* 点选高亮 */
      this.inner.querySelectorAll('.blk.sel').forEach(x => x.classList.remove('sel'));
      el.classList.add('sel');
      this.selected = node;
    }

    addToWorkspace(template) {
      const node = cloneTree(template);
      this.scripts.push(node);
      this._registerHats(node);
      this.app.onChanged();
      this.render();
      this.app.toast('已加入积木');
      return node;
    }

    /** 在选中积木后面插入 */
    appendAfterSelected(node) {
      const sel = this.selected;
      if (!sel || !this.idMap.has(sel.id)) { this.addToWorkspace(node); return; }
      const def = B.get(sel.type);
      if (!def || def.shape === 'cap' || def.shape === 'reporter' || def.shape === 'boolean') {
        this.addToWorkspace(node); return;
      }
      const ins = cloneTree(node);
      const tail = tailOf(ins);
      tail.next = sel.next || null;
      sel.next = ins;
      this._registerHats(ins);
      this.app.onChanged();
      this.render();
    }

    /* ============================================================
       全局事件
       ============================================================ */
    _bindGlobal() {
      this.root.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.blk')) return;
        e.preventDefault();
        this.app.showWorkspaceMenu(e.clientX, e.clientY);
      });
      this.root.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.blk')) return;
        this.selected = null;
        this.inner.querySelectorAll('.blk.sel').forEach(x => x.classList.remove('sel'));
      });
    }
  }

  /** 找到一条堆叠链的最后一个积木 */
  function tailOf(node) {
    let cur = node;
    while (cur && cur.next) cur = cur.next;
    return cur || node;
  }

  function coerce(kind, v) {    if (kind === 'num') {
      if (v === '' || v === null) return '';
      const n = Number(v);
      return isFinite(n) ? n : v;
    }
    return v;
  }
  function toHex(v) {
    if (typeof v !== 'string') return '';
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '';
  }

  Workspace.cloneTree = cloneTree;
  global.EH5Workspace = Workspace;
})(typeof window !== 'undefined' ? window : globalThis);
