# TaskAgent v2.0 · 迭代需求文档

> **文档定位**：基于 v1.0 已验证的核心闭环，规划 2.0 版本的工程化升级路径。所有需求均以"可落地"为前提，拒绝空中楼阁。

---

## 一、2.0 设计原则：成本控制 × 产品效果

做 AI 产品始终围绕两条线：

**成本控制（花多少钱）**：控制 Token 消耗。手段包括——记忆管理、上下文裁剪、提示词精简、模型分级、意图路由按需注入。

**产品效果（用得爽不爽）**：响应速度（TTFT）、内容准确度（意图命中率）、主观体验（情绪感知与陪伴感）。

这两条线贯穿每个迭代阶段，不是做完一个再做另一个，而是每个功能都要同时回答："它省了多少 Token？它让用户感知好了多少？"

---

## 二、v1.0 现状诊断

基于代码审查，v1.0 的真实架构如下：

| 模块 | 现状 | 问题 |
|:---|:---|:---|
| **意图识别** | Gemini 用 `responseSchema` 强制 JSON；OpenAI 用 Prompt 尾部追加格式指令 + `JSON.parse` | OpenAI 路径依赖纯文本解析，格式崩溃风险高 |
| **上下文管理** | 每次请求发送：全量当日任务 + 完整聊天历史 + 用户画像 | 聊天越长 Token 越贵，10 轮对话后 Token 翻倍 |
| **Agent 协作** | Chat Agent 和 Report Agent 各自独立，用户需手动切换到报告页面触发 | 无法在对话中自然触发报告生成，割裂了交互流 |
| **模型调用** | 单一模型处理所有场景（对话、意图识别、报告生成） | "杀鸡用牛刀"，简单闲聊也调大模型 |
| **响应方式** | 全量等待（等整个 JSON 返回后才渲染） | 用户感知慢，尤其报告生成时无反馈 |
| **数据存储** | `localStorage`，单 Key 存全量 JSON | 5-10MB 上限，数据量大时读写变慢 |
| **桌面集成** | 有悬浮球和任务抽屉，但关闭即退出 | 无后台常驻，无系统通知 |
| **悬浮球交互** | 基础拖拽和磁吸已实现 | 拖拽偶有卡顿，展开/收起无动画过渡，位置不记忆 |
| **API 配置** | 全局单一 API Key + 单一模型，所有 Agent 共用 | 无法按 Agent 分配不同模型，成本控制粒度粗 |
| **文件处理** | 无 | 用户无法上传会议纪要等文档来批量提取待办事项 |

---

## 三、2.0 需求清单（按优先级排序）

### P0：必须做（直接影响用户体验和产品可用性）

#### 3.1 统一 API 架构：移除双轨代码，全面采用 OpenAI 兼容格式
**问题**：v1.0 的 `AgentService.ts` 中每个函数都有 `if (isOpenAI) { ... } else { Gemini SDK }` 两套逻辑。Gemini 路径用 `@google/genai` SDK + `responseSchema`，OpenAI 路径用 `fetch` + 手搓 JSON 解析。导致：
- 每新增一个功能（如流式输出）都要写两遍代码。
- 两条路径的行为不一致（Gemini 有结构化输出保障，OpenAI 没有）。
- 维护成本翻倍，Bug 也翻倍。

**方案**：统一为 **OpenAI Chat Completions 兼容格式**，只用 `fetch` 调用。
- **核心依据**：Google Gemini 已提供 OpenAI 兼容端点（`https://generativelanguage.googleapis.com/v1beta/openai/`），DeepSeek / Kimi / Qwen 等国内模型也全部兼容 OpenAI 格式。也就是说，**一套 `fetch` 代码可以调用所有模型**。
- **具体执行**：
  1. 删除 `@google/genai` SDK 依赖。
  2. 将所有模型调用统一为 `POST /chat/completions` 格式。
  3. 通过 `baseUrl` 参数区分不同供应商（用户在设置页配置）。
  4. Function Calling 使用 OpenAI 标准的 `tools` + `tool_calls` 字段，所有供应商通用。
  5. 流式输出使用 OpenAI 标准的 `stream: true` + SSE 解析，所有供应商通用。
- **结果**：`AgentService.ts` 中所有 `if (isGemini) / if (isOpenAI)` 分支全部删除，只剩一条代码路径。

**常见供应商 Base URL 参考**：
| 供应商 | Base URL |
|:---|:---|
| Gemini（OpenAI 兼容） | `https://generativelanguage.googleapis.com/v1beta/openai` |
| OpenAI 官方 | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Kimi (Moonshot) | `https://api.moonshot.cn/v1` |
| Qwen (通义千问) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |

#### 3.2 流式输出 + Function Calling 统一调用架构
**问题**：当前用户发消息后，要等 2-5 秒才能看到任何响应。
**方案**：所有请求统一使用 `stream: true` + `tools`（Function Calling）**同时开启**，一次调用解决意图识别和响应输出：
- 模型选择调用 Tool（任务操作）→ SSE 流中增量返回 `tool_calls` 参数 → 解析完毕后执行操作。
- 模型选择不调用 Tool（闲聊）→ SSE 流中逐字返回文本 → 前端打字机效果渲染。
- **核心指标**：TTFT（首字延迟）< 1s。
- **关键优势**：只有一次模型调用，不存在"先判断意图再发第二次请求"的延迟翻倍问题。

#### 3.3 意图识别：规则前置 + Function Calling + Agent 协作
**问题**：当前每条消息都带着全部任务列表 + 全部历史对话发给大模型做意图识别，成本高且慢。
**方案**：两层处理——
1. **第一层：本地规则快速判定**。用正则/关键词匹配过滤明显意图（如包含"添加"、"进度"、"拆解"等词）。命中则直接走 Function Calling 路径（非流式，确保参数完整）。
2. **第二层：模型统一调用兜底**。规则未命中时，走 3.2 的统一调用架构（`stream: true` + `tools`）。模型自行决定是调用 Tool 还是直接对话——不调用任何 Tool 即为 chat（闲聊），这是 Function Calling 范式的天然兜底，无需额外的"置信度判断"。

**Function Calling Tool 清单（审查完毕，5 个）：**

| Tool | 用户场景示例 | 参数 Schema | 对应 Store 操作 |
|:---|:---|:---|:---|
| **`add_tasks`** | "帮我添加一个任务：写论文引言" | `proposedTasks: string[]`, `targetDate?: string` | `addTask()` |
| **`update_task`** | "进度更新到 60%"、"挪到明天"、"备注一下要等数据" | `taskId: string`, `progress?: number`, `date?: string`, `notes?: string`, `priority?: string` | `updateTask()` |
| **`delete_task`** | "把这个任务删了"、"不需要了" | `taskId: string` | `deleteTask()` |
| **`decompose`** | "帮我拆解一下开题报告" | `taskId: string`, `proposedTasks: string[]` | `addTask()` × N |
| **`generate_report`** | "总结一下这周的进度" | `startDate: string`, `endDate: string` | `addReport()` |

**与 v1.0 的对比变化：**
- `update_progress` → 扩展为 **`update_task`**：v1.0 只能改进度，v2.0 支持改日期、备注、优先级等 Task 的任意字段（对齐 Store 的 `Partial<Task>` 能力）。
- 新增 **`delete_task`**：v1.0 无法通过对话删除任务，只能手动操作。
- 新增 **`generate_report`**：v1.0 需要手动去报告页面触发，v2.0 在对话中自然调用。

**明确不是 Tool 的：**
- **`chat`（闲聊）**：在 Function Calling 范式中，模型选择不调用任何 Tool 时，即为普通对话。`chat` 是兜底默认行为，不需要定义为 Tool。
- **`parse_document`（文档解析）**：由文件上传按钮/拖拽触发，不走意图识别流程，是独立的 UI 驱动功能。

**`generate_report` 的 Agent 协作逻辑**：
当模型调用 `generate_report` Tool 时，Chat Agent 将其转发给 Report Agent（使用深度模型）执行 `generateCustomSummary`，并将结果返回到对话流中。这不需要 Multi-Agent 框架，只是基于 Function Calling 的函数分发。

**四个 Agent 的职责划分**：
| Agent | 触发方式 | 模型选型 | 职责 |
|:---|:---|:---|:---|
| **Chat Agent** | 用户每次发消息 | 快速模型（Flash） | 意图识别 + 闲聊 + 情绪陪伴 + 调度 |
| **Daily Summary Agent** | Rollover 时间到达时自动触发（后台静默） | 快速模型（Flash） | 生成简短激励性一日总结（2 句话），存入 `historySummaries` |
| **Report Agent** | 被 `generate_report` Tool 调用 | 深度模型 | 用户主动请求的日报/周报/自定义日期范围报告（结构化深度分析） |
| **文档解析 Agent** | 用户上传文件时由 UI 触发 | 快速模型（Flash） | 从会议纪要/文档中提取待办事项 |

> **Daily Summary Agent vs Report Agent 的区别**：前者是每天自动触发的"2 句话激励"（当前 `RolloverEngine.tsx` 中的 `generateSummary`），后者是用户主动请求的"深度分析报告"（`AgentService.ts` 中的 `generateCustomSummary`）。两者输入数据、输出格式、Prompt 风格完全不同，不应共用同一套配置。
> 
> **注意**：当前 `RolloverEngine.tsx` 也存在 `if (isOpenAI) / else { Gemini SDK }` 双轨代码，Sprint 1 统一 API 时需一并改造。

#### 3.4 滑动摘要 (Rolling Summary)
**问题**：对于一个注重情绪陪伴的对话产品，简单截断历史对话会丢失关键的情绪上下文（如"用户刚才说自己很沮丧"），导致 AI 的回复显得冷漠和断裂。
**方案**：
- **触发条件**：当对话超过 **3 轮**时启动摘要机制。
- **执行流程**：
  1. 将第 3 轮之前的历史对话发送给小模型（异步后台执行，不阻塞用户）。
  2. 小模型生成一句话事实摘要（如："用户正因为跑实验报错而沮丧，决定放弃 Python 改看文献"）。
  3. 实际发送给模型的上下文 = `事实摘要` + `最近 3 轮完整对话`。
- **成本分析**：摘要调用消耗约 200-400 tokens（用 Flash 小模型），但节省了发送 5-10 轮完整历史的 2000+ tokens。**净节省 60%+**。
- **缓存策略**：摘要结果缓存在 ChatSession 对象中（新增 `summary` 字段），只有当新的对话超出已摘要范围时才重新生成。

#### 3.5 上下文路由 + System Prompt 动态组建
**问题**：当前 `systemInstruction` 是一个巨大的模板字符串，无论用户说"今天天气真好"还是"帮我添加任务"，都注入全量任务列表 + 全部指令，浪费 Token。
**方案**：
- 拆分 System Prompt 为模块化片段：`base_persona`（人设）、`task_context`（任务数据）、`chat_instruction`（对话指令）、`report_instruction`（报告指令）。
- **路由策略**（在发送请求前，根据规则层判定结果决定 Prompt 组装方式）：
  - 规则命中任务意图（`add_tasks` / `update_task` / `delete_task` / `decompose`）→ 组装：`base_persona` + `task_context(当日)` + Tools 定义。
  - 规则未命中（走模型兜底）→ 组装：`base_persona` + `chat_instruction` + `task_context(当日)` + Tools 定义。此时模型可能调 Tool 也可能直接对话，两种情况都覆盖。
  - `generate_report` 被模型调用后 → Report Agent 使用：`base_persona` + `task_context(多日)` + `report_instruction`。
  - 文档解析（UI 触发）→ 组装：`base_persona` + 上传文档文本。
- **预估节省**：闲聊场景下 Token 消耗减少 40-60%（不注入完整任务列表）。

---

### P1：应该做（提升产品完整度）

#### 3.6 错误处理与降级策略
**问题**：AI 产品的异常处理直接影响用户信任度。文档此前只覆盖了"正常流程"。
**方案**：
- **网络超时**：fetch 请求 15s 无响应 → 自动取消并显示"网络超时，请重试"，保留用户输入。
- **API 额度用尽（429）**：返回友好提示"API 调用次数已达上限"，并引导用户检查配额或更换 Key。
- **Function Calling 参数异常**：如 `taskId` 不存在或 `progress` 超出 0-100 范围 → 前端校验拦截，提示用户"未找到对应任务"。
- **SSE 流中断**：流式传输过程中连接断开 → 保留已接收的部分文本，在末尾追加"（回复中断，请重试）"。
- **模型返回空内容**：降级为固定兜底回复"收到！还有其他需要帮忙的吗？"（沿用 v1.0 逻辑）。

#### 3.7 会议纪要/文档解析 → 自动提取待办
**场景**：研究生用户经常参加组会、学术报告等，会后有大量待办事项散落在会议纪要中。手动逐条输入效率极低。
**方案**：
- 在对话区域支持文件上传（拖拽或按钮）。
- **支持格式（按优先级）**：
  1. **纯文本 (.txt)**：直接读取，零依赖。
  2. **Word (.docx)**：使用 `mammoth` 库提取文本（纯 JS，无原生编译问题）。
  3. **PDF (.pdf)**：使用 `pdf-parse` 库提取文本（纯 JS，基于 `pdfjs-dist`）。
- **处理流程**：
  1. 用户上传文件 → 前端提取纯文本。
  2. 将文本发送给快速模型，Prompt："从以下会议纪要中提取所有待办事项，返回 JSON 数组"。
  3. 前端展示提取结果列表，用户勾选确认后批量添加为任务。
- **不需要多模态**：这里处理的是文档中的文字信息，不是图片/音频。文本提取是纯代码操作，大模型只负责理解语义和提取结构化信息。

#### 3.8 Per-Agent 模型与 API 配置（含模型分级）
**问题**：v1.0 的设置页只有一套全局 API Key + 模型配置，所有场景共用同一个模型。日常闲聊和深度报告用同一个模型，要么浪费钱，要么质量差。
**方案**：
- 设置页从"单一配置"升级为"分 Agent 配置"：
  - **Chat Agent（对话 + 意图识别 + 摘要）**：API Key + 模型（默认 `gemini-2.0-flash`，追求低延迟低成本）。
  - **Report Agent（日报/周报/自定义报告）**：API Key + 模型（默认 `gemini-2.5-flash`，追求内容质量）。
  - **文档解析 Agent**：可复用 Chat Agent 的配置（无需独立设置）。
- 支持两种常见用法：
  - "同一个 API Key，不同模型版本"（如同一个 Gemini Key 分别调 Flash 和 Pro）。
  - "不同 API Key"（如 Chat 用免费额度的 Key，Report 用付费 Key）。
- UI 设计：默认折叠显示一套统一配置（新用户友好），展开后显示分 Agent 的独立配置（高级用户精细控制）。
- **v1 → v2 迁移兼容**：升级时自动将 v1.0 的全局 API Key + 模型填充到所有 Agent 的配置中，用户无需重新配置。

#### 3.9 悬浮球与任务抽屉交互流畅度优化
**问题**：v1.0 的悬浮球和磁吸侧边栏在拖拽、展开/收起时存在卡顿和闪烁，影响"桌面伴侣"的精致感。
**方案**：
- **拖拽性能**：优化 `mousemove` 事件处理，使用 `requestAnimationFrame` 节流，确保拖拽帧率稳定在 60fps。
- **窗口动画**：悬浮球点击展开/收起时增加缓动动画（easing），而非瞬间跳变。
- **磁吸反馈**：悬浮球靠近屏幕边缘时增加视觉吸附提示（如半透明指示线或轻微震动反馈）。
- **位置记忆**：记住用户上次拖拽悬浮球的位置，重启后自动恢复，避免每次都从默认位置出发。
- **任务抽屉过渡**：侧边栏展开/收起使用 CSS `transform + transition` 替代 `width` 动画，避免重排（reflow）导致的卡顿。

#### 3.10 系统托盘 + 后台常驻
**问题**：用户关闭窗口后应用直接退出，失去了"桌面伴侣"的定位。
**方案**：
- Electron `Tray` API 实现系统托盘图标。
- 关闭窗口时隐藏而非退出（`win.hide()` 替代 `app.quit()`）。
- 托盘右键菜单：显示/隐藏、退出。
- 可选：到达 Rollover 时间时弹出系统通知提醒用户查看日报。

---

### P2：可以做（锦上添花，视开发进度而定）

#### 3.11 数据存储升级
**问题**：`localStorage` 有 5-10MB 上限，且无法在主进程中访问。

**关于 SQLite vs electron-store 的选型分析**：

| 维度 | SQLite (`better-sqlite3`) | SQLite (`sql.js` / WASM) | `electron-store` (JSON) |
|:---|:---|:---|:---|
| **数据模型适配** | 适合关系型数据 | 同左 | 适合文档型/JSON 数据 |
| **当前数据结构** | 需要将 JSON 拆为多张表 | 同左 | 天然兼容，零迁移成本 |
| **跨平台构建** | ❌ 需要 `node-gyp` 原生编译，CI 容易翻车 | ✅ 纯 WASM，无原生编译 | ✅ 纯 JS，无原生编译 |
| **查询能力** | ✅ SQL 全功能 | ✅ SQL 全功能 | ❌ 无查询，只能全量读写 |
| **性能** | ✅ 最优 | ⚠️ WASM 有开销，但够用 | ⚠️ 大数据量时全量序列化慢 |
| **社区生态** | 很多平台在用 | 较少 | Electron 生态主流 |

**v2.0 推荐方案**：先用 `electron-store` 替代 localStorage（零迁移成本，解决容量上限问题）。如果后续数据量增长到需要按条件查询（如"查找所有包含某关键词的历史任务"），再引入 `sql.js`（WASM 版 SQLite，避免原生编译问题）。

#### 3.12 数据加密导入/导出
**方案**：
- 导出：将存储的 JSON 数据用 AES 加密后保存为 `.taskagent` 文件。
- 导入：读取文件 → 解密 → 合并/覆盖当前数据。
- 可用于跨设备迁移和备份。

---

## 四、明确不做的事项（及原因）

| 需求 | 不做原因 |
|:---|:---|
| **Multi-Agent 重型框架（LangChain / CrewAI）** | Agent 协作通过 Function Calling + 函数分发实现，不需要引入框架级依赖。框架适合需要复杂 DAG 编排的场景，我们的场景是线性调用 |
| **知识库 RAG / 向量检索** | 产品定位是任务管理，不是知识库；用户数据量级不需要向量检索 |
| **多模态图片理解** | 文档解析通过文本提取库实现，不需要视觉模型 |
| **团队协作模式** | 需要后端服务器，与 Local-First 架构冲突，属于产品方向级变更 |

---

## 五、开发排期建议

| 阶段 | 内容 | 预估工期 | 核心产出 |
|:---|:---|:---|:---|
| **Sprint 1** | 统一 API 架构 + 流式输出 + Function Calling | 4-5 天 | 消除双轨代码，响应速度大幅提升，意图识别统一 |
| **Sprint 2** | 滑动摘要 + 上下文路由 + Prompt 模块化 + 错误处理 | 4-5 天 | Token 成本下降 60%，对话连贯性提升，异常体验兜底 |
| **Sprint 3** | Per-Agent 模型配置 + Report Agent 协作 | 2-3 天 | 分 Agent 精细控制成本，对话中自然生成报告 |
| **Sprint 4** | 悬浮球交互优化 + 系统托盘 + 后台常驻 | 2-3 天 | 桌面伴侣体验全面升级 |
| **Sprint 5** | 会议纪要文档解析 | 2-3 天 | 核心差异化功能 |
| **Sprint 6** | 数据存储升级 + 加密导入导出 | 2-3 天 | 数据安全与可迁移性 |

---

## 六、核心验收指标

| 指标 | v1.0 现状 | v2.0 目标 |
|:---|:---|:---|
| **TTFT（首字延迟）** | 2-5s（等全量返回） | < 1s（流式首字） |
| **单次对话 Token 消耗** | ~2000-4000 tokens | ~800-1500 tokens（摘要 + 路由后） |
| **意图识别准确率** | ~85%（v1.0 双轨代码，OpenAI 路径偶尔崩溃） | ~95%（统一 Function Calling + 规则前置） |
| **对话上下文保留** | 全量发送（无上限，成本失控） | 摘要 + 最近 3 轮（成本可控，情绪不丢） |
| **数据存储上限** | 5-10MB（localStorage） | 无上限（electron-store） |
| **悬浮球拖拽帧率** | 偶有卡顿（未节流） | 稳定 60fps（rAF 节流） |
| **用户满意度（情绪陪伴）** | 无度量 | 对话中增加 👍/👎 反馈，正向率 > 80% |

---

> **文档版本**：v2.0 Rev.6（终审版） · 更新日期：2026-05-05
>
> **关联文档**：
> - [v0.1 MVP 验证文档](PRD_TaskAgent_MVP_v0.1.md)
> - [v1.0 正式 PRD](PRD_TaskAgent.md)
