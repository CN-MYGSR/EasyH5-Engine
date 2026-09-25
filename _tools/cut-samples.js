// 把 model.js 中「内置示例工程」整段剪掉（示例改由 samples.js 提供）
const fs = require('fs');
const path = process.argv[2];
let s = fs.readFileSync(path, 'utf8');

const START = '  /* ============================================================\n     内置示例工程\n     ============================================================ */';
const END = '  /* ============================================================\n     工具：深拷贝 / 序列化';

const i = s.indexOf(START);
const j = s.indexOf(END);
if (i < 0) throw new Error('找不到起始标记');
if (j < 0) throw new Error('找不到结束标记');
if (j <= i) throw new Error('标记顺序异常');

const removed = s.slice(i, j);
if (removed.length < 500) throw new Error('要删除的区段太短，可能匹配错了: ' + removed.length);

s = s.slice(0, i) + '  /* 内置示例工程见 samples.js（在 EH5Model.SAMPLES 上注册） */\n\n' + s.slice(j);

// SAMPLES 定义改由外部注入
s = s.replace('  const SAMPLES = [];\n', '');
if (s.includes('const SAMPLES = [];')) throw new Error('SAMPLES 声明未删除');

const before = s.length;
s = s.replace('\n    SAMPLES\n  };', '\n    SAMPLES: []\n  };');
if (s.length === before) throw new Error('导出处的 SAMPLES 未替换');

fs.writeFileSync(path, s, 'utf8');
console.log('OK 删除', removed.length, '字符；剩余', s.length);
