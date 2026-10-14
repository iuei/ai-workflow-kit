/**
 * 侧边栏重构：交互与可访问性验收。
 * 覆盖折叠（含记忆）、窄屏抽屉（三种关闭方式 + 焦点归还）、账号菜单定位、文字对比度。
 *
 * 运行：PROBE_BASE=http://127.0.0.1:3211 node .probe/sidebar-verify.mjs
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

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function login(page, username, password) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout: 15000 });
  const fill = (selector, value) => page.locator(selector).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await fill('#login-username', username);
  await fill('#login-password', password);
  await page.locator('sl-button[type="submit"]').click();
  await page.waitForSelector('.app-frame', { timeout: 20000 });
  await page.waitForTimeout(700);
}

/** 侧栏几何与可见性快照。 */
const snapshot = (page) => page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  };
  const visible = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).display !== 'none' : false;
  };
  const style = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { display: cs.display, position: cs.position };
  };
  const sidebar = document.querySelector('.sidebar');
  return {
    sidebar: box('.sidebar'),
    workspace: box('.workspace'),
    collapsed: document.querySelector('.app-frame')?.dataset.collapsed ?? null,
    stored: (() => { try { return localStorage.getItem('logistics.sidebar.collapsed'); } catch { return null; } })(),
    pressed: document.querySelector('#sidebar-collapse')?.getAttribute('aria-pressed') ?? null,
    collapseLabel: document.querySelector('#sidebar-collapse')?.getAttribute('aria-label') ?? null,
    collapseIconHidden: (() => {
      const icons = document.querySelectorAll('#sidebar-collapse .nav-icon');
      return [...icons].map((el) => getComputedStyle(el).display);
    })(),
    navTextVisible: visible('.nav-text'),
    navLabelVisible: visible('.nav-label'),
    accountTextVisible: visible('.account-text'),
    activeBar: document.querySelector('.nav-item.active .nav-bar')
      ? getComputedStyle(document.querySelector('.nav-item.active .nav-bar')).backgroundColor
      : null,
    navIconCount: document.querySelectorAll('.nav-item .nav-icon').length,
    navItemWidths: [...document.querySelectorAll('.nav-item')].map((el) => Math.round(el.getBoundingClientRect().width)),
    navItemHeights: [...new Set([...document.querySelectorAll('.nav-item')].map((el) => Math.round(el.getBoundingClientRect().height)))],
    /* 账号区布局：头像必须在文字左侧且垂直居中（曾经因为把三个元素全塞进 sl-button 的默认插槽，
       加上 line-height 被组件按 38px 撑开，头像跑到了文字上方） */
    accountLayout: (() => {
      const button = document.querySelector('#account-toggle');
      const avatar = button?.querySelector('sl-avatar');
      const text = button?.querySelector('.account-text');
      if (!button || !avatar || !text) return null;
      const b = button.getBoundingClientRect();
      const a = avatar.getBoundingClientRect();
      const t = text.getBoundingClientRect();
      return {
        avatarLeftOfText: a.right <= t.left + 1,
        avatarVerticallyCentered: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) <= 2,
        textLineHeight: getComputedStyle(text).lineHeight,
        buttonHeight: Math.round(b.height)
      };
    })(),
    scrimHidden: document.querySelector('#sidebar-scrim')?.hidden ?? null,
    bodyNavOpen: document.body.classList.contains('nav-open'),
    mobileTopbar: { box: box('.app-topbar'), style: style('.app-topbar') },
    navToggleExpanded: document.querySelector('#nav-toggle')?.getAttribute('aria-expanded') ?? null,
    mobileTopbarVisible: visible('.app-topbar'),
    groupLabels: [...document.querySelectorAll('.nav-label')].map((el) => el.textContent.trim()),
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth
  };
});

/* ============ 一、桌面端：布局、折叠与记忆（管理员） ============ */
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, PROBE_USER, PROBE_PASS);

  const initial = await snapshot(page);
  check('桌面侧栏宽 232px', initial.sidebar.w === 232, `${initial.sidebar.w}px`);
  check('内容区紧贴侧栏右侧（无重叠、无空档）', initial.workspace.x === initial.sidebar.w, `workspace.x=${initial.workspace.x}`);
  check('导航项各带一个图标', initial.navIconCount === 3, `${initial.navIconCount} 个`);
  check('导航项等高', initial.navItemHeights.length === 1, `${initial.navItemHeights.join('/')}px`);
  check('选中项有左侧指示条', initial.activeBar === 'rgb(37, 95, 206)', initial.activeBar || '(无)');
  check('分组为「工作台 + 系统管理」', initial.groupLabels.join('|') === '工作台|系统管理', initial.groupLabels.join('|'));
  check('账号区横向布局：头像在文字左侧且垂直居中', initial.accountLayout?.avatarLeftOfText === true && initial.accountLayout?.avatarVerticallyCentered === true, JSON.stringify(initial.accountLayout));
  check('账号按钮高度受控（未被文字行高撑高）', initial.accountLayout?.buttonHeight <= 52, `${initial.accountLayout?.buttonHeight}px`);
  check('桌面无横向滚动', initial.hScroll === false);
  check('桌面隐藏移动端顶栏', initial.mobileTopbarVisible === false);

  // 折叠：宽度有 200ms 过渡，等到真正落位再断言（固定 sleep 会偶发抢跑）
  await page.locator('#sidebar-collapse').click();
  await page.waitForFunction(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 72, null, { timeout: 4000 }).catch(() => {});
  const collapsed = await snapshot(page);
  check('折叠后侧栏宽 72px', collapsed.sidebar.w === 72, `${collapsed.sidebar.w}px`);
  check('折叠后内容区跟随左移', collapsed.workspace.x === 72, `workspace.x=${collapsed.workspace.x}`);
  check('折叠后文字 / 分组标题 / 账号名让位', !collapsed.navTextVisible && !collapsed.navLabelVisible && !collapsed.accountTextVisible);
  check('折叠后按钮 aria-pressed=true 且提示改「展开」', collapsed.pressed === 'true' && collapsed.collapseLabel === '展开侧边栏', `${collapsed.pressed} / ${collapsed.collapseLabel}`);
  check('折叠状态写入 localStorage', collapsed.stored === '1', String(collapsed.stored));
  await page.screenshot({ path: '.probe/sidebar-after-collapsed-1440.png' });

  // 刷新后保持折叠
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-frame', { timeout: 15000 });
  await page.waitForTimeout(600);
  const afterReload = await snapshot(page);
  check('刷新后仍保持折叠', afterReload.sidebar.w === 72 && afterReload.collapsed === 'true', `${afterReload.sidebar.w}px`);

  // 折叠态账号菜单不能溢出侧栏
  await page.locator('#account-toggle').click();
  await page.waitForTimeout(350);
  const menuBox = await page.evaluate(() => {
    const el = document.querySelector('#account-menu');
    const r = el.getBoundingClientRect();
    return { hidden: el.hidden, x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  });
  check('折叠态账号菜单可见且不溢出视口', menuBox.hidden === false && menuBox.x >= 0 && menuBox.right <= 1440 && menuBox.bottom <= 900,
    `x=${menuBox.x} right=${menuBox.right} bottom=${menuBox.bottom}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('Esc 关闭账号菜单并归还焦点', await page.evaluate(() => document.querySelector('#account-menu').hidden === true && document.activeElement?.id === 'account-toggle'));

  // 展开回去
  await page.locator('#sidebar-collapse').click();
  await page.waitForFunction(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 232, null, { timeout: 4000 }).catch(() => {});
  const expanded = await snapshot(page);
  check('再次点击恢复展开并清除记忆', expanded.sidebar.w === 232 && expanded.stored === '0', `${expanded.sidebar.w}px / stored=${expanded.stored}`);
  await page.screenshot({ path: '.probe/sidebar-after-expanded-1440.png' });

  /* 对比度：正文 ≥4.5:1，图形 / 大字号 ≥3:1 */
  const contrast = await page.evaluate(() => {
    const parse = (value) => (value.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    const luminance = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (fg, bg) => {
      const [a, b] = [luminance(parse(fg)), luminance(parse(bg))].sort((x, y) => y - x);
      return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
    };
    const background = (el) => {
      let node = el;
      while (node) {
        const color = getComputedStyle(node).backgroundColor;
        if (color && color !== 'rgba(0, 0, 0, 0)') return color;
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
    };
    const sample = (label, selector, colorProperty = 'color') => {
      const el = document.querySelector(selector);
      if (!el) return { label, ratio: null };
      return { label, ratio: ratio(getComputedStyle(el)[colorProperty], background(el)) };
    };
    return [
      sample('导航文字（未选中）', '.nav-item .nav-text'),
      sample('导航文字（选中）', '.nav-item.active .nav-text'),
      sample('分组标题', '.nav-label'),
      sample('账号姓名', '.account-name'),
      sample('角色标签', '.role-chip'),
      sample('数据新鲜度', '.sync-freshness'),
      sample('导航图标', '.nav-item .nav-icon'),
      sample('品牌副标题', '.brand-copy small')
    ];
  });
  for (const item of contrast) {
    const threshold = /图标|副标题|角色标签|分组标题/.test(item.label) ? 3 : 4.5;
    check(`对比度 ${item.label} ≥ ${threshold}:1`, item.ratio >= threshold, `${item.ratio}:1`);
  }

  await context.close();
}

/* ============ 二、普通用户：只看到工作台分组 ============ */
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, 'admin', PROBE_PASS);
  const member = await snapshot(page);
  check('普通用户导航只有 1 组 / 1 项', member.groupLabels.join('|') === '工作台' && member.navIconCount === 1, `${member.groupLabels.join('|')} / ${member.navIconCount} 项`);
  check('普通用户侧栏宽度与管理员一致', member.sidebar.w === 232, `${member.sidebar.w}px`);
  check('普通用户也显示底部账号区', member.accountTextVisible === true);

  // 折叠能力对普通用户同样可用
  await page.locator('#sidebar-collapse').click();
  await page.waitForFunction(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 72, null, { timeout: 4000 }).catch(() => {});
  const memberCollapsed = await snapshot(page);
  check('普通用户可折叠侧栏', memberCollapsed.sidebar.w === 72, `${memberCollapsed.sidebar.w}px`);
  await context.close();
}

/* ============ 三、窄屏 375：抽屉开合、焦点、滚动锁定 ============ */
{
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await login(page, PROBE_USER, PROBE_PASS);

  const closed = await snapshot(page);
  check('窄屏侧栏默认收起（在视口左侧之外）', closed.sidebar.x < 0, `x=${closed.sidebar.x}`);
  check('窄屏顶栏可见且高 56px', closed.mobileTopbarVisible === true && closed.mobileTopbar.box?.h === 56, `可见=${closed.mobileTopbarVisible} 高=${closed.mobileTopbar.box?.h}px`);
  check('窄屏遮罩默认隐藏', closed.scrimHidden === true);
  check('窄屏无横向滚动', closed.hScroll === false);

  // 打开抽屉
  await page.locator('#nav-toggle').click();
  await page.waitForTimeout(400);
  const opened = await snapshot(page);
  check('点汉堡后抽屉滑入', opened.sidebar.x === 0, `x=${opened.sidebar.x}`);
  check('抽屉打开后遮罩出现 + body 锁定滚动', opened.scrimHidden === false && opened.bodyNavOpen === true);
  check('汉堡按钮 aria-expanded=true', opened.navToggleExpanded === 'true');
  check('焦点移入抽屉（到关闭按钮）', await page.evaluate(() => document.activeElement?.id === 'sidebar-collapse'));
  check('抽屉关闭按钮显示为 ✕ 图标', opened.collapseIconHidden[0] === 'none' && opened.collapseIconHidden[1] === 'block', opened.collapseIconHidden.join('/'));
  await page.screenshot({ path: '.probe/sidebar-after-drawer-375.png' });

  // Esc 关闭 + 焦点归还
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const afterEsc = await snapshot(page);
  check('Esc 关闭抽屉并归还焦点到汉堡按钮', afterEsc.sidebar.x < 0 && afterEsc.bodyNavOpen === false
    && await page.evaluate(() => document.activeElement?.id === 'nav-toggle'));

  // 点遮罩关闭
  await page.locator('#nav-toggle').click();
  await page.waitForTimeout(400);
  await page.locator('#sidebar-scrim').click({ position: { x: 340, y: 400 } });
  await page.waitForTimeout(400);
  const afterScrim = await snapshot(page);
  check('点遮罩关闭抽屉', afterScrim.sidebar.x < 0 && afterScrim.scrimHidden === true);

  // 点导航项后自动收起
  await page.locator('#nav-toggle').click();
  await page.waitForTimeout(400);
  await page.locator('.nav-item[data-nav="list"]').click();
  await page.waitForTimeout(900);
  const afterNav = await snapshot(page);
  check('点导航项后抽屉自动收起', afterNav.bodyNavOpen === false && afterNav.sidebar.x < 0);

  // 窄屏抽屉内账号入口可达（账号区不再是顶栏那个按钮）
  await page.locator('#nav-toggle').click();
  await page.waitForTimeout(400);
  const drawerAccount = await page.evaluate(() => {
    const el = document.querySelector('#account-toggle');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), right: Math.round(r.right), visible: getComputedStyle(el).display !== 'none' };
  });
  check('窄屏抽屉内账号按钮完整可见', drawerAccount.visible && drawerAccount.x >= 0 && drawerAccount.right <= 375,
    `x=${drawerAccount.x} right=${drawerAccount.right}`);

  await context.close();
}

await browser.close();
const failed = results.filter((item) => !item.pass);
console.log(`\n===== ${results.length - failed.length}/${results.length} 项通过 =====`);
if (failed.length) {
  console.log('失败项：\n' + failed.map((item) => `- ${item.name}`).join('\n'));
  process.exitCode = 1;
}
