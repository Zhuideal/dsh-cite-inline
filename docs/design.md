# 设计说明

这份文档解释 chip 的外观与序列化为什么是这个样子。只想用插件的话看 [README](../README.md) 就够了。

## chip 的外观

chip 用 **DSH 官方主题 token** 绘制，不写死任何产品配色，因此浅色/深色主题自动适配，也与 `dsh-claude-style` 这类只改 token 指向的皮肤插件兼容：

| 部位 | 取值 |
|---|---|
| 底色 | `business-tertiary` 82% + `business-primary` 18% |
| 文字 | `--dsw-alias-label-primary` |
| 图标 | `--dsw-alias-state-business-primary`（对话气泡，`appearance: 'session'`） |

两个面共用同一组规则：输入框内是 `.mxScHa_reference.rtYPxa_chip`，已发送消息里是 `[data-ref-chip]`。

18% 这个比例是量出来的：以浅色主题的 tertiary `#e4edfd` 与 primary `#4176e6` 两端做插值，18% 处得到 `#c7d8f9`，是这条 token 斜坡上离参考形态 `#bce3ff` 最近的点。**没有把 `#bce3ff` 写进样式表**——写死颜色会让深色主题失效，也会与换色皮肤插件互相覆盖。

### 为什么必须覆盖 `display`

DSH 原生的 `.refChip` 是 `display: inline` + `white-space: inherit` + `overflow-wrap: anywhere`，注释里写明这是刻意的：它要跟随气泡折行。后果是**它永不截断**，一条长引用会在气泡里铺开一大段——这正是「发送后不像胶囊」的根因。

`max-width` 与 `text-overflow: ellipsis` 对 inline 盒**完全无效**，所以插件必须把 `[data-ref-chip]` 改成 `inline-block` 才能让它成为胶囊：

```css
[data-ref-chip] {
  display: inline-block; max-width: 240px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  vertical-align: bottom;
}
```

240px 与 DSH 自己给输入框 chip 的上限一致，两个面因此宽度相同。

## 发送后为什么还是胶囊

`codec.serialize()` 的返回值有**两个**消费者：

- **模型**：原样收到这段文本
- **用户气泡**：DSH 的 `projectUserText()` 会扫这段文本里的 `@…` / `@"…"` / `/…` token，逐个渲染成 chip

所以序列化形式必须**既是可读的模型文本、又是扫描器认的 token**。这里用 `@"全文"`——**正文整份放进引号内**：

```
@"单次请求体量巨大。每次请求都带 10–20 万 prompt tokens（agent 把全量上下文重发一遍）。哪怕调用次数不多，token 速率也直接爆表。"
```

**正文必须放在引号内，不能跟在引号后面。** 放在外面时，`projectUserText` 会把它当作普通文本渲染成一整段 plain run，于是气泡里出现「胶囊 + 一大段展开的全文」——这就是这个插件最早期版本的观感缺陷。

代价是引号内的文本会原样进模型 prompt，但这也正是我们要的：模型读到的是完整引用。

### 四个必须处理的字符

标签在 `compactLabel()` 里做归一化，每一处都对应 `projectUserText` 的一个真实行为：

| 原字符 | 替换为 | 不替换的后果 |
|---|---|---|
| 换行 / 连续空白 | 单个空格 | token 正则是 `@"[^"\n]+"`，换行会把 token 劈成两半，chip 退化成纯文本 |
| `"` | `”`（右双引号） | 提前闭合 token，后半段作为 plain run 泄漏到气泡里 |
| `/` | `∕`（除法斜杠） | 渲染器把它当文件路径，`displayLabel` 只保留最后一段，引用内容被悄悄截掉 |
| `\` | `∕`（同上） | 同上：`displayLabel` 按 `[\\/]` 切分，Windows 路径（`C:\Users\…`）会让 chip 只剩最后一个反斜杠之后的文字 |

后三条是实测发现的：`see src/client/foo.ts for details` 会被渲染成只有 `foo.ts for details`；`C:\Users\<用户名>\node_modules\dsh-quote-to-chat 是…` 会只剩 `dsh-quote-to-chat 是…`。用 `tools/sent-chip.test.mjs` 可以直接复现。

### token 前必须有一个分隔符

`serialize()` 返回的是 **` @"全文"`（注意前导空格）**，不是 `@"全文"`。

扫描正则（`ui-primitives` `lib/index.js:6724`）是：

```js
const re = /(^|\s)(\/[\w-]+(?=\s|$)|@"[^"\n]+"|@[^\s]+)/gu;
```

开头的 `(^|\s)` 是**必需**的，它要求 token 前面要么是字符串开头，要么是一个空白字符。chip 紧跟在用户已输入的文字后面时（例如 `删掉这个重复的东西` + chip），token 自己没有分隔符，`(^|\s)` 匹配失败，整段引用会连同字面量 `@"` 和结尾的 `"` 一起泄漏成纯文本——就是「第二个引用自己展开了」那个现象。换行符也是 `\s`，所以两行各放一个 chip 时不会出问题，只有同一行紧贴文字时才会。

`tools/port.test.mjs` 与 `tools/sent-chip.test.mjs` 都按 5 种前缀（消息开头 / CJK 词后 / ASCII 词后 / 全角逗号后 / 换行后）覆盖了这个契约。
