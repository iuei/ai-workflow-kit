---
name: never-swallowing-failures
description: Use when writing catch blocks, scheduled or background jobs, external API calls, retries, or any code path whose failure would otherwise be invisible; and when a "no data" symptom has no matching error in the logs.
---

# 失败不许静默

## 核心法则

**看不见的失败最终会以「页面上没有数据」的形式暴露给用户，而排查成本由用户承担。**

两起真实事故：

- 被静默吞掉的令牌失效，让定时同步**连续失败 698 轮**、数据冻结两天，日志里没有任何痕迹（案例 S4）
- 一处 `catch {}` 让每轮固定 **41 条**记录失败却无法诊断（案例 D2）

## 规则

1. **禁止空 catch**。捕获后必须三选一：记日志、落库、向上抛。

   ```js
   // 禁止
   try { await sync() } catch {}

   // 必须
   try {
     await sync();
   } catch (error) {
     store.recordSyncFailure({ source, error: error.message, responseBody: error.responseBody });
     throw error; // 或者明确标注「已降级，不影响主流程」
   }
   ```

2. **外部调用失败要保留原文**：HTTP 状态码、响应体（截断）、请求参数（脱敏）。
   只记「请求失败」等于没记——真实事故里正是因为丢弃了错误体，用户反复猜了两天。
3. **定时任务必须可观测**：每轮落一条运行记录（成功 / 失败 / 原因 / 耗时）；
   **连续失败 ≥2 轮**要在界面上出告警。单轮失败可能只是上游抖动，连续失败基本能断定是配置或凭据问题。
4. **兜底要有出口**：`catch` 里给默认值时，同时标记「这是降级结果」，
   不能让降级值和真实值长得一样。
5. **启动阶段要隔离**：初始化任务（首次同步、资料预热）失败**不能**让进程起不来，用 try/catch 包住并降级
   （案例 P2：启动引导同步异常直接让服务在 listen 之前退出）。
6. **不要把「没数据」当正常**：查询返回 0 条时，要能区分「确实没有」与「拉取失败」。

## 怎么检查

```bash
grep -rn "catch\s*{\s*}" src/            # 空捕获
grep -rn "catch ([a-z]*)\s*{\s*}" src/   # 空捕获（带参数）
grep -rn "consecutiveFailures" src/      # 是否有连续失败计数与告警出口
```

再造一次失败验证链路：把上游地址/凭据改错，确认**有日志、有告警、进程不崩**。

## 常见错误

| 错误 | 实际 |
| --- | --- |
| 「加了 try/catch 更稳」 | 吞掉错误的 catch 只是把崩溃换成了静默错数据 |
| 「失败了下轮会重试」 | 没有记录的重试，失败轮次无人知晓——698 轮就是证据 |
| 「日志太多，这个不记」 | 该记的是失败原因与上下文，不是每次成功 |
| 「先不发告警，等稳定了再说」 | 连续失败告警正是稳定期的保险 |

## 红牌

- 写 `catch {}` 或 `catch (e) {}`
- 外部调用只记 `error.message`，丢掉状态码与响应体
- 定时任务没有任何运行记录
- 用默认值兜底之后，无法区分真实值与兜底值
