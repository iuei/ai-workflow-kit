/**
 * 生产实例（默认 3000 端口）上的侧栏快速核验：只做只读检查，不新建/修改任何业务数据。
 * 用管理员演示账号登录，确认刷新后即可看到新框架。
 *
 * 运行：node .probe/sidebar-prod-check.mjs
 */
import { chromium } from 'playwright';

/** 探针账号：从环境变量读取——通用工具里不该写死某个项目的演示口令。 */
const PROBE_USER = process.env.PROBE_USER;
const PROBE_PASS = process.env.PROBE_PASS;
if (!PROBE_USER || !PROBE_PASS) {
  console.error('缺少 PROBE_USER / PROBE_PASS：探针需要用被测系统的账号登录后才能取证。');
  process.exit(2);
}


const BASE = process.env.PROD_BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
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
await page.waitForTimeout(1000);

const desktop = await page.evaluate(() => ({
  sidebarWidth: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
  workspaceX: Math.round(document.querySelector('.workspace').getBoundingClientRect().x),
  legacyTopbar: Boolean(document.querySelector('.topbar')),
  groups: [...document.querySelectorAll('.nav-label')].map((el) => el.textContent.trim()),
  icons: document.querySelectorAll('.nav-item .nav-icon').length,
  sidebarCssLoaded: [...document.styleSheets].some((sheet) => (sheet.href || '').includes('sidebar.css')),
  accountInFoot: Boolean(document.querySelector('.sidebar-foot #account-toggle'))
}));
console.log('桌面 1440：', JSON.stringify(desktop));
await page.screenshot({ path: '.probe/sidebar-prod-1440.png' });

await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(600);
await page.locator('#nav-toggle').click();
await page.waitForTimeout(500);
const narrow = await page.evaluate(() => ({
  drawerX: Math.round(document.querySelector('.sidebar').getBoundingClientRect().x),
  topbarHeight: Math.round(document.querySelector('.app-topbar').getBoundingClientRect().height),
  bodyNavOpen: document.body.classList.contains('nav-open'),
  noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
}));
console.log('窄屏 375：', JSON.stringify(narrow));
await page.screenshot({ path: '.probe/sidebar-prod-375.png' });

await browser.close();
