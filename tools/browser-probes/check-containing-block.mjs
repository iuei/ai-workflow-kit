import { chromium } from 'playwright';

/** 探针账号：从环境变量读取——通用工具里不该写死某个项目的演示口令。 */
const PROBE_USER = process.env.PROBE_USER;
const PROBE_PASS = process.env.PROBE_PASS;
if (!PROBE_USER || !PROBE_PASS) {
  console.error('缺少 PROBE_USER / PROBE_PASS：探针需要用被测系统的账号登录后才能取证。');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function run(username, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3211', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form');
  await page.locator('#login-username').click(); await page.keyboard.type(username);
  await page.locator('#login-password').click(); await page.keyboard.type(PROBE_PASS);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.topbar'); await page.waitForTimeout(1000);
  const d = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.topbar'));
    const ua = getComputedStyle(document.querySelector('.user-area'));
    return {
      topbar: {
        backdropFilter: cs.backdropFilter, webkitBackdropFilter: cs.webkitBackdropFilter,
        transform: cs.transform, filter: cs.filter, willChange: cs.willChange,
        contain: cs.contain, perspective: cs.perspective, position: cs.position, width: cs.width
      },
      userArea: { width: ua.width, padding: ua.padding, left: ua.left, right: ua.right, boxSizing: ua.boxSizing }
    };
  });
  console.log(`=== ${tag} (${username}) ===`);
  console.log('  .topbar 包含块触发属性:', JSON.stringify(d.topbar));
  console.log('  .user-area:', JSON.stringify(d.userArea));
  await ctx.close();
}
await run('admin', '普通用户');
await run(PROBE_USER, '管理员');
await browser.close();
