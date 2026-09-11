import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createDefaultState } from '../../src/state/appState';
import type { AppState } from '../../src/Store';

const require = createRequire(import.meta.url);
const root = process.cwd();
const report = '# 整体概览\n研究任务稳步推进。\n## 任务进度审计\n论文已推进。\n## 关键问题和建议\n继续记录。\n## 抓紧行动\n完成下一步。\n## 结语\n保持节奏。';

function event(response: ServerResponse, delta: object, finish: string | null = null) {
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
}
function finish(response: ServerResponse, text: string) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
  event(response, { content: text.slice(0, 3) });
  event(response, { content: text.slice(3) });
  event(response, {}, 'stop');
  response.end('data: [DONE]\n\n');
}
function tool(response: ServerResponse, name: string, args: object) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
  const json = JSON.stringify(args);
  event(response, { tool_calls: [{ index: 0, id: crypto.randomUUID(), type: 'function', function: { name, arguments: json.slice(0, 5) } }] });
  event(response, { tool_calls: [{ index: 0, function: { arguments: json.slice(5) } }] });
  event(response, {}, 'tool_calls');
  response.end('data: [DONE]\n\n');
}

async function launchDesktop(profile: string) {
  const env: Record<string, string | undefined> = { ...process.env, TASKAGENT_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  return _electron.launch({ args: process.env.TASKAGENT_E2E_EXECUTABLE ? [] : [root], executablePath: process.env.TASKAGENT_E2E_EXECUTABLE || require('electron'), env });
}

async function mainWindow(app: ElectronApplication) {
  const isMain = (page: Page) => /^(http|file):/.test(page.url()) && !page.url().includes('window=');
  await expect.poll(() => app.windows().some(isMain)).toBe(true);
  const main = app.windows().find(isMain)!;
  await expect(main.getByRole('textbox', { name: '对话输入', exact: true })).toBeVisible();
  return main;
}

type Desktop = { app: ElectronApplication; main: Page; profile: string; requests: any[]; read: () => Promise<AppState>; restart: () => Promise<Page> };
const test = base.extend<{ desktop: Desktop }>({
  desktop: async ({}, use, testInfo) => {
    const requests: any[] = [];
    const server = createServer(async (request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
      if (request.method === 'OPTIONS') { response.end(); return; }
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      const prompt = body.messages.filter((m: any) => m.role === 'user').at(-1)?.content || '';
      const results = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
      if (body.tools?.some((item: any) => item.function.name === 'capture_memories')) {
        const statements = JSON.parse(prompt).userStatements;
        const candidate = statements[0];
        const payload = { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: {
          name: 'capture_memories', arguments: JSON.stringify({ facts: candidate ? [{ key: candidate.category === 'constraint' ? 'constraint.study_time' : 'background.analysis_tool', category: candidate.category, evidence: candidate.evidence }] : [] }),
        } }] }, finish_reason: 'tool_calls' }] };
        const respond = () => { if (!response.destroyed) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(payload)); } };
        if (candidate?.evidence.includes('每周只有')) {
          const timer = setTimeout(respond, 1500);
          response.on('close', () => clearTimeout(timer));
        } else respond();
        return;
      }
      if (body.model === 'report-model' || !body.tools) {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: body.model === 'report-model' ? report : '保留用户的任务进展。' }, finish_reason: 'stop' }] })); return;
      }
      if (prompt.includes('慢速回复') || prompt.includes('停止测试')) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
        event(response, { content: '正在响应' });
        const timer = setTimeout(() => {
          if (response.destroyed) return;
          if (prompt.includes('停止测试')) {
            event(response, { tool_calls: [{ index: 0, id: 'too-late', type: 'function', function: { name: 'add_tasks', arguments: '{"tasks":[{"name":"不应出现"}]}' } }] });
            event(response, {}, 'tool_calls');
          } else { event(response, { content: '，这是原会话的回复。' }); event(response, {}, 'stop'); }
          response.end('data: [DONE]\n\n');
        }, 1500);
        response.on('close', () => clearTimeout(timer)); return;
      }
      const readOnly = body.tools.every((t: any) => ['list_tasks', 'propose_tasks'].includes(t.function.name));
      if (readOnly && prompt.includes('重生成失败')) { response.writeHead(503); response.end(); return; }
      if (readOnly && !prompt.startsWith('针对')) { finish(response, '当前任务状态已保留，本次没有重复执行。'); return; }
      if (results.length) {
        if ((prompt.includes('查询后更新') || prompt.includes('删除论文')) && results.length === 1) {
          const id = results[0].data.tasks[0].id;
          tool(response, prompt.includes('删除论文') ? 'delete_task' : 'update_task', prompt.includes('删除论文') ? { taskId: id } : { taskId: id, progress: 60, notes: '完成实验部分', priority: 'high' }); return;
        }
        finish(response, '操作已完成，请查看任务和操作记录。'); return;
      }
      if (prompt.includes('查询后更新') || prompt.includes('删除论文')) tool(response, 'list_tasks', { query: '论文任务' });
      else if (prompt.includes('报告')) tool(response, 'generate_report', { startDate: createDefaultState().activeDate, endDate: createDefaultState().activeDate });
      else if (prompt.includes('建议') || prompt.includes('<document>')) tool(response, 'propose_tasks', { tasks: [{ name: '准备研究展示', date: '2026-09-15' }, { name: '整理研究笔记', date: '2026-09-16' }] });
      else if (prompt.includes('添加')) tool(response, 'add_tasks', { tasks: [{ name: prompt.includes('悬浮') ? '悬浮球任务' : '论文任务' }] });
      else finish(response, '你好，可以一起规划任务。');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const profile = await mkdtemp(path.join(tmpdir(), 'taskagent-e2e-'));
    const state = createDefaultState();
    state.settings = { ...state.settings, apiBaseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'local-test-only', apiModel: 'chat-model', reportModel: 'report-model', floatingBallEnabled: true, sidebarEnabled: false };
    await writeFile(path.join(profile, 'taskagent-data.json'), JSON.stringify(state));
    let app = await launchDesktop(profile);
    let main: Page | undefined;
    const errors: string[] = [];
    try {
      main = await mainWindow(app);
      main.on('pageerror', error => errors.push(error.message));
      await use({ app, main, profile, requests,
        read: async () => JSON.parse(await main!.evaluate(() => window.electronAPI!.storeGet()) || 'null'),
        restart: async () => {
          await app.close();
          app = await launchDesktop(profile);
          main = await mainWindow(app);
          main.on('pageerror', error => errors.push(error.message));
          return main;
        },
      });
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) await main?.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {});
      await app.close().catch(() => {});
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(profile, { recursive: true, force: true });
      expect(errors).toEqual([]);
    }
  },
});

async function send(page: Page, text: string, inputName = '对话输入') {
  await page.getByRole('textbox', { name: inputName, exact: true }).fill(text);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}
async function idle(page: Page) { await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0); }

test('task CRUD uses real tools and tool results, with safe regeneration', async ({ desktop }, info) => {
  const { main, read, requests } = desktop;
  await send(main, '添加论文任务');
  await expect.poll(async () => (await read()).tasks.length).toBe(1); await idle(main);
  await send(main, '查询后更新论文任务');
  await expect.poll(async () => (await read()).tasks[0].progress).toBe(60); await idle(main);
  expect((await read()).tasks[0].notes).toBe('完成实验部分');
  expect(requests.some(r => r.messages.filter((m: any) => m.role === 'tool').length === 2)).toBe(true);
  expect(requests.filter(r => r.tools).every(r => r.stream === true && !r.response_format)).toBe(true);
  expect(requests.filter(r => r.stream).every(r => r.messages.some((m: any) => m.role === 'system' && m.content.includes('意图识别 few-shot')))).toBe(true);
  await main.getByRole('button', { name: '重新生成', exact: true }).click(); await idle(main);
  expect((await read()).tasks.length).toBe(1);
  await main.screenshot({ path: info.outputPath('taskagent.png') });
  await send(main, '删除论文任务');
  await expect.poll(async () => (await read()).tasks.length).toBe(0);
});

test('suggestions preserve dates and cannot be applied twice', async ({ desktop }) => {
  const { main, read } = desktop;
  await send(main, '给我两个研究建议'); await idle(main);
  await expect(main.getByRole('button', { name: '全部应用', exact: true })).toBeVisible();
  expect((await read()).tasks.length).toBe(0);
  await main.getByRole('button', { name: '全部应用', exact: true }).click();
  await expect.poll(async () => (await read()).tasks.length).toBe(2);
  expect((await read()).tasks.map(t => t.date)).toEqual(['2026-09-15', '2026-09-16']);
  await expect(main.getByRole('button', { name: '已添加', exact: true }).first()).toBeDisabled();
});

test('streamed reply stays in its original session; stop prevents delayed tools', async ({ desktop }) => {
  const { main, read } = desktop;
  const originalId = (await read()).activeChatSessionId;
  await send(main, '慢速回复');
  await expect(main.getByText('正在响应', { exact: true })).toBeVisible();
  await main.getByRole('button', { name: '开启新对话' }).click();
  await idle(main);
  const state = await read();
  expect(state.chatSessions.find(s => s.id === originalId)?.messages.at(-1)?.text).toContain('原会话');
  expect(state.chatSessions.find(s => s.id === state.activeChatSessionId)?.messages.length).toBe(1);
  await send(main, '停止测试');
  await expect(main.getByText('正在响应', { exact: true })).toBeVisible();
  await main.getByRole('button', { name: '停止生成', exact: true }).click(); await idle(main);
  expect((await read()).tasks.length).toBe(0);
  await expect(main.getByText(/已停止生成/)).toBeVisible();
});

for (const extension of ['txt', 'docx', 'pdf']) {
  test(`parse ${extension} attachment and submit its text with instructions`, async ({ desktop }) => {
    const { main, read, requests } = desktop;
    await main.getByLabel('上传文档', { exact: true }).setInputFiles(path.join(root, `tests/fixtures/tasks.${extension}`));
    await send(main, '从附件提取建议');
    await expect(main.getByRole('button', { name: '全部应用', exact: true })).toBeVisible();
    expect(requests.some(r => r.messages.some((m: any) => m.role === 'user' && m.content.includes('Prepare the research presentation.')))).toBe(true);
    expect((await read()).tasks.length).toBe(0);
  });
}

test('report uses independent model and is saved in history', async ({ desktop }) => {
  const { main, read, requests } = desktop;
  await send(main, '生成今日报告');
  await expect.poll(async () => (await read()).reports.length).toBe(1); await idle(main);
  expect((await read()).reports[0].content).toEqual(report);
  expect(requests.some(r => r.model === 'report-model' && !r.tools)).toBe(true);
  await main.getByRole('button', { name: '历史总结', exact: true }).click();
  await expect(main.getByText('历史与总结', { exact: true })).toBeVisible();
});

test('floating chat shares tool execution and persistence survives reload', async ({ desktop }) => {
  const { app, main, read } = desktop;
  await expect.poll(() => app.windows().length).toBe(3);
  const ball = app.windows().find(p => p.url().includes('window=ball'))!;
  await ball.getByRole('button', { name: '打开悬浮球对话' }).click();
  await ball.getByRole('button', { name: '固定在桌面' }).click();
  await send(ball, '添加悬浮球任务', '悬浮球对话输入');
  await expect.poll(async () => (await read()).tasks.some(t => t.name === '悬浮球任务')).toBe(true);
  await expect(main.getByText('悬浮球任务', { exact: true })).toBeVisible();
  await main.reload();
  await expect(main.getByText('悬浮球任务', { exact: true })).toBeVisible();
});

test('settings accept a complete logical time and encrypted backup round trips', async ({ desktop }) => {
  const { app, main, profile, read } = desktop;
  await send(main, '添加论文任务'); await idle(main);
  await send(main, '我长期使用Python做数据分析'); await idle(main);
  expect((await read()).memory?.facts.length).toBe(1);
  await main.getByRole('button', { name: '设置', exact: true }).click();
  await main.getByLabel('新一天开始时间').fill('03:30');
  expect((await read()).settings.rolloverTime).toBe('03:30');
  const backup = path.join(profile, 'test-backup.taskagent');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, backup);
  main.on('dialog', dialog => { void dialog.accept(); });
  await main.getByRole('button', { name: '📤 导出数据' }).click();
  await main.getByPlaceholder('设置导出密码...').fill('test-password');
  await main.getByRole('button', { name: '确认', exact: true }).click();
  await expect.poll(async () => { try { return (await readFile(backup, 'utf8')).includes('taskagent-backup'); } catch { return false; } }).toBe(true);
  await main.getByRole('button', { name: '清理全部数据', exact: true }).click();
  await expect.poll(async () => (await read()).tasks.length).toBe(0);
  expect((await read()).memory?.facts.length).toBe(0);
  await main.getByRole('button', { name: '📥 导入数据' }).click();
  await main.getByPlaceholder('输入导入密码...').fill('test-password');
  await main.getByRole('button', { name: '确认', exact: true }).click();
  await expect.poll(async () => (await read()).tasks.length).toBe(1);
  expect((await read()).memory?.facts[0].content).toBe('我长期使用Python做数据分析');
});

test('tasks, chat, reports and settings survive a complete app restart', async ({ desktop }) => {
  const { main, read, restart } = desktop;
  await send(main, '添加论文任务'); await idle(main);
  await send(main, '生成今日报告'); await idle(main);
  await main.getByRole('button', { name: '设置', exact: true }).click();
  await main.getByLabel('新一天开始时间').fill('03:30');
  const before = await read();
  const reopened = await restart();
  await expect(reopened.getByText('论文任务', { exact: true })).toBeVisible();
  const after = await read();
  expect(after.tasks).toEqual(before.tasks);
  expect(after.reports).toEqual(before.reports);
  expect(after.chatSessions).toEqual(before.chatSessions);
  expect(after.settings.rolloverTime).toBe('03:30');
  await send(reopened, '查询后更新论文任务');
  await expect.poll(async () => (await read()).tasks[0].progress).toBe(60);
});

test('streaming storage failure cancels generation and keeps saved data', async ({ desktop }) => {
  const { app, main, read } = desktop;
  await send(main, '添加论文任务'); await idle(main);
  await app.evaluate(({ ipcMain }) => {
    const listeners = ipcMain.rawListeners('store:commit');
    ipcMain.removeAllListeners('store:commit');
    ipcMain.on('store:commit', (event, data, ...args) => {
      if (data.includes('正在响应')) { event.returnValue = null; return; }
      for (const listener of listeners) listener.call(ipcMain, event, data, ...args);
    });
  });
  await send(main, '慢速回复');
  await expect(main.getByRole('alert')).toContainText('修改未保存');
  await idle(main);
  expect((await read()).tasks.map(t => t.name)).toEqual(['论文任务']);
  expect((await read()).chatSessions[0].messages.at(-1)?.text).toBe('');
});

test('failed regeneration retains the original suggestions for acceptance', async ({ desktop }) => {
  const { main, read } = desktop;
  await send(main, '给我两个建议，重生成失败测试'); await idle(main);
  const original = (await read()).chatSessions[0].messages.at(-1)!;
  await main.getByRole('button', { name: '重新生成', exact: true }).click(); await idle(main);
  const retried = (await read()).chatSessions[0].messages.at(-1)!;
  expect(retried.proposedTasks).toEqual(original.proposedTasks);
  expect(retried.text).toContain('本次重新生成未完成');
  await main.getByRole('button', { name: '全部应用', exact: true }).click();
  expect((await read()).tasks.length).toBe(2);
});

test('conversation memory is stored separately, updates by key and recalls across sessions and restart', async ({ desktop }) => {
  const { main, read, requests, profile, restart } = desktop;
  await send(main, '我长期使用Python做数据分析'); await idle(main);
  expect((await read()).memory?.facts[0].evidence).toBe('我长期使用Python做数据分析');
  await expect(main.getByLabel('记忆状态')).toContainText('长期记忆');
  const raw = JSON.parse(await readFile(path.join(profile, 'taskagent-data.json'), 'utf8'));
  const separate = JSON.parse(await readFile(path.join(profile, 'taskagent-memory.json'), 'utf8'));
  expect(raw.profile).toBeUndefined(); expect(raw.memory).toBeUndefined();
  expect(separate.memory.facts.length).toBe(1);
  await main.getByRole('button', { name: '开启新对话' }).click();
  await send(main, '根据我的背景，怎样学习数据分析？'); await idle(main);
  const request = requests.filter(r => r.stream && r.messages.at(-1).content === '根据我的背景，怎样学习数据分析？').at(-1);
  expect(request.messages.some((m: any) => m.role === 'system' && m.content.includes('我长期使用Python做数据分析'))).toBe(true);
  await send(main, '我长期使用R做数据分析'); await idle(main);
  expect((await read()).memory?.facts.map(fact => fact.content)).toEqual(['我长期使用R做数据分析']);
  const reopened = await restart();
  await reopened.getByRole('button', { name: '开启新对话' }).click();
  await send(reopened, '根据我的背景，怎样学习数据分析？'); await idle(reopened);
  const after = requests.filter(r => r.stream && r.messages.at(-1).content === '根据我的背景，怎样学习数据分析？').at(-1);
  expect(after.messages.some((m: any) => m.role === 'system' && m.content.includes('我长期使用R做数据分析'))).toBe(true);
  expect(after.messages.some((m: any) => m.content?.includes('我长期使用Python做数据分析'))).toBe(false);
});

test('memory can be reviewed, edited and deleted; disabling learning preserves user control', async ({ desktop }, info) => {
  const { main, read, requests } = desktop;
  await send(main, '我长期使用Python做数据分析'); await idle(main);
  await main.getByRole('button', { name: '个人档案', exact: true }).click();
  await main.getByRole('button', { name: '编辑记忆：我长期使用Python做数据分析' }).click();
  await main.getByLabel('记忆内容', { exact: true }).fill('我偏好用R进行统计分析');
  await main.getByRole('button', { name: '保存记忆', exact: true }).click();
  expect((await read()).memory?.facts[0].content).toBe('我偏好用R进行统计分析');
  expect((await read()).memory?.facts[0].evidence).toBe('我长期使用Python做数据分析');
  await main.getByRole('region', { name: '长期记忆', exact: true }).screenshot({ path: info.outputPath('memory.png') });
  await main.getByRole('button', { name: '删除记忆：我偏好用R进行统计分析' }).click();
  expect((await read()).memory?.facts.length).toBe(0);
  await main.getByRole('switch', { name: '自动学习对话记忆' }).click();
  await expect(main.getByRole('switch', { name: '自动学习对话记忆' })).not.toBeChecked();
  await main.getByRole('button', { name: '任务中心', exact: true }).click();
  await main.getByRole('button', { name: '开启新对话' }).click();
  const before = requests.filter(r => r.tools?.some((item: any) => item.function.name === 'capture_memories')).length;
  await send(main, '我长期使用Julia做数据分析'); await idle(main);
  expect(requests.filter(r => r.tools?.some((item: any) => item.function.name === 'capture_memories')).length).toBe(before);
  expect((await read()).memory?.facts.length).toBe(0);
  await send(main, '根据我的背景给些建议'); await idle(main);
  const after = requests.filter(r => r.stream && r.messages.at(-1).content === '根据我的背景给些建议').at(-1);
  expect(after.messages.some((m: any) => /我长期使用Python|我偏好用R/.test(m.content || ''))).toBe(false);
});

test('stopping memory learning keeps the completed reply and saves no delayed fact', async ({ desktop }) => {
  const { main, read, requests } = desktop;
  await send(main, '我每周只有周末能学习');
  await expect.poll(() => requests.some(r => r.tools?.some((item: any) => item.function.name === 'capture_memories'))).toBe(true);
  await main.getByRole('button', { name: '停止生成', exact: true }).click(); await idle(main);
  const latest = (await read()).chatSessions[0].messages.at(-1)!;
  expect(latest.text).toContain('你好，可以一起规划任务');
  expect(latest.memoryStatus).toContain('停止');
  expect((await read()).memory?.facts.length).toBe(0);
});
