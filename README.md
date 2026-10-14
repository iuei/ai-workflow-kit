# AI 工作流工具包

> 从 2026-06-18 ~ 2026-10-13 的 **194 个 AI 编码会话 / 1369 条真实用户发言 / 12 个项目**里复盘出来的、
> 真正被反复用到的文档、技能与工具。每一项都标注 **作用** 与 **使用说明**。

---

## 为什么是这几样（筛选依据）

复盘本机全部 DSH + Codex 会话（剔除系统注入后统计，脚本见 `tools/session-review/`）得到三条结论：

| 结论 | 数据 |
| --- | --- |
| 摩擦面很宽 | **51% 的会话**至少出现过一次摩擦信号 |
| 你被当成验收器 | 纯确认/推进消息 170 条（12%）+ 验证类追问 173 条（13%） |
| 最高频的坑不是"改错"，而是"没生效" | 服务中断/反复启动 73 条、同类问题要全量扫 47 条、口径不一致 13 条 |

所以这个包里只放三类东西：**能消掉这些摩擦的规则与技能**、**能取证的工具**、**能沉淀经验的模板与案例**。
没放进来的（一次性探针、项目业务脚本）都不具备跨项目复用价值。

---

## 内容清单

| 目录 | 是什么 | 什么时候用 |
| --- | --- | --- |
| `skills/` | 可直接装入 AI 运行时的技能 | 每次改 UI / 交付前的自证动作 |
| `tools/session-review/` | 会话复盘流水线（4 个脚本：提取 → 摘要 → 统计 → 出图） | 每月一次，量化协作摩擦 |
| `tools/browser-probes/` | 真实浏览器取证脚本 | 用户说"没变化/不对齐/没生效"时 |
| `templates/` | 交接文档与项目约束模板 | 新项目起步 / 换会话交接 |
| `reports/` | 本次复盘报告与概览图 | 想回看数据与结论时 |
| `casebook/` | 可复用踩坑案例集 | 动手前扫一眼，避免重复踩 |

---

## 1. 技能 · `skills/`

### 1.1 `verifying-ui-changes-in-browser`

**作用**：把"我改了代码"升级为"我在你会用的角色、视口、入口上跑过并量到了证据"。
专治三类反复出现的返工：

- 改了没生效（资源缓存 / 服务没重启 / 只改了一个分支）
- 只改一处，同类位置还有好几个
- 同一件事在统计与筛选里用了两个口径

**使用说明**

1. 安装（三选一，DSH 与 Claude Code 用 `skills` 目录，Codex 用 `skills` 或 `~/.agents/skills/`）：

   ```bash
   cp -r skills/verifying-ui-changes-in-browser ~/.dsh/skills/          # DSH
   cp -r skills/verifying-ui-changes-in-browser ~/.claude/skills/       # Claude Code
   cp -r skills/verifying-ui-changes-in-browser ~/.codex/skills/        # Codex
   ```

2. 触发方式：不需要手动调用。用户在对话里说「没有变化 / 还是没生效 / 只有一处生效 / 刷新后还是旧的 / 不对齐」，
   或 Agent 准备宣称前端改动完成时，技能描述里的触发条件会命中。

3. 配合 `tools/browser-probes/` 使用：技能给的是"验什么、按什么顺序排查"，
   探针脚本负责"把证据量出来"。

**状态**：草稿已可用。按 `writing-skills` 的铁律，正式定稿前建议补一次 baseline 压力测试
（让一个没有该技能的 Agent 跑"改完 CSS 就宣称完成"的场景，记录它漏掉哪个分支）。

**不含**：不替代通用测试纪律（那属于 `verification-before-completion`），也不做视觉设计决策（那属于设计类技能）。

---

## 2. 工具 · `tools/`

### 2.1 会话复盘 · `tools/session-review/`

**作用**：把本机所有 AI 会话（DSH + Codex）变成可读的统计与报告，用来量化"我在哪些环节反复付出时间"。
这是本包唯一的"元工具"——它产出的数据决定了其它内容该做什么。

**使用说明**（在任意目录执行，脚本会自己找 `~/.dsh/sessions` 与 `~/.codex/sessions`）：

```bash
mkdir -p .probe          # 脚本把中间产物与报告写到当前目录的 .probe/
```bash
# 第 1 步：抽取某个项目的用户发言（参数是工作目录关键字）
node tools/session-review/extract-sessions.mjs "物流数据监控"
#   → .probe/session-user-messages.jsonl

# 第 2 步：压成可通读的诉求序列 + 词频
node tools/session-review/summarize-sessions.mjs
#   → .probe/session-digest.txt

# 第 3 步：生成统计报告（读上一步产出的 .probe/proj-*.jsonl）
node tools/session-review/session-report.mjs
#   → .probe/session-report.md / .probe/session-stats.json

# 第 4 步（可选）：渲染一页概览图（数据驱动，数字自动与报告一致）
node tools/session-review/render-chart.mjs
#   → .probe/session-report.png / .probe/session-report.html
```

**口径与前置**

- DSH 会话是 zstd 压缩的事件流，脚本用 `zstd -dc` 解压（macOS：`brew install zstd`）。
- 第 4 步需要本机 Chrome 与 `playwright`；不跑也不影响前 3 步。
- **系统注入必须剔除**（`extract-sessions.mjs` 已内置）：`<system-reminder>`、runtime context、
  后台任务通知、Codex 审批代理模板都会被当成"用户消息"，不剔除会虚高 40% 以上
  （实测某项目 208 条里 83 条是注入）。
- 分类基于关键词匹配，一条消息可命中多类；比例用于横向比较，不是精确占比。

**建议频率**：每月一次，或一个大项目结束后一次。

### 2.2 浏览器取证探针 · `tools/browser-probes/`

**作用**：用真实 Chrome 量出可贴出来的证据（几何、样式、交互、对比度、请求），
替代"读代码推断"。这些脚本是同一种写法的实例，改一改就能用于你的新页面。

**通用前置**：本机装了 Chrome 与 `playwright`；探针默认连 `http://127.0.0.1:3000`，用 `PROBE_BASE` 指向临时实例。
**探针账号一律走环境变量**（通用工具里不写死任何项目的口令）：`PROBE_USER` / `PROBE_PASS` 必填，
需要对比两个角色时再加 `PROBE_ADMIN_USER` / `PROBE_ADMIN_PASS` 与 `PROBE_MEMBER_USER` / `PROBE_MEMBER_PASS`。

**验证数据类改动时用副本库 + 临时端口**，不要拿生产库试错：

```bash
cp data/app.sqlite .probe/test.sqlite
DATABASE_PATH=./.probe/test.sqlite PORT=3211 node src/server.mjs &
PROBE_BASE=http://127.0.0.1:3211 PROBE_USER=<账号> PROBE_PASS=<口令> \
  node tools/browser-probes/sidebar-verify.mjs
```

| 脚本 | 作用 | 命令 |
| --- | --- | --- |
| `sidebar-baseline.mjs` | 基线测量：多角色 × 四视口的框架几何 + 截图，用于改前改后对比 | `PROBE_BASE=... PROBE_PREFIX=before node ...` |
| `sidebar-verify.mjs` | 交互验收：折叠记忆、抽屉开合、焦点归还、对比度（42 项断言） | `PROBE_BASE=... node ...` |
| `sidebar-prod-check.mjs` | 生产实例只读核验：确认刷新后新框架真的生效 | `PROD_BASE=http://127.0.0.1:3000 node ...` |
| `verify-stat-card-filter.mjs` | 口径一致性：卡片数字必须等于点击后列表条数 | `PROBE_BASE=... node ...` |
| `probe-table-metrics.mjs` | 表格实测：各列渲染宽高、表头/行高 | `node ... 1440`（视口宽度） |
| `check-containing-block.mjs` | 诊断 `backdrop-filter`/`transform` 祖先把 `fixed` 后代改基准的经典坑 | `node ...` |
| `repro-user-role.mjs` | 复现"多角色分支"缺陷：同一页面用两种账号各跑一遍 | `PROBE_BASE=... node ...` |

**写自己的探针时，照这个骨架**：起临时实例 → 登录 → 采集 `getBoundingClientRect()` 与
`getComputedStyle()` → 截图 → 断言 → 退出码非 0 即失败。

---

## 3. 模板 · `templates/`

### 3.1 `交接文档模板.md`

**作用**：换会话 / 换 Agent / 隔几天回来时，5 分钟接上进度。你过去提过"交接文档内容过多"，
所以模板强制四段结构，历史交付移到归档文件。

**使用说明**：复制到项目根目录命名 `交接文档.md`；每完成一个阶段只改「当前状态 / 下一步」两段；
一个月或 20 次交付后，把旧内容剪到 `docs/交接归档-<月份>.md`。

### 3.2 `AGENTS-项目约束.md`

**作用**：把复盘里最高频的三类摩擦写成硬约束，追加到项目 `AGENTS.md` 末尾即可生效：
重启纪律（改了服务端必须重启并贴日志时间戳）、全量扫同类（修复类交付附同类位置清单）、
口径唯一（一个业务概念一个定义 + 互校断言）、验收清单（交付物的一部分）。

**使用说明**：整段追加到项目 `AGENTS.md`，或按项目裁剪。这些规则是写给 Agent 看的，越具体越有效
（"必须附启动日志时间戳"比"注意重启"有效得多）。

---

## 4. 报告 · `reports/`

| 文件 | 说明 |
| --- | --- |
| `session-report.md` | 完整复盘报告：规模与时间跨度、诉求类型、摩擦信号、流程偏好、会话长度、按天活跃度、建议、口径局限 |
| `session-report.png` | 一页概览图（适合贴进周报或存档） |
| `session-stats.json` | 机器可读统计，便于做趋势对比 |

**使用说明**：想看结论直接读 `session-report.md` 第七节「建议」；
想做趋势就在下个月重跑 `tools/session-review/`，把两份 `session-stats.json` 对比。

---

## 5. 案例集 · `casebook/`

**作用**：把 4 个月里踩过的工程坑提炼成「现象 → 根因 → 规避方式 → 适用场景」，
动手前扫一眼就能避开重复的坑。**30 条，分 5 组**：CSS 与组件（9）、数据与口径（6）、
同步与外部接口（6）、进程与部署（5）、测试与验收（4），结尾附「最高频的三个坑」及排序依据。

三个最高频的坑（有 grep 计数支撑）：

1. **改了却没生效**（重启 49 次 / 缓存 14 次）——后端未重启、前端被缓存、CSS 被更靠后的块覆盖。
2. **同一概念两处口径不同**（口径 43 次）——不报错，只显示空白或错数字，最隐蔽。
3. **失败被静默吞掉**（静默 12 次，影响面最大）——`catch {}` 让定时任务连败 698 轮而日志无痕。

**使用说明**：作为参考手册查阅，不必通读；条目按技术主题编号（C/D/S/P/T）便于检索；
每踩一个新坑就往里加一条，保持它是最新的。案例虽来自单个项目，但根因与规避方式对同类栈通用。

**文件**：`工程案例集.md`

---

## 放进远程仓库（两种方式）

**方式 A：独立仓库（推荐）**

```bash
cd ai-workflow-kit
git init && git add . && git commit -m "chore: AI 工作流工具包（技能 + 工具 + 模板 + 复盘报告）"
git remote add origin <你的仓库地址>
git push -u origin main
```

**方式 B：并入现有项目仓库**

```bash
cp -r ai-workflow-kit <你的项目>/docs/ai-workflow
```

注意：`tools/` 里引用了 `~/.dsh/sessions`、`~/.codex/sessions` 这类本机路径，
属于**个人工作流资产**，不要和业务代码混在同一层目录里。

---

## 维护节奏

| 频率 | 动作 |
| --- | --- |
| 每月 | 重跑 `tools/session-review/`，对比摩擦信号是否下降（目标：服务中断、同类问题全量扫这两项先降） |
| 每次踩坑 | 往 `casebook/` 加一条 |
| 每次改 UI 交付 | 用 `tools/browser-probes/` 留一份前后证据 |
| 换会话 / 换 Agent | 用 `templates/交接文档模板.md` |
