# TaskAgent · AI 驱动的桌面任务管理助手

> **一句话定位**：基于 LLM + Function Calling 的本地化 AI 任务管理工具，用户通过自然语言对话即可完成任务全生命周期管理，兼具情绪陪伴能力。

---

## 一、项目总览

### 1.1 解决什么问题

传统 Todo 应用依赖"打开 App → 手动填表单 → 勾选完成"的流程，交互成本高，缺乏智能化。研究生群体任务碎片化严重（科研、求职、生活交叉），需要一个能"听懂自然语言 + 自动匹配任务 + 提供情绪支持"的智能助手。

### 1.2 核心能力

| 能力 | 说明 | 示例 |
|:---|:---|:---|
| **自然语言任务操作** | 对话式增删改查，无需手动填表 | "帮我加一个准备面试的任务" |
| **隐式意图识别** | 从日常表达中识别任务操作 | "健完身了" → 自动匹配健身任务 → 进度100% |
| **多维报告生成** | 对话触发结构化 Markdown 报告 | "总结一下这周" → 生成含概览/审计/建议的报告 |
| **情绪陪伴** | 识别负面情绪，共情回应 | "真的累了" → 理解压力，拒绝说教 |
| **全本地存储** | 数据不上云，AES-256-GCM 加密导出 | 零隐私泄露风险 |
| **桌面深度集成** | 悬浮球/磁吸侧边栏/系统托盘 | 随时可见，不打断工作流 |

### 1.3 技术栈

```
前端:   React 19 + TypeScript + TailwindCSS 4 + Framer Motion
桌面:   Electron 41（多窗口 + IPC + 系统托盘）
AI:     OpenAI Chat Completions 兼容协议 + Function Calling
存储:   Electron fs JSON（本地持久化，替代 localStorage）
文档:   mammoth（docx） + pdfjs-dist（pdf）
加密:   AES-256-GCM + PBKDF2（10万次迭代）
```

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────┐
│                 Electron Main Process                │
│   ┌────────┐  ┌──────┐  ┌───────────┐  ┌────────┐  │
│   │ 主窗口 │  │悬浮球│  │磁吸侧边栏│  │系统托盘│  │
│   └────────┘  └──────┘  └───────────┘  └────────┘  │
│   ┌──────────────────────────────────────────────┐  │
│   │  IPC 通信 · fs JSON 持久化 · AES 加密导出   │  │
│   └──────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│                 Renderer (Vite + React)               │
│                                                       │
│   ┌──────────────────────────────────────────────┐   │
│   │          Store（全局状态 · Context）           │   │
│   │  tasks / chatSessions / reports / profile     │   │
│   │  settings / historySummaries                   │   │
│   └───────────────────┬──────────────────────────┘   │
│                       ↓                               │
│   ┌─────────────────────────┐  ┌─────────────────┐   │
│   │     AgentService.ts     │  │ DocumentParser   │   │
│   │  规则层 + FC + Prompt   │  │ txt/docx/pdf     │   │
│   │  模块 + 滑动摘要       │  │ → LLM 提取待办   │   │
│   └───────────┬─────────────┘  └─────────────────┘   │
│               ↓                                       │
│   ┌─────────────────────────────────────────────┐    │
│   │      OpenAI Chat Completions API            │    │
│   │   (Gemini / DeepSeek / Qwen / Kimi / ...)   │    │
│   └─────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────┤
│  UI 组件                                              │
│  AgentChat · TaskHub · History · Profile ·            │
│  Settings · FloatingBall · FloatingTaskCenter ·       │
│  RolloverEngine                                       │
└─────────────────────────────────────────────────────┘
```

---

## 三、Agent 架构详解

### 3.1 多 Agent 协作体系

本项目设计了 **4 个职责分离的 Agent**，通过 Chat Agent 作为入口进行调度：

```
用户输入 ─→ Chat Agent（入口）
              ├─→ 直接处理: 闲聊 / 任务CRUD / 拆解
              ├─→ 转发给 Report Agent: 生成结构化报告
              └─→ （后台）Daily Summary Agent: 每日自动日报
            
文件上传 ─→ Document Agent: 提取待办 → 批量确认
```

| Agent | 模型 | 触发方式 | 职责 |
|:---|:---|:---|:---|
| **Chat Agent** | 快速模型（Flash） | 每条用户消息 | 意图识别 + 任务操作 + 闲聊 + 调度 |
| **Report Agent** | 深度模型（Pro） | Chat Agent 调度 | 生成多日结构化 Markdown 报告（60s 超时） |
| **Daily Summary Agent** | 快速模型 | 定时自动触发 | 2 句话激励性日报 + 系统通知 |
| **Document Agent** | 快速模型 | 用户上传文件 | txt/docx/pdf → 纯文本 → LLM 提取待办 |

### 3.2 意图识别：两层架构

```
用户输入: "健完身了"
  ↓
┌────────────────────────────────────┐
│ 第一层: matchLocalRule()           │
│ 正则/关键词匹配（本地，零延迟）     │
│                                    │
│ "添加.*任务"  → add_tasks          │
│ "删除.*任务"  → delete_task        │
│ "进度.*\d+"   → update_task        │
│ "拆解|细化"   → decompose          │
│ "总结.*周"    → generate_report    │
│                                    │
│ "健完身了"    → ❌ 未命中           │
└──────────────┬─────────────────────┘
               ↓ 未命中
┌────────────────────────────────────┐
│ 第二层: 模型 + Function Calling     │
│                                    │
│ 模型看到 task_context 中有         │
│ "abc123: 健身 (Progress: 0%)"      │
│ → 调用 update_task(abc123, 100)    │
│ → 返回 "💪 健身完成！继续保持！"    │
└────────────────────────────────────┘
```

**为什么需要两层**：
- **第一层（规则）**：命中率约 40%，零 Token 消耗，零延迟。覆盖"添加任务"等显式表达。
- **第二层（模型 FC）**：处理隐式表达（"健完身了"→匹配健身任务），需要理解自然语言语义。

### 3.3 Function Calling 工作机制

**请求构建**：每次请求携带 5 个 Tool 定义，模型自主决定是否调用：

```json
{
  "model": "gemini-2.5-flash",
  "stream": true,
  "messages": [
    { "role": "system", "content": "You are 任务助理...\n[Today's Tasks]\nabc123: 健身 (0%)" },
    { "role": "user",   "content": "健完身了" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "update_task",
        "description": "当用户提到完成、做了、做到某个进度时调用",
        "parameters": {
          "type": "object",
          "properties": {
            "taskId":   { "type": "string", "description": "匹配的任务ID" },
            "progress": { "type": "number", "description": "0-100" }
          },
          "required": ["taskId"]
        }
      }
    },
    { "...add_tasks..." },
    { "...delete_task..." },
    { "...decompose..." },
    { "...generate_report..." }
  ]
}
```

**响应处理**（SSE 流）：

```
情况 A — 调用 Tool（任务操作）:
  模型返回 tool_calls → 客户端逐 chunk 拼接 arguments
  → JSON.parse → 分发: update_task("abc123", {progress: 100})
  → 显示回复

情况 B — 不调用 Tool（闲聊）:
  模型返回 content → 逐字渲染到 UI（原生流式打字机）

结束条件: SSE 收到 [DONE] 信号
```

**6 个 Intent 的完整设计**：

| Intent | 触发场景 | Tool 参数 | 客户端操作 |
|:---|:---|:---|:---|
| `add_tasks` | "帮我加个任务" | proposedTasks[], targetDate? | addTask + 确认 UI |
| `update_task` | "健完身了" / "进度60%" | taskId, progress, notes? | updateTask |
| `delete_task` | "删掉这个任务" | taskId | deleteTask |
| `decompose` | "拆解一下开题报告" | taskId, proposedTasks[] | 展示拆解方案 |
| `generate_report` | "总结一下这周" | startDate, endDate | 调用 Report Agent |
| `chat` | 闲聊/情绪表达 | （不调用 Tool，直接输出文字） | 流式渲染 |

### 3.4 System Prompt 模块化 + 上下文路由

System Prompt 拆分为 5 个独立模块，按意图按需组装：

```
mod_base_persona(state)       → 人设 + 风格 + 当前日期（~80 tokens）
mod_task_context(state)       → 当日任务列表 + ID（用于 FC 匹配）
mod_chat_instruction()        → 对话规则 + 情绪陪伴指引
mod_profile_context(state)    → 用户画像（专业/目标/技能）
buildChatContext(session)     → 滑动摘要 + 最近 3 轮对话
```

**路由策略**：

```typescript
function buildSystemPrompt(state, ruleHint) {
  const persona = mod_base_persona(state);
  const taskCtx = mod_task_context(state);   // 始终注入
  const chatCtx = buildChatContext(session);

  if (ruleHint) {
    // 规则命中 → 精简 Prompt（省略 chat_instruction、profile）
    return [persona, taskCtx, chatCtx].join("\n\n");
  }
  // 模型兜底 → 完整 Prompt
  return [persona, mod_chat_instruction(), taskCtx,
          mod_profile_context(state), chatCtx].join("\n\n");
}
```

**关键设计决策**：`task_context` 始终注入（即使是闲聊）。原因：不注入时模型无法识别"健完身了"→匹配健身任务。同时增加 chat 守卫指令防止模型主动提及任务列表。

### 3.5 滑动摘要（Rolling Summary）

解决长对话 Token 线性增长问题：

```
对话消息: M1  M2  M3  M4  M5  M6  M7  M8  M9  M10
          |←────── 已摘要 ──────→|  |←─ 最近3轮 ─→|
                    ↓
          "用户因实验报错沮丧，决定改看文献"（一句话摘要）

实际发送: [摘要] + [M5~M10 完整内容]
```

- **触发条件**：对话超过 3 轮（6 条消息）
- **执行方式**：后台异步，不阻塞用户输入
- **缓存策略**：摘要存储在 `ChatSession.summary` 字段，`summarizedUpTo` 记录已摘要位置，增量更新
- **Token 效果**：长对话从 2500+ tokens → ~700 tokens（节省 ~72%）

### 3.6 Report Agent

独立模型配置，支持 Per-Agent 分级：

```typescript
function getReportConfig(state) {
  return {
    apiKey: state.settings.reportApiKey || state.settings.apiKey,      // 留空则沿用全局
    baseUrl: state.settings.reportApiBaseUrl || state.settings.apiBaseUrl,
    model: state.settings.reportModel || state.settings.apiModel,
  };
}
```

报告结构（5 段式）：整体概览 → 任务进度审计 → 关键问题和建议 → 抓紧行动 → 结语

生成后自动同步到历史报告列表，时间滚轮按目标日期降序 + 连续日期填充。

### 3.7 错误处理与降级

| 场景 | 策略 |
|:---|:---|
| 网络超时（15s/60s） | `AbortSignal.timeout` + 用户提示 |
| API 401 | "请检查 API Key 是否正确或已过期" |
| API 429 | "调用次数已达上限，请稍后重试" |
| FC 参数缺失 | 客户端校验 taskId 是否存在 |
| 报告生成失败 | 显示真实错误信息（非通用提示） |
| 摘要生成失败 | 静默降级，不阻塞主流程 |

---

## 四、v2.0 核心迭代（相对于 v1.0）

### 4.1 迭代总览

| 迭代点 | v1.0 | v2.0 | 效果 |
|:---|:---|:---|:---|
| **API 架构** | 双轨（Gemini SDK + fetch） | 统一 OpenAI 兼容格式 | 消除所有 if/else 分支，新增供应商零改动 |
| **意图识别** | 单层（全量发模型） | 两层（规则前置 + FC 兜底） | 40% 请求零 Token，隐式意图准确率提升 |
| **上下文管理** | 全量发送聊天历史 | 滑动摘要 + 3 轮窗口 | 长对话 Token 节省 72% |
| **Prompt 结构** | 单一模板字符串 | 5 模块按需组装 | 闲聊场景减少无关上下文注入 |
| **模型配置** | 全局单一 | Per-Agent 分级 | 闲聊用 Flash（快），报告用 Pro（深） |
| **存储** | localStorage（5-10MB 上限） | Electron fs JSON | 无容量限制 + IPC 安全隔离 |
| **桌面集成** | 基础窗口 | 悬浮球 + 磁吸 + 托盘 + 60fps 拖拽 | 操作系统级常驻，不打断工作流 |
| **文档解析** | 无 | txt/docx/pdf → LLM 提取 | 批量导入待办 |
| **加密** | 无 | AES-256-GCM + PBKDF2 | 安全导出/导入 |

### 4.2 Token 效率评估

| 场景 | v1.0 | v2.0 | 节省 |
|:---|:---|:---|:---|
| 规则命中（40%请求） | 500-800 | **0**（本地处理）+ FC ~600 | ~40% 请求免调用 |
| 短对话（1-4 轮） | 500-800 | ~1000 | 持平（FC 增加固定开销） |
| 长对话（10+ 轮） | 2500+ | ~1100 | **~56%** |

### 4.3 意图准确率

| 测试用例 | 预期 | v1.0 | v2.0 |
|:---|:---|:---|:---|
| "帮我添加一个任务" | add_tasks | ✅ | ✅ |
| "健完身了" | update_task | ❌ | ✅ |
| "跑完步了，出了一身汗" | update_task | ❌ | ✅ |
| "真的累了，明天还要面试" | chat | ✅ | ✅ |
| "总结一下这周" | generate_report | ✅ | ✅ |
| "把这个任务拆解一下" | decompose | ✅ | ✅ |

**v2.0 关键提升**：隐式意图识别能力。得益于 `task_context` 始终注入 + FC 的语义匹配。

---

## 五、桌面工程细节

### 5.1 悬浮球系统

- **拖拽**：`requestAnimationFrame` 节流，每帧只执行一次 `setBounds`，稳定 60fps
- **磁吸**：靠近屏幕边缘 100px 内 → `box-shadow inset` 内发光反馈 → 释放后自动吸附
- **展开/收起**：`easeOutCubic` 200ms 缓动动画
- **快速对话**：悬浮球内嵌精简版 AgentChat，支持固定（Pin）模式

### 5.2 磁吸侧边栏

- 吸附状态：收缩为 3px 蓝色边条，鼠标悬停展开
- 展示当日任务列表 + 进度环
- 进度修改：仅进度环区域响应滚轮（`passive: false` + `preventDefault`）

### 5.3 系统托盘

- 原生像素 Buffer 生成 32×32 蓝色渐变圆点图标（零外部资源依赖）
- 关闭窗口 → 隐藏到托盘（非退出），后台常驻
- 双击托盘图标恢复主窗口

### 5.4 跨窗口状态同步

多个 Electron BrowserWindow 通过 localStorage `StorageEvent` 同步状态，增加 50ms 防抖 + `isLocalUpdate` 标志防止快速拖动 slider 时的反馈循环。

### 5.5 数据安全

- **存储**：`app.getPath('userData')` 目录下 JSON 文件，IPC 隔离
- **导出加密**：AES-256-GCM + PBKDF2（10 万次迭代 + 随机 salt + 随机 IV）
- **导入解密**：密码验证 → GCM 认证标签校验（防篡改）→ 状态还原

---

## 六、项目文件结构

```
task-agent/
├── electron-main.cjs          # 主进程（窗口管理/托盘/IPC/存储/加密）437行
├── electron-preload.cjs        # 预加载脚本（暴露安全 API）
├── src/
│   ├── services/
│   │   ├── AgentService.ts     # 核心 AI 服务（415行）
│   │   │   ├── callChatCompletion()    — 统一 API 客户端
│   │   │   ├── matchLocalRule()        — 规则层（5 条正则）
│   │   │   ├── buildSystemPrompt()     — 模块化 Prompt 组建
│   │   │   ├── generateRollingSummary()— 滑动摘要引擎
│   │   │   ├── processAgentRequest()   — 主请求入口
│   │   │   └── generateCustomSummary() — Report Agent 入口
│   │   ├── DocumentParser.ts   # 文档解析（76行）
│   │   └── StreamParser.ts     # SSE 流解析器（解析 FC 流式响应）
│   ├── components/
│   │   ├── AgentChat.tsx       # 主对话界面（529行）
│   │   ├── TaskHub.tsx         # 任务面板（250行）
│   │   ├── History.tsx         # 历史记录 + 报告（549行）
│   │   ├── Settings.tsx        # 设置页（Per-Agent 配置）
│   │   ├── Profile.tsx         # 用户画像
│   │   ├── RolloverEngine.tsx  # 日报自动生成（95行）
│   │   ├── FloatingBallWindow.tsx       # 悬浮球（292行）
│   │   └── FloatingTaskCenterWindow.tsx # 磁吸侧边栏（273行）
│   └── Store.tsx               # 全局状态管理（508行）
├── package.json
└── vite.config.ts
```

---

## 七、Vibe Coding 协作实录：从需求到发布

> 以下记录我如何与 AI 编程助手协作，完成从 v1.0 到 v2.0 的完整迭代。

### 第一阶段：需求定义与架构设计

**我做了什么**：基于 v1.0 的实际使用痛点（Token 消耗过高、响应慢、无桌面集成），撰写了 `PRD_TaskAgent_v2.0_Iterations.md`，明确了设计原则（成本控制 × 产品效果）、优先级分层（P0/P1/P2），以及每个模块的预期 Token 节省量。

**与 AI 的协作**：AI 帮我梳理了 v1.0 的代码架构现状，量化了每个模块的 Token 消耗（如 "全量历史发送在 10 轮后消耗 2500+ tokens"），帮助我验证 PRD 中的节省预估是否合理。

### 第二阶段：核心架构重构

**我做了什么**：确定了"统一 API + 规则前置 + Function Calling + 滑动摘要"的技术路线。在过程中经历了一次关键决策——**是否用 Function Calling**。

**决策过程**：
1. 最初实现了 Function Calling（stream + tools），发现两个问题：每次请求多 ~600 tokens 的 Tool 定义开销；stream + tools 同时开启会出现"双重输出"Bug（模型同时产生文字和 tool_call）。
2. 于是尝试了 JSON 结构化输出（`response_format: json_object`），用 prompt 内自然语言描述 intent，省了 ~400 tokens/次，但牺牲了流式首字和 Schema 强约束。
3. **最终选择**：面向发布版本回到 Function Calling，因为 Schema 约束保证参数正确性、原生流式提供更好的用户体验、且支持未来扩展（多步调用/Agentic Loop）。Token 开销通过规则前置层（40% 请求免 FC 调用）和滑动摘要来对冲。

**与 AI 的协作**：AI 负责具体的代码实现——SSE 流解析器、Tool 定义的 JSON Schema、Prompt 模块的拆分和拼接逻辑。我负责定义"规则层应该覆盖哪些 pattern"、"摘要应该保留情绪信息还是只保留事实"等产品决策。

### 第三阶段：桌面集成与 UX 打磨

**我做了什么**：定义了悬浮球的交互规范（拖拽/磁吸/展开收起的触发条件和动画参数）、进度控制的精确范围（仅进度环区域响应滚轮）。

**与 AI 的协作**：AI 处理了 Electron 多窗口通信（IPC）、原生事件监听（`passive: false` 阻止页面滚动）、`requestAnimationFrame` 节流等底层实现。我通过实际操作发现 Bug（如"slider 拖动时进度跳动"），AI 诊断出根因是 localStorage 跨窗口同步的反馈循环，并实现了防抖修复。

### 第四阶段：验证与发布

**验证方式**：
- TypeScript 编译检查：`npx tsc --noEmit`（零错误）
- 实际对话测试：覆盖显式/隐式意图、长对话摘要、报告生成、情绪陪伴等场景
- 打包验证：`electron-builder --win --dir` 生成 unpacked 可执行文件，本地运行确认

**Vibe Coding 的核心体会**：

1. **人定义"是什么"和"为什么"，AI 实现"怎么做"**：我负责产品需求、架构决策、优先级排序；AI 负责代码实现、Bug 诊断、技术方案细节。
2. **决策需要人来做**：FC vs JSON 的权衡、task_context 是否始终注入、摘要是否保留情绪——这些涉及产品价值判断的决策，AI 可以分析利弊但不能替代决定。
3. **迭代式协作效率最高**：不是一次性写完 PRD 然后让 AI 全部实现，而是"小步实现 → 实际使用 → 发现问题 → 修正方向"的循环。每次对话解决一个具体问题，累积起来完成整体重构。
4. **代码审查仍然必要**：AI 生成的代码偶有逻辑遗漏（如空 reply 未做兜底、跨窗口同步未防抖），需要通过实际运行和人工审查来发现。

---

> **文档版本**：v2.0 Final · 更新日期：2026-05-09
