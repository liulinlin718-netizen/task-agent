---
name: quick-commit
description: 快速生成规范的 git commit message 并提交
---

# Quick Commit

帮用户分析当前变更，生成符合 conventional commits 规范的提交信息并执行提交。

## 流程

1. 运行 `git status` 和 `git diff --staged` 查看暂存区变更
2. 如果暂存区为空，运行 `git diff` 查看工作区变更，先询问是否要 stage
3. 根据变更内容生成中文 commit message，格式: `<type>: <简述>`
4. 展示给用户确认后执行 `git commit`

## Commit 类型

- feat: 新功能
- fix: 修复 bug
- refactor: 重构
- chore: 杂项（依赖、构建、配置）
- docs: 文档
- style: 格式
- test: 测试
