/**
 * 把 .probe/session-user-messages.jsonl 压缩成可通读的摘要视图 + 词频统计。
 *
 * 运行：node .probe/summarize-sessions.mjs
 * 输出：.probe/session-digest.txt（按会话分组的用户诉求序列）与控制台词频
 */
import fs from 'node:fs';
import path from 'node:path';

const input = path.resolve('.probe/session-user-messages.jsonl');
const digestFile = path.resolve('.probe/session-digest.txt');
const messages = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

/** 一条消息压成一行：去掉换行、折叠空白、截断。 */
const oneLine = (text, limit = 110) => text.replace(/\s+/g, ' ').trim().slice(0, limit);

const groups = new Map();
for (const item of messages) {
  const key = `${item.source}:${item.session}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(item);
}

const lines = [];
lines.push(`用户消息总数 ${messages.length}，会话数 ${groups.size}\n`);
for (const [key, items] of [...groups.entries()].sort((a, b) => (a[1][0].time || 0) - (b[1][0].time || 0))) {
  const first = items[0];
  const date = first.time ? new Date(first.time).toISOString().slice(0, 16).replace('T', ' ') : '(无时间)';
  lines.push(`\n## ${key.split(':')[0]} ${key.split(':')[1].slice(0, 46)} | ${date} | ${items.length} 条`);
  items.forEach((item, index) => {
    lines.push(`  ${String(index + 1).padStart(2)}. ${oneLine(item.text)}`);
  });
}
fs.writeFileSync(digestFile, lines.join('\n'));
console.log(`已写出 ${digestFile}（${lines.length} 行）`);

/** 词频：按「诉求类型」和「返工/摩擦信号」两组关键词统计出现的消息条数。 */
const buckets = {
  '修复/缺陷': ['修复', '报错', '错误', '失败', 'bug', '异常', '不生效', '没生效', '无效', '坏了'],
  '优化/重构': ['优化', '重构', '调整', '改进', '精简', '统一', '规范'],
  'UI/前端外观': ['UI', '界面', '样式', '布局', '字体', '颜色', '间距', '侧边栏', '顶栏', '按钮', '表格', '图标', '移动端', '窄屏'],
  '数据/同步/接口': ['同步', '数据', '接口', 'ERP', '快递100', '积加', '单号', '轨迹', '签收'],
  '返工信号': ['还是', '仍然', '没有成功', '不对', '不对齐', '又', '重新', '为什么', '之前', '依然', '却'],
  '流程要求': ['先给方案', '方案', '确认', '验证', '测试', '根因', '不要临时', '自查', '检查'],
  '隔离/环境': ['重启', '端口', '副本', '浏览器', '缓存', '并发', '会话'],
  '问询/调研': ['是什么', '为什么', '如何', '怎么', '能不能', '可以吗', '？', '?']
};
console.log('\n=== 关键词命中（消息条数 / 占比） ===');
for (const [name, words] of Object.entries(buckets)) {
  const hits = messages.filter((item) => words.some((word) => item.text.includes(word))).length;
  console.log(`  ${name.padEnd(14)} ${String(hits).padStart(4)} 条  ${(hits / messages.length * 100).toFixed(0)}%`);
}

/** 每条消息命中的关键词，便于定位典型样本。 */
const signals = {};
for (const item of messages) {
  const hit = Object.entries(buckets)
    .filter(([, words]) => words.some((word) => item.text.includes(word)))
    .map(([name]) => name);
  for (const name of hit) signals[name] = (signals[name] || 0) + 1;
}
