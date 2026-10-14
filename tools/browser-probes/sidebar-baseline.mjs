/**
 * 框架基线测量（可复用于任何「侧栏 / 顶栏 / 抽屉」布局）。
 * 多角色 × 四档视口，采集容器与导航项的布局几何并截图，用于改前改后对比。
 *
 * 运行：
 *   PROBE_USER=<管理员账号> PROBE_PASS=<口令> [PROBE_BASE=http://127.0.0.1:3000] node sidebar-baseline.mjs
 *   # 需要对比两个角色时额外给：PROBE_MEMBER_USER / PROBE_MEMBER_PASS
 * 输出：.probe/<PROBE_PREFIX>-<角色>-<视口>.png
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
/** 截图前缀：改造前 sidebar-before、改造后 sidebar-after，便于人工对比。 */
const PREFIX = process.env.PROBE_PREFIX || 'sidebar-before';
/** 两个角色：普通用户未单独提供时复用管理员账号（单角色系统可直接不填）。 */
const ACCOUNTS = [
  { username: process.env.PROBE_ADMIN_USER || PROBE_USER, password: process.env.PROBE_ADMIN_PASS || PROBE_PASS, tag: 'admin', label: '管理员' },
  { username: process.env.PROBE_MEMBER_USER || PROBE_USER, password: process.env.PROBE_MEMBER_PASS || PROBE_PASS, tag: 'member', label: '普通用户' }
];
const VIEWPORTS = [
  { width: 1920, height: 1000, tag: '1920' },
  { width: 1440, height: 900, tag: '1440' },
  { width: 1024, height: 800, tag: '1024' },
  { width: 375, height: 812, tag: '375' }
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];

for (const account of ACCOUNTS) {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    console.log(`[run] ${account.label} @ ${viewport.tag}`);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#login-form', { timeout: 15000 });
    const fill = async (selector, value) => {
      await page.locator(selector).evaluate((el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    };
    await fill('#login-username', account.username);
    await fill('#login-password', account.password);
    await page.locator('sl-button[type="submit"]').click();
    try {
      await page.waitForSelector('.app-frame', { timeout: 20000 });
    } catch (error) {
      const hint = await page.locator('#login-error').innerText().catch(() => '');
      const fieldError = await page.locator('#login-password-error').innerText().catch(() => '');
      await page.screenshot({ path: `.probe/sidebar-login-fail-${account.tag}-${viewport.tag}.png` });
      throw new Error(`登录失败 ${account.label}@${viewport.tag}: ${hint} ${fieldError}`);
    }
    await page.waitForTimeout(900);

    const data = await page.evaluate(() => {
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const style = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          position: cs.position, display: cs.display, flexDirection: cs.flexDirection,
          width: cs.width, gap: cs.gap, padding: cs.padding, background: cs.backgroundColor
        };
      };
      const frame = document.querySelector('.app-frame');
      const sidebar = document.querySelector('.sidebar');
      return {
        role: document.querySelector('.role-chip')?.textContent?.trim(),
        topbarClass: frame?.className,
        navLabel: document.querySelector('.nav-label')?.textContent?.trim() ?? null,
        navGroupLabels: [...document.querySelectorAll('.nav-label')].map((el) => el.textContent.trim()),
        navItems: [...document.querySelectorAll('.nav-item')].map((el) => ({
          text: el.textContent.trim(),
          box: box(el),
          paddingLeft: getComputedStyle(el.shadowRoot?.querySelector('[part="base"]') || el)?.paddingLeft ?? null,
          iconCount: el.querySelectorAll('svg').length
        })),
        frames: {
          sidebar: { box: box(sidebar), style: style('.sidebar') },
          brand: box(document.querySelector('.brand')),
          navLabel: box(document.querySelector('.nav-label')),
          nav: box(document.querySelector('.main-nav')),
          userArea: { box: box(document.querySelector('.sidebar-foot')), style: style('.sidebar-foot') },
          mobileTopbar: { box: box(document.querySelector('.app-topbar')), style: style('.app-topbar') },
          workspace: { box: box(document.querySelector('.workspace')), style: style('.workspace') }
        },
        sidebarCollapsed: frame?.dataset.collapsed ?? null,
        sidebarTransform: sidebar ? getComputedStyle(sidebar).transform : null,
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        firstHeading: document.querySelector('.page-heading h2')?.textContent?.trim() ?? null
      };
    });

    await page.screenshot({ path: `.probe/${PREFIX}-${account.tag}-${viewport.tag}.png` });
    await context.close();
    report.push({ account: account.label, viewport: viewport.tag, ...data });
  }
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
