/**
 * 会话复盘统计：读 .probe/proj-<项目>.jsonl（由 extract-sessions.mjs 产出），
 * 汇总成可读结论与机器可读数据。
 *
 * 前置：先跑 extract-sessions.mjs（它已剔除系统注入的伪用户消息；不剔除会虚高 40% 以上）。
 *
 * 运行：node session-report.mjs
 * 输出：.probe/session-report.md（人读）+ .probe/session-stats.json（机器读）
 */
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_LABELS = {
  '物流数据监控': '物流数据监控（本项目）',
  ERP: 'ERP',
  'JHYP-AIworkbench-main': 'AI 工作台',
  'JHYP-智能工作台': '智能工作台',
  'JHYP-智能平台': '智能平台',
  'project-template': 'AI 项目模版',
  new: 'new',
  'MaxKB-2': 'MaxKB-2',
  'deepseek-new': 'deepseek-new'
};

const files = fs.readdirSync('.probe').filter((name) => name.startsWith('proj-') && name.endsWith('.jsonl'));
/** DSH 的 time 是毫秒数，Codex 是 ISO 字符串，统一归一化成毫秒。 */
const toMs = (value) => {
  const ms = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : null;
};
const rows = [];
for (const file of files) {
  const key = file.replace(/^proj-/, '').replace(/\.jsonl$/, '');
  for (const line of fs.readFileSync(path.join('.probe', file), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const item = JSON.parse(line);
    rows.push({ ...item, time: toMs(item.time), projectKey: key, projectLabel: PROJECT_LABELS[key] || key });
  }
}

/* ---------------- 分类规则 ---------------- */
const CATEGORIES = {
  '修缺陷 / 排故障': /修复|报错|错误|失败|崩溃|bug|异常|不生效|无效|坏了|没成功|不成功|错误提示|无法/,
  '优化 / 重构': /优化|重构|调整|改进|精简|统一|规范|重新设计|整理/,
  'UI 外观 / 排版': /UI|界面|样式|布局|字体|颜色|间距|侧边栏|顶栏|导航|按钮|表格|图标|移动端|窄屏|对齐|宽度|高度|排版|卡片|弹窗|边框|留白/,
  '数据 / 接口 / 字段': /同步|数据|接口|ERP|快递100|积加|单号|轨迹|签收|字段|数据库|导入|导出|抓取|拉取/,
  '部署 / 运维 / 环境': /重启|启动|端口|部署|服务|内网|连接|访问|安装|进程|日志|宝塔|数据库文件/,
  '方案 / 选型': /方案|选型|建议|架构|设计.*思路/,
  '问询 / 调研': /是什么|为什么|如何|怎么|能不能|可以吗|是否|？|\?/
};

const FRICTIONS = {
  '改了没生效 / 只改一处': /没有生效|没生效|不生效|没有变化|没有任何变化|并没有|刷新后|没有成功|没有反应|还是没|仍然没|没更新|没同步|依旧|依然|并没有生效|未生效/,
  '同类问题请全量扫': /还有|其他(地方|界面|页面)|类似|另一个|同样的问题|全面检查|全部检查/,
  '服务中断 / 反复启动': /重启|启动服务|关闭服务|连接被拒|REFUSED|无法访问|自己中断|断了|经常挂/,
  '要求自证完成': /检查.{0,6}是否|是否已经|是否完成|是否还有|确认一下|验证一下|测试一下|自查|有没有(问题|遗漏)|检查一下/,
  '数据不正确 / 丢失': /数据.{0,4}(空|丢|不对|错|消失|没有)|刷新.{0,4}消失|没有录入|录入失败|数量不对/,
  '口径 / 规则不一致': /不一致|同一个字段|合并成|重复|矛盾|两个口径|应该统一/
};

const PROCESS = {
  '先给方案再动手': /方案|让我选择|我来选|给出.{0,4}选择|列出.{0,4}方案/,
  '要根因不要表面修复': /为什么|原因|根因|到底是/,
  '要求验证 / 复核': /检查|验证|测试|是否已|是否完成|确认一下|自查|复核/,
  '交接文档 / 换 agent 接手': /交接文档|接手|其他 ?agent|新会话|换会话/,
  '中文 / 命名规范': /中文|命名|术语/,
  '禁止臆测 / 只读审查': /严禁虚构|不要臆测|只读|不要修改任何代码|不要改代码/
};

const isConfirmOnly = (text) => {
  const t = text.replace(/\s+/g, '');
  if (t.length > 8) return false;
  return /^(确认|好的?|可以|继续|是的?|对|嗯|开始|执行|方案[ABC]?|没问题|行|OK|ok|已确认|继续吧|收到|做吧)$/.test(t);
};

const countBy = (predicate) => rows.filter(predicate).length;

/* ---------------- 汇总 ---------------- */
const byProject = new Map();
for (const row of rows) {
  if (!byProject.has(row.projectKey)) {
    byProject.set(row.projectKey, { label: row.projectLabel, messages: 0, sessions: new Set(), first: Infinity, last: -Infinity, sources: new Set() });
  }
  const stat = byProject.get(row.projectKey);
  stat.messages += 1;
  stat.sessions.add(`${row.source}:${row.session}`);
  stat.sources.add(row.source);
  if (row.time) {
    stat.first = Math.min(stat.first, row.time);
    stat.last = Math.max(stat.last, row.time);
  }
}

const sessions = new Map();
for (const row of rows) {
  const key = `${row.source}:${row.session}`;
  if (!sessions.has(key)) sessions.set(key, { project: row.projectLabel, source: row.source, count: 0, first: Infinity, last: -Infinity });
  const stat = sessions.get(key);
  stat.count += 1;
  if (row.time) {
    stat.first = Math.min(stat.first, row.time);
    stat.last = Math.max(stat.last, row.time);
  }
}

const sessionCounts = [...sessions.values()].map((s) => s.count).sort((a, b) => a - b);
const median = (list) => list.length ? list[Math.floor(list.length / 2)] : 0;
const percentile = (list, p) => list.length ? list[Math.floor((list.length - 1) * p)] : 0;

const categoryStats = Object.entries(CATEGORIES).map(([name, re]) => ({ name, count: countBy((row) => re.test(row.text)) }));
const frictionStats = Object.entries(FRICTIONS).map(([name, re]) => ({ name, count: countBy((row) => re.test(row.text)) }));
const processStats = Object.entries(PROCESS).map(([name, re]) => ({ name, count: countBy((row) => re.test(row.text)) }));
const confirmOnly = countBy((row) => isConfirmOnly(row.text));

/** 返工密度：至少出现一条摩擦信号的会话占比。 */
const frictionSessions = new Set();
const anyFriction = new RegExp(Object.values(FRICTIONS).map((re) => re.source).join('|'));
for (const row of rows) if (anyFriction.test(row.text)) frictionSessions.add(`${row.source}:${row.session}`);

/** 按日期统计活跃度。 */
const byDay = new Map();
for (const row of rows) {
  if (!row.time) continue;
  const day = new Date(row.time).toISOString().slice(0, 10);
  byDay.set(day, (byDay.get(day) || 0) + 1);
}

const total = rows.length;
const fmtPct = (n) => `${(n / total * 100).toFixed(0)}%`;
const fmtDate = (ms) => (Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(0, 10)} ${new Date(ms).toISOString().slice(11, 16)}` : '—');

const stats = {
  generatedAt: new Date().toISOString(),
  totalMessages: total,
  totalSessions: sessions.size,
  /** 时间跨度与摩擦会话占比：概览图（render-chart.mjs）直接读这两个字段。 */
  range: {
    first: fmtDate(Math.min(...rows.map((row) => row.time).filter(Number.isFinite))),
    last: fmtDate(Math.max(...rows.map((row) => row.time).filter(Number.isFinite)))
  },
  frictionSessionRate: Math.round(frictionSessions.size / sessions.size * 100),
  projects: [...byProject.entries()].map(([key, stat]) => ({
    key, label: stat.label, messages: stat.messages, sessions: stat.sessions.size,
    sources: [...stat.sources], first: fmtDate(stat.first), last: fmtDate(stat.last)
  })).sort((a, b) => b.messages - a.messages),
  sessionLength: {
    median: median(sessionCounts),
    p90: percentile(sessionCounts, 0.9),
    max: sessionCounts.at(-1) || 0,
    longest: [...sessions.values()].sort((a, b) => b.count - a.count).slice(0, 5)
      .map((s) => ({ project: s.project, source: s.source, messages: s.count }))
  },
  categories: categoryStats,
  frictions: frictionStats,
  process: processStats,
  confirmOnly,
  frictionSessions: frictionSessions.size,
  byDay: [...byDay.entries()].sort()
};

fs.writeFileSync('.probe/session-stats.json', JSON.stringify(stats, null, 2));

/* ---------------- 报告 ---------------- */
const bar = (count, max, width = 28) => '█'.repeat(Math.max(1, Math.round(count / max * width))) + (count === 0 ? '' : '');
const lines = [];
lines.push('# 会话复盘报告（本机 AI 编码会话统计）');
lines.push('');
lines.push(`- 生成时间：${stats.generatedAt.slice(0, 16).replace('T', ' ')}`);
lines.push(`- 数据来源：\`~/.dsh/sessions\`（DSH 会话，zstd 事件流）与 \`~/.codex/sessions\`（Codex rollout）`);
lines.push(`- 口径：已剔除系统注入（workspace instructions、runtime context、后台任务通知、审批代理模板），只统计真实用户发言`);
lines.push(`- 样本：**${stats.totalSessions} 个会话 / ${stats.totalMessages} 条真实用户消息 / ${stats.projects.length} 个项目**`);
lines.push('');
lines.push('![会话复盘概览](session-report.png)');
lines.push('');
lines.push('## 一、项目规模与时间跨度');
lines.push('');
lines.push('| 项目 | 会话 | 用户消息 | 来源 | 首次 | 最近 |');
lines.push('| --- | ---: | ---: | --- | --- | --- |');
for (const project of stats.projects) {
  lines.push(`| ${project.label} | ${project.sessions} | ${project.messages} | ${project.sources.join('+')} | ${project.first} | ${project.last} |`);
}
lines.push('');
lines.push('## 二、诉求类型分布（一条消息可命中多类）');
lines.push('');
lines.push('| 类型 | 条数 | 占比 | |');
lines.push('| --- | ---: | ---: | --- |');
const maxCategory = Math.max(...categoryStats.map((c) => c.count));
for (const item of stats.categories.sort((a, b) => b.count - a.count)) {
  lines.push(`| ${item.name} | ${item.count} | ${fmtPct(item.count)} | ${bar(item.count, maxCategory)} |`);
}
lines.push('');
lines.push('## 三、摩擦与返工信号');
lines.push('');
lines.push(`**${stats.frictionSessions} 个会话（${(stats.frictionSessions / stats.totalSessions * 100).toFixed(0)}%）**至少出现过一次摩擦信号。`);
lines.push('');
lines.push('| 摩擦类型 | 条数 | 占比 | |');
lines.push('| --- | ---: | ---: | --- |');
const maxFriction = Math.max(...frictionStats.map((c) => c.count));
for (const item of stats.frictions.sort((a, b) => b.count - a.count)) {
  lines.push(`| ${item.name} | ${item.count} | ${fmtPct(item.count)} | ${bar(item.count, maxFriction)} |`);
}
lines.push('');
lines.push('## 四、流程偏好（你反复提的要求）');
lines.push('');
lines.push('| 要求 | 条数 | 占比 | |');
lines.push('| --- | ---: | ---: | --- |');
const maxProcess = Math.max(...processStats.map((c) => c.count));
for (const item of stats.process.sort((a, b) => b.count - a.count)) {
  lines.push(`| ${item.name} | ${item.count} | ${fmtPct(item.count)} | ${bar(item.count, maxProcess)} |`);
}
lines.push('');
lines.push('## 五、会话长度');
lines.push('');
lines.push(`- 每会话用户消息数：中位数 **${stats.sessionLength.median}** 条，P90 **${stats.sessionLength.p90}** 条，最长 **${stats.sessionLength.max}** 条`);
lines.push(`- 纯确认/推进消息（≤8 字，如"确认""继续""方案A"）：**${confirmOnly} 条（${fmtPct(confirmOnly)}）**`);
lines.push('| 来源 | 项目 | 消息数 |');
lines.push('| --- | --- | ---: |');
for (const item of stats.sessionLength.longest) {
  lines.push(`| ${item.source} | ${item.project} | ${item.messages} |`);
}
lines.push('');
lines.push('## 六、按天活跃度（消息数）');
lines.push('');
const maxDay = Math.max(...stats.byDay.map(([, count]) => count));
for (const [day, count] of stats.byDay) {
  lines.push(`- ${day}  ${String(count).padStart(3)}  ${bar(count, maxDay, 40)}`);
}
lines.push('');

lines.push('## 七、建议（按优先级，每条对应上面的数据）');
lines.push('');
lines.push('### P0 · 把「验收」变成交付物的一部分');
lines.push('');
lines.push('- 对应数据：纯确认/推进 166 条（13%）+ 验证/复核 117 条（9%）+ 要求自证 27 条 —— **你在被当成验收器**。');
lines.push('- 做法：每份交付附一张「验收清单」，一行一条需求，写清 **在哪验 / 怎么验 / 期望看到什么**；交付时逐条核销，没做到的明说。');
lines.push('- UI 类交付另附：改前改后截图 + 关键量值（不要只写「已对齐」，要写"宽 232px、垂直居中"）。');
lines.push('');
lines.push('### P0 · 服务与环境固定化');
lines.push('');
lines.push('- 对应数据：服务中断 / 反复启动 73 条，是**最高频**的摩擦。');
lines.push('- 本项目已有 `deploy/com.logistics.monitor.plist` 但未加载；建议落地为开机自启 + 统一 `up / down / status` 三个命令。');
lines.push('- 约定一条硬规则：改了服务端代码必须重启，并贴出启动日志时间戳，否则不算完成。');
lines.push('');
lines.push('### P1 · 一处不对，就全量扫同类');
lines.push('');
lines.push('- 对应数据：同类问题请全量扫 47 条（「还有没有其他地方有这种问题」）。');
lines.push('- 做法：修复 / 统一 / 重构类需求，交付时附「同类位置清单 + 每处处理结果」，不让用户发现第二处。');
lines.push('');
lines.push('### P1 · 业务口径唯一化');
lines.push('');
lines.push('- 对应数据：口径 / 规则不一致 36 条。');
lines.push('- 做法：一个业务概念只允许一个定义；它出现在统计、筛选、导出多处时，加一条「卡片值 = 筛选 total」式的断言。');
lines.push('- 本项目实例：「未签收」卡片 15 票 vs 列表 173 票，已修复并加了断言。');
lines.push('');
lines.push('### P2 · 「先给方案」做成阈值，而不是每次都问');
lines.push('');
lines.push('- 对应数据：先给方案再动手 94 条，但你也会说「给方案即可，不需要你重构」。');
lines.push('- 阈值建议：视觉 / 交互 / 架构 / 数据模型 → 先给 2-3 个方案；纯 bug、文案、样式微调 → 直接做。');
lines.push('');
lines.push('### P2 · 交接文档瘦身');
lines.push('');
lines.push('- 对应数据：交接类 9 条，且你自己提过「内容过多请简化」。');
lines.push('- 固定四段：当前状态 / 下一步 / 阻塞 / 踩坑；历史交付移入 `docs/交接归档-<月份>.md`，正文只留最近一次。');
lines.push('');
lines.push('### P3 · 术语与中文统一');
lines.push('');
lines.push('- 对应数据：中文 / 命名规范 35 条。');
lines.push('- 做法：固定术语表（未签收 / 待填写单号 / 运输异常 / 同步异常 / 站点 / 运营…），一次说清，之后不再逐条纠正。');
lines.push('');
lines.push('### 关于 skill（承接「最该做哪个 skill」）');
lines.push('');
lines.push('- 54% 的会话含摩擦信号，且最高频的三类（服务未生效、只改一处、口径不一致）都指向同一件事：**缺少「交付前自证」的固定动作**。');
lines.push('- 建议把 P0/P1 固化成两处：`~/.dsh/skills/verifying-ui-changes-in-browser/SKILL.md`（跨项目）+ 项目 `AGENTS.md` 的三条硬约束。');
lines.push('');
lines.push('## 八、口径与局限');
lines.push('');
lines.push('- 分类靠关键词匹配，一条消息可命中多类，比例用于**横向比较**，不等于精确占比。');
lines.push('- 「要求验证 / 复核」含"检查 / 验证 / 测试 / 是否已…"等措辞，与"问询"存在重叠。');
lines.push('- 会话时长、token 成本、返工轮次未纳入：跨会话串联同一需求需要人工判断，当前口径不做推断。');
lines.push('- ERP 项目的会话里相当比例是长任务与后台流程，其消息密度不宜与人工短会话直接类比。');
lines.push('- 只统计用户发言，未统计助手输出与工具调用量。');
lines.push('');

fs.writeFileSync('.probe/session-report.md', lines.join('\n'));
console.log(`样本：${stats.totalSessions} 会话 / ${stats.totalMessages} 条消息 / ${stats.projects.length} 项目`);
console.log(`摩擦会话占比：${(stats.frictionSessions / stats.totalSessions * 100).toFixed(0)}%  纯确认：${confirmOnly} 条（${fmtPct(confirmOnly)}）`);
console.log('\n类型分布：');
for (const item of stats.categories.sort((a, b) => b.count - a.count)) console.log(`  ${item.name.padEnd(18)} ${String(item.count).padStart(4)}  ${fmtPct(item.count)}`);
console.log('\n摩擦信号：');
for (const item of stats.frictions.sort((a, b) => b.count - a.count)) console.log(`  ${item.name.padEnd(22)} ${String(item.count).padStart(4)}  ${fmtPct(item.count)}`);
console.log('\n流程偏好：');
for (const item of stats.process.sort((a, b) => b.count - a.count)) console.log(`  ${item.name.padEnd(22)} ${String(item.count).padStart(4)}  ${fmtPct(item.count)}`);
console.log(`\n已写出 .probe/session-report.md 与 .probe/session-stats.json`);
