# 移植说明

本插件是 [choco9527/dsh-add-to-chat](https://github.com/choco9527/dsh-add-to-chat)（MIT）的独立移植版，为**官方 DSH 0.2.0-rc.2** 重写。它不是复刻分支，也不跟上游同步更新。

这份文档记录「为什么必须移植」以及改了哪些地方。只想用插件的话看 [README](../README.md) 就够了。

## 为什么需要移植

上游 README 声称依赖「助手正文的 `data-dsh-message-role="assistant"` 标记」与「`conversation.draftContexts` 提交服务」。对官方 DSH 0.2.0-rc.2 全量检索（app.asar 12967 个条目）：

- `data-dsh-message-role` —— **0 命中**。DSH 只发 `data-dsh-automatic-focus` 与 `data-dsh-boot`；助手正文真正的标记是 ui-chat 的 `data-chat-flow-kind="assistant-step"`。
- `conversation.draftContexts` —— **0 命中**。官方 `conversation` 服务的成员只有 `input` / `blocks` / `fileUploads` / `draftAttachments` / `send()` / `sendSession()`。
- 更新版本的官方包同样没有：`@deepseek-ai/dsh-client-ui-conversation@0.2.1-alpha.2`（比 rc.2 更新）里也没有 `draftContexts`。

上游的自动化测试之所以全绿，是因为它的测试夹具**自己伪造了这两个契约**（`test/support/client-harness.mjs`：`reply.setAttribute('data-dsh-message-role', 'assistant')` 与 `conversation: { draftContexts: {...} }`）。作者在 revert commit 里也写明 draft-context 服务是在「**the core fork**」里恢复的。

上游 HEAD 在官方 DSH 上会在 `apply()` 处直接抛错：

```js
if (ctx.conversation?.draftContexts === undefined) {
  throw new Error('dsh-add-to-chat requires DSH draft-context support')
}
```

即使把这一句去掉，`ASSISTANT_REPLY_SELECTOR` 也匹配不到任何元素，按钮永远不会出现。

## 与上游的关键差异

| 行为 | 上游 HEAD | 本移植版 |
|---|---|---|
| 注释存放位置 | 输入框之外（draft context） | **输入框内的 chip** |
| 输入框是否纯净 | 是 | **否**（会有引用 chip） |
| 助手正文标记 | `data-dsh-message-role` | **`data-chat-flow-kind="assistant-step"`** |
| 会话定位 | `sessions.list.current` / `retainedBy` | **`retainedBy.mainView`** |
| 依赖的服务 | `conversation.draftContexts`（fork 专有） | **`inputTriggers`（官方）** |
| 能否在官方 DSH 运行 | **否** | **是** |

代价：chip 会出现在输入框里，可以像普通引用一样被 Backspace 整枚删除——这也是 chip 存在的意义（编辑器把它当一个整体）。上游 HEAD 靠 draft context 保持输入框纯净，但那需要 fork 的服务。

## 具体补丁

基于上游 commit `5125430`（唯一走官方 `inputTriggers` 机制的版本），打以下几处补丁：

1. **助手正文选择器**：`[data-dsh-message-role="assistant"]` → `[data-chat-flow-kind="assistant-step"]`
2. **会话定位**：`sessions.list.getSnapshot().current` → 新版 `retainedBy.mainView`（保留旧版 `current` 兼容）
3. **chip 皮肤**：注入官方主题 token 的浅蓝胶囊，同时覆盖输入框 chip 与已发送消息 chip；并把已发送 chip 的 `display` 从 `inline` 改为 `inline-block`，否则 `max-width` 与省略号都不生效
4. **chip 图标**：`insertReference` 传 `appearance: 'session'`，`@` 字标换成对话气泡图标
5. **序列化格式**：`serialize()` 返回单个 ` @"全文"` token（前导空格是契约的一部分，见 [design.md](design.md)），全文放进引号内，气泡不再溢出
6. **标签归一化**：换行折叠成空格，`"` → `”`，`/` 和 `\` → `∕`（都是为了让 token 不被正则或路径切分逻辑破坏）
7. **工具条**：单按钮浮钮 → 「添加到对话｜复制」小横条，`mousedown` 中和以保住选区
8. **复制动作**：异步 Clipboard API + `execCommand` 兜底
9. **移除旧 UI**：上游的「N 条注释」浮标、回复内的编号徽章、悬浮预览卡全部退役——目标设计里没有它们，且浮标会在输入框旁露出一枚裸 i18n 键

（曾有过第 10 项「会话菜单行：注册一行『复制会话 ID』」。DSH 0.2.1 起官方自带这一项——会话 `⋯` 菜单最后一条，文案 `复制 Session ID`，由 `ui-workspace` 的 `SessionIdMenuItem` 渲染。本插件再注册一行只会让同一个菜单出现两个同名条目，因此整块删除。插件现在只做一件事：把助手回复里的选区变成引用 chip。）

`5125430` 自己的 `current` 读取在 rc.2 上恒为 `undefined`（该快照只有 `{ids, byId, phase, projectionsBySession}`），所以点按钮毫无反应——这正是上游 `904f259` 修的问题，本移植版把那个修复合并了进来。

其余依赖的官方 API 已逐个核对存在：`inputTriggers.registerSource`、`sessions.scope(id)`、`conversation.input.for(scope)`、`input.insertReference` / `insertText`、`input.state` 的 `draft` / `occurrences` / `draftRev`。

已**不再**依赖 `[data-composer-card]`（它只服务已退役的浮标定位）。

## 维护

移植工具在 `tools/`：

- `tools/upstream-client.js` —— 上游 `5125430` 的 `client.js` 原文（MIT），作为补丁基线
- `tools/build-client.cjs` —— 应用标识符重命名 + 移植补丁，生成 `client.js`，并在最后做「不含 fork 专有契约」的自检
- `tools/port.test.mjs` —— 上述验证套件

重建：

```
OUT_DIR=. node tools/build-client.cjs
CLIENT_JS=./client.js node tools/port.test.mjs
node tools/sent-chip.test.mjs
```

**若 DSH 后续版本改了 DOM 契约**，插件里只有两处会失效，且都能靠测试立刻发现：

1. `ASSISTANT_REPLY_SELECTOR = '[data-chat-flow-kind="assistant-step"]'`
   —— 助手正文容器。诊断：选中回复文字后按钮不浮出，就在 DevTools 里确认该属性是否还在。
2. 已发送 chip 的类名 `.mxScHa_reference.rtYPxa_chip`（皮肤覆盖用）
   —— 诊断：输入框里的 chip 没变成浅色胶囊。

（会话菜单行已不在插件范围内，因此也不在这张名单上。）

## 许可证

MIT。原始作品 © choco9527；本移植版按其 MIT 条款分发。
