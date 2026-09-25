/* ============================================================
   blocks.js — 积木语言定义
   每种积木 = 一条数据描述，渲染器据此生成积木，解释器据此执行
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 通用选项表 ---------- */
  const KEYS = [
    ['空格', ' '], ['上箭头', 'ArrowUp'], ['下箭头', 'ArrowDown'],
    ['左箭头', 'ArrowLeft'], ['右箭头', 'ArrowRight'], ['回车', 'Enter'],
    ['a', 'a'], ['b', 'b'], ['c', 'c'], ['d', 'd'], ['e', 'e'], ['f', 'f'],
    ['g', 'g'], ['h', 'h'], ['i', 'i'], ['j', 'j'], ['k', 'k'], ['l', 'l'],
    ['m', 'm'], ['n', 'n'], ['o', 'o'], ['p', 'p'], ['q', 'q'], ['r', 'r'],
    ['s', 's'], ['t', 't'], ['u', 'u'], ['v', 'v'], ['w', 'w'], ['x', 'x'],
    ['y', 'y'], ['z', 'z'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'],
    ['任意', 'any']
  ];

  /* 手柄按键（W3C 标准映射索引） */
  const PAD_BUTTONS = [
    ['A / ✕', '0'], ['B / ○', '1'], ['X / □', '2'], ['Y / △', '3'],
    ['LB / L1', '4'], ['RB / R1', '5'], ['LT / L2', '6'], ['RT / R2', '7'],
    ['选择 / Share', '8'], ['开始 / Options', '9'],
    ['左摇杆按下', '10'], ['右摇杆按下', '11'],
    ['十字键 ↑', '12'], ['十字键 ↓', '13'], ['十字键 ←', '14'], ['十字键 →', '15'],
    ['任意按键', 'any']
  ];

  const CATS = [
    { id: 'events',    name: '事件',   icon: '⚡', color: 'var(--c-events)' },
    { id: 'motion',    name: '运动',   icon: '➜',  color: 'var(--c-motion)' },
    { id: 'looks',     name: '外观',   icon: '🎨', color: 'var(--c-looks)' },
    { id: 'sound',     name: '声音',   icon: '🔊', color: 'var(--c-sound)' },
    { id: 'control',   name: '控制',   icon: '🔁', color: 'var(--c-control)' },
    { id: 'sensing',   name: '侦测',   icon: '👁', color: 'var(--c-sensing)' },
    { id: 'operators', name: '运算',   icon: '➗', color: 'var(--c-operators)' },
    { id: 'data',      name: '变量',   icon: '📦', color: 'var(--c-data)' },
    { id: 'list',      name: '列表',   icon: '📋', color: 'var(--c-list)' },
    { id: 'three',     name: '3D',     icon: '🧊', color: 'var(--c-three)' },
    { id: 'app',       name: '应用',   icon: '📱', color: 'var(--c-app)' }
  ];

  /* ---------- 积木表 ---------- */
  const DEFS = [];

  function def(o) { DEFS.push(o); return o; }

  /* ===== 事件 ===== */
  def({ type: 'event_whenflagclicked', cat: 'events', shape: 'hat', text: '当 ▶ 被点击' });
  def({ type: 'event_whenkeypressed', cat: 'events', shape: 'hat', text: '当按下 %KEY 键',
    args: [{ name: 'KEY', kind: 'field', options: KEYS, def: '空格' }] });
  def({ type: 'event_whenthisspriteclicked', cat: 'events', shape: 'hat', text: '当角色被点击' });
  def({ type: 'event_whenstageclicked', cat: 'events', shape: 'hat', text: '当舞台被点击' });
  def({ type: 'event_whenbroadcastreceived', cat: 'events', shape: 'hat', text: '当接收到 %MSG',
    args: [{ name: 'MSG', kind: 'field', dynamic: 'broadcasts', creatable: true, def: '' }] });
  def({ type: 'event_broadcast', cat: 'events', shape: 'stack', text: '广播 %MSG',
    args: [{ name: 'MSG', kind: 'field', dynamic: 'broadcasts', creatable: true, def: '' }] });
  def({ type: 'event_broadcastandwait', cat: 'events', shape: 'stack', text: '广播 %MSG 并等待',
    args: [{ name: 'MSG', kind: 'field', dynamic: 'broadcasts', creatable: true, def: '' }] });

  /* ===== 运动 ===== */
  def({ type: 'motion_movesteps', cat: 'motion', shape: 'stack', text: '移动 %STEPS 步',
    args: [{ name: 'STEPS', kind: 'num', def: 10 }] });
  def({ type: 'motion_turnright', cat: 'motion', shape: 'stack', text: '右转 ↻ %DEG 度',
    args: [{ name: 'DEG', kind: 'num', def: 15 }] });
  def({ type: 'motion_turnleft', cat: 'motion', shape: 'stack', text: '左转 ↺ %DEG 度',
    args: [{ name: 'DEG', kind: 'num', def: 15 }] });
  def({ type: 'motion_gotoxy', cat: 'motion', shape: 'stack', text: '移到 x: %X y: %Y',
    args: [{ name: 'X', kind: 'num', def: 0 }, { name: 'Y', kind: 'num', def: 0 }] });
  def({ type: 'motion_glideto', cat: 'motion', shape: 'stack', text: '在 %SECS 秒内滑行到 x: %X y: %Y',
    args: [{ name: 'SECS', kind: 'num', def: 1 }, { name: 'X', kind: 'num', def: 0 }, { name: 'Y', kind: 'num', def: 0 }] });
  def({ type: 'motion_changexby', cat: 'motion', shape: 'stack', text: '将 x 坐标增加 %DX',
    args: [{ name: 'DX', kind: 'num', def: 10 }] });
  def({ type: 'motion_setx', cat: 'motion', shape: 'stack', text: '将 x 坐标设为 %X',
    args: [{ name: 'X', kind: 'num', def: 0 }] });
  def({ type: 'motion_changeyby', cat: 'motion', shape: 'stack', text: '将 y 坐标增加 %DY',
    args: [{ name: 'DY', kind: 'num', def: 10 }] });
  def({ type: 'motion_sety', cat: 'motion', shape: 'stack', text: '将 y 坐标设为 %Y',
    args: [{ name: 'Y', kind: 'num', def: 0 }] });
  def({ type: 'motion_pointindirection', cat: 'motion', shape: 'stack', text: '面向 %DIR 方向',
    args: [{ name: 'DIR', kind: 'num', def: 90 }] });
  def({ type: 'motion_pointtowards', cat: 'motion', shape: 'stack', text: '面向 %TARGET',
    args: [{ name: 'TARGET', kind: 'field', dynamic: 'targets', def: '_mouse_' }] });
  def({ type: 'motion_bounce', cat: 'motion', shape: 'stack', text: '碰到边缘就反弹' });
  def({ type: 'motion_xposition', cat: 'motion', shape: 'reporter', text: 'x 坐标' });
  def({ type: 'motion_yposition', cat: 'motion', shape: 'reporter', text: 'y 坐标' });
  def({ type: 'motion_direction', cat: 'motion', shape: 'reporter', text: '方向' });

  /* ===== 外观 ===== */
  def({ type: 'looks_sayforsecs', cat: 'looks', shape: 'stack', text: '说 %MSG %SECS 秒',
    args: [{ name: 'MSG', kind: 'text', def: '你好！' }, { name: 'SECS', kind: 'num', def: 2 }] });
  def({ type: 'looks_say', cat: 'looks', shape: 'stack', text: '说 %MSG',
    args: [{ name: 'MSG', kind: 'text', def: '你好！' }] });
  def({ type: 'looks_think', cat: 'looks', shape: 'stack', text: '思考 %MSG',
    args: [{ name: 'MSG', kind: 'text', def: '嗯…' }] });
  def({ type: 'looks_switchcostume', cat: 'looks', shape: 'stack', text: '换成造型 %COSTUME',
    args: [{ name: 'COSTUME', kind: 'field', dynamic: 'costumes', def: '' }] });
  def({ type: 'looks_nextcostume', cat: 'looks', shape: 'stack', text: '下一个造型' });
  def({ type: 'looks_setsize', cat: 'looks', shape: 'stack', text: '将大小设为 %SIZE %',
    args: [{ name: 'SIZE', kind: 'num', def: 100 }] });
  def({ type: 'looks_changesize', cat: 'looks', shape: 'stack', text: '将大小增加 %SIZE',
    args: [{ name: 'SIZE', kind: 'num', def: 10 }] });
  def({ type: 'looks_show', cat: 'looks', shape: 'stack', text: '显示' });
  def({ type: 'looks_hide', cat: 'looks', shape: 'stack', text: '隐藏' });
  def({ type: 'looks_setlayer', cat: 'looks', shape: 'stack', text: '移到最 %LAYER 层',
    args: [{ name: 'LAYER', kind: 'field', options: [['前', 'front'], ['后', 'back']], def: 'front' }] });
  def({ type: 'looks_seteffect', cat: 'looks', shape: 'stack', text: '将 %EFFECT 特效设为 %VAL',
    args: [{ name: 'EFFECT', kind: 'field', options: [['颜色', 'color'], ['亮度', 'brightness'], ['透明度', 'ghost'], ['像素化', 'pixelate']], def: 'ghost' }, { name: 'VAL', kind: 'num', def: 50 }] });
  def({ type: 'looks_size', cat: 'looks', shape: 'reporter', text: '大小' });
  def({ type: 'looks_costumenumber', cat: 'looks', shape: 'reporter', text: '造型编号' });

  /* ===== 声音 ===== */
  def({ type: 'sound_playtone', cat: 'sound', shape: 'stack', text: '播放音符 %NOTE 时长 %SECS 秒',
    args: [{ name: 'NOTE', kind: 'field', options: [['C4', 'C4'], ['D4', 'D4'], ['E4', 'E4'], ['F4', 'F4'], ['G4', 'G4'], ['A4', 'A4'], ['B4', 'B4'], ['C5', 'C5'], ['E5', 'E5'], ['G5', 'G5']], def: 'C4' }, { name: 'SECS', kind: 'num', def: 0.25 }] });
  def({ type: 'sound_playdrum', cat: 'sound', shape: 'stack', text: '播放鼓点 %KIND 时长 %SECS 秒',
    args: [{ name: 'KIND', kind: 'field', options: [['底鼓', 'kick'], ['军鼓', 'snare'], ['踩镲', 'hat'], ['镲片', 'crash']], def: 'kick' }, { name: 'SECS', kind: 'num', def: 0.2 }] });
  def({ type: 'sound_setvolume', cat: 'sound', shape: 'stack', text: '将音量设为 %V %',
    args: [{ name: 'V', kind: 'num', def: 100 }] });
  def({ type: 'sound_stopallsounds', cat: 'sound', shape: 'stack', text: '停止所有声音' });
  def({ type: 'sound_volume', cat: 'sound', shape: 'reporter', text: '音量' });

  /* ===== 控制 ===== */
  def({ type: 'control_wait', cat: 'control', shape: 'stack', text: '等待 %SECS 秒',
    args: [{ name: 'SECS', kind: 'num', def: 1 }] });
  def({ type: 'control_repeat', cat: 'control', shape: 'c', text: '重复执行 %TIMES 次',
    args: [{ name: 'TIMES', kind: 'num', def: 10 }], branches: ['SUBSTACK'] });
  def({ type: 'control_forever', cat: 'control', shape: 'c', text: '重复执行', branches: ['SUBSTACK'] });
  def({ type: 'control_if', cat: 'control', shape: 'c', text: '如果 %COND 那么',
    args: [{ name: 'COND', kind: 'bool' }], branches: ['SUBSTACK'] });
  def({ type: 'control_if_else', cat: 'control', shape: 'c', text: '如果 %COND 那么',
    args: [{ name: 'COND', kind: 'bool' }], branches: ['SUBSTACK', 'SUBSTACK2'], branchLabels: ['', '否则'] });
  def({ type: 'control_waituntil', cat: 'control', shape: 'stack', text: '等待直到 %COND',
    args: [{ name: 'COND', kind: 'bool' }] });
  def({ type: 'control_repeat_until', cat: 'control', shape: 'c', text: '重复执行直到 %COND',
    args: [{ name: 'COND', kind: 'bool' }], branches: ['SUBSTACK'] });
  def({ type: 'control_stop', cat: 'control', shape: 'cap', text: '停止 %MODE',
    args: [{ name: 'MODE', kind: 'field', options: [['全部脚本', 'all'], ['这个脚本', 'this'], ['该角色的其他脚本', 'other']], def: 'all' }] });
  def({ type: 'control_createclone', cat: 'control', shape: 'stack', text: '克隆 %TARGET',
    args: [{ name: 'TARGET', kind: 'field', dynamic: 'cloneTargets', def: '_myself_' }] });
  def({ type: 'control_whencloned', cat: 'control', shape: 'hat', text: '当作为克隆体启动时' });
  def({ type: 'control_deletethisclone', cat: 'control', shape: 'cap', text: '删除此克隆体' });
  def({ type: 'control_breakpoint', cat: 'control', shape: 'stack', text: '等待 %SECS 秒（调试）',
    args: [{ name: 'SECS', kind: 'num', def: 0.1 }], hidden: true });

  /* ===== 侦测 ===== */
  def({ type: 'sensing_touching', cat: 'sensing', shape: 'boolean', text: '碰到 %TARGET ?',
    args: [{ name: 'TARGET', kind: 'field', dynamic: 'edgeTargets', def: '_edge_' }] });
  def({ type: 'sensing_keypressed', cat: 'sensing', shape: 'boolean', text: '按下 %KEY 键?',
    args: [{ name: 'KEY', kind: 'field', options: KEYS, def: '空格' }] });
  def({ type: 'sensing_mousedown', cat: 'sensing', shape: 'boolean', text: '按下鼠标?' });
  def({ type: 'sensing_mousex', cat: 'sensing', shape: 'reporter', text: '鼠标 x 坐标' });
  def({ type: 'sensing_mousey', cat: 'sensing', shape: 'reporter', text: '鼠标 y 坐标' });
  def({ type: 'sensing_timer', cat: 'sensing', shape: 'reporter', text: '计时器' });
  def({ type: 'sensing_resettimer', cat: 'sensing', shape: 'stack', text: '计时器归零' });
  def({ type: 'sensing_distanceto', cat: 'sensing', shape: 'reporter', text: '到 %TARGET 的距离',
    args: [{ name: 'TARGET', kind: 'field', dynamic: 'targets', def: '_mouse_' }] });
  def({ type: 'sensing_ask', cat: 'sensing', shape: 'stack', text: '询问 %Q 并等待',
    args: [{ name: 'Q', kind: 'text', def: '你的名字是？' }] });
  def({ type: 'sensing_answer', cat: 'sensing', shape: 'reporter', text: '回答' });
  def({ type: 'sensing_of', cat: 'sensing', shape: 'reporter', text: '%PROP of %TARGET',
    args: [{ name: 'PROP', kind: 'field', options: [['x 坐标', 'x'], ['y 坐标', 'y'], ['方向', 'direction'], ['大小', 'size'], ['造型编号', 'costume'], ['可见', 'visible'], ['变量', 'var']], def: 'x' }, { name: 'TARGET', kind: 'field', dynamic: 'targets', def: '_stage_' }] });
  def({ type: 'sensing_fps', cat: 'sensing', shape: 'reporter', text: '帧率' });
  def({ type: 'sensing_username', cat: 'sensing', shape: 'reporter', text: '用户名' });

  /* ===== 手柄（游戏手柄 / 手柄模拟器） ===== */
  def({ type: 'sensing_gamepadconnected', cat: 'sensing', shape: 'boolean', text: '手柄已连接?' });
  def({ type: 'sensing_gamepadbutton', cat: 'sensing', shape: 'boolean', text: '手柄按下 %BTN ?',
    args: [{ name: 'BTN', kind: 'field', options: PAD_BUTTONS, def: '0' }] });
  def({ type: 'sensing_gamepadaxis', cat: 'sensing', shape: 'reporter', text: '手柄 %STICK 的 %DIR 值',
    args: [{ name: 'STICK', kind: 'field', options: [['左摇杆', 'left'], ['右摇杆', 'right']], def: 'left' },
           { name: 'DIR', kind: 'field', options: [['水平', 'h'], ['垂直', 'v']], def: 'h' }] });
  def({ type: 'sensing_gamepadname', cat: 'sensing', shape: 'reporter', text: '手柄名称' });
  def({ type: 'sensing_gamepadvibrate', cat: 'sensing', shape: 'stack', text: '手柄震动 强度 %I % 持续 %MS 毫秒',
    args: [{ name: 'I', kind: 'num', def: 100 }, { name: 'MS', kind: 'num', def: 200 }] });
  def({ type: 'event_whengamepadbutton', cat: 'events', shape: 'hat', text: '当按下手柄 %BTN 键',
    args: [{ name: 'BTN', kind: 'field', options: PAD_BUTTONS, def: '0' }] });

  /* ===== 运算 ===== */
  def({ type: 'operator_add', cat: 'operators', shape: 'reporter', text: '%A + %B',
    args: [{ name: 'A', kind: 'num', def: '' }, { name: 'B', kind: 'num', def: '' }] });
  def({ type: 'operator_subtract', cat: 'operators', shape: 'reporter', text: '%A - %B',
    args: [{ name: 'A', kind: 'num', def: '' }, { name: 'B', kind: 'num', def: '' }] });
  def({ type: 'operator_multiply', cat: 'operators', shape: 'reporter', text: '%A × %B',
    args: [{ name: 'A', kind: 'num', def: '' }, { name: 'B', kind: 'num', def: '' }] });
  def({ type: 'operator_divide', cat: 'operators', shape: 'reporter', text: '%A ÷ %B',
    args: [{ name: 'A', kind: 'num', def: '' }, { name: 'B', kind: 'num', def: '' }] });
  def({ type: 'operator_mod', cat: 'operators', shape: 'reporter', text: '%A 除以 %B 的余数',
    args: [{ name: 'A', kind: 'num', def: '' }, { name: 'B', kind: 'num', def: '' }] });
  def({ type: 'operator_round', cat: 'operators', shape: 'reporter', text: '将 %N 四舍五入',
    args: [{ name: 'N', kind: 'num', def: '' }] });
  def({ type: 'operator_mathop', cat: 'operators', shape: 'reporter', text: '%OP 的 %N',
    args: [{ name: 'OP', kind: 'field', options: [['绝对值', 'abs'], ['向下取整', 'floor'], ['向上取整', 'ceil'], ['平方根', 'sqrt'], ['sin', 'sin'], ['cos', 'cos'], ['tan', 'tan'], ['ln', 'ln'], ['log', 'log'], ['10^', 'pow10']], def: 'abs' }, { name: 'N', kind: 'num', def: '' }] });
  def({ type: 'operator_random', cat: 'operators', shape: 'reporter', text: '在 %FROM 到 %TO 之间取随机数',
    args: [{ name: 'FROM', kind: 'num', def: 1 }, { name: 'TO', kind: 'num', def: 10 }] });
  def({ type: 'operator_gt', cat: 'operators', shape: 'boolean', text: '%A > %B',
    args: [{ name: 'A', kind: 'text', def: '' }, { name: 'B', kind: 'text', def: '' }] });
  def({ type: 'operator_lt', cat: 'operators', shape: 'boolean', text: '%A < %B',
    args: [{ name: 'A', kind: 'text', def: '' }, { name: 'B', kind: 'text', def: '' }] });
  def({ type: 'operator_equals', cat: 'operators', shape: 'boolean', text: '%A = %B',
    args: [{ name: 'A', kind: 'text', def: '' }, { name: 'B', kind: 'text', def: '' }] });
  def({ type: 'operator_and', cat: 'operators', shape: 'boolean', text: '%A 且 %B',
    args: [{ name: 'A', kind: 'bool' }, { name: 'B', kind: 'bool' }] });
  def({ type: 'operator_or', cat: 'operators', shape: 'boolean', text: '%A 或 %B',
    args: [{ name: 'A', kind: 'bool' }, { name: 'B', kind: 'bool' }] });
  def({ type: 'operator_not', cat: 'operators', shape: 'boolean', text: '不成立 %A',
    args: [{ name: 'A', kind: 'bool' }] });
  def({ type: 'operator_join', cat: 'operators', shape: 'reporter', text: '连接 %A 和 %B',
    args: [{ name: 'A', kind: 'text', def: '苹果' }, { name: 'B', kind: 'text', def: '香蕉' }] });
  def({ type: 'operator_letter_of', cat: 'operators', shape: 'reporter', text: '%STR 的第 %N 个字符',
    args: [{ name: 'STR', kind: 'text', def: '世界' }, { name: 'N', kind: 'num', def: 1 }] });
  def({ type: 'operator_length', cat: 'operators', shape: 'reporter', text: '%STR 的长度',
    args: [{ name: 'STR', kind: 'text', def: '世界' }] });
  def({ type: 'operator_contains', cat: 'operators', shape: 'boolean', text: '%A 包含 %B ?',
    args: [{ name: 'A', kind: 'text', def: '' }, { name: 'B', kind: 'text', def: '' }] });
  def({ type: 'operator_indexof', cat: 'operators', shape: 'reporter', text: '%B 在 %A 中的位置',
    args: [{ name: 'B', kind: 'text', def: '' }, { name: 'A', kind: 'text', def: '' }] });

  /* ===== 变量 ===== */
  def({ type: 'data_setvariableto', cat: 'data', shape: 'stack', text: '将 %VAR 设为 %VALUE',
    args: [{ name: 'VAR', kind: 'field', dynamic: 'variables', creatable: true, def: '' }, { name: 'VALUE', kind: 'text', def: 0 }] });
  def({ type: 'data_changevariableby', cat: 'data', shape: 'stack', text: '将 %VAR 增加 %VALUE',
    args: [{ name: 'VAR', kind: 'field', dynamic: 'variables', creatable: true, def: '' }, { name: 'VALUE', kind: 'num', def: 1 }] });
  def({ type: 'data_showvariable', cat: 'data', shape: 'stack', text: '显示变量 %VAR',
    args: [{ name: 'VAR', kind: 'field', dynamic: 'variables', creatable: true, def: '' }] });
  def({ type: 'data_hidevariable', cat: 'data', shape: 'stack', text: '隐藏变量 %VAR',
    args: [{ name: 'VAR', kind: 'field', dynamic: 'variables', creatable: true, def: '' }] });
  def({ type: 'data_variable', cat: 'data', shape: 'reporter', text: '%VAR',
    args: [{ name: 'VAR', kind: 'field', dynamic: 'variables', creatable: true, def: '' }] });

  /* ===== 列表 ===== */
  def({ type: 'data_addtolist', cat: 'list', shape: 'stack', text: '将 %ITEM 加入 %LIST',
    args: [{ name: 'ITEM', kind: 'text', def: '东西' }, { name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }] });
  def({ type: 'data_deleteoflist', cat: 'list', shape: 'stack', text: '删除 %LIST 的第 %INDEX 项',
    args: [{ name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }, { name: 'INDEX', kind: 'num', def: 1 }] });
  def({ type: 'data_deletealloflist', cat: 'list', shape: 'stack', text: '删除 %LIST 的全部项目',
    args: [{ name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }] });
  def({ type: 'data_insertatlist', cat: 'list', shape: 'stack', text: '在 %LIST 的第 %INDEX 项前插入 %ITEM',
    args: [{ name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }, { name: 'INDEX', kind: 'num', def: 1 }, { name: 'ITEM', kind: 'text', def: '东西' }] });
  def({ type: 'data_replaceitemoflist', cat: 'list', shape: 'stack', text: '将 %LIST 的第 %INDEX 项替换为 %ITEM',
    args: [{ name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }, { name: 'INDEX', kind: 'num', def: 1 }, { name: 'ITEM', kind: 'text', def: '东西' }] });
  def({ type: 'data_itemoflist', cat: 'list', shape: 'reporter', text: '%LIST 的第 %INDEX 项',
    args: [{ name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }, { name: 'INDEX', kind: 'num', def: 1 }] });
  def({ type: 'data_itemnumoflist', cat: 'list', shape: 'reporter', text: '%ITEM 在 %LIST 中的编号',
    args: [{ name: 'ITEM', kind: 'text', def: '东西' }, { name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }] });
  def({ type: 'data_lengthoflist', cat: 'list', shape: 'reporter', text: '%LIST 的项目数',
    args: [{ name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }] });
  def({ type: 'data_listcontainsitem', cat: 'list', shape: 'boolean', text: '%LIST 包含 %ITEM ?',
    args: [{ name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }, { name: 'ITEM', kind: 'text', def: '东西' }] });
  def({ type: 'data_listastext', cat: 'list', shape: 'reporter', text: '%LIST 的文本',
    args: [{ name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }] });
  def({ type: 'data_showlist', cat: 'list', shape: 'stack', text: '显示列表 %LIST',
    args: [{ name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }] });
  def({ type: 'data_hidelist', cat: 'list', shape: 'stack', text: '隐藏列表 %LIST',
    args: [{ name: 'LIST', kind: 'field', dynamic: 'lists', creatable: true, def: '' }] });

  /* ===== 3D ===== */
  const GEO = [
    ['立方体', 'box'], ['球体', 'sphere'], ['圆柱体', 'cylinder'], ['圆锥体', 'cone'],
    ['圆环', 'torus'], ['平面', 'plane'], ['胶囊', 'capsule'], ['文字', 'text']
  ];
  def({ type: 'three_create', cat: 'three', shape: 'stack', text: '创建 %SHAPE 命名为 %NAME 颜色 %COLOR',
    args: [{ name: 'SHAPE', kind: 'field', options: GEO, def: 'box' },
           { name: 'NAME', kind: 'text', def: '物体1' },
           { name: 'COLOR', kind: 'color', def: '#4c97ff' }] });
  def({ type: 'three_createx', cat: 'three', shape: 'stack', text: '创建 %SHAPE 尺寸 %W %H %D 命名为 %NAME 颜色 %COLOR',
    args: [{ name: 'SHAPE', kind: 'field', options: GEO, def: 'box' },
           { name: 'W', kind: 'num', def: 1 }, { name: 'H', kind: 'num', def: 1 }, { name: 'D', kind: 'num', def: 1 },
           { name: 'NAME', kind: 'text', def: '物体1' },
           { name: 'COLOR', kind: 'color', def: '#4c97ff' }] });
  def({ type: 'three_createtext', cat: 'three', shape: 'stack', text: '创建文字 %TEXT 颜色 %COLOR 命名为 %NAME',
    args: [{ name: 'TEXT', kind: 'text', def: '你好' }, { name: 'COLOR', kind: 'color', def: '#ffffff' }, { name: 'NAME', kind: 'text', def: '文字1' }] });
  def({ type: 'three_createmodel', cat: 'three', shape: 'stack', text: '创建模型 %MODEL 命名为 %NAME',
    args: [{ name: 'MODEL', kind: 'field', dynamic: 'models', def: '' },
           { name: 'NAME', kind: 'text', def: '模型1' }] });
  def({ type: 'three_settexture', cat: 'three', shape: 'stack', text: '将 %OBJ 的贴图设为 %TEX',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' },
           { name: 'TEX', kind: 'field', dynamic: 'textures', def: '' }] });
  def({ type: 'three_ground', cat: 'three', shape: 'stack', text: '创建地面 大小 %S 颜色 %COLOR',
    args: [{ name: 'S', kind: 'num', def: 40 }, { name: 'COLOR', kind: 'color', def: '#8fbf6a' }] });
  def({ type: 'three_delete', cat: 'three', shape: 'stack', text: '删除 %OBJ',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' }] });
  def({ type: 'three_setpos', cat: 'three', shape: 'stack', text: '将 %OBJ 位置设为 x: %X y: %Y z: %Z',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' },
           { name: 'X', kind: 'num', def: 0 }, { name: 'Y', kind: 'num', def: 0 }, { name: 'Z', kind: 'num', def: 0 }] });
  def({ type: 'three_move', cat: 'three', shape: 'stack', text: '将 %OBJ 沿朝向移动 %N 步',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' }, { name: 'N', kind: 'num', def: 1 }] });
  def({ type: 'three_rotate', cat: 'three', shape: 'stack', text: '将 %OBJ 绕 %AXIS 轴旋转 %DEG 度',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' },
           { name: 'AXIS', kind: 'field', options: [['x', 'x'], ['y', 'y'], ['z', 'z']], def: 'y' },
           { name: 'DEG', kind: 'num', def: 15 }] });
  def({ type: 'three_setrot', cat: 'three', shape: 'stack', text: '将 %OBJ 旋转设为 x: %X y: %Y z: %Z',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' },
           { name: 'X', kind: 'num', def: 0 }, { name: 'Y', kind: 'num', def: 0 }, { name: 'Z', kind: 'num', def: 0 }] });
  def({ type: 'three_setscale', cat: 'three', shape: 'stack', text: '将 %OBJ 大小设为 %S',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' }, { name: 'S', kind: 'num', def: 1 }] });
  def({ type: 'three_setcolor', cat: 'three', shape: 'stack', text: '将 %OBJ 颜色设为 %COLOR',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' }, { name: 'COLOR', kind: 'color', def: '#ff6b6b' }] });
  def({ type: 'three_setvisible', cat: 'three', shape: 'stack', text: '%MODE %OBJ',
    args: [{ name: 'MODE', kind: 'field', options: [['显示', 'show'], ['隐藏', 'hide']], def: 'show' },
           { name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' }] });
  def({ type: 'three_setspeed', cat: 'three', shape: 'stack', text: '将 %OBJ 速度设为 x: %X y: %Y z: %Z',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' },
           { name: 'X', kind: 'num', def: 0 }, { name: 'Y', kind: 'num', def: 0 }, { name: 'Z', kind: 'num', def: 0 }] });
  def({ type: 'three_impulse', cat: 'three', shape: 'stack', text: '给 %OBJ 施加冲量 x: %X y: %Y z: %Z',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' },
           { name: 'X', kind: 'num', def: 0 }, { name: 'Y', kind: 'num', def: 5 }, { name: 'Z', kind: 'num', def: 0 }] });
  def({ type: 'three_setmode', cat: 'three', shape: 'stack', text: '将 %OBJ 设为 %MODE',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' },
           { name: 'MODE', kind: 'field', options: [['动态（受重力）', 'dynamic'], ['静态', 'static']], def: 'dynamic' }] });
  def({ type: 'three_setgravity', cat: 'three', shape: 'stack', text: '将重力设为 %G',
    args: [{ name: 'G', kind: 'num', def: -20 }] });
  def({ type: 'three_setbounce', cat: 'three', shape: 'stack', text: '将 %OBJ 弹性设为 %B',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' }, { name: 'B', kind: 'num', def: 0.5 }] });
  def({ type: 'three_camerafollow', cat: 'three', shape: 'stack', text: '相机跟随 %OBJ 距离 %D 高度 %H',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' }, { name: 'D', kind: 'num', def: 8 }, { name: 'H', kind: 'num', def: 4 }] });
  def({ type: 'three_camerapos', cat: 'three', shape: 'stack', text: '相机位置 x: %X y: %Y z: %Z 看向 x: %LX y: %LY z: %LZ',
    args: [{ name: 'X', kind: 'num', def: 0 }, { name: 'Y', kind: 'num', def: 5 }, { name: 'Z', kind: 'num', def: 10 },
           { name: 'LX', kind: 'num', def: 0 }, { name: 'LY', kind: 'num', def: 0 }, { name: 'LZ', kind: 'num', def: 0 }] });
  def({ type: 'three_cameralook', cat: 'three', shape: 'stack', text: '相机看向 %OBJ',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' }] });
  def({ type: 'three_firstperson', cat: 'three', shape: 'stack', text: '%MODE 第一人称控制 (WASD + 鼠标)',
    args: [{ name: 'MODE', kind: 'field', options: [['启用', 'on'], ['关闭', 'off']], def: 'on' }] });
  def({ type: 'three_cameramode', cat: 'three', shape: 'stack', text: '相机用 %MODE 投影 视野 %F',
    args: [{ name: 'MODE', kind: 'field', options: [['透视', 'perspective'], ['正交（等距）', 'ortho']], def: 'perspective' },
           { name: 'F', kind: 'num', def: 10 }] });
  def({ type: 'three_setbillboard', cat: 'three', shape: 'stack', text: '将 %OBJ 设为 %MODE 相机',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' },
           { name: 'MODE', kind: 'field', options: [['始终面向', 'on'], ['不面向', 'off']], def: 'on' }] });
  def({ type: 'three_setbg', cat: 'three', shape: 'stack', text: '将天空颜色设为 %COLOR',
    args: [{ name: 'COLOR', kind: 'color', def: '#87ceeb' }] });
  def({ type: 'three_addlight', cat: 'three', shape: 'stack', text: '添加 %KIND 光 强度 %I',
    args: [{ name: 'KIND', kind: 'field', options: [['环境', 'ambient'], ['平行', 'directional'], ['点', 'point']], def: 'ambient' },
           { name: 'I', kind: 'num', def: 0.8 }] });
  def({ type: 'three_fog', cat: 'three', shape: 'stack', text: '将雾浓度设为 %V 颜色 %COLOR',
    args: [{ name: 'V', kind: 'num', def: 0.02 }, { name: 'COLOR', kind: 'color', def: '#cfe6ff' }] });
  def({ type: 'three_pos', cat: 'three', shape: 'reporter', text: '%OBJ 的 %AXIS 坐标',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' },
           { name: 'AXIS', kind: 'field', options: [['x', 'x'], ['y', 'y'], ['z', 'z']], def: 'y' }] });
  def({ type: 'three_onground', cat: 'three', shape: 'boolean', text: '%OBJ 在地面上?',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' }] });
  def({ type: 'three_collide', cat: 'three', shape: 'boolean', text: '%A 碰到 %B ?',
    args: [{ name: 'A', kind: 'field', dynamic: 'objects3d', def: '' }, { name: 'B', kind: 'field', dynamic: 'objects3d', def: '' }] });
  def({ type: 'three_keycontrol', cat: 'three', shape: 'stack', text: '让 %OBJ 用 %KEYS 键移动 速度 %SPD',
    args: [{ name: 'OBJ', kind: 'field', dynamic: 'objects3d', def: '' },
           { name: 'KEYS', kind: 'field', options: [['WASD', 'wasd'], ['方向键', 'arrows'], ['WASD+方向键', 'both']], def: 'wasd' },
           { name: 'SPD', kind: 'num', def: 0.15 }] });

  /* ===== 应用 ===== */
  def({ type: 'app_alert', cat: 'app', shape: 'stack', text: '弹出提示 %MSG',
    args: [{ name: 'MSG', kind: 'text', def: '你好！' }] });
  def({ type: 'app_settitle', cat: 'app', shape: 'stack', text: '将窗口标题设为 %TITLE',
    args: [{ name: 'TITLE', kind: 'text', def: '我的作品' }] });
  def({ type: 'app_openurl', cat: 'app', shape: 'stack', text: '打开网址 %URL',
    args: [{ name: 'URL', kind: 'text', def: 'https://' }] });
  def({ type: 'app_log', cat: 'app', shape: 'stack', text: '输出日志 %MSG',
    args: [{ name: 'MSG', kind: 'text', def: '调试信息' }] });
  def({ type: 'app_setbg', cat: 'app', shape: 'stack', text: '将舞台背景色设为 %COLOR',
    args: [{ name: 'COLOR', kind: 'color', def: '#ffffff' }] });
  def({ type: 'app_savefile', cat: 'app', shape: 'stack', text: '保存文件 %NAME 内容 %TEXT',
    args: [{ name: 'NAME', kind: 'text', def: '导出.txt' }, { name: 'TEXT', kind: 'text', def: '内容' }] });
  def({ type: 'app_readfile', cat: 'app', shape: 'stack', text: '读取本地文件到变量 %VAR',
    args: [{ name: 'VAR', kind: 'field', dynamic: 'variables', creatable: true, def: '' }] });
  def({ type: 'app_fullscreen', cat: 'app', shape: 'stack', text: '切换全屏' });
  def({ type: 'app_restart', cat: 'app', shape: 'stack', text: '重新开始（清空所有变量）' });

  /* ---------- 索引 ---------- */
  const BY_TYPE = Object.create(null);
  DEFS.forEach(d => { BY_TYPE[d.type] = d; });

  const CAT_COLOR = Object.create(null);
  CATS.forEach(c => { CAT_COLOR[c.id] = c.color; });

  /* ---------- 工具函数 ---------- */
  function blocksOf(cat) {
    return DEFS.filter(d => d.cat === cat && !d.hidden);
  }

  /** 解析 text 模板 -> [{t:'label',v:'移动'},{t:'arg',v:argDef}] */
  function parseText(d) {
    const out = [];
    const argMap = Object.create(null);
    (d.args || []).forEach(a => { argMap[a.name] = a; });
    const parts = String(d.text).split(/(%[A-Z_0-9]+)/g);
    for (const p of parts) {
      if (!p) continue;
      const m = /^%([A-Z_0-9]+)$/.exec(p);
      if (m && argMap[m[1]]) out.push({ t: 'arg', arg: argMap[m[1]] });
      else out.push({ t: 'label', v: p });
    }
    return out;
  }

  global.EH5Blocks = {
    CATS, DEFS, BY_TYPE, CAT_COLOR, KEYS, GEO, PAD_BUTTONS,
    blocksOf, parseText,
    get: t => BY_TYPE[t],
    colorOf: t => {
      const d = BY_TYPE[t];
      return d ? (CAT_COLOR[d.cat] || '#888') : '#888';
    },
    /** 该积木是否为堆叠型（可接在 next 上） */
    isStack: t => {
      const d = BY_TYPE[t];
      return !!d && (d.shape === 'stack' || d.shape === 'hat' || d.shape === 'c' || d.shape === 'cap');
    },
    isHat: t => { const d = BY_TYPE[t]; return !!d && d.shape === 'hat'; },
    isReporter: t => { const d = BY_TYPE[t]; return !!d && (d.shape === 'reporter' || d.shape === 'boolean'); },
    isBoolean: t => { const d = BY_TYPE[t]; return !!d && d.shape === 'boolean'; },
    /** 新建一个积木节点 */
    make(type) {
      const d = BY_TYPE[type];
      if (!d) throw new Error('未知积木: ' + type);
      const node = { type, id: 'b' + Math.random().toString(36).slice(2, 9), inputs: {}, fields: {} };
      (d.args || []).forEach(a => {
        if (a.kind === 'field') {
          let v = a.def;
          if (a.dynamic && !v) v = '';
          node.fields[a.name] = v;
        } else if (a.kind === 'bool') {
          /* 布尔槽默认空 */
        } else {
          if (a.def !== undefined && a.def !== '') node.inputs[a.name] = a.def;
        }
      });
      if (d.branches) { node.branches = {}; d.branches.forEach(b => { node.branches[b] = null; }); }
      return node;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
