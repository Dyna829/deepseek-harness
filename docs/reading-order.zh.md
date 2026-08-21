# DeepSeek Harness 源码阅读顺序（中文指南）

> 配套本仓库：https://github.com/Dyna829/deepseek-harness
> 分支：`zh-comments`（已加中文注释的版本）
> 推荐阅读时长：3-5 天通读，1-2 周吃透

这份文档是给「想真正读懂 dsh（DeepSeek Harness）」的人写的入门地图。仓库本身已经有很好的英文文档（`docs/architecture.md`、`AGENTS.md`、`docs/glossary.md` 等），但**按什么顺序读**没人写。这份指南就是补这个缺口。

每一步会告诉你：**先读什么、后读什么、为什么这么排、读完应该能回答什么问题**。

---

## 0. 阅读前必看（30 分钟）

| 文档 | 作用 | 跳过会怎样 |
|---|---|---|
| `README.zh.md` | 仓库定位、构建/运行命令 | 不知道 dsh 是个啥 |
| `AGENTS.md` | 仓库布局、给 agent 的工作约定 | 找不到文件在哪 |
| `docs/glossary.zh.md` | 术语表（**Plugin/Service/Event/Context/Fiber/Scope**） | 看不懂后续所有英文 JSDoc |
| `docs/architecture.zh.md` | 架构总览（**必读**） | 看代码不知道哪条线在干嘛 |

读完这一步，你脑子里应该有这张图：
- dsh = 插件化的 AI agent 运行时
- 所有功能都是 Cordis 插件，没有特殊核心
- 一切围绕「session 事件日志」+「agent 状态机」+「可替换的 LLM/Tool 适配器」

---

## 1. 先把 Cordis 弄懂（半天）

dsh 的全部架构都建在 Cordis 上。**不读 Cordis = 看不懂 dsh**。

| 文档 | 重点看什么 |
|---|---|
| `docs/cordis-primer.zh.md` | **必读**。Cordis 的 Service / Event / Effect / Fiber 概念 |
| `docs/cordis-tutorial/` | 跟着走一遍，写几个 demo plugin |
| `vendor/cordis/README.md` | 框架本身的 README（兜底） |

**读完要能回答的问题**：
- 一个 Service 怎么挂到 `ctx` 上？为什么是 `class XxxService extends Service`？
- 怎么发事件（`ctx.emit`）、怎么监听（`ctx.on`）？
- 什么是「可逆效果（Effect）」？为什么 dsh 大量用 `ctx.effect(...)`？
- Fiber 是什么？父子 Fiber 怎么影响生命周期？

**如果还不懂**，先去 `https://github.com/deepseek-ai/cordis`（vendored 在 `vendor/cosmokit`）读 README，别急着往下走。

---

## 2. 理解 dsh 的真相之源：Session（半天）

session 是 dsh 整个系统的「真相之源」。先读这个，其他东西才有挂靠。

| 文档 / 文件 | 重点看什么 |
|---|---|
| `docs/architecture.zh.md` 的「Turn flow」小节 | 整个 turn / step 的概念图 |
| `packages/core/session/README.zh.md` | 包的概览 |
| `packages/core/session/src/types.ts` | **必读**。所有事件类型的形状 `SessionEventMap` |
| `packages/core/session/src/index.ts` | `SessionStore` 服务、`Session.append(...)` |
| `packages/core/session/src/surface.ts` | 「Surface」概念：模型实际看到哪些消息 |
| `packages/core/session/src/repair.ts` | 崩溃恢复怎么补 turn |
| `packages/core/session/src/chunk-rows.ts` | streaming chunk 怎么打包存盘（很巧妙） |
| `packages/core/session/src/request-header.ts` | 「一次 LLM 请求的关键配置」怎么 fold |
| `packages/core/session/src/invariant.ts` | 日志关系型不变量（可跳） |

**读完要能回答的问题**：
- 「append-only 事件日志」怎么变成 LLM 看到的 messages？surface 怎么折叠？
- 「可重放」具体是什么含义？哪些字段必须 frozen？
- `repair.ts` 怎么把一个崩溃残留的尾巴补成合法 turn？
- `SESSION_FORMAT_VERSION = 0` 意味着什么？

**这步是整个 dsh 学习路径的**「Doom 3 入门关」**——最难懂、但后面全靠它。**

---

## 3. Scope 原语（半天）

`@deepseek-ai/dsh-scope` 是 dsh 自研的 scope 路由原语。Cordis 本身没有「让事件只发给某个子上下文」的能力，dsh 就在 Cordis 上面叠了这层。

| 文档 / 文件 | 重点看什么 |
|---|---|
| `packages/core/scope/src/index.ts` | `createScope` / `scopeTarget` / `scopeOf` 三个核心 |
| `packages/core/scope/src/store.ts` | `NamedEntries` / `AnonymousEntries` / `ScopeLayer` |
| `packages/core/scope/src/invariant.ts` | invariant 怎么拦「scope 错配」 |

**读完要能回答的问题**：
- 怎么让「agent A 的 inbox 插了条消息」这件事**只**被 A 的监听者看到？
- `scopeTarget(base, subject)` 的 `base` 和 `subject` 各自干嘛用？
- `ScopeLayer` 怎么让「换一个 agent = 整体替换一个 layer」？

---

## 4. System Prompt 装配（半天）

`ctx.systemPrompt` 是组装 system prompt 的中心：静态 sections + 动态 contexts + tool schemas + 变量。

| 文档 / 文件 | 重点看什么 |
|---|---|
| `docs/architecture.zh.md` 的相关小节 | 装配流程的文字描述 |
| `packages/core/system-prompt/src/index.ts` | 服务本体、瀑布事件 `system-prompt/assemble` |
| `packages/core/system-prompt/src/invariant.ts` | 装配合法性（可跳） |

**读完要能回答的问题**：
- section / context / variable / tool schema 怎么合并成最终 prompt？
- 为什么 `system-prompt/assemble` 是 waterfall 而不是 emit？

---

## 5. Agent 层：接口 + 生命周期（半天）

`@deepseek-ai/dsh-agent` 定义「agent 是什么」、维护活 agent 集合、提供发起者追踪。

| 文档 / 文件 | 重点看什么 |
|---|---|
| `packages/core/agent/src/index.ts` | **`AgentRegistry` 服务**、`AgentFactory` 接口、所有 `agent/*` 事件声明 |
| `packages/core/agent/src/types.ts` | `InboxTarget` 等小类型 |
| `packages/core/agent/src/runtime-types.ts` | `Agent` 接口、所有 `agent/*` 事件的 JSDoc（**重点看每个事件**） |
| `packages/core/agent/src/inbox.ts` | 「待处理消息」的两种列表：`next-turn` / `next-step` |
| `packages/core/agent/src/dispatch.ts` | fused dispatcher（agent + scope 永远绑在一起） |
| `packages/core/agent/src/consumed-work.ts` | 怎么从 log 算出「消费了哪些工作」（解决"没开 step 的 turn"歧义） |
| `packages/core/agent/src/model-selection.ts` | 「step 跑到一半切 model」怎么不撕裂 prompt/request |

**读完要能回答的问题**：
- `Agent` 接口的 6 个方法各干嘛用？`send` / `followup` / `steer` / `inject` 怎么选？
- 发起者（Initiator）追踪用什么实现？为什么需要它？
- `agent/pre-step` / `agent/request` / `agent/turn-stopping` 三个 waterfall 各是什么扩展点？
- inbox 的两种列表怎么合用？`clear` 和 `cancel` 什么区别？

---

## 6. Agent Loop：默认 driver（1 天）

`@deepseek-ai/dsh-agent-loop` 是 dsh 自带的 agent driver，把「agent + session + inbox + LLM + tools」连成「turn → step → request → tool」的循环。

| 文档 / 文件 | 重点看什么 |
|---|---|
| `docs/architecture.zh.md` 的「Turn flow」 | 先看这个，再看代码 |
| `packages/core/agent-loop/src/agent.ts` | **`ReactLoopAgent` 主类**、三大状态机（idle / maintenance / running） |
| `packages/core/agent-loop/src/index.ts` | `AgentLoop` 服务、`setFactory` 注册、配置驱动的 agent 启动 |
| `packages/core/agent-loop/src/tool-calls.ts` | **必读**。parallel pool + exclusive barrier + 模型顺序落盘 |
| `packages/core/agent-loop/src/runtime-context.ts` | 动态 context 怎么投影到 log |
| `packages/core/agent-loop/src/invariant.ts` | **必读**。request-reconstruction 检查（replay 正确性的根） |

**读完要能回答的问题**：
- 一次 turn 怎么开、怎么关？为什么「step 边界」是个关键点？
- `tool-calls.ts` 怎么保证「结果按模型顺序落盘」+「派发可以并行」？
- abort 时怎么合成 `TOOL_ABORTED_BEFORE_DISPATCH` 结果？
- `request-reconstruction` invariant 检查的 7 件事各自是为什么？

---

## 7. Tool 系统（1-2 天）

`@deepseek-ai/dsh-tools` 是 dsh 的「tool 概念」的全部。

| 文档 / 文件 | 重点看什么 |
|---|---|
| `docs/subsystems/tools.md` | 子系统文档 |
| `packages/core/tools/src/index.ts` | **`ctx.tools` 服务**、调度器管线（pre/guard/around/execute/post） |
| `packages/core/tools/src/schema.ts` | **TypeScript-like schema DSL**（必读） |
| `packages/core/tools/src/json-schema.ts` | 受限 JSON Schema 子集 |
| `packages/core/tools/src/presentation.ts` | UI 渲染意图（call card / diff / terminal） |
| `packages/core/tools/src/code-mode.ts` | Code Mode 的 `run_code` 工具 + 子调用桥 |
| `packages/core/tools/src/ts-types.ts` / `py-types.ts` | 生成 SDK 文本（模型在 code 模式里写代码用） |

**读完要能回答的问题**：
- 「一个 tool 怎么注册」「一次 tool call 怎么跑完管线」
- 三种展示模式（native / code / sdk）怎么选？`run_code` 怎么把代码里的子调用桥到「`tool/call` + `tool/result`」事件？
- schema DSL 怎么既给模型看（JSON Schema）、又给作者看（TypeScript-like）？

---

## 8. LLM 抽象层（半天）

`@deepseek-ai/dsh-llm` 把「LLM 调用」抽象成一个可插拔的接缝。

| 文档 / 文件 | 重点看什么 |
|---|---|
| `packages/llm/llm/src/index.ts` | **`LlmRuntime` 服务**、`LlmAdapter` 抽象、`BlockAssembler` |
| `packages/llm/llm/src/types.ts` | `GenerateOptions` / `StreamChunk` / `Message` |
| `packages/llm/llm/src/retry-policy.ts` | 重试策略 |
| `packages/llm/llm/src/call-config.ts` | LLM 请求的「epoch header」（和 session 的 `request/header` 对应） |
| `packages/llm/llm/src/error.ts` | `LlmError`（带 `status` / `providerRetryAfterMs` / `requestId`） |
| `packages/llm/llm-deepseek/src/adapter.ts` | DeepSeek 适配器示例 |
| `packages/llm/llm-pi-ai/src/adapter.ts` | 第三方 pi-ai 适配器示例 |

**读完要能回答的问题**：
- `LlmAdapter` 的契约是什么？实现一个新 provider 要写哪些方法？
- `llm/stream` 事件怎么用？它是个 waterfall —— 可以重试、重放、路由。
- 怎么把所有「请求级」配置折叠成一次 header，让 `request-reconstruction` 能 replay？

---

## 9. Boot & Profile：所有东西怎么串起来（半天）

`@deepseek-ai/dsh-app-boot` 是 `dsh` 这个 bin 的启动胶水。

| 文档 / 文件 | 重点看什么 |
|---|---|
| `packages/boot/app-boot/src/index.ts` | 加载 .env、读 config、起 Cordis Loader |
| `packages/boot/app-boot/src/profile.ts` | profile / bundle 概念怎么实现 |
| `docs/architecture.zh.md` 的「Profiles and bundles」小节 | 概念图 |

**读完要能回答的问题**：
- 一行 `dsh web` 怎么从 `.env` 一直走到跑起来的 Cordis 树？
- `cordis.yml` 里的 row 怎么变成 Cordis 服务？
- patch layer 怎么覆盖 bundle 的默认配置？

---

## 10. Host plane：浏览器/外部世界（半天，可选）

`packages/host/` 是 dsh 跑在浏览器或外部世界时需要的「宿主服务」：webserver、API proxy、目录选择器、插件清单等。

- `host/webserver/` — WebSocket / HTTP 服务
- `host/apiproxy/` — **API 代理层**（浏览器通过它调 dsh 内部 API，所有 RPC 路由）
- `host/directory-picker*/` — 不同平台的目录选择对话框
- `host/plugin-inventory/` — 插件清单
- `host/frontend-static/` — 前端静态资源

**看完知道**：浏览器端的「dsh UI」怎么跟底层 dsh 进程通信。

---

## 11. API Gateway & Remotes（半天，可选）

`packages/api/` 是 dsh 的 RPC 抽象层。

- `api/gateway/` — Typert 类型图驱动的 gateway
- `api/remotes/` — 远程 API 客户端

**看完知道**：浏览器 ↔ dsh 进程 ↔ 远端 dsh 进程之间的 RPC 怎么路由。

---

## 12. 剩下的辅助包（按需）

不是主干，但很常用：

| 包 | 干嘛的 |
|---|---|
| `packages/preset/` | 每会话 agent 组合（preset 是一组 cordis.yml row） |
| `packages/skill/` | skill 提供方 + 加载器 |
| `packages/subagent/` | subagent 委派 |
| `packages/workflow/` | workflow（worker thread 驱动） |
| `packages/compaction/` | session 压缩（避免历史无限增长） |
| `packages/interaction/` | 审批 / 权限 / 用户提问 |
| `packages/credentials/` | 凭证引用（env、.env provider） |
| `packages/settings/` | 用户设置（基于 schemastery） |
| `packages/plan/` | plan 模式（agent 离线制定计划） |
| `packages/storage/` | 持久化抽象 |
| `packages/extensions/` | 拓展点插件 |
| `packages/jobs/` | 异步任务 |
| `packages/goal/` | 目标管理 |
| `packages/hooks/` | Claude Code / Codex hook 桥 |
| `packages/sdk/` | JSON-RPC 协议 + 客户端 |
| `packages/todo/` | `todo_write` 工具 |
| `packages/sandbox/` | 沙箱 |
| `packages/fs/` `lsp/` `terminal/` `shell/` `subprocess/` `e2b/` | 各种 cap 能力（filesystem、LSP、terminal、shell、子进程、E2B 远程沙箱） |
| `packages/guard/` | 循环卫生 + 工具超时 |
| `packages/code-runtime/` | Code Mode 用的代码运行时（worker thread） |
| `packages/util/` `experimental/` `support/` `runtime-diagnostics/` `test-support/` `acp/` `feedback/` `spill/` `mcp/` `web/` | 工具 / 实验 / 支持 / 诊断 / 测试 / ACP / 反馈 / spill / MCP / Web |

---

## 13. Python SDK（半天，可选）

`python/` 目录是 dsh 的 Python 客户端。

| 文件 | 重点 |
|---|---|
| `python/README.md` | 包结构 |
| `python/sdk/` | Python SDK 源码 |
| `python/sdk-runtime/` | 绑定的运行时（实际跑 dsh 进程） |

**看完知道**：Python 程序怎么调 dsh 进程。

---

## 14. 跑几个 example（半天）

`examples/` 下有 6 个可跑的 demo bundle：

- `examples/headless-agent/` — headless 模式（最简单，纯命令跑一次）
- `examples/acp-agent/` — ACP 协议服务器
- `examples/jsonrpc-agent/` — JSON-RPC
- `examples/mcp-memory/` — MCP 协议桥
- `examples/web-cordis/` — 浏览器接入
- `examples/web-schedule/` — 定时任务

挑一个用 `pnpm dsh web` 跑起来，改改 cordis.yml 看效果。

---

## 15. 进阶：subsystem 子系统文档（按需）

`docs/subsystems/` 下有每个主要子系统的专题文档：

- `agent-lifecycle` — agent 生命周期
- `capability-seams` — 能力接缝
- `event-producer-consumer` — 事件生产消费
- `graph-atlas` — 各种图（plugin graph、event graph…）
- `module-graph` — 模块依赖图
- `persistence-catalog` — 持久化目录
- `tool-catalog` — 工具目录
- `tool-execution-pipeline` — 工具执行管线
- `web-styling` — Web UI 样式
- `defensive-patterns` — 防御性编程模式

读主干累了来这里补专项。

---

## 阅读路径速查表

```
┌─────────────────────────────────────────────────────────────┐
│  0. 入门 30 分钟（README、AGENTS、glossary、architecture）    │
│  ↓                                                           │
│  1. Cordis 半天（cordis-primer + tutorial）                    │
│  ↓                                                           │
│  2. Session 半天（types + index + surface + repair）          │
│  ↓                                                           │
│  3. Scope 半天                                                │
│  ↓                                                           │
│  4. System Prompt 半天                                        │
│  ↓                                                           │
│  5. Agent 接口 半天                                            │
│  ↓                                                           │
│  6. Agent Loop 1 天（重点：tool-calls + invariant）            │
│  ↓                                                           │
│  7. Tool 系统 1-2 天（重点：schema DSL + code-mode）           │
│  ↓                                                           │
│  8. LLM 抽象 半天                                              │
│  ↓                                                           │
│  9. Boot & Profile 半天                                       │
│  ↓                                                           │
│  10-15. Host / API / Python / examples / 子系统（按需）        │
└─────────────────────────────────────────────────────────────┘
```

**总投入**：3-5 天通读，1-2 周吃透。

---

## 写新插件的最小路径

如果你读这份文档是为了「我要给 dsh 加个新功能」：

1. 读 `docs/architecture.zh.md`（半小时）
2. 读 `packages/boot/app-boot/src/index.ts`（搞懂「我的插件怎么被加载」）
3. 找现有最像的插件（按用途在 `packages/` 下找）抄结构
4. 注册成 Cordis Service（看 `ctx.tools` / `ctx.llm` 怎么挂）
5. 写测试（看 `tests/` 目录的惯例）

---

## 推荐阅读方式

1. **不要从头读到尾**。这份指南的顺序是经过设计的，跳着读会浪费时间。
2. **每个文件最多读 3 遍**：
   - 第 1 遍扫结构（看 JSDoc、文件头、class 列表）
   - 第 2 遍细看关键路径（按这份指南的标注）
   - 第 3 遍带着具体问题回头看
3. **配合 commit 历史**。`git log -- packages/xxx/` 看每个包最近的修改，能学到「真实的开发流程」。
4. **跑 example + 改 cordis.yml**。纸上看 10 遍不如改 1 遍。

---

## 配套资料

- 中文版已经加在 `zh-comments` 分支的所有 `src/*.ts` 文件顶部（**本仓库**）
- 本文档的英文版本将来可能放到 `docs/reading-order.md`（看上游是否合并）
- 仓库已有文档列表：见 `docs/AGENTS.md`

祝读得开心。
