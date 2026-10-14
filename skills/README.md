# 技能索引（4 个）

这些不是知识文档，而是**行为约束**：遇到 X 时必须做 Y，做完要有证据。
全部来自 194 个会话复盘 + 30 条真实事故案例的提炼。

| 技能 | 治什么 | 触发信号 | 支撑证据 |
| --- | --- | --- | --- |
| [`verifying-ui-changes-in-browser`](verifying-ui-changes-in-browser/SKILL.md) | 改了 UI，用户看不到 / 只有一处生效 | 用户说「没有变化 / 没生效 / 不对齐」；准备宣称前端改完 | 「改了没生效」24 条 +「服务未生效」73 条 +「同类问题全量扫」47 条；51% 会话含摩擦 |
| [`making-backend-changes-take-effect`](making-backend-changes-take-effect/SKILL.md) | 改了服务端，跑着的还是旧实例 | 改 `src/`、SQL、迁移、配置、定时任务、部署产物 | 服务中断/反复启动 73 条（跨 6 个项目）；项目文档里「重启」出现 49 次 |
| [`never-swallowing-failures`](never-swallowing-failures/SKILL.md) | 失败被静默吞掉，用户只看到「没有数据」 | 写 catch、定时任务、外部调用、重试 | 令牌失效被吞 → 定时同步连败 **698 轮**、数据冻结两天；`catch {}` 致每轮固定 **41 条**失败无法诊断 |
| [`one-definition-per-metric`](one-definition-per-metric/SKILL.md) | 同一个词在两处口径不同，显示错数字 | 卡片数字与点进去的列表对不上；同一概念出现在统计/筛选/导出/详情 | 「未签收」卡片 15 票 vs 列表 173 票（差额是 158 票占位单） |

## 安装

三个运行时的技能目录（任选；DSH 与 Claude Code 用 `skills`，Codex 还认 `~/.agents/skills/`）：

```bash
cp -r skills/* ~/.dsh/skills/       # DSH
cp -r skills/* ~/.claude/skills/    # Claude Code
cp -r skills/* ~/.codex/skills/     # Codex
```

## 使用

**不需要手动调用**。触发条件写在每个技能 frontmatter 的 `description` 里，
当对话或任务命中这些条件时应当自动加载。

三个典型触发场景：

- 用户说「点击未签收卡片没有筛选出未签收的数据」→ `one-definition-per-metric`
- 改完 `src/db.mjs` 准备交付 → `making-backend-changes-take-effect`
- 写 `try { ... } catch {}` → `never-swallowing-failures`

## 与 `rules/` 的分工

| 目录 | 面向谁 | 回答的问题 |
| --- | --- | --- |
| `skills/` | AI Agent 的行为 | 什么时候必须做什么动作 |
| `rules/` | 项目与提交检查 | 必须遵守什么、怎么查出来 |

两边内容有交叉是刻意的：技能管"过程中别忘"，规则管"提交前逐条过"。

## 状态

4 个技能均为**可用草稿**。按 `writing-skills` 的铁律，正式定稿前建议各补一次 baseline 压力测试：
让一个没有该技能的 Agent 跑对应场景，记录它漏掉哪一步，再据此收紧措辞。
