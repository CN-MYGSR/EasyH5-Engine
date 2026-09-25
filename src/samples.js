/* ============================================================
   samples.js — 内置示例工程
   每个示例都用「积木」真实搭建（不是硬编码游戏逻辑），
   所以打开示例 = 打开一份可编辑的图形化源码。
   ============================================================ */
(function (global) {
  'use strict';

  const M = global.EH5Model;
  const { Bk, chain, sub, createProject, createSprite, createObject3d } = M;

  /* 便捷：造一个 C 型积木并填好内部 */
  function C(type, inputs, fields, inner) {
    const b = Bk(type, inputs, fields);
    if (inner) sub(b, 'SUBSTACK', inner);
    return b;
  }
  function CE(type, inputs, fields, thenPart, elsePart) {
    const b = Bk(type, inputs, fields);
    sub(b, 'SUBSTACK', thenPart || null);
    sub(b, 'SUBSTACK2', elsePart || null);
    return b;
  }

  const SAMPLES = [];

  /* ============================================================
     1. 跳跳方块 — 2D 平台跳跃
     ============================================================ */
  SAMPLES.push({
    id: 'platformer', name: '跳跳方块', mode: '2d', icon: '🏃',
    desc: '方向键左右移动 / 空格跳跃 / 吃金币加分',
    build() {
      const p = createProject('跳跳方块');
      p.meta.desc = '方向键左右移动，空格跳跃，碰到金币得分。';
      p.stage.bgColor = '#dff1ff';
      p.variables = [
        { name: '速度y', value: 0, visible: false },
        { name: '分数', value: 0, visible: true }
      ];

      /* ---------- 玩家 ---------- */
      const player = createSprite('玩家', 'rect', '#4c97ff');
      player.x = -160; player.y = -60;
      player.costumes[0].w = 40; player.costumes[0].h = 40;

      const onFloor = Bk('operator_lt', { A: Bk('motion_yposition'), B: -59 });

      const jump = C('control_if',
        { COND: Bk('operator_and', {
            A: Bk('sensing_keypressed', null, { KEY: ' ' }),
            B: onFloor
          }) },
        null,
        Bk('data_setvariableto', { VALUE: 13 }, { VAR: '速度y' }));

      const floorClamp = C('control_if',
        { COND: Bk('operator_lt', { A: Bk('motion_yposition'), B: -60 }) },
        null,
        chain(
          Bk('motion_sety', { Y: -60 }),
          Bk('data_setvariableto', { VALUE: 0 }, { VAR: '速度y' })
        ));

      const mainLoop = C('control_forever', null, null, chain(
        C('control_if', { COND: Bk('sensing_keypressed', null, { KEY: 'ArrowRight' }) }, null,
          Bk('motion_changexby', { DX: 5 })),
        C('control_if', { COND: Bk('sensing_keypressed', null, { KEY: 'ArrowLeft' }) }, null,
          Bk('motion_changexby', { DX: -5 })),
        jump,
        Bk('data_changevariableby', { VALUE: -0.7 }, { VAR: '速度y' }),
        Bk('motion_changeyby', { DY: Bk('data_variable', null, { VAR: '速度y' }) }),
        floorClamp
      ));

      player.scripts = [chain(
        Bk('event_whenflagclicked'),
        Bk('motion_gotoxy', { X: -160, Y: -60 }),
        Bk('data_setvariableto', { VALUE: 0 }, { VAR: '速度y' }),
        Bk('data_setvariableto', { VALUE: 0 }, { VAR: '分数' }),
        Bk('looks_show'),
        mainLoop
      )];

      /* ---------- 地面 ---------- */
      const ground = createSprite('地面', 'rect', '#59c059');
      ground.x = 0; ground.y = -105;
      ground.costumes[0].w = 480; ground.costumes[0].h = 90;
      ground.scripts = [chain(Bk('event_whenflagclicked'), Bk('looks_show'))];

      /* ---------- 金币 ---------- */
      const coin = createSprite('金币', 'star', '#ffd93d');
      coin.x = 100; coin.y = -30;
      coin.costumes[0].w = 28; coin.costumes[0].h = 28;

      const eat = C('control_if',
        { COND: Bk('sensing_touching', null, { TARGET: '玩家' }) },
        null,
        chain(
          Bk('data_changevariableby', { VALUE: 1 }, { VAR: '分数' }),
          Bk('sound_playtone', { SECS: 0.12 }, { NOTE: 'E5' }),
          Bk('motion_gotoxy', {
            X: Bk('operator_random', { FROM: -200, TO: 200 }),
            Y: Bk('operator_random', { FROM: -50, TO: 110 })
          })
        ));

      coin.scripts = [chain(
        Bk('event_whenflagclicked'),
        Bk('motion_gotoxy', { X: 100, Y: -30 }),
        Bk('looks_show'),
        C('control_forever', null, null, chain(
          Bk('motion_turnright', { DEG: 4 }),
          eat
        ))
      )];

      p.sprites = [ground, coin, player];
      return p;
    }
  });

  /* ============================================================
     2. 躲陨石 — 2D 生存
     ============================================================ */
  SAMPLES.push({
    id: 'dodge', name: '躲陨石', mode: '2d', icon: '🚀',
    desc: '鼠标控制飞船，躲开不断落下的陨石',
    build() {
      const p = createProject('躲陨石');
      p.meta.desc = '鼠标移动飞船，躲开陨石。被撞到就结束。';
      p.stage.bgColor = '#12172b';
      p.variables = [{ name: '得分', value: 0, visible: true }];

      const hit = C('control_if',
        { COND: Bk('sensing_touching', null, { TARGET: '陨石' }) },
        null,
        chain(
          Bk('sound_playdrum', { SECS: 0.4 }, { KIND: 'crash' }),
          Bk('looks_sayforsecs', { MSG: '撞到了！', SECS: 1 }),
          Bk('control_stop', null, { MODE: 'all' })
        ));

      const ship = createSprite('飞船', 'triangle', '#5cb1d6');
      ship.y = -120;
      ship.costumes[0].w = 36; ship.costumes[0].h = 36;
      ship.scripts = [chain(
        Bk('event_whenflagclicked'),
        Bk('data_setvariableto', { VALUE: 0 }, { VAR: '得分' }),
        Bk('looks_show'),
        C('control_forever', null, null, chain(
          Bk('motion_gotoxy', { X: Bk('sensing_mousex'), Y: -120 }),
          Bk('motion_pointindirection', { DIR: 90 }),
          hit
        ))
      )];

      const respawn = chain(
        Bk('data_changevariableby', { VALUE: 1 }, { VAR: '得分' }),
        Bk('sound_playtone', { SECS: 0.08 }, { NOTE: 'C5' }),
        Bk('motion_gotoxy', {
          X: Bk('operator_random', { FROM: -220, TO: 220 }),
          Y: 200
        })
      );

      const rock = createSprite('陨石', 'circle', '#ff8c1a');
      rock.y = 200;
      rock.costumes[0].w = 32; rock.costumes[0].h = 32;
      rock.scripts = [chain(
        Bk('event_whenflagclicked'),
        Bk('motion_gotoxy', { X: 0, Y: 200 }),
        Bk('looks_show'),
        C('control_forever', null, null, chain(
          Bk('motion_changeyby', { DY: -5 }),
          C('control_if',
            { COND: Bk('operator_lt', { A: Bk('motion_yposition'), B: -180 }) },
            null, respawn)
        ))
      )];

      p.sprites = [rock, ship];
      return p;
    }
  });

  /* ============================================================
     3. 3D 第一人称 — WASD 漫游 + 收集
     ============================================================ */
  SAMPLES.push({
    id: 'fps', name: '3D 第一人称', mode: '3d', icon: '🧊',
    desc: 'WASD 行走 / 空格跳跃 / 鼠标转视角 / 收集金块',
    build() {
      const p = createProject('3D 第一人称');
      p.meta.desc = 'WASD 移动，空格跳跃，鼠标转向。让皮球撞到金块得分。';
      p.stage.mode = '3d';
      p.stage.skyColor = '#87ceeb';
      p.variables = [{ name: '分数', value: 0, visible: true }];

      const gold = createObject3d('金块', 'box', '#ffd93d');
      gold.w = gold.h = gold.d = 0.8; gold.x = 6; gold.y = 0.4; gold.z = -6;

      const crate = createObject3d('箱子A', 'box', '#e2498a');
      crate.w = crate.h = crate.d = 1.4; crate.x = -5; crate.y = 0.7; crate.z = -8;

      const pillar = createObject3d('柱子', 'cylinder', '#9966ff');
      pillar.r = 0.6; pillar.h = 7; pillar.y = 3.5; pillar.x = 8; pillar.z = 4;

      const ball = createObject3d('皮球', 'sphere', '#ff6b6b');
      ball.r = 0.6; ball.x = -3; ball.y = 4; ball.z = 3;
      ball.physics = 'dynamic'; ball.bounce = 0.88;

      const cone = createObject3d('路障', 'cone', '#ff8c1a');
      cone.r = 0.6; cone.h = 1.4; cone.x = 2; cone.y = 0.7; cone.z = -3;

      p.objects3d = [gold, crate, pillar, ball, cone];

      const collect = C('control_if',
        { COND: Bk('three_collide', null, { A: '金块', B: '皮球' }) },
        null,
        chain(
          Bk('data_changevariableby', { VALUE: 1 }, { VAR: '分数' }),
          Bk('sound_playtone', { SECS: 0.15 }, { NOTE: 'G5' }),
          Bk('three_setpos', {
            X: Bk('operator_random', { FROM: -12, TO: 12 }),
            Y: 0.4,
            Z: Bk('operator_random', { FROM: -12, TO: 12 })
          }, { OBJ: '金块' })
        ));

      const s = p.sprites[0];
      s.name = '主控';
      s.scripts = [chain(
        Bk('event_whenflagclicked'),
        Bk('data_setvariableto', { VALUE: 0 }, { VAR: '分数' }),
        Bk('three_setbg', null, { COLOR: '#87ceeb' }),
        Bk('three_ground', { S: 80 }, { COLOR: '#7cb342' }),
        Bk('three_addlight', { I: 0.85 }, { KIND: 'ambient' }),
        Bk('three_addlight', { I: 1.2 }, { KIND: 'directional' }),
        Bk('three_fog', { V: 0.012 }, { COLOR: '#cfe6ff' }),
        Bk('three_setgravity', { G: -22 }),
        Bk('three_firstperson', null, { MODE: 'on' }),
        C('control_forever', null, null, chain(
          Bk('three_rotate', { DEG: 1.6 }, { OBJ: '金块', AXIS: 'y' }),
          Bk('three_rotate', { DEG: 0.6 }, { OBJ: '皮球', AXIS: 'x' }),
          collect
        ))
      )];

      return p;
    }
  });

  /* ============================================================
     4. 3D 弹跳球 — 物理沙盒
     ============================================================ */
  SAMPLES.push({
    id: 'physics3d', name: '3D 弹跳球', mode: '3d', icon: '⚽',
    desc: '重力 / 碰撞 / 弹性，按空格随机生成新球',
    build() {
      const p = createProject('3D 弹跳球');
      p.meta.desc = '球受重力下落并弹跳。按空格在随机位置生成新球。';
      p.stage.mode = '3d';
      p.variables = [{ name: '球数', value: 0, visible: true }];

      const mkName = () => Bk('operator_join', {
        A: '球', B: Bk('data_variable', null, { VAR: '球数' })
      });

      const spawn = chain(
        Bk('three_create', { NAME: mkName() }, { SHAPE: 'sphere', COLOR: '#4c97ff' }),
        Bk('three_setpos', {
          X: Bk('operator_random', { FROM: -8, TO: 8 }),
          Y: Bk('operator_random', { FROM: 6, TO: 14 }),
          Z: Bk('operator_random', { FROM: -8, TO: 8 })
        }, { OBJ: mkName() }),
        Bk('three_setscale', { S: Bk('operator_random', { FROM: 0.6, TO: 1.4 }) }, { OBJ: mkName() }),
        Bk('three_setmode', null, { OBJ: mkName(), MODE: 'dynamic' }),
        Bk('three_setbounce', { B: 0.82 }, { OBJ: mkName() }),
        Bk('data_changevariableby', { VALUE: 1 }, { VAR: '球数' })
      );

      const fire = chain(
        Bk('three_create', { NAME: '新球' }, { SHAPE: 'sphere', COLOR: '#ffd93d' }),
        Bk('three_setpos', { X: Bk('sensing_mousex'), Y: 13, Z: 0 }, { OBJ: '新球' }),
        Bk('three_setscale', { S: 1.1 }, { OBJ: '新球' }),
        Bk('three_setmode', null, { OBJ: '新球', MODE: 'dynamic' }),
        Bk('three_setbounce', { B: 0.92 }, { OBJ: '新球' }),
        Bk('sound_playtone', { SECS: 0.09 }, { NOTE: 'C5' })
      );

      const s = p.sprites[0];
      s.name = '主控';
      s.scripts = [
        chain(
          Bk('event_whenflagclicked'),
          Bk('three_setbg', null, { COLOR: '#1b2338' }),
          Bk('three_ground', { S: 60 }, { COLOR: '#2d3a5c' }),
          Bk('three_addlight', { I: 0.6 }, { KIND: 'ambient' }),
          Bk('three_addlight', { I: 1.4 }, { KIND: 'directional' }),
          Bk('three_setgravity', { G: -22 }),
          Bk('three_camerapos', { X: 0, Y: 10, Z: 20, LX: 0, LY: 2, LZ: 0 }),
          Bk('three_fog', { V: 0.008 }, { COLOR: '#1b2338' }),
          Bk('data_setvariableto', { VALUE: 0 }, { VAR: '球数' }),
          C('control_repeat', { TIMES: 12 }, null, spawn)
        ),
        chain(
          Bk('event_whenkeypressed', null, { KEY: ' ' }),
          fire
        )
      ];

      return p;
    }
  });

  /* ============================================================
     5. 待办清单 — App 类作品
     ============================================================ */
  SAMPLES.push({
    id: 'todo', name: '待办清单', mode: '2d', icon: '📋',
    desc: '用列表 + 询问搭一个迷你 App',
    build() {
      const p = createProject('待办清单');
      p.meta.desc = '一个用积木搭的待办清单 App：输入事项自动记录，可保存成文件。';
      p.stage.bgColor = '#f7f8fb';
      p.lists = [{ name: '待办', value: [], visible: true }];

      const stop = Bk('control_stop', null, { MODE: 'this' });
      const loop = C('control_forever', null, null, chain(
        Bk('sensing_ask', { Q: '输入要做的事（直接回车结束）' }),
        CE('control_if_else', { COND: Bk('operator_equals', { A: Bk('sensing_answer'), B: '' }) },
          null,
          chain(
            Bk('sound_playtone', { SECS: 0.2 }, { NOTE: 'C5' }),
            Bk('app_savefile', { NAME: '待办清单.txt', TEXT: Bk('data_listastext', null, { LIST: '待办' }) }),
            Bk('app_alert', { MSG: '已保存为 待办清单.txt' }),
            stop
          ),
          chain(
            Bk('data_addtolist', { ITEM: Bk('sensing_answer') }, { LIST: '待办' }),
            Bk('sound_playtone', { SECS: 0.08 }, { NOTE: 'E5' })
          ))
      ));

      const s = p.sprites[0];
      s.name = '主控';
      s.visible = false;
      s.scripts = [chain(
        Bk('event_whenflagclicked'),
        Bk('data_deletealloflist', null, { LIST: '待办' }),
        Bk('data_showlist', null, { LIST: '待办' }),
        loop
      )];

      return p;
    }
  });

  /* ============================================================
     6. 3D 贴图演示 — 上传素材 / 广告牌 / 正交投影
     贴图是当场用 canvas 画出来的，不依赖任何外部文件
     ============================================================ */
  SAMPLES.push({
    id: 'textures', name: '3D 贴图演示', mode: '3d', icon: '🧱',
    desc: '程序生成的贴图 + 广告牌 + 正交投影切换',
    build() {
      const p = createProject('3D 贴图演示');
      p.meta.desc = '贴图是当场画出来的。按 R 键切换正交/透视投影，看看区别。';
      p.stage.mode = '3d';
      p.stage.skyColor = '#1d2440';
      p.variables = [{ name: '投影', value: '透视', visible: true }];

      /* --- 现场画两张贴图，存进素材库 --- */
      const mkTex = (name, a, b, n) => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 256;
        const g = cv.getContext('2d');
        const c = 256 / n;
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            g.fillStyle = ((x + y) % 2) ? a : b;
            g.fillRect(x * c, y * c, c, c);
          }
        }
        g.strokeStyle = 'rgba(255,255,255,.35)';
        g.lineWidth = 6;
        g.strokeRect(3, 3, 250, 250);
        return M.addAsset(p, {
          name: name, kind: 'image', src: cv.toDataURL('image/png'), w: 256, h: 256
        });
      };
      const texA = mkTex('蓝黄格', '#2f6df6', '#ffd93d', 8);
      const texB = mkTex('粉绿格', '#e2498a', '#0fbd8c', 6);

      const cube = createObject3d('贴图箱', 'box', '#ffffff');
      cube.w = cube.h = cube.d = 2; cube.x = -3; cube.y = 1; cube.z = 0;
      cube.texture = texA.id;
      cube.physics = 'dynamic'; cube.bounce = 0.6;

      const ball = createObject3d('贴图球', 'sphere', '#ffffff');
      ball.r = 1; ball.x = 0; ball.y = 1; ball.z = 0;
      ball.texture = texB.id;

      const sign = createObject3d('广告牌', 'plane', '#ffd93d');
      sign.w = 3.2; sign.d = 1.1; sign.x = 3.4; sign.y = 2.2; sign.z = 0;

      const post = createObject3d('牌杆', 'cylinder', '#5b6474');
      post.r = 0.09; post.h = 2.2; post.x = 3.4; post.y = 1.1; post.z = 0;

      p.objects3d = [cube, ball, sign, post];

      const s = p.sprites[0];
      s.name = '主控';
      s.scripts = [
        chain(
          Bk('event_whenflagclicked'),
          Bk('three_setbg', null, { COLOR: '#1d2440' }),
          Bk('three_ground', { S: 50 }, { COLOR: '#2a3352' }),
          Bk('three_addlight', { I: 0.55 }, { KIND: 'ambient' }),
          Bk('three_addlight', { I: 1.5 }, { KIND: 'directional' }),
          Bk('three_addlight', { I: 0.9 }, { KIND: 'point' }),
          Bk('three_fog', { V: 0.016 }, { COLOR: '#1d2440' }),
          Bk('three_setgravity', { G: -20 }),
          Bk('three_setbounce', { B: 0.62 }, { OBJ: '贴图箱' }),
          Bk('three_setbillboard', null, { OBJ: '广告牌', MODE: 'on' }),
          Bk('three_cameramode', { F: 14 }, { MODE: 'perspective' }),
          Bk('data_setvariableto', { VALUE: '透视' }, { VAR: '投影' }),
          C('control_forever', null, null, chain(
            Bk('three_rotate', { DEG: 0.9 }, { OBJ: '贴图箱', AXIS: 'y' }),
            Bk('three_rotate', { DEG: 0.6 }, { OBJ: '贴图球', AXIS: 'y' }),
            Bk('three_rotate', { DEG: 1.4 }, { OBJ: '贴图球', AXIS: 'x' })
          ))
        ),
        chain(
          Bk('event_whenkeypressed', null, { KEY: 'r' }),
          C('control_if_else', { COND: Bk('operator_equals', { A: Bk('data_variable', null, { VAR: '投影' }), B: '透视' }) },
            null,
            chain(
              Bk('three_cameramode', { F: 14 }, { MODE: 'ortho' }),
              Bk('data_setvariableto', { VALUE: '正交' }, { VAR: '投影' })
            ),
            chain(
              Bk('three_cameramode', { F: 14 }, { MODE: 'perspective' }),
              Bk('data_setvariableto', { VALUE: '透视' }, { VAR: '投影' })
            ))
        ),
        chain(
          Bk('event_whenkeypressed', null, { KEY: ' ' }),
          Bk('three_impulse', { X: 0, Y: 8, Z: 0 }, { OBJ: '贴图箱' }),
          Bk('sound_playtone', { SECS: 0.12 }, { NOTE: 'C5' })
        )
      ];

      return p;
    }
  });

  /* ============================================================
     7. 空白
     ============================================================ */
  SAMPLES.push({
    id: 'blank', name: '空白项目', mode: '2d', icon: '✨',
    desc: '从零开始做一个作品',
    build() { return createProject('我的作品'); }
  });

  M.SAMPLES = SAMPLES;
  global.EH5Samples = SAMPLES;
})(typeof window !== 'undefined' ? window : globalThis);
