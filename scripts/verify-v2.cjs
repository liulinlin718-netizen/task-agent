/**
 * TaskAgent v2.0 PRD 验收自动化脚本
 * 
 * 用法: node scripts/verify-v2.cjs
 * 
 * 检查项:
 *   1. 文件结构完整性
 *   2. 遗留代码清除
 *   3. 依赖健康度
 *   4. 核心模块存在性
 *   5. 关键代码模式验证
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;

function check(name, condition) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    pass++;
  } else {
    console.log(`  ❌ ${name}`);
    fail++;
  }
}

function fileExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function fileContains(rel, pattern) {
  if (!fileExists(rel)) return false;
  const content = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
  return typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content);
}

function fileNotContains(rel, pattern) {
  if (!fileExists(rel)) return true;
  const content = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
  return typeof pattern === 'string' ? !content.includes(pattern) : !pattern.test(content);
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n🔍 TaskAgent v2.0 PRD 验收检查\n');

// ─── 1. 文件结构 ─────────────────────────────────────────────────
console.log('📁 1. 核心文件完整性');
check('AgentService.ts 存在', fileExists('src/services/AgentService.ts'));
check('StreamParser.ts 存在', fileExists('src/services/StreamParser.ts'));
check('DocumentParser.ts 存在', fileExists('src/services/DocumentParser.ts'));
check('electron-main.cjs 存在', fileExists('electron-main.cjs'));
check('electron-preload.cjs 存在', fileExists('electron-preload.cjs'));
check('FloatingBallWindow.tsx 存在', fileExists('src/components/FloatingBallWindow.tsx'));
check('FloatingTaskCenterWindow.tsx 存在', fileExists('src/components/FloatingTaskCenterWindow.tsx'));
check('RolloverEngine.tsx 存在', fileExists('src/components/RolloverEngine.tsx'));
check('Settings.tsx 存在', fileExists('src/components/Settings.tsx'));

// ─── 2. 遗留代码清除（3.1 统一 API）───────────────────────────────
console.log('\n🧹 2. 遗留代码清除 (PRD 3.1)');
check('@google/genai 未在 package.json', fileNotContains('package.json', '@google/genai'));
check('AgentService 无 isGemini', fileNotContains('src/services/AgentService.ts', 'isGemini'));
check('AgentService 无 isOpenAI', fileNotContains('src/services/AgentService.ts', 'isOpenAI'));
check('AgentService 无 apiFormat', fileNotContains('src/services/AgentService.ts', 'apiFormat'));
check('RolloverEngine 无 isGemini', fileNotContains('src/components/RolloverEngine.tsx', 'isGemini'));
check('已删除 PRD_TaskAgent.md', !fileExists('PRD_TaskAgent.md'));
check('已删除 PRD_TaskAgent_MVP_v0.1.md', !fileExists('PRD_TaskAgent_MVP_v0.1.md'));
check('已删除 metadata.json', !fileExists('metadata.json'));

// ─── 3. 统一 API + 流式 (3.1, 3.2) ──────────────────────────────
console.log('\n🌊 3. 统一 API + 流式输出 (PRD 3.1, 3.2)');
check('callChatCompletion 存在', fileContains('src/services/AgentService.ts', 'callChatCompletion'));
check('/chat/completions 端点', fileContains('src/services/AgentService.ts', '/chat/completions'));
check('stream: true 支持', fileContains('src/services/AgentService.ts', 'stream: true'));
check('parseSSEStream 导入', fileContains('src/services/AgentService.ts', 'parseSSEStream'));
check('StreamParser 模块存在', fileContains('src/services/StreamParser.ts', 'parseSSEStream'));

// ─── 4. Function Calling (3.3) ──────────────────────────────────
console.log('\n🔧 4. Function Calling 5 Tools (PRD 3.3)');
check('add_tasks Tool', fileContains('src/services/AgentService.ts', '"add_tasks"'));
check('update_task Tool', fileContains('src/services/AgentService.ts', '"update_task"'));
check('delete_task Tool', fileContains('src/services/AgentService.ts', '"delete_task"'));
check('decompose Tool', fileContains('src/services/AgentService.ts', '"decompose"'));
check('generate_report Tool', fileContains('src/services/AgentService.ts', '"generate_report"'));
check('matchLocalRule 规则前置', fileContains('src/services/AgentService.ts', 'matchLocalRule'));

// ─── 5. 滑动摘要 (3.4) ──────────────────────────────────────────
console.log('\n📝 5. 滑动摘要 (PRD 3.4)');
check('RECENT_ROUNDS = 3', fileContains('src/services/AgentService.ts', 'RECENT_ROUNDS = 3'));
check('generateRollingSummary 函数', fileContains('src/services/AgentService.ts', 'generateRollingSummary'));
check('ChatSession.summary 字段', fileContains('src/Store.tsx', 'summary?:'));
check('ChatSession.summarizedUpTo 字段', fileContains('src/Store.tsx', 'summarizedUpTo?:'));

// ─── 6. Prompt 模块化 (3.5) ─────────────────────────────────────
console.log('\n🧩 6. Prompt 模块化路由 (PRD 3.5)');
check('mod_base_persona', fileContains('src/services/AgentService.ts', 'mod_base_persona'));
check('mod_task_context', fileContains('src/services/AgentService.ts', 'mod_task_context'));
check('mod_chat_instruction', fileContains('src/services/AgentService.ts', 'mod_chat_instruction'));
check('mod_profile_context', fileContains('src/services/AgentService.ts', 'mod_profile_context'));
check('buildSystemPrompt 路由', fileContains('src/services/AgentService.ts', 'buildSystemPrompt'));

// ─── 7. 错误处理 (3.6) ──────────────────────────────────────────
console.log('\n🛡️ 7. 错误处理 (PRD 3.6)');
check('15s 超时', fileContains('src/services/AgentService.ts', 'REQUEST_TIMEOUT_MS'));
check('429 状态码处理', fileContains('src/services/AgentService.ts', '429'));
check('401 状态码处理', fileContains('src/services/AgentService.ts', '401'));
check('空内容兜底', fileContains('src/services/AgentService.ts', '收到！还有其他需要帮忙的吗？'));

// ─── 8. 文档解析 (3.7) ──────────────────────────────────────────
console.log('\n📄 8. 文档解析 (PRD 3.7)');
check('.txt 支持', fileContains('src/services/DocumentParser.ts', "ext === \"txt\""));
check('.docx 支持 (mammoth)', fileContains('src/services/DocumentParser.ts', 'mammoth'));
check('.pdf 支持 (pdfjs-dist)', fileContains('src/services/DocumentParser.ts', 'pdfjs-dist'));
check('mammoth 在 package.json', fileContains('package.json', 'mammoth'));
check('pdfjs-dist 在 package.json', fileContains('package.json', 'pdfjs-dist'));
check('上传按钮 (Paperclip)', fileContains('src/components/AgentChat.tsx', 'Paperclip'));

// ─── 9. Per-Agent 配置 (3.8) ────────────────────────────────────
console.log('\n⚙️ 9. Per-Agent 模型配置 (PRD 3.8)');
check('getChatConfig', fileContains('src/services/AgentService.ts', 'getChatConfig'));
check('getReportConfig', fileContains('src/services/AgentService.ts', 'getReportConfig'));
check('reportApiKey 字段', fileContains('src/Store.tsx', 'reportApiKey'));
check('reportModel 字段', fileContains('src/Store.tsx', 'reportModel'));
check('reportApiBaseUrl 字段', fileContains('src/Store.tsx', 'reportApiBaseUrl'));

// ─── 10. 悬浮球优化 (3.9) ───────────────────────────────────────
console.log('\n🔵 10. 悬浮球优化 (PRD 3.9)');
check('requestAnimationFrame 节流', fileContains('src/components/FloatingBallWindow.tsx', 'requestAnimationFrame'));
check('位置记忆 (ball-position.json)', fileContains('electron-main.cjs', 'ball-position.json'));
check('animateBounds 缓动', fileContains('electron-main.cjs', 'animateBounds'));
check('easeOutCubic', fileContains('electron-main.cjs', 'easeOutCubic'));
check('nearEdge 磁吸反馈', fileContains('src/components/FloatingBallWindow.tsx', 'nearEdge'));

// ─── 11. 系统托盘 (3.10) ────────────────────────────────────────
console.log('\n🔔 11. 系统托盘 (PRD 3.10)');
check('Tray 导入', fileContains('electron-main.cjs', 'Tray'));
check('tray 右键菜单', fileContains('electron-main.cjs', 'Menu.buildFromTemplate'));
check('关闭=隐藏 (isQuitting)', fileContains('electron-main.cjs', 'isQuitting'));
check('Rollover 系统通知', fileContains('src/components/RolloverEngine.tsx', 'Notification'));

// ─── 12. 数据存储升级 (3.11) ────────────────────────────────────
console.log('\n💾 12. 数据存储 (PRD 3.11)');
check('taskagent-data.json 存储路径', fileContains('electron-main.cjs', 'taskagent-data.json'));
check('store:get IPC', fileContains('electron-main.cjs', "store:get"));
check('store:set IPC', fileContains('electron-main.cjs', "store:set"));
check('storeGet preload', fileContains('electron-preload.cjs', 'storeGet'));
check('storeSet preload', fileContains('electron-preload.cjs', 'storeSet'));
check('Store.tsx IPC 读取', fileContains('src/Store.tsx', 'storeGet'));

// ─── 13. 加密导入导出 (3.12) ────────────────────────────────────
console.log('\n🔐 13. 加密导入导出 (PRD 3.12)');
check('AES-256-GCM', fileContains('electron-main.cjs', 'aes-256-gcm'));
check('encryptData 函数', fileContains('electron-main.cjs', 'encryptData'));
check('decryptData 函数', fileContains('electron-main.cjs', 'decryptData'));
check('data:export IPC', fileContains('electron-main.cjs', 'data:export'));
check('data:import IPC', fileContains('electron-main.cjs', 'data:import'));
check('.taskagent 文件格式', fileContains('electron-main.cjs', '.taskagent'));
check('Settings 导出按钮', fileContains('src/components/Settings.tsx', '导出数据'));
check('Settings 导入按钮', fileContains('src/components/Settings.tsx', '导入数据'));

// ─── 14. 明确不做的事项 ─────────────────────────────────────────
console.log('\n🚫 14. 明确不做检查');
check('无 LangChain', fileNotContains('package.json', 'langchain'));
check('无 CrewAI', fileNotContains('package.json', 'crewai'));
check('无向量检索', fileNotContains('package.json', 'embedding'));

// ═══════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`📊 结果: ${pass} 通过 / ${fail} 失败 / ${pass + fail} 总计`);
console.log(`${'═'.repeat(50)}`);

if (fail === 0) {
  console.log('\n🎉 TaskAgent v2.0 PRD 验收通过！\n');
} else {
  console.log(`\n⚠️ 有 ${fail} 项未通过，请检查。\n`);
}

process.exit(fail > 0 ? 1 : 0);
