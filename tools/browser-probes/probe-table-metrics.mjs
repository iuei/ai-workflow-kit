/**
 * 探测：数据表格各列的真实渲染宽高。
 *
 * 目的：用实测数据判断列宽分配是否合理、行高由哪一列撑起，
 * 而不是靠猜（colgroup 的 width 在 table-layout: auto 下只是建议值）。
 *
 * 运行：node .probe/probe-table-metrics.mjs [viewportWidth...]
 * 说明：自己拉起临时服务 + 全新演示库，跑完清理，不影响 3000 端口的实例。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 探针账号：从环境变量读取——通用工具里不该写死某个项目的演示口令。 */
const PROBE_USER = process.env.PROBE_USER;
const PROBE_PASS = process.env.PROBE_PASS;
if (!PROBE_USER || !PROBE_PASS) {
  console.error('缺少 PROBE_USER / PROBE_PASS：探针需要用被测系统的账号登录后才能取证。');
  process.exit(2);
}


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PROBE_PORT || 3311);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(ROOT, 'data', `.probe-${PORT}.sqlite`);
const KEY_PATH = path.join(ROOT, 'data', `.probe-${PORT}.key`);
const SHOTS = path.join(ROOT, '.probe');

const { chromium } = await import('playwright');

for (const file of [DB_PATH, KEY_PATH, `${DB_PATH}-journal`]) rmSync(file, { force: true });
const server = spawn(process.execPath, ['src/server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB_PATH, SECRET_KEY_PATH: KEY_PATH },
  stdio: ['ignore', 'pipe', 'pipe']
});
const log = [];
server.stdout.on('data', (chunk) => log.push(String(chunk)));
server.stderr.on('data', (chunk) => log.push(String(chunk)));

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true;
    } catch { /* 等 */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

let browser;
try {
  if (!await waitForServer()) throw new Error(`服务启动失败：\n${log.join('')}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true });

  const widths = process.argv.slice(2).map(Number).filter(Boolean);
  const viewports = widths.length ? widths : [1440, 1280, 1920];

  for (const width of viewports) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#login-username', { timeout: 15000 });
    const demo = await page.$('#fill-demo');
    if (demo) await demo.click();
    else {
      await page.locator('#login-username').click();
      await page.keyboard.type(PROBE_USER);
      await page.locator('#login-password').click();
      await page.keyboard.type(PROBE_PASS);
    }
    await page.locator('#login-password').click();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.topbar', { timeout: 15000 });
    await page.waitForTimeout(1500);

    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector('.table-scroll');
      const table = scroller?.querySelector('table');
      if (!table) return null;

      /**
       * 关键文本在「不换行」时的真实渲染宽度。
       * 列宽要按这个值定，而不是按字符数估算——等宽字体的实际字宽取决于字体本身，
       * 12px 下并不等于 12 * 0.6。
       */
      const measure = (text, className) => {
        const probe = document.createElement('span');
        probe.className = className;
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
        probe.textContent = text;
        document.body.appendChild(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return Math.round(width * 100) / 100;
      };
      const texts = {
        '采购主值 PO2609013567 / LN2609184345': measure('PO2609013567 / LN2609184345', 'cell-strong'),
        '产品主值（2 个 ASIN）B0H68WJ4DH、B0H68V4G96': measure('B0H68WJ4DH、B0H68V4G96', 'cell-strong'),
        '产品主值（3 个 ASIN）B0H68WJ4DH、B0H68V4G96 等 3 个': measure('B0H68WJ4DH、B0H68V4G96 等 3 个', 'cell-strong'),
        '快递单号 EMS123456789CN': measure('EMS123456789CN', 'cell-strong'),
        '更新时间 2026/9/21 10:51:17': measure('2026/9/21 10:51:17', 'cell-time'),
        '更新时间（相对）3 分钟前': measure('3 分钟前', 'cell-time'),
        '产品辅助行 冯承豪 · VV:US · 亚马逊运营二部': measure('冯承豪 · VV:US · 亚马逊运营二部', 'muted'),
        '采购辅助行 CN → US-西岸仓 · 计划 1000 / 发货 1000 / 入库 0': measure('CN → US-西岸仓 · 计划 1000 / 发货 1000 / 入库 0', 'muted')
      };

      const headers = [...table.querySelectorAll('thead th')];
      const rows = [...table.querySelectorAll('tbody tr[data-id]')];

      /**
       * 某个单元格里主值实际占了几行。
       * 这是「列宽是否刚好放得下」的唯一判据——看列宽数字看不出来，
       * 差几个像素就会悄悄换成两行，行高随即被顶高。
       * 用 Range 的行矩形数而不是「高度 ÷ line-height」：这里的 line-height 是
       * 继承来的 normal，getComputedStyle 拿不到可直接相除的像素值。
       */
      const mainTextLines = (cellSelector) => rows.map((row) => {
        const cell = row.querySelector(cellSelector);
        const target = cell?.querySelector('.cell-strong') || cell?.querySelector('.cell-time');
        if (!target) return null;
        const range = document.createRange();
        range.selectNodeContents(target);
        const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
        return {
          lines: Math.max(1, tops.size),
          text: (target.textContent || '').trim().slice(0, 40)
        };
      });

      const columnDetails = {
        purchase: mainTextLines('.cell-purchase'),
        product: mainTextLines('.cell-product'),
        updated: mainTextLines('.cell-time')
      };

      /**
       * 决定性验证：把用户给的样例文本注入成一行真实表格行再测量。
       * 演示数据里不一定有「2 个 ASIN」或「PO + LN 双长号」的行，
       * 光比文本宽度和列宽还差最后一步——浏览器是否真的把它们排在一行。
       */
      const sampleRow = (() => {
        const probeRow = document.createElement('tr');
        const cells = [
          ['cell-purchase', '<div class="cell-strong">PO2609013567 / LN2609184345</div>'],
          ['cell-product', '<div class="cell-strong">B0H68WJ4DH、B0H68V4G96</div>'],
          ['cell-tracking', '<div class="cell-strong">EMS123456789CN</div>'],
          ['cell-status', ''],
          ['cell-event', ''],
          ['cell-time', '<span>2026/9/21 10:51:17</span>'],
          ['cell-action', '']
        ];
        for (const [className, html] of cells) {
          const td = document.createElement('td');
          td.className = className;
          td.innerHTML = html;
          probeRow.appendChild(td);
        }
        table.querySelector('tbody').appendChild(probeRow);

        const linesOf = (td) => {
          const target = td.querySelector('.cell-strong') || td.querySelector('span') || td;
          const range = document.createRange();
          range.selectNodeContents(target);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        };
        const result = {
          purchase: linesOf(probeRow.children[0]),
          product: linesOf(probeRow.children[1]),
          tracking: linesOf(probeRow.children[2]),
          updated: linesOf(probeRow.children[5]),
          widths: [...probeRow.children].map((td) => Math.round(td.getBoundingClientRect().width))
        };
        probeRow.remove();
        return result;
      })();

      const columns = headers.map((th, index) => {
        const cells = rows.map((row) => row.children[index]).filter(Boolean);
        // 单元格内容自然高度 vs 实际高度：判断这一列有没有被压缩
        const tallest = cells.reduce((max, cell) => Math.max(max, cell.scrollHeight), 0);
        return {
          title: th.textContent.trim(),
          width: Math.round(th.getBoundingClientRect().width),
          contentHeight: tallest,
          lines: cells.map((cell) => Math.round(cell.getBoundingClientRect().height))
        };
      });

      return {
        texts,
        columnDetails,
        sampleRow,
        viewport: window.innerWidth,
        workspace: Math.round(document.querySelector('.workspace')?.getBoundingClientRect().width || 0),
        card: Math.round(document.querySelector('.table-card')?.getBoundingClientRect().width || 0),
        scrollerClient: scroller.clientWidth,
        scrollerScroll: scroller.scrollWidth,
        horizontalScroll: scroller.scrollWidth > scroller.clientWidth + 1,
        tableWidth: Math.round(table.getBoundingClientRect().width),
        tableHeight: Math.round(table.getBoundingClientRect().height),
        thHeight: Math.round(headers[0]?.getBoundingClientRect().height || 0),
        rowHeights: rows.map((row) => Math.round(row.getBoundingClientRect().height)),
        columns
      };
    });

    if (!metrics) {
      console.log(`\n[${width}px] 未找到表格`);
      await page.close();
      continue;
    }

    console.log(`\n${'='.repeat(78)}`);
    console.log(`视口 ${width}px｜工作区 ${metrics.workspace}px｜卡片 ${metrics.card}px｜表格 ${metrics.tableWidth}px｜表头高 ${metrics.thHeight}px`);
    console.log(`滚动容器 client ${metrics.scrollerClient}px / scroll ${metrics.scrollerScroll}px｜横向滚动：${metrics.horizontalScroll ? '是' : '否'}`);
    console.log(`行高序列：${metrics.rowHeights.join(' / ')}px（表体合计 ${metrics.tableHeight}px）`);
    console.log('-'.repeat(78));
    console.log('列名'.padEnd(14) + '列宽'.padStart(8) + '内容高'.padStart(10) + '  各单元格高度');
    for (const column of metrics.columns) {
      console.log(
        column.title.padEnd(14)
        + String(column.width).padStart(6) + 'px'
        + String(column.contentHeight).padStart(8) + 'px'
        + '  ' + column.lines.join(' / ')
      );
    }
    const sum = metrics.columns.reduce((total, column) => total + column.width, 0);
    console.log('-'.repeat(78));
    console.log(`列宽合计 ${sum}px（表格 ${metrics.tableWidth}px，差 ${metrics.tableWidth - sum}px 为边框）`);
    console.log('-'.repeat(78));
    console.log('关键文本的单行渲染宽度（列宽 = 文本宽 + 28px 左右内边距）：');
    for (const [label, value] of Object.entries(metrics.texts)) {
      console.log(`  ${String(value).padStart(7)}px  →  列宽需 ${Math.ceil(value) + 28}px   ${label}`);
    }
    console.log('-'.repeat(78));
    console.log('样例文本注入真实表格行后的折行情况（1 = 一行放下）：');
    const sample = metrics.sampleRow || {};
    const sampleOut = [
      ['采购 / 仓', 'PO2609013567 / LN2609184345', sample.purchase, sample.widths?.[0]],
      ['产品', 'B0H68WJ4DH、B0H68V4G96', sample.product, sample.widths?.[1]],
      ['快递 / 运单', 'EMS123456789CN', sample.tracking, sample.widths?.[2]],
      ['更新', '2026/9/21 10:51:17', sample.updated, sample.widths?.[5]]
    ];
    for (const [label, text, lines, width] of sampleOut) {
      const ok = lines === 1 ? '✔' : '✘';
      console.log(`  ${ok} ${label.padEnd(10)} ${String(lines)}行  列宽 ${width}px   ${text}`);
    }
    console.log('-'.repeat(78));
    console.log('实际数据各行主值占几行（1 = 一行放下）：');
    for (const [name, label] of [['purchase', '采购 / 仓'], ['product', '产品'], ['updated', '更新']]) {
      const detail = metrics.columnDetails?.[name] || [];
      const summary = detail.map((item) => (item ? `${item.lines}行` : '—')).join(' ');
      console.log(`  ${label.padEnd(10)} ${summary}`);
      for (const item of detail) {
        if (item && item.lines > 1) console.log(`      ↳ 折行：${item.text}`);
      }
    }

    await page.screenshot({ path: path.join(SHOTS, `table-metrics-${width}.png`), fullPage: false });
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  if (!server.killed) server.kill('SIGTERM');
  for (const file of [DB_PATH, KEY_PATH, `${DB_PATH}-journal`]) rmSync(file, { force: true });
}
