---
name: one-definition-per-metric
description: Use when the same business concept (a status, a count, a category) is computed in more than one place — statistics cards, filters, exports, detail views — or when a card's number does not match the list it opens.
---

# 一个口径只允许一个定义

## 核心法则

**同一个词在两处用不同条件计算时，它不会报错，只会显示错的数字。** 这是最难被发现的一类缺陷。

真实案例：概览卡「未签收」显示 **15** 票，点进去列表 **173** 票——差额来自 158 票「待填写单号」的占位单
被算进了未签收。用户的第一反应是「筛选坏了」，而不是「数字错了」（案例 D1）。

## 做法

1. **定义先落到一处**：把口径写成共享 SQL 或函数（例如 `getStatusCounts()`），不要在展示层各写一份。
   口径要写进注释，并以需求文档原话为准，例如：
   `未签收 = is_signed = 0 AND is_placeholder = 0`（需求文档：「全部未签收且带快递单号的物流单」）。
2. **所有展示路径复用它**：卡片、筛选、导出、详情、对外 API。
   筛选用的是**同一个条件**，而不是"看起来一样"的条件。
3. **加互校断言**（关键一步）：把「卡片值 = 点击后列表的 total」变成测试。

   ```js
   assert.equal(store.listShipments({ signed: 'false' }).total, stats.unsigned);
   ```

   这条断言在修好之前是红的（actual 2 / expected 1），修好之后变成防回归网。
4. **口径变更要处理存量数据**：改了定义，旧记录也要按新口径回填或标注，否则新旧混在一起更糟。
5. **矛盾组合要有明确结果**：例如 `signed=false&pending=true`（未签收且待填写单号）应返回空集——
   把结论写进注释与测试，而不是让它悄悄返回一堆数据。

## 怎么检查

```bash
grep -rn "is_signed" src/          # 同一个字段在多处出现，逐个比对条件表达式
grep -rn "未签收" src/ public/      # 同一个业务词在几处实现
```

- 逐个问：这两处的条件表达式是不是**逐字相同**？不同就说明存在第二个口径。
- 界面上点一遍：每个可点击的数字，点进去的条数是否等于这个数字。
- 别忘了第三处：导出与详情往往重复实现了同一条件。

## 常见错误

| 错误 | 实际 |
| --- | --- |
| 「两处逻辑一样」 | 差一个 `AND is_placeholder = 0`，就是 15 与 173 |
| 「数字对不上是缓存」 | 先比口径，再怀疑缓存 |
| 「先把界面上的词统一」 | 词一样、条件不同，问题依旧 |
| 「导出是次要功能，先不管」 | 导出与卡片对不上时，用户会怀疑整个系统的数据 |

## 红牌

- 同一个业务词在 2 个以上文件里各有一份条件表达式
- 可点击的统计数字，没有「点进去等于这个数字」的断言
- 口径变了，存量数据没动
