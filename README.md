# dsh-cite-inline

> 在 DSH 助手回复里选中一段文字，把它变成输入框里的一枚引用 chip。

## 它做什么

1. 在助手回复中选中文字 → 上方浮出工具条：**添加到对话** ｜ **复制**
2. 点「添加到对话」→ 选区变成输入框里一枚**原子引用 chip**
3. 继续打字或直接发送，chip 随消息一起走
4. 发送后在你自己气泡里**仍是胶囊**（悬浮看全文），不会展开成一大段
5. Backspace 整枚删除

界面跟随 DSH 语言（中/英），切换即时刷新。浅色/深色主题自动适配。

**为什么需要它**：DSH 里想引用助手说过的一段话，只能复制粘贴。粘进来是一大段文字，改起来费劲、删起来更费劲。chip 把这段引用变成编辑器里的一个整体。

## 安装

```bash
dsh plugin --profile desktop add link:<本仓库的绝对路径>
```

**装完必须重启 DSH Desktop** —— 运行中的 Host 不会热挂载新插件。

卸载：

```bash
dsh plugin --profile desktop remove dsh-cite-inline
```

> `--profile desktop` 换成 `web` 即装到网页版。

## 兼容性

需要 **DSH 0.2.0-rc.2 或更新**。

这是 [choco9527/dsh-add-to-chat](https://github.com/choco9527/dsh-add-to-chat)（MIT）的独立移植版。原版依赖一个 **DSH fork** 才有的扩展点，在官方 DSH 上必然加载失败，所以这里按官方 API 重写了。详见 [docs/porting.md](docs/porting.md)。

## 验证

三套测试，零依赖、不需要浏览器：

```bash
CLIENT_JS=./client.js node tools/port.test.mjs   # 契约测试（21 项）
node tools/sent-chip.test.mjs                    # 发送后渲染（5 种选区 × 5 种前缀）
node tools/smoke.mjs                             # 端到端四步交互
```

`sent-chip.test.mjs` 直接从已安装的 DSH 里读官方 `ui-primitives`，所以不会对着过期副本测试。找不到源码时会 SKIP 而不是报错——那是环境缺失，不是代码缺陷。

| 测试 | 挡住什么 |
|---|---|
| `port.test.mjs` | 契约回归：在模拟官方 rc.2 的上下文里加载真实 `client.js`，故意不提供 fork 专有 API |
| `sent-chip.test.mjs` | 「引用在气泡里展开」——唯一能挡住这类回归的测试 |
| `smoke.mjs` | 打印完整交互链路与注入的样式表，供人工核对 |

宿主侧加载标记写在 `~/.dsh/cite-inline-loaded.json`，是从外部判断 Host 有没有加载插件的唯一办法。

## 文档

- [docs/design.md](docs/design.md) —— chip 为什么长这样，序列化为什么是 ` @"全文"`
- [docs/porting.md](docs/porting.md) —— 与上游的差异、移植补丁清单、维护方式
- [CHANGELOG.md](CHANGELOG.md) —— 每个版本改了什么

## 已知限制

- 引用 chip 出现在**输入框内**（不是输入框之外的 draft context）。这需要 fork 专有的服务，官方 DSH 没有。副作用是输入框不再纯净，但 chip 可以整枚删除，日常使用不受影响。
- 已发送 chip 的皮肤依赖 DSH 内部的类名 `.mxScHa_reference.rtYPxa_chip`。DSH 大版本更新若改了这个名字，胶囊会退回默认样式——测试会立刻发现。

## 许可证

MIT。原始作品 © choco9527；本移植版按其 MIT 条款分发。
