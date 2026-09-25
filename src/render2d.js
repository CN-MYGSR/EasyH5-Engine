/* ============================================================
   render2d.js — Canvas 2D 渲染器
   舞台坐标系：原点居中，x 向右，y 向上（与积木语义一致）
   ============================================================ */
(function (global) {
  'use strict';

  const M = global.EH5Model;

  class Render2D {
    constructor(rt) {
      this.rt = rt;
      this.canvas = rt.canvas2d;
      this.ctx = this.canvas.getContext('2d');
      this._off = document.createElement('canvas');
      this._offc = this._off.getContext('2d');
      this._k = 1; this._ox = 0; this._oy = 0;
      this.W = rt.project.stage.width;
      this.H = rt.project.stage.height;
    }

    /**
     * 关键：画布显示尺寸完全交给 CSS（width/height:100%），
     * 这里只设置「后备缓冲区」大小，并按等比缩放把舞台坐标映射上去。
     * 之前这里用内联样式写死 px，会覆盖 CSS 的 100% 导致画布溢出被裁。
     */
    resize(cssW, cssH) {
      const SW = this.rt.project.stage.width;
      const SH = this.rt.project.stage.height;
      /* 还没完成布局时用舞台原始尺寸兜底，等 ResizeObserver 再纠正 */
      if (!(cssW > 2) || !(cssH > 2)) { cssW = SW; cssH = SH; }
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      const bw = Math.max(1, Math.round(cssW * dpr));
      const bh = Math.max(1, Math.round(cssH * dpr));
      if (this.canvas.width !== bw) this.canvas.width = bw;
      if (this.canvas.height !== bh) this.canvas.height = bh;
      /* 等比缩放 + 居中（避免非 4:3 容器把画面拉变形） */
      const k = Math.min(cssW / SW, cssH / SH) * dpr;
      this._k = k;
      this._ox = (bw - SW * k) / 2;
      this._oy = (bh - SH * k) / 2;
      this.W = SW; this.H = SH;
    }

    /** 舞台坐标 -> 画布逻辑坐标（渲染时已套用缩放，这里直接用舞台单位） */
    sx(x) { return this.W / 2 + x; }
    sy(y) { return this.H / 2 - y; }

    render() {
      const rt = this.rt, ctx = this.ctx, W = this.W, H = this.H;
      const st = rt.project.stage;

      /* 背景 */
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this._k, 0, 0, this._k, this._ox, this._oy);
      ctx.fillStyle = rt.bgColor || st.bgColor || '#ffffff';
      ctx.fillRect(0, 0, W, H);

      /* 角色（含克隆体），数组顺序即图层顺序 */
      const list = rt.targets.filter(t => t.kind === 'sprite' && t.visible);
      for (const t of list) this.drawSprite(t);

      /* 拖拽中的角色 */
      if (rt.dragging) this.drawSprite(rt.dragging);
    }

    drawSprite(t) {
      const ctx = this.ctx;
      const cos = t.costumes[t.currentCostume] || t.costumes[0];
      if (!cos) return;

      const scale = (t.size / 100);
      const w = cos.w * scale, h = cos.h * scale;
      const cx = this.sx(t.x), cy = this.sy(t.y);

      /* 特效 */
      const fx = t.effects || {};
      const filters = [];
      if (fx.color) filters.push('hue-rotate(' + (fx.color * 3.6) + 'deg)');
      if (fx.brightness) filters.push('brightness(' + Math.max(0, 1 + fx.brightness / 100) + ')');
      const alpha = Math.max(0, Math.min(1, 1 - (fx.ghost || 0) / 100));

      ctx.save();
      ctx.globalAlpha = alpha;
      if (filters.length) ctx.filter = filters.join(' ');
      ctx.translate(cx, cy);

      /* 旋转：方向 90 = 朝右 */
      let rot = 0, flip = 1;
      if (t.rotationStyle === 'all') rot = (t.direction - 90) * Math.PI / 180;
      else if (t.rotationStyle === 'leftright') {
        const d = ((t.direction % 360) + 360) % 360;
        if (d > 180) flip = -1;
      }
      ctx.rotate(rot);
      ctx.scale(flip, 1);

      if (fx.pixelate > 0) {
        const px = Math.max(2, fx.pixelate / 4);
        const ow = Math.max(1, Math.round(w / px)), oh = Math.max(1, Math.round(h / px));
        if (this._off.width !== ow || this._off.height !== oh) {
          this._off.width = ow; this._off.height = oh;
        }
        const oc = this._offc;
        oc.setTransform(1, 0, 0, 1, 0, 0);
        oc.clearRect(0, 0, ow, oh);
        oc.save(); oc.scale(ow / w, oh / h);
        M.drawCostume(oc, cos, w / 2, h / 2, w, h);
        oc.restore();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this._off, -w / 2, -h / 2, w, h);
      } else {
        M.drawCostume(ctx, cos, 0, 0, w, h);
      }

      ctx.filter = 'none';
      ctx.restore();

      /* 说话气泡 */
      if (t.say && t.say.text) this.drawBubble(t, cx, cy - h / 2 - 6, t.say.text);
    }

    drawBubble(t, x, y, text) {
      const ctx = this.ctx;
      const font = '13px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
      ctx.save();
      ctx.font = font;
      const lines = wrap(ctx, String(text), 160);
      const lh = 18, padX = 10, padY = 7;
      let tw = 0;
      lines.forEach(l => { tw = Math.max(tw, ctx.measureText(l).width); });
      const bw = tw + padX * 2, bh = lines.length * lh + padY * 2;
      let bx = x - bw / 2, by = y - bh;
      bx = Math.max(4, Math.min(this.W - bw - 4, bx));
      by = Math.max(4, by);

      ctx.fillStyle = 'rgba(255,255,255,.97)';
      ctx.strokeStyle = 'rgba(31,36,48,.22)';
      ctx.lineWidth = 1.5;
      M.roundRect(ctx, bx, by, bw, bh, 10);
      ctx.fill(); ctx.stroke();
      /* 小三角 */
      ctx.beginPath();
      const tipX = Math.max(bx + 12, Math.min(bx + bw - 12, x));
      ctx.moveTo(tipX - 6, by + bh - 1);
      ctx.lineTo(tipX, by + bh + 8);
      ctx.lineTo(tipX + 6, by + bh - 1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,.97)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,36,48,.22)';
      ctx.beginPath();
      ctx.moveTo(tipX - 6, by + bh); ctx.lineTo(tipX, by + bh + 8); ctx.lineTo(tipX + 6, by + bh);
      ctx.stroke();

      ctx.fillStyle = '#1f2430';
      ctx.font = font;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, bx + padX, by + padY + i * lh + 1));
      ctx.restore();
    }
  }

  function wrap(ctx, text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const ch of para) {
        const test = line + ch;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = ch; }
        else line = test;
      }
      out.push(line);
    }
    return out.slice(0, 8);
  }

  global.EH5Render2D = Render2D;
})(typeof window !== 'undefined' ? window : globalThis);
