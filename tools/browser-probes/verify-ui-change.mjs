// 前端改动取证：多角色 × 多视口，采几何 + 计算样式并截图；运行方式见下一步的命令。
import { chromium } from 'playwright';
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3000';
const PREFIX = process.env.PROBE_PREFIX || 'after';
const SELECTORS = (process.env.PROBE_SELECTORS || '.app-topbar,.sidebar,.workspace').split(',');
const VIEWPORTS = (process.env.PROBE_VIEWPORTS || '1920,1440,1024,375').split(',').map(Number);
const ACCOUNTS = [
  { tag: 'admin', user: process.env.PROBE_ADMIN_USER, pass: process.env.PROBE_ADMIN_PASS },
  { tag: 'member', user: process.env.PROBE_MEMBER_USER, pass: process.env.PROBE_MEMBER_PASS }
].filter((account) => account.user && account.pass);
if (!ACCOUNTS.length) {
  console.error('缺少探针账号：至少给一组 PROBE_ADMIN_USER / PROBE_ADMIN_PASS（要对比角色再加 MEMBER 一组）');
  process.exit(2);
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const rows = [];
for (const account of ACCOUNTS) {
  for (const width of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#login-form', { timeout: 15000 });
    const fill = (selector, value) => page.locator(selector).evaluate((el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await fill('#login-username', account.user);
    await fill('#login-password', account.pass);
    await page.locator('sl-button[type="submit"]').click();
    await page.waitForSelector('.app-frame', { timeout: 20000 });
    // 等条件成立，而不是固定 sleep（案例 T2：过渡动画会让固定等待随机假红）
    await page.waitForFunction((selector) => Boolean(document.querySelector(selector.split('>>>')[0].trim())), SELECTORS[0], { timeout: 10000 });
    const metrics = await page.evaluate((selectors) => selectors.map((raw) => {
      const [host, inner] = raw.split('>>>').map((part) => part.trim());
      const base = document.querySelector(host);
      const el = inner ? base?.shadowRoot?.querySelector(inner) : base;
      if (!el) return { selector: raw, missing: true };
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        selector: raw,
        x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height),
        display: style.display, position: style.position, flexWrap: style.flexWrap,
        backdropFilter: style.backdropFilter, fontVariantNumeric: style.fontVariantNumeric,
        heightVar: style.getPropertyValue('--sl-input-height-medium').trim()
      };
    }), SELECTORS);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: `.probe/ui-${PREFIX}-${account.tag}-${width}.png` });
    rows.push({ account: account.tag, width, overflow, metrics });
    await context.close();
  }
}
await browser.close();
console.log(JSON.stringify(rows, null, 1));
const overflowRows = rows.filter((row) => row.overflow);
if (overflowRows.length) { console.error(`横向溢出：${overflowRows.map((row) => `${row.account}@${row.width}`).join(' ')}`); process.exit(1); }
