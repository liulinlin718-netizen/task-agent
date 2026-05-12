# TaskAgent 🧠

[![Electron](https://img.shields.io/badge/Electron-41.3.0-blue.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.0.0-61dafb.svg)](https://react.dev/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

> **TaskAgent** 是一款 **AI 原生 (AI-Native)** 桌面任务管理助手。它不仅仅是一个 Todo List，更是一个能够理解你意图、并缓解进度焦虑的智能伴侣。

---

## ✨ 核心亮点

*   **🕹️ 桌面伴侣交互**：基于 Electron 实现的独立悬浮球 (Floating Orb) 与 磁吸式侧边栏 (Task Center)，不打断心流，随叫随到。
*   **🤖 意图驱动引擎**：内置 **Manager-Worker Agent 架构**。通过自然语言对话（如“帮我拆解开题报告”或“今天写了三页”）直接操控任务状态。
*   **⏳ 柔性进度管理**：抛弃传统的 0/1 打钩模式，采用 **0-100% 进度滑块**。量化科研进展，拒绝二元挫败感。
*   **🌙 柔性重置 (Rollover)**：自定义“逻辑新一天”的起点（如凌晨 2:00）。未完成任务自动结转，消灭学术人群的“熬夜刷新焦虑”。
*   **🔒 Local-First 隐私**：数据完全本地化存储，不经过第三方服务器，确保科研灵感与进度的绝对私有。
*   **🔌 多模型支持**：原生支持 Google Gemini，并兼容 OpenAI 协议下的 8+ 种国内外主流模型（DeepSeek, Kimi, Qwen 等）。

---

## 🛠️ 技术栈

*   **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Framer Motion
*   **Desktop**: Electron, IPC (Inter-Process Communication)
*   **AI Engine**: Google Generative AI SDK, OpenAI API Standard
*   **State Management**: React Context + LocalStorage Persistence

---

## 🚀 快速开始

### 1. 环境准备
确保你的电脑已安装 [Node.js](https://nodejs.org/) (建议 v18+)。

### 2. 克隆与安装
```bash
# 安装依赖
npm install
```

### 3. 配置 API Key
1. 启动应用后，在应用内的 **Settings (设置)** 页面直接输入你的 API Key。
2. 支持配置自定义 API Base URL（可接入私有部署或国产模型）。

### 4. 运行开发版本
```bash
# 启动 Electron 开发模式
npm run dev:electron
```

### 5. 打包构建
```bash
# 构建 Windows 安装包 (.exe)
npm run build:exe

# 构建 macOS 安装包 (.dmg) - 需在 macOS 环境运行
npm run build:mac
```

---

## 📂 项目结构

*   `electron-main.cjs`: Electron 主进程逻辑（窗口管理、磁吸算法）。
*   `src/services/AgentService.ts`: AI Agent 核心逻辑，处理意图路由与结构化 JSON 解析。
*   `src/Store.tsx`: 全局响应式状态管理与本地持久化。
*   `src/components/FloatingBallWindow.tsx`: 桌面悬浮球实现。
*   `src/components/RolloverEngine.tsx`: 逻辑日重置与任务结转引擎。

---


# TaskAgent v2.0.0 · AI 驱动的桌面任务管理助手

> 基于 LLM + Function Calling 的本地化 AI 任务管理工具，用户通过自然语言对话即可完成任务全生命周期管理，兼具情绪陪伴能力。

## 🎯 核心能力

| 能力 | 说明 | 示例 |
|:---|:---|:---|
| **自然语言任务操作** | 对话式增删改查，无需手动填表 | "帮我加一个准备面试的任务" |
| **隐式意图识别** | 从日常表达中自动匹配任务 | "健完身了" → 健身任务进度100% |
| **多维报告生成** | 对话触发结构化 Markdown 报告 | "总结一下这周" → 5 段式报告 |
| **情绪陪伴** | 识别负面情绪，共情回应 | "真的累了" → 理解压力，拒绝说教 |
| **全本地存储** | 数据不上云，AES-256-GCM 加密导出 | 零隐私泄露风险 |
| **桌面深度集成** | 悬浮球 / 磁吸侧边栏 / 系统托盘 | 随时可见，不打断工作流 |
| **文档解析** | 上传 txt/docx/pdf，附带指令一起发送 | "帮我把会议纪要做成待办" |

## 🛠 技术栈

```
前端:   React 19 + TypeScript + TailwindCSS 4 + Framer Motion
桌面:   Electron 41（多窗口 + IPC + 系统托盘）
AI:     OpenAI Chat Completions 兼容协议 + Function Calling
存储:   Electron fs JSON（本地持久化）
文档:   mammoth（docx） + pdfjs-dist（pdf）
加密:   AES-256-GCM + PBKDF2（10万次迭代）
```

## 🏗 Agent 架构

- **4 Agent 协作**：Chat Agent（入口）→ Report Agent（深度报告）→ Daily Summary Agent（自动日报）→ Document Agent（文件解析）
- **两层意图识别**：本地规则层（正则，零 Token）+ 模型 Function Calling 层（语义匹配）
- **滑动摘要**：长对话自动压缩上下文，超过 3 轮后仅保留摘要 + 最近 3 轮
- **Prompt 模块化**：5 个独立模块按需组装，减少无关上下文注入

---

## 🚀 v2.0.0 相比 v1.0.0 的主要迭代

### 架构重构
| 迭代点 | v1.0 | v2.0 |
|:---|:---|:---|
| **API 架构** | Gemini SDK + fetch 双轨 | 统一 OpenAI 兼容格式（新增供应商零改动） |
| **意图识别** | 单层（每条消息都调模型） | 两层（规则前置 + FC 兜底，40% 请求零 Token） |
| **上下文管理** | 全量发送聊天历史 | 滑动摘要 + 3 轮窗口（长对话 Token 节省 72%） |
| **Prompt 结构** | 单一模板字符串 | 5 模块按需组装 |
| **模型配置** | 全局单一 | Per-Agent 分级（Flash 闲聊 / Pro 报告） |
| **存储** | localStorage（5-10MB 上限） | Electron fs JSON（无容量限制） |

### 新增功能
- ✨ **悬浮球**：可拖拽 + 磁吸边缘 + 展开快速对话 + 固定模式
- ✨ **磁吸侧边栏**：吸附屏幕边缘，鼠标悬停展开任务列表
- ✨ **系统托盘**：关闭窗口后台常驻，双击恢复
- ✨ **文档解析**：上传 txt/docx/pdf → 附带用户指令一起发送给 LLM
- ✨ **加密导出/导入**：AES-256-GCM + PBKDF2（10万次迭代）
- ✨ **多会话管理**：独立聊天会话 + 自动标题生成
- ✨ **报告持久化**：历史报告列表 + 时间滚轮浏览

### Bug 修复
- 🐛 修复空回复气泡（模型返回空 content 时占位消息残留）
- 🐛 修复进度条拖动跳动（跨窗口 localStorage 同步反馈循环）
- 🐛 修复 PDF 解析失败（worker 从 CDN 改为本地打包）
- 🐛 修复推荐任务挂载到错误消息（闭包 stale state 问题）

### 意图准确率提升
| 测试用例 | v1.0 | v2.0 |
|:---|:---|:---|
| "健完身了" | ❌ | ✅ |
| "跑完步了，出了一身汗" | ❌ | ✅ |
| "帮我添加一个任务" | ✅ | ✅ |
| "总结一下这周" | ✅ | ✅ |

---

📖 完整项目介绍请查看 [TaskAgent项目最终介绍.md](TaskAgent项目最终介绍.md)

---

*Made with ❤️ for Researchers.*
