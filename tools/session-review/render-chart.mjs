/**
 * 数据驱动生成概览图：读 .probe/session-stats.json，渲染成 HTML 再用真实 Chrome 截图。
 *
 * 为什么不用手写 HTML：图里的数字必须和报告一致；写死一次，下次重跑统计就对不上了。
 *
 * 运行：node render-chart.mjs
 * 前置：session-report.mjs 已跑过（产出 session-stats.json）；本机有 Chrome 与 playwright
 * 输出：.probe/session-report.png（报告里的 session-report.md 会引用它）
 */
import fs from 'node:fs';
import path from 'node:path';

const stats = JSON.parse(fs.readFileSync('.probe/session-stats.json', 'utf8'));
const outDir = path.resolve('.probe');
const htmlFile = path.join(outDir, 'session-report.html');
const pngFile = path.join(outDir, 'session-report.png');

const top = (list, n) => [...list].sort((a, b) => b.count - a.count).slice(0, n);
const pct = (count) => `${(count / stats.totalMessages * 100).toFixed(0)}%`;
const BAR_COLORS = { blue: '', warn: ' warn', red: ' red' };

function rows(items, colorKey) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return items.map((item) => {
    const width = Math.max(4, Math.round(item.count / max * 100));
    return `      <div class="row"><span class="name">${item.name}</span><span class="track"><span class="fill${BAR_COLORS[colorKey]}" style="width:${width}%"></span></span><span class="val">${item.count} · ${pct(item.count)}</span></div>`;
  }).join('\n');
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>AI 编码会话复盘</title>
<style>
  :root { --blue:#255fce; --blue-soft:#e9f1fe; --ink:#1b2a41; --text:#44536a; --muted:#64748b; --line:#e4e9f2; --warn:#b45309; --warn-soft:#fef3c7; --red:#b42318; }
  * { box-sizing: border-box; }
  body { margin:0; padding:34px 38px 30px; max-width:1120px; background:#f4f6fa; color:var(--text);
         font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { margin:0 0 4px; color:var(--ink); font-size:25px; letter-spacing:-.4px; }
  .sub { margin:0 0 22px; color:var(--muted); font-size:13px; }
  .cards { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:22px; }
  .card { padding:14px 16px; background:#fff; border:1px solid var(--line); border-radius:12px; }
  .card b { display:block; color:var(--ink); font-size:27px; line-height:1.15; font-variant-numeric:tabular-nums; }
  .card span { color:var(--muted); font-size:12px; }
  .card.hot b { color:var(--red); } .card.warm b { color:var(--warn); }
  .panels { display:grid; grid-template-columns:1.05fr 1fr; gap:16px; }
  .panel { padding:16px 18px 14px; background:#fff; border:1px solid var(--line); border-radius:12px; }
  .panel h2 { margin:0 0 12px; color:var(--ink); font-size:14px; }
  .panel h2 em { margin-left:6px; color:var(--muted); font-size:11px; font-style:normal; }
  .row { display:grid; grid-template-columns:118px 1fr 74px; align-items:center; gap:10px; margin-bottom:8px; }
  .row .name { color:var(--text); font-size:12px; }
  .track { display:block; height:15px; background:#f1f4f9; border-radius:4px; overflow:hidden; }
  .fill { display:block; height:100%; border-radius:4px; background:var(--blue); }
  .fill.warn { background:#e0a83a; } .fill.red { background:#d9534f; }
  .val { color:var(--muted); font-size:11px; text-align:right; font-variant-numeric:tabular-nums; }
  .foot { display:grid; grid-template-columns:1.05fr 1fr; gap:16px; margin-top:16px; }
  .note { padding:13px 16px; border-radius:12px; font-size:12px; line-height:1.7; }
  .note strong { color:var(--ink); }
  .note.blue { background:var(--blue-soft); border:1px solid #cfe0ff; }
  .note.warn { background:var(--warn-soft); border:1px solid #f5dfa3; }
  .tag { display:inline-block; margin-right:6px; padding:1px 7px; border-radius:999px; background:#fff; color:var(--blue); font-size:11px; font-weight:600; }
</style>
</head>
<body>
  <h1>AI 编码会话复盘</h1>
  <p class="sub">${stats.range.first} ~ ${stats.range.last} · DSH 与 Codex 全部会话 · 已剔除系统注入，只统计真实用户发言</p>

  <div class="cards">
    <div class="card"><b>${stats.totalSessions}</b><span>会话</span></div>
    <div class="card"><b>${stats.totalMessages}</b><span>用户消息</span></div>
    <div class="card"><b>${stats.projects.length}</b><span>项目</span></div>
    <div class="card hot"><b>${stats.frictionSessionRate}%</b><span>会话含摩擦信号</span></div>
    <div class="card warm"><b>${pct(stats.confirmOnly)}</b><span>纯确认/推进消息</span></div>
  </div>

  <div class="panels">
    <section class="panel">
      <h2>诉求类型<em>一条可命中多类</em></h2>
${rows(top(stats.categories, 7), 'blue')}
    </section>

    <section class="panel">
      <h2>摩擦信号<em>你在为这些反复付出时间</em></h2>
${rows(top(stats.frictions, 6), 'red')}
      <div class="row"><span class="name">会话消息数（中位 / P90）</span><span class="track"><span class="fill" style="width:26%"></span></span><span class="val">${stats.sessionLength.median} / ${stats.sessionLength.p90}</span></div>
    </section>
  </div>

  <div class="foot">
    <div class="note blue">
      <strong>你反复提的三件事</strong><br>
${top(stats.process, 3).map((item) => `      <span class="tag">${item.name} ${item.count}</span>`).join('\n')}<br>
      它们加起来超过消息总量的 1/5——说明你要的不是"更快"，而是"更可核对"。
    </div>
    <div class="note warn">
      <strong>最大的隐性成本</strong><br>
      ${stats.confirmOnly} 条纯确认消息（${pct(stats.confirmOnly)}）+ ${(stats.process.find((item) => item.name.includes('验证')) || {}).count || 0} 条验证追问 = <strong>你被当成了验收器</strong>。<br>
      这部分完全可以由「交付即附验收清单」消掉。
    </div>
  </div>
</body>
</html>
`;

fs.writeFileSync(htmlFile, html);

const { chromium } = await import('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(`file://${htmlFile}`);
await page.waitForTimeout(300);
const box = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.body.scrollHeight }));
await page.setViewportSize({ width: box.w, height: box.h });
await page.waitForTimeout(200);
await page.locator('body').screenshot({ path: pngFile });
await browser.close();
console.log(`已生成 ${htmlFile} 与 ${pngFile}（${box.w}×${box.h}）`);
