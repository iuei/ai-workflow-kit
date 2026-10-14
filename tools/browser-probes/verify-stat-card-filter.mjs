/**
 * 验证「点击概览卡 → 列表筛选」口径一致：卡片数字必须等于筛选后的列表条数。
 * 重点是被报障的「未签收」：筛选后不得混入「待填写快递单号」的占位单。
 *
 * 运行：PROBE_BASE=http://127.0.0.1:3211 node .probe/verify-stat-card-filter.mjs
 */
import { chromium } from 'playwright';

/** 探针账号：从环境变量读取——通用工具里不该写死某个项目的演示口令。 */
const PROBE_USER = process.env.PROBE_USER;
const PROBE_PASS = process.env.PROBE_PASS;
if (!PROBE_USER || !PROBE_PASS) {
  console.error('缺少 PROBE_USER / PROBE_PASS：探针需要用被测系统的账号登录后才能取证。');
  process.exit(2);
}


const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3211';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#login-form', { timeout: 15000 });
const fill = (selector, value) => page.locator(selector).evaluate((el, v) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
await fill('#login-username', PROBE_USER);
await fill('#login-password', PROBE_PASS);
await page.locator('sl-button[type="submit"]').click();
await page.waitForSelector('.app-frame', { timeout: 20000 });
await page.waitForTimeout(1200);

/** 读某张卡片的数字与列表当前条数、状态分布、URL 参数。 */
const readState = (label) => page.evaluate((cardLabel) => {
  const card = [...document.querySelectorAll('.stat-card')]
    .find((el) => el.querySelector('.stat-label')?.textContent.trim() === cardLabel);
  const toolbar = document.querySelector('.table-toolbar')?.textContent || '';
  const total = Number((toolbar.match(/共\s*(\d+)\s*票/) || [])[1] ?? -1);
  const statuses = [...document.querySelectorAll('tbody tr')]
    .map((row) => row.querySelector('.cell-status')?.textContent.trim() || '')
    .filter(Boolean);
  return {
    cardValue: card ? Number(card.querySelector('.stat-value').textContent.trim()) : null,
    cardActive: card ? card.classList.contains('active') : null,
    listTotal: total,
    pendingRows: statuses.filter((text) => text.includes('待填写快递单号')).length,
    rowCount: statuses.length,
    search: location.search
  };
}, label);

const initial = await readState('未签收');
check('概览卡「未签收」有数字', Number.isFinite(initial.cardValue), `${initial.cardValue}`);

// 点击「未签收」卡片
await page.locator('.stat-card', { has: page.locator('.stat-label', { hasText: '未签收' }) }).first().click();
await page.waitForTimeout(1500);
const unsigned = await readState('未签收');
check('点「未签收」后卡片进入选中态', unsigned.cardActive === true);
check('URL 写入 signed=false', unsigned.search.includes('signed=false'), unsigned.search);
check('列表条数 = 卡片数字（不再把待填写单号算进来）', unsigned.listTotal === unsigned.cardValue,
  `卡片 ${unsigned.cardValue} / 列表 ${unsigned.listTotal}`);
check('列表里不出现「待填写快递单号」的行', unsigned.pendingRows === 0, `${unsigned.pendingRows} 行`);

// 对照：点击「待填写单号」卡片
await page.locator('.stat-card', { has: page.locator('.stat-label', { hasText: '待填写单号' }) }).first().click();
await page.waitForTimeout(1500);
const pending = await readState('待填写单号');
check('点「待填写单号」列表条数 = 卡片数字', pending.listTotal === pending.cardValue, `卡片 ${pending.cardValue} / 列表 ${pending.listTotal}`);
check('该口径下列表确实全是待填写单号', pending.pendingRows === pending.rowCount && pending.rowCount > 0, `${pending.pendingRows}/${pending.rowCount} 行`);

// 对照：已签收
await page.locator('.stat-card', { has: page.locator('.stat-label', { hasText: '已签收' }) }).first().click();
await page.waitForTimeout(1500);
const signed = await readState('已签收');
check('点「已签收」列表条数 = 卡片数字', signed.listTotal === signed.cardValue, `卡片 ${signed.cardValue} / 列表 ${signed.listTotal}`);

// 对照：全部
await page.locator('.stat-card', { has: page.locator('.stat-label', { hasText: '全部物流单' }) }).first().click();
await page.waitForTimeout(1500);
const all = await readState('全部物流单');
check('点「全部物流单」列表条数 = 卡片数字', all.listTotal === all.cardValue, `卡片 ${all.cardValue} / 列表 ${all.listTotal}`);
check('未签收 + 待填写 + 已签收 = 全部', unsigned.cardValue + pending.cardValue + signed.cardValue === all.cardValue,
  `${unsigned.cardValue} + ${pending.cardValue} + ${signed.cardValue} = ${all.cardValue}`);

await page.screenshot({ path: '.probe/stat-card-unsigned-filter.png' });
await browser.close();

const failed = results.filter((item) => !item.pass);
console.log(`\n===== ${results.length - failed.length}/${results.length} 项通过 =====`);
if (failed.length) {
  console.log('失败项：\n' + failed.map((item) => `- ${item.name}`).join('\n'));
  process.exitCode = 1;
}
