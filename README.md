# dsh-cite-inline

在 DSH 助手回复里**选中一段文字 → 点「添加到对话」→ 把它带进下一条消息**。

这是 [choco9527/dsh-add-to-chat](https://github.com/choco9527/dsh-add-to-chat)（MIT）的**独立移植版**，为**原版 DSH 0.2.0-rc.2** 重写。它不是原版的复刻分支，也不跟原版同步更新——原版 HEAD 依赖一个 DSH **fork** 才有的扩展点，在官方 DSH 上必然加载失败（详见下方「为什么需要移植」）。

## 效果

1. 在助手回复正文中选中文字，选区上方浮出工具条：**添加到对话**｜**复制**
2. 点击后，选中内容作为一枚**引用 chip** 插入输入框
3. 继续正常打字或直接发送；chip 随消息一起发出，在用户气泡里**仍是胶囊**（鼠标悬浮可见全文）
4. chip 是原子节点：Backspace 整枚删除
5. 界面跟随 DSH 语言（中/英），切换语言即时刷新
6. 侧边栏会话行的 `⋯` 菜单多一项**复制会话 ID**（点一下复制该会话的原生 id，菜单短暂停留显示「会话 ID 已复制」再关闭）

## 复制会话 ID：为什么不需要改核心

DSH 自带公开插槽 `sidebar.workspaces.session.menu.item`。工作区浏览器会把**每一个注册者**渲染进会话的 `⋯` 菜单，父插槽还会注入 `useMenuOpenState`（行用来关闭所在菜单的钩子）。官方自己的「置顶 / 重命名 / 分叉 / 归档」就是四行注册：

```js
ctx.slots.inject('sidebar.workspaces.session.menu.item', function* () {
  yield ctx.slots.register({ name: ..., id: 'pin',    order: 100, locale: NS, inject: pinInjected },    PinSessionMenuItem)
  yield ctx.slots.register({ name: ..., id: 'rename', order: 200, locale: NS, inject: renameInjected }, RenameSessionMenuItem)
  // fork 300, archive 400 …
})
```

所以本插件只做一次注册，`order: 250` 落在「重命名」和「分叉会话」之间。行本身用官方 `MenuItemButton` 渲染 —— 那是 ui-primitives 导出的菜单行组件，自带官方 `Menu.module.css` 类名，因此**配色、hover、图标列、深色主题全部自动一致**，插件不写一行菜单样式。

（`dsh-cite` 上游为这个功能维护了一份核心补丁 `0001-web-session-row-menu-slot.patch`，改的是 `ui-workspace` 的 `Rows.tsx` 等文件。那是给旧版 DSH 的；rc.2 已把该扩展点做进内核，所以这里**不需要**任何核心改动。）

### 为什么整段代码都被 try/catch 包住

这是刻意的。一个菜单行只是便利功能，它**绝不能**让 `apply()` 抛异常 —— 抛异常的客户端 entry 正是把 DSH 推进启动失败恢复、进而清空 profile 的原因。所以：

- `slots` 服务用 `ctx.get('slots')` 探测，**不写进 `inject` 数组**（声明了却等不到服务会让 fiber 卡在 `pending`，那同样是启动失败）
- `require` 缺失、react/primitives 取不到、`writeClipboard` 不是函数 —— 任一情况都只是**跳过这一行**，其余功能不受影响
- 剪贴板失败时关闭菜单，而不是假装复制成功

`tools/port.test.mjs` 里有三条专门的断言守这条底线：`slots` 缺失、`require` 抛错、primitives 只返回空对象时，工具条与插入 chip 功能**全部照常工作**。

## chip 长什么样

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

后三条是实测发现的：`see src/client/foo.ts for details` 会被渲染成只有 `foo.ts for details`；`C:\Users\<user>\node_modules\dsh-quote-to-chat 是…` 会只剩 `dsh-quote-to-chat 是…`。用 `tools/sent-chip.test.mjs` 可以直接复现。

### token 前必须有一个分隔符

`serialize()` 返回的是 **` @"全文"`（注意前导空格）**，不是 `@"全文"`。

扫描正则（`ui-primitives` `lib/index.js:6724`）是：

```js
const re = /(^|\s)(\/[\w-]+(?=\s|$)|@"[^"\n]+"|@[^\s]+)/gu;
```

开头的 `(^|\s)` 是**必需**的，它要求 token 前面要么是字符串开头，要么是一个空白字符。chip 紧跟在用户已输入的文字后面时（例如 `删掉这个重复的东西` + chip），token 自己没有分隔符，`(^|\s)` 匹配失败，整段引用会连同字面量 `@"` 和结尾的 `"` 一起泄漏成纯文本——就是「第二个引用自己展开了」那个现象。换行符也是 `\s`，所以两行各放一个 chip 时不会出问题，只有同一行紧贴文字时才会。

`tools/port.test.mjs` 与 `tools/sent-chip.test.mjs` 都按 5 种前缀（消息开头 / CJK 词后 / ASCII 词后 / 全角逗号后 / 换行后）覆盖了这个契约。

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

## 安装

从本仓库目录安装（`--profile` 换成 `web` 即为网页版）：

```
dsh plugin --profile desktop add link:<本仓库的绝对路径>
```

**安装后必须重启 DSH Desktop**：已实测运行中的 Host 不会热挂载新插件。

卸载：

```
dsh plugin --profile desktop remove dsh-cite-inline
```

## 验证

三套测试，全部零依赖、不需要浏览器：

```
CLIENT_JS=./client.js node tools/port.test.mjs   # 契约测试（25 项）
node tools/sent-chip.test.mjs                    # 发送后渲染测试（5 种选区）
node tools/smoke.mjs                             # 端到端走一遍四步交互
```

`sent-chip.test.mjs` **直接从已安装的 asar 读取**官方 `ui-primitives` 包，不依赖任何暂存目录，因此换一台机器或换了 DSH 版本都不会读到过期副本（可用 `DSH_ASAR` 环境变量指定 asar 路径）。

**`tools/port.test.mjs`** —— 在一个**模仿官方 0.2.0-rc.2 契约的上下文**里加载真实 `client.js`，故意**不**提供 fork 专有的 `conversation.draftContexts` 与 `data-dsh-message-role`。因此一旦回退到 fork 契约，测试立刻失败。覆盖 25 项：启动不抛错、注册 `@` 引用源、从 `retainedBy.mainView` 定位会话、点击插入 chip、chip 带 `appearance:'session'`、codec 序列化成单个 `@"…"` token、多行选区折叠成单行、`clipboardText` 与标签一致、工具条含添加/复制两个动作、样式表同时覆盖两个面且只用官方 token、已废弃的 rail/marker/preview 不再挂载、非助手选区不触发、旧版 `current` 目录兼容、无会话时不插入、子 agent 会话不误判、删 chip 后引用失效、卸载清理；以及会话菜单行这一组的 8 项 —— 注册进官方插槽且 id/order/locale 正确、用 `MenuItemButton` 渲染、点击复制原生 session id、复制成功后置位、**复制被拒时关闭菜单而非假装成功**、复制成功后装载延时关闭 effect、以及 `slots` 缺失 / `require` 抛错 / primitives 缺导出这三种环境下**插件其余功能全部照常工作**。

**`tools/sent-chip.test.mjs`** —— 从 asar 里抽出的**真实 `projectUserText()` 源码**，喂给它 5 种选区（短句、长段、含引号、含斜杠、多行），断言每种都渲染成**恰好一枚 chip 且零泄漏**。这是唯一能挡住「引用在气泡里展开」这类回归的测试。

**`tools/smoke.mjs`** —— 打印完整交互链路与注入的样式表，用于人工核对。

宿主侧加载标记：插件挂载后会在 `~/.dsh/cite-inline-loaded.json` 写一条 `{event, name, at, pid}`。这是从外部判断「Host 到底有没有加载它」的唯一办法（浏览器半边在文件系统上不可见）。

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

### 本移植版做了什么

基于上游 commit `5125430`（唯一走官方 `inputTriggers` 机制的版本），打以下几处补丁：

1. **助手正文选择器**：`[data-dsh-message-role="assistant"]` → `[data-chat-flow-kind="assistant-step"]`
2. **会话定位**：`sessions.list.getSnapshot().current` → 新版 `retainedBy.mainView`（保留旧版 `current` 兼容）
3. **chip 皮肤**：注入官方主题 token 的浅蓝胶囊，同时覆盖输入框 chip 与已发送消息 chip；并把已发送 chip 的 `display` 从 `inline` 改为 `inline-block`，否则 `max-width` 与省略号都不生效
4. **chip 图标**：`insertReference` 传 `appearance: 'session'`，`@` 字标换成对话气泡图标
5. **序列化格式**：`` serialize() 返回单个 ` @"全文"` token ``（前导空格是契约的一部分，见上节），全文放进引号内，气泡不再溢出
6. **标签归一化**：换行折叠成空格，`"` → `”`，`/` 和 `\` → `∕`（都是为了让 token 不被正则或路径切分逻辑破坏）
7. **工具条**：单按钮浮钮 → 「添加到对话｜复制」小横条，`mousedown` 中和以保住选区
8. **复制动作**：异步 Clipboard API + `execCommand` 兜底
9. **移除旧 UI**：上游的「N 条注释」浮标、回复内的编号徽章、悬浮预览卡全部退役——目标设计里没有它们，且浮标会在输入框旁露出一枚裸 i18n 键
10. **会话菜单行**：往官方插槽 `sidebar.workspaces.session.menu.item` 注册一行「复制会话 ID」，用官方 `MenuItemButton` 渲染；`factory` 改为接收 `require` 以取得 React 与 primitives

`5125430` 自己的 `current` 读取在 rc.2 上恒为 `undefined`（该快照只有 `{ids, byId, phase, projectionsBySession}`），所以点按钮毫无反应——这正是上游 `904f259` 修的问题，本移植版把那个修复合并了进来。

其余依赖的官方 API 已逐个核对存在：`inputTriggers.registerSource`、`sessions.scope(id)`、`conversation.input.for(scope)`、`input.insertReference` / `insertText`、`input.state` 的 `draft` / `occurrences` / `draftRev`。

已**不再**依赖 `[data-composer-card]`（它只服务已退役的浮标定位）。

## 维护

移植工具在 `tools/`：

- `tools/upstream-client.js` —— 上游 `5125430` 的 `client.js` 原文（MIT），作为补丁基线
- `tools/build-client.cjs` —— 应用标识符重命名 + 两处移植补丁，生成 `client.js`，并在最后做「不含 fork 专有契约」的自检
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

会话菜单行不在这张名单上：它走的是公开插槽，不依赖任何哈希类名。

## 许可证

MIT。原始作品 © choco9527；本移植版按其 MIT 条款分发。