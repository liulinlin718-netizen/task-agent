# TaskAgent · AI 驱动的桌面任务管理助手

> **一句话定位**：基于 LLM + Function Calling 的本地化 AI 任务管理工具，用户通过自然语言对话即可完成任务全生命周期管理，兼具情绪陪伴能力。

---

## 一、项目总览

### 1.1 目标用户与场景洞察

**目标用户**：在读研究生（硕士/博士），日常在科研、求职、课程、生活四条线之间高频切换。

**深入场景后发现的典型一天**：

> 上午改论文 → 中午健身 → 下午跑实验 → 晚上准备面试 → 睡前想复盘今天做了什么但已经累得不想动。中间还要处理导师临时布置的任务、回复邮件、约组会时间。

从这类真实场景中提炼出 **4 个核心痛点**：

| 痛点 | 场景还原 | 现有工具的不足 |
|:---|:---|:---|
| **记录成本高** | 想到一个待办，但打开 App、填表单、选日期太麻烦，干脆记在脑子里，第二天就忘了 | 传统 Todo 依赖"主动打开 → 手动填写"，交互链路长 |
| **进度追踪割裂** | 跑完步想记一下，但要找到对应任务 → 点编辑 → 改进度，不如不记 | 无法从日常表达中自动识别任务完成 |
| **缺乏结构化回顾** | 周末想复盘这周做了什么，但任务散落在不同日期，手动汇总费时 | 没有跨日期的智能报告生成能力 |
| **情绪无处安放** | 实验失败、论文被拒时很沮丧，跟工具说"真的累了"只会得到冷冰冰的"已记录" | 工具缺乏情绪感知，无法提供共情回应 |

### 1.2 竞品分析与差异化

| 维度 | Todoist/滴答清单 | Notion | ChatGPT/通用AI | **TaskAgent** |
|:---|:---|:---|:---|:---|
| 任务管理 | ✅ 专业 | ✅ 灵活 | ❌ 无持久化 | ✅ 自然语言驱动 |
| 交互方式 | 表单填写 | 块编辑器 | 纯对话 | **对话 + 面板双模态** |
| 隐式意图 | ❌ | ❌ | ⚠️ 无任务上下文 | ✅ "健完身了"→自动匹配 |
| 报告生成 | ❌ | 手动模板 | ✅ 但无任务数据 | ✅ **基于真实任务数据** |
| 情绪陪伴 | ❌ | ❌ | ⚠️ 通用 | ✅ 融入任务场景 |
| 数据隐私 | 云端 | 云端 | 云端 | **全本地存储** |
| 桌面常驻 | ❌ | ❌ | ❌ | ✅ 悬浮球+磁吸 |

**差异化定位**：市面上的产品要么是"纯工具无智能"（Todoist），要么是"纯智能无工具"（ChatGPT）。TaskAgent 的核心竞争力是 **将 AI 对话能力与结构化任务管理深度融合**——AI 不是附加功能，而是任务操作的主入口。

### 1.3 核心能力

基于以上痛点和差异化分析，TaskAgent 提供 6 项核心能力：

| 能力 | 解决的痛点 | 示例 |
|:---|:---|:---|
| **自然语言任务操作** | 记录成本高 | "帮我加一个准备面试的任务" → 一句话完成 |
| **隐式意图识别** | 进度追踪割裂 | "健完身了" → 自动匹配健身任务 → 进度100% |
| **多维报告生成** | 缺乏结构化回顾 | "总结一下这周" → 5 段式 Markdown 报告 |
| **情绪陪伴** | 情绪无处安放 | "真的累了" → 理解压力，共情回应，拒绝说教 |
| **全本地存储** | 数据隐私顾虑 | AES-256-GCM 加密导出，零云端泄露风险 |
| **桌面深度集成** | 切换 App 打断工作流 | 悬浮球/磁吸侧边栏/系统托盘，随时可见 |

### 1.4 技术栈

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

## 四、产品迭代历程

### 4.1 v1.0：从 0 到 1（MVP 验证）

**目标**：用最小可行产品验证"自然语言对话管理任务"这个核心假设是否成立。

**v1.0 实现了什么**：

| 模块 | v1.0 实现 |
|:---|:---|
| 对话界面 | React 单页应用，基础聊天 UI |
| 意图识别 | 全量 prompt 内嵌指令，无规则层，每条消息都调模型 |
| 任务管理 | 基础 CRUD + 日历视图 + 进度条 |
| 报告生成 | 对话触发，单一 prompt 生成 |
| 用户画像 | 专业/目标/技能/头像 |
| 存储 | localStorage（浏览器本地） |
| API 适配 | Gemini SDK + OpenAI fetch 双轨代码 |

**v1.0 验证了什么**：
- ✅ 用户确实愿意用对话方式管理任务（比填表单快 3-5 倍）
- ✅ 情绪陪伴能力被用户高度认可（"终于有工具不跟我说教了"）
- ✅ 报告生成是高频需求（每周至少 1-2 次）

**v1.0 暴露的问题**：

| 问题 | 表现 | 根因 |
|:---|:---|:---|
| Token 消耗过高 | 10 轮对话后单次请求 2500+ tokens | 全量历史发送，无上下文管理 |
| 响应延迟 | TTFT 2-5s | 无流式输出，等全量返回 |
| 隐式意图识别差 | "健完身了"无法匹配健身任务 | prompt 中未注入当日任务列表 |
| 维护成本高 | 每个功能写两套代码 | Gemini SDK / OpenAI 双轨架构 |
| 存储受限 | 数据量超过 5-10MB 后异常 | localStorage 容量上限 |
| 无桌面集成 | 必须切换到浏览器窗口 | 纯 Web 应用，无 Electron |

### 4.2 v2.0：工程化升级（1.0 → 2.0）

基于 v1.0 暴露的问题，v2.0 围绕"**成本控制 × 产品效果**"两条主线进行系统性重构：

#### 迭代总览

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

## 七、Vibe Coding 协作实录：从 0 到发布

> 以下记录我如何与 AI 编程助手协作，完成 TaskAgent 从概念到 v2.0 发布的全过程。

### Phase 1：需求洞察与产品定义（0 → 概念）

**我做了什么**：从自身研究生生活出发，观察周围同学的工作习惯，提炼出"任务碎片化 + 记录成本高 + 缺乏回顾 + 情绪无处安放"四个痛点。对比 Todoist/Notion/ChatGPT 等竞品，确定了"AI 对话驱动的本地化任务管理"这个切入点。

**产出**：产品定位文档、核心功能清单、UI 草图。

### Phase 2：v1.0 MVP 构建（概念 → 可用产品）

**我做了什么**：定义了 MVP 范围——对话界面 + 任务 CRUD + 日历视图 + 报告生成 + 用户画像。明确"先跑通核心闭环，不追求工程完美"。

**与 AI 的协作**：AI 搭建了 React + TypeScript 项目脚手架、实现了 Store 状态管理、对话 UI 组件、Gemini/OpenAI 双轨 API 调用。我负责 prompt 设计（人设/风格/任务指令）、UI 布局决策、交互流程定义。

**v1.0 成果**：一个可运行的 Web 应用，验证了"用户确实愿意用对话管理任务"的核心假设。

### Phase 3：v2.0 需求定义与架构设计（1.0 → PRD）

**我做了什么**：基于 v1.0 实际使用中暴露的 6 个问题（Token 过高、延迟、隐式意图差、双轨代码、存储受限、无桌面集成），撰写了 `PRD_TaskAgent_v2.0_Iterations.md`，明确了设计原则（成本控制 × 产品效果）、P0/P1/P2 优先级分层，以及每个模块的预期 Token 节省量。

**与 AI 的协作**：AI 帮我审计 v1.0 代码，量化每个模块的 Token 消耗（如"全量历史在 10 轮后消耗 2500+ tokens"），验证 PRD 中的节省预估是否合理。

### Phase 4：v2.0 核心架构重构（PRD → 代码）

**我做了什么**：确定"统一 API + 规则前置 + Function Calling + 滑动摘要"的技术路线。过程中经历了一次关键决策：

**FC vs JSON 的决策过程**：
1. 先实现了 Function Calling（stream + tools），发现每次请求多 ~600 tokens 的 Tool 定义开销，且 stream + tools 同时开启会出现"双重输出"Bug。
2. 尝试 JSON 结构化输出（`response_format: json_object`），省了 ~400 tokens/次，但牺牲了流式首字和 Schema 强约束。
3. **最终选择**：面向发布回到 Function Calling，因为 Schema 约束保证参数正确性、原生流式体验更好、支持未来 Agentic Loop 扩展。Token 开销通过规则前置层和滑动摘要来对冲。

**与 AI 的协作**：AI 实现了 SSE 流解析器、Tool JSON Schema、Prompt 模块拆分和拼接逻辑。我负责"规则层应覆盖哪些 pattern"、"摘要应保留情绪还是只保留事实"、"task_context 是否始终注入"等产品决策。

### Phase 5：桌面集成与 UX 打磨

**我做了什么**：定义悬浮球交互规范（拖拽/磁吸/展开收起的触发条件和动画参数）、进度控制精确范围、报告排序和时间滚轮逻辑。

**与 AI 的协作**：AI 处理了 Electron 多窗口 IPC 通信、原生事件监听（`passive: false`）、`requestAnimationFrame` 节流、AES-256-GCM 加密等底层实现。我通过实际操作发现 Bug（如"slider 拖动时进度跳动"），AI 诊断出根因是 localStorage 跨窗口同步的反馈循环，并实现了防抖修复。

### Phase 6：验证与发布

**验证方式**：
- TypeScript 编译检查：`npx tsc --noEmit`（零错误）
- 对话测试：显式/隐式意图、长对话摘要、报告生成、情绪陪伴
- 打包：`electron-builder --win --dir` → 本地 unpacked 可执行文件
- Git 管理：`v2-dev` 分支开发，CI/CD 通过后合并

### 核心体会

1. **人定义"是什么"和"为什么"，AI 实现"怎么做"**：产品需求、架构决策、优先级排序是人的工作；代码实现、Bug 诊断、技术方案细节交给 AI。
2. **决策需要人来做**：FC vs JSON 的权衡、task_context 注入策略、摘要是否保留情绪——这些产品价值判断不能委托给 AI。
3. **迭代式协作效率最高**：不是一次写完 PRD 让 AI 全部实现，而是"小步实现 → 实际使用 → 发现问题 → 修正方向"的循环。
4. **代码审查仍然必要**：AI 生成的代码偶有逻辑遗漏（空 reply 未兜底、跨窗口同步未防抖），必须通过实际运行和人工审查发现。

---

> **文档版本**：v2.0 Final · 更新日期：2026-05-09
