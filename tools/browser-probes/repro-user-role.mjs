/**
 * 复现：用户管理 → 新增账号 → 点「角色」时弹窗被直接关闭。
 *
 * 抓取完整事件序列（click / sl-request-close / sl-after-hide / 焦点变化），
 * 用于定位「弹窗是被谁关掉的」，而不是靠猜。
 *
 * 用法：node .probe/repro-user-role.mjs
 */
import { chromium } from 'playwright';

/** 探针账号：从环境变量读取——通用工具里不该写死某个项目的演示口令。 */
const PROBE_USER = process.env.PROBE_USER;
const PROBE_PASS = process.env.PROBE_PASS;
if (!PROBE_USER || !PROBE_PASS) {
  console.error('缺少 PROBE_USER / PROBE_PASS：探针需要用被测系统的账号登录后才能取证。');
  process.exit(2);
}


const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleLines = [];
page.on('console', (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => consoleLines.push(`[pageerror] ${error.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#login-username', { timeout: 20000 });
await page.locator('#login-username').click();
await page.keyboard.type(PROBE_USER);
await page.locator('#login-password').click();
await page.keyboard.type(PROBE_PASS);
await page.locator('sl-button[type="submit"]').click();
await page.waitForSelector('.topbar', { timeout: 20000 });
await page.waitForTimeout(1200);

// 进入用户管理
await page.locator('[data-nav="users"]').click();
await page.waitForSelector('#create-user, #create-user-empty', { timeout: 15000 });
await page.waitForTimeout(600);

// 安装事件记录器（捕获阶段，能拿到被组件内部处理的原始事件）
await page.evaluate(() => {
  window.__events = [];
  const label = (node) => {
    if (!node || !node.tagName) return String(node);
    return `${node.tagName}${node.id ? `#${node.id}` : ''}${node.className && typeof node.className === 'string' ? `.${node.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')}` : ''}`;
  };
  for (const type of ['click', 'sl-request-close', 'sl-after-hide', 'sl-hide', 'sl-blur', 'focusout', 'focusin', 'keydown']) {
    document.addEventListener(type, (event) => {
      window.__events.push({
        type,
        target: label(event.target),
        detailSource: event.detail?.source || null,
        focus: label(document.activeElement),
        dialogOpen: document.querySelector('#user-create-modal')?.open ?? null
      });
    }, true);
  }
});

const state = async (step) => page.evaluate((name) => {
  const dialog = document.querySelector('#user-create-modal');
  const select = dialog?.querySelector('#create-user-role');
  const dropdown = select?.shadowRoot?.querySelector('sl-popup') || document.querySelector('sl-popup');
  return {
    步骤: name,
    弹窗存在: Boolean(dialog),
    弹窗open: dialog?.open ?? null,
    弹窗connected: dialog?.isConnected ?? null,
    角色select存在: Boolean(select),
    下拉可见: dropdown ? dropdown.getAttribute('active') !== null : null,
    焦点: document.activeElement?.tagName + (document.activeElement?.id ? `#${document.activeElement.id}` : '')
  };
}, step);

console.log('打开弹窗前:', JSON.stringify(await state('before')));

await page.locator('#create-user, #create-user-empty').first().click();
await page.waitForTimeout(800);
console.log('打开弹窗后:', JSON.stringify(await state('opened')));

// ① 点击角色下拉
await page.locator('#create-user-role').click();
await page.waitForTimeout(800);
const afterOpenDropdown = await state('click-select');
console.log('点击角色下拉后:', JSON.stringify(afterOpenDropdown));

// ② 选择某个角色（限定在新增账号弹窗内，否则会误匹配筛选区的同名选项）
const option = page.locator('#user-create-modal sl-option[value="admin"]').first();
const optionCount = await option.count();
console.log('下拉选项数量:', optionCount);
if (optionCount) {
  await option.click();
  await page.waitForTimeout(800);
  console.log('选择角色后:', JSON.stringify(await state('choose-option')));
}

console.log('\n===== 事件序列 =====');
const events = await page.evaluate(() => window.__events);
for (const event of events) {
  console.log(JSON.stringify(event));
}

console.log('\n===== 控制台输出 =====');
console.log(consoleLines.slice(-15).join('\n') || '(无)');

await page.screenshot({ path: '.probe/repro-user-role.png' });
console.log('\n截图：.probe/repro-user-role.png');
await browser.close();
