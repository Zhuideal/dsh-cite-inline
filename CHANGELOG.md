# 更新记录

本文件记录 `dsh-cite-inline` 的每个版本改了什么、为什么改。
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.2.0

删掉「复制会话 ID」菜单行 —— 官方自己做了这一项，插件留着只会让菜单里出现两条同名项。

### 移除（破坏性）

**侧边栏会话 `⋯` 菜单里的「复制会话 ID」不再由本插件提供。**

DSH 0.2.1 把这一项做进了内核：`ui-workspace` 的 `SessionIdMenuItem` 注册进
`sidebar.workspaces.session.menu.item`，是会话菜单的**最后一条内置项**，文案
`复制 Session ID`，复制成功提示 `Session ID 已复制`。

所以截图里的菜单同时出现两行：

```
置顶会话
重命名            Ctrl + Alt + G
复制会话 ID              ← 本插件，order 250
分叉会话          Ctrl + Alt + F
归档会话          Ctrl + Shift + A
复制 Session ID          ← 官方内置
```

官方实现和本插件那一行几乎是同一份代码 —— 同一个 `MenuItemButton`、同一个
`IconCopyOutlineRegular`、同一个 `useMenuOpenState` 关菜单。既然如此，插件这一行
不提供任何官方没有的能力，只制造重名。已整块删除。

**功能没有消失**，只是改由 DSH 提供：菜单里那一行「复制 Session ID」照旧可点。

### 顺带变化

`factory` 回到零参。当初把 `factory: () => {}` 改成 `factory: require => {}`，唯一目的
就是从模块加载器里取 React 与 primitives 来渲染那一行菜单；行没了，这个参数也就没有
存在的理由。现在与所有官方客户端 bundle 的写法一致。

`package.json` 的 description 与 keywords 里去掉了 session-id 相关内容。

### 测试

- 删掉菜单行那 8 项断言，换成 2 项**反向**断言：打包产物不得再出现
  `sidebar.workspaces.session.menu.item` / `menuCopySessionId` / `CopySessionId`，
  且 `factory` 必须保持零参、不得出现 `require(` —— 防止这次删除被下次构建悄悄还原
- 契约测试 27 → **21 项**，其余全绿

### 修复

**`tools/sent-chip.test.mjs` 在 DSH 0.2.1 上根本跑不起来**

它只在 `app.asar` 里找 `ui-primitives`，而 0.2.1 把客户端 UI 包挪出了 asar（asar 现在
只装宿主半边），于是第一行就抛：

```
Error: not in asar: /dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js
```

一个用例都没跑。现在先逐个试 asar 候选（asar 存在但不含该包是正常情况），再回退到
profile 的 `node_modules`，并打印实际用了哪一份。`DSH_ASAR` 与 `DSH_PRIMITIVES` 都能覆盖。

### 升级方式

```bash
git pull
```

插件通过 `link:` 安装，无需重装。**必须重启 DSH** —— 宿主不会热挂载客户端代码变更
（HMR 会重新合成 bundle，但页面仍需刷新一次）。

## 0.1.1

修两个「引用胶囊退化成纯文本」的缺陷。两个都需要**先输入别的字再插入引用**才会触发，
所以只测「空输入框里插入」是测不出来的。

### 修复

**1. 引用紧贴在文字后面时，整条引用会泄漏成纯文本**

DSH 在发送后从纯文本反推 chip，用的扫描正则是：

```js
/(^|\s)(\/[\w-]+(?=\s|$)|@"[^"\n]+"|@[^\s]+)/gu
```

那个 `(^|\s)` 分组是**强制**的 —— token 必须位于字符串开头，或前面是空白字符。

`serialize()` 原本输出 `@"全文"`，不带前导分隔符。于是在「看一下这[光标]里插入引用」这种
情形下，发送出去的文本是：

```
看一下这个@"单次请求体量巨大…"
```

`@"` 紧贴在 `个` 后面 → `(^|\s)` 匹配失败 → **不认成 chip** → 用户气泡里出现的是带着
字面 `@"` 和结尾 `"` 的一大段纯文本，而不是胶囊。

现在 `serialize()` 输出 ` @"全文"`，前导空格让 `\s` 分支成立。`\s` 同时也覆盖「消息开头」
这一情形，所以不需要为两种情况分别处理。

**2. 选区里含 Windows 路径时，胶囊被压成最后一个反斜杠之后的文字**

渲染器计算 chip 显示标签的逻辑：

```js
displayLabel = label.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1)
```

它按 `\` 和 `/` **两种**分隔符切分，然后**只保留最后一段**。

`compactLabel()` 原本只把正斜杠 `/` 换成 `∕`（U+2215），漏了反斜杠。所以在 Windows 上选中
一段含 `C:\Users\<user>\…` 的文字时，标签会被切成 `['C:', 'Users', '<user>', …]`，
`.at(-1)` 只留下最后一段 —— **引用的绝大部分内容被静默丢弃**。

现在 `/[\\/]/gu` 两种分隔符一起归一化，切分不再发生，标签保持完整。

### 测试

- `tools/sent-chip.test.mjs`：从构建产物里**提取**真实的 `serialize()` 模板（不是硬编码），
  跑 **5 种选区 × 5 种前缀** —— 消息开头、中文词后、英文词后、全角逗号后、换行后 ——
  共 25 组，断言每种都渲染成**恰好一枚 chip 且零泄漏**
- `tools/port.test.mjs`：直接对着 `projectUserText` 的**真实扫描正则**断言 token 形状
- 契约测试 25 → **27 项**

**回退上面任一修复，两套测试都会失败。**

### 升级方式

```bash
git pull
```

插件通过 `link:` 安装，无需重装。**必须重启 DSH** —— 宿主不会热挂载客户端代码变更。

## 0.1.0

首个版本。两个功能，一个主题：把引用在「记录」和「你要用的地方」之间搬运。

- 在助手回复里选中文字 → 点「添加到对话」→ 选区变成输入框里一枚**原子引用 chip**。
  chip 随消息一起发出，在用户自己的气泡里**仍是紧凑胶囊**，不会展开成大段引用块。
- 侧边栏会话菜单新增一行**「复制会话 ID」**。

移植自 [choco9527/dsh-add-to-chat](https://github.com/choco9527/dsh-add-to-chat)（MIT），
适配 stock DSH 0.2.0-rc.2。上游基线逐字保留在 `tools/upstream-client.js`，由
`tools/build-client.cjs` 重新生成 `client.js` —— 因此可审阅的是**补丁列表**，而不是构建产物。
