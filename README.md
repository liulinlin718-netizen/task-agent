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


## 🤝 贡献与反馈

本项目目前处于 **V1.0.0 (Release Candidate)** 阶段。欢迎任何形式的 Issue 和 Pull Request！


---

*Made with ❤️ for Researchers.*
