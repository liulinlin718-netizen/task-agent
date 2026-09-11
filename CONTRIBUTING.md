# 参与贡献

欢迎改进 TaskAgent 的功能、文档、测试与桌面兼容性。提交前可以在 [Issues](https://github.com/liulinlin718-netizen/task-agent/issues) 搜索已有讨论；范围较大的改动先说明问题和预期行为，便于避免重复工作。

## 本地开发

需要 Node.js 22.13 或以上版本、npm 和 Git。安装依赖时保留开发依赖。

```bash
git clone https://github.com/liulinlin718-netizen/task-agent.git
cd task-agent
npm ci
npm run setup:electron
npm run dev:electron
```

`setup:electron` 运行 Electron 官方安装器，已安装时可重复执行。只开发普通界面可以运行 `npm run dev`；窗口、托盘、主动提醒和备份需要 Electron。

开发版默认也会持久化数据。需要独立开发资料时，可在启动前设置 `TASKAGENT_USER_DATA_DIR` 为专用目录；自动化桌面测试已使用隔离目录。不要将真实 API Key、个人对话、备份或本地数据文件加入提交。

代码入口见 [架构文档](docs/architecture.md#模块关系)。前端业务逻辑位于 `src/`，桌面窗口与 IPC 位于根目录 Electron 入口，事务存储和提醒策略位于 `electron/`。

## 测试

```bash
npm run lint
npm test
npm run build
```

也可运行 `npm run verify` 一次完成上述检查。测试入口 `scripts/test.mjs` 自动发现 `tests/*.test.ts` 和 `tests/*.test.cjs`；新增测试应验证可观察行为、回归条件或边界。

涉及桌面交互时，在图形桌面环境运行：

```bash
npm run test:e2e
```

测试使用临时数据目录和本地模拟模型服务，无需真实 API Key。默认自行启动开发服务器，请保持 3000 端口空闲；Playwright 失败诊断输出位于 `test-results/`。

设置 `TASKAGENT_E2E_EXECUTABLE` 为打包应用的可执行文件绝对路径后，同一命令会测试该应用并跳过开发服务器。macOS 应指定应用内的 `Contents/MacOS/TaskAgent`，Windows 应指定安装目录中的 `TaskAgent.exe`。

模拟测试验证客户端在给定模型响应下的行为。若报告线上模型兼容性，请同时提供服务地址类型、模型版本、复现输入与脱敏后的错误；不要把模拟测试结果表述为线上模型准确率。

## 构建安装包

```bash
npm run build:mac  # macOS DMG / ZIP
npm run build:exe  # Windows NSIS 安装包
```

输出目录为 `release/`。macOS 包在 macOS 上构建，Windows 包建议在 Windows 上构建。发布目标为 macOS arm64、macOS x64 和 Windows x64；使用不同架构产物时必须在相应设备上验证。

需要显式选择架构时，可以向 electron-builder 传入参数：

```bash
npm run build:mac -- --arm64 --publish never
npm run build:mac -- --x64 --publish never
npm run build:exe -- --x64 --publish never
```

文件命名为 `TaskAgent-<版本>-<系统>-<架构>.<扩展名>`。构建通过不等于签名、公证或在所有目标设备上运行通过。当前 macOS 使用 ad-hoc 签名，Windows 未签名；修改发行流程时应同时更新 README 和 Release 中的说明。

### 持续集成与发行

[检查工作流](.github/workflows/check.yml) 对分支推送和 Pull Request 运行跨平台验证；[发行工作流](.github/workflows/build.yml) 由 `v*` 标签触发。发行前需保持标签、`package.json` 版本和 `CHANGELOG.md` 对应版本一致。

发行工作流先验证，再分别构建三个目标并测试打包应用。产物经过架构、完整性及文件集合检查后汇总为带 `SHA256SUMS` 的发行包，先上传到草稿并核对上传内容，最后发布。某个平台失败时应先处理失败原因，避免手动发布缺少目标平台的版本。修改发行脚本时另外运行 `node --test scripts/release.test.mjs`。

## 提交 Pull Request

- 聚焦一个具体问题或一组相关变化，保留现有项目结构与代码风格。
- 在描述中写明问题、最终行为和验证结果；界面改动附上对应截图。
- 行为变更补充必要的测试，文档变更检查链接与命令；更新用户可见功能时补充 `CHANGELOG.md`。
- 不提交 `node_modules/`、`dist/`、`release/`、测试输出或本地运行数据。
- 修改模型交互时，明确区分真实工具执行、待采纳建议与普通回复；对写入失败、取消、重复调用和只读重生成做相应检查。
- 修改持久化时，考虑旧数据迁移、窗口并发、备份恢复和中断写入。不要仅依据内存变化显示保存成功。

## 问题反馈

通过 [Issues](https://github.com/liulinlin718-netizen/task-agent/issues) 提供系统版本、设备架构、TaskAgent 版本、复现步骤、预期结果与实际结果。涉及 AI 的问题请补充模型名称和脱敏错误信息；无需提供密钥或整份私人数据。

本项目采用 [MIT License](LICENSE)。提交贡献时请确保你有权提供相关代码、文档或资源，并保留适用的第三方版权声明。
