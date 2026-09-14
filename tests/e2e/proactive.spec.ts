import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createDefaultState } from '../../src/state/appState';
import type { AppState } from '../../src/Store';

const require = createRequire(import.meta.url);
type Desktop = {
  app: ElectronApplication; main: Page; requests: any[];
  read: () => Promise<AppState>; ball: () => Promise<Page>; restart: () => Promise<void>;
};

const test = base.extend<{ desktop: Desktop }>({
  desktop: async ({}, use, info) => {
    const requests: any[] = [];
    const server = createServer(async (request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
      if (request.method === 'OPTIONS') { response.end(); return; }
      let raw = ''; for await (const chunk of request) raw += chunk;
      requests.push(JSON.parse(raw));
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '卡住也没关系。先用五分钟写下论文的一个小标题，再告诉我进展。' }, finish_reason: 'stop' }] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const profile = await mkdtemp(path.join(tmpdir(), 'taskagent-proactive-e2e-'));
    const state = createDefaultState();
    state.settings = { ...state.settings, sidebarEnabled: false, floatingBallEnabled: true,
      proactiveEnabled: false, proactiveQuietStart: '00:00', proactiveQuietEnd: '00:00',
      apiBaseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: 'local-test', apiModel: 'test' };
    state.tasks = [{ id: 'stale-paper', name: '论文初稿', date: state.activeDate, progress: 20,
      lastProgressAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() }];
    await writeFile(path.join(profile, 'taskagent-data.json'), JSON.stringify(state));
    let app: ElectronApplication;
    let main: Page;
    const errors: string[] = [];
    const launch = async () => {
      const env: Record<string, string | undefined> = { ...process.env, TASKAGENT_USER_DATA_DIR: profile };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await _electron.launch({ executablePath: process.env.TASKAGENT_E2E_EXECUTABLE || require('electron'), args: process.env.TASKAGENT_E2E_EXECUTABLE ? [] : [process.cwd()], env });
      await expect.poll(() => app.windows().some(page => /^(file|http):/.test(page.url()) && !page.url().includes('window='))).toBe(true);
      main = app.windows().find(page => /^(file|http):/.test(page.url()) && !page.url().includes('window='))!;
      await expect(main.getByRole('textbox', { name: '对话输入', exact: true })).toBeVisible();
      for (const page of app.windows()) page.on('pageerror', error => errors.push(error.message));
    };
    try {
      await launch();
      await use({ get app() { return app; }, get main() { return main; }, requests,
        read: async () => JSON.parse(await main.evaluate(() => window.electronAPI!.storeGet()) || 'null'),
        ball: async () => {
          await expect.poll(() => app.windows().some(page => page.url().includes('window=ball'))).toBe(true);
          return app.windows().find(page => page.url().includes('window=ball'))!;
        },
        restart: async () => { await app.close(); await launch(); },
      });
    } finally {
      if (info.status !== info.expectedStatus) {
        for (const page of app!.windows()) await page.screenshot({ path: info.outputPath(page.url().includes('window=ball') ? 'ball-failure.png' : 'window-failure.png') }).catch(() => {});
      }
      await app!?.close().catch(() => {});
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(profile, { recursive: true, force: true });
      expect(errors).toEqual([]);
    }
  },
});

async function settings(desktop: Desktop, patch: Partial<AppState['settings']>) {
  const result = await desktop.main.evaluate(patch => {
    const before = window.electronAPI!.storeGet()!;
    const state = JSON.parse(before);
    state.settings = { ...state.settings, ...patch };
    return window.electronAPI!.storeCommit(JSON.stringify(state), before);
  }, patch);
  expect(result).not.toBeNull();
}

test('stale progress proactively opens a non-focusing nudge while the main window is hidden, and saves offline', async ({ desktop }, info) => {
  const ball = await desktop.ball();
  await desktop.app.evaluate(async ({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().includes('window='));
    main!.hide();
    const focusTarget = new BrowserWindow({ width: 240, height: 180, title: 'Reminder focus test', show: false });
    await focusTarget.loadURL('data:text/html,<title>Reminder focus test</title><input aria-label="focus target">');
    focusTarget.show(); focusTarget.focus();
  });
  await expect.poll(() => desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL().startsWith('data:'))).toBe(true);
  await settings(desktop, { proactiveEnabled: true });
  await expect(ball.getByRole('button', { name: '展开任务进度提醒', exact: true })).toBeVisible();
  await expect(ball.getByRole('button', { name: '提醒中的桌宠', exact: true })).toBeVisible();
  await expect(ball.getByRole('button', { name: '保存进度', exact: true })).toHaveCount(0);
  await expect.poll(() => ball.evaluate(() => window.electronAPI!.windowGetBounds().width)).toBe(328);
  const windows = await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ url: win.webContents.getURL(), focused: win.isFocused(), visible: win.isVisible(), bounds: win.getBounds() })));
  expect(windows.find(win => win.url.includes('window=ball'))).toMatchObject({ focused: false, visible: true, bounds: { width: 328, height: 112 } });
  expect(windows.find(win => win.url.startsWith('data:'))?.focused).toBe(true);
  expect(windows.find(win => /^(file|http):/.test(win.url) && !win.url.includes('window='))?.visible).toBe(false);
  await ball.screenshot({ path: info.outputPath('proactive-nudge.png') });
  await ball.getByRole('button', { name: '展开任务进度提醒', exact: true }).click();
  await expect.poll(() => ball.evaluate(() => window.electronAPI!.windowGetBounds().height)).toBe(380);
  await expect(ball.getByText('论文初稿', { exact: true })).toBeVisible();
  expect((await desktop.read()).proactive?.count).toBe(1);
  expect(await ball.getByRole('region', { name: '任务进度提醒' }).evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
  await ball.screenshot({ path: info.outputPath('proactive-reminder.png') });
  const prior = (await desktop.read()).tasks[0].lastProgressAt!;
  const slider = ball.getByRole('slider', { name: '提醒任务进度' });
  await expect(slider).toHaveValue('20');
  const bounds = await ball.evaluate(() => window.electronAPI!.windowGetBounds());
  const track = (await slider.boundingBox())!;
  await ball.mouse.move(track.x + 10 + (track.width - 20) * 0.2, track.y + track.height / 2);
  await ball.mouse.down();
  await ball.mouse.move(track.x + 10 + (track.width - 20) * 0.45, track.y + track.height / 2, { steps: 8 });
  await expect(slider).toHaveValue('45');
  await expect(ball.getByLabel('当前进度', { exact: true })).toHaveText('当前进度 45%');
  await expect(ball.getByRole('slider')).toHaveCount(1);
  await expect(ball.getByRole('button', { name: '保存进度', exact: true })).toHaveCount(0);
  for (const label of ['完成了', '推进了一点', '还没变化']) {
    await expect(ball.getByRole('button', { name: label, exact: true })).toHaveText(label);
  }
  expect((await desktop.read()).tasks[0].progress).toBe(20);
  expect(await ball.evaluate(() => window.electronAPI!.windowGetBounds())).toEqual(bounds);
  await ball.screenshot({ path: info.outputPath('proactive-slider.png') });
  await ball.mouse.up();
  await expect.poll(async () => (await desktop.read()).tasks[0].progress).toBe(45);
  expect(Date.parse((await desktop.read()).tasks[0].lastProgressAt!)).toBeGreaterThan(Date.parse(prior));
  await expect.poll(async () => (await desktop.read()).proactive?.active).toBeUndefined();
  expect(desktop.requests).toHaveLength(0);
  await desktop.restart();
  expect((await desktop.read()).tasks[0].progress).toBe(45);
  expect((await desktop.read()).proactive?.count).toBe(1);
  await expect((await desktop.ball()).getByRole('button', { name: '打开悬浮球对话' })).toBeVisible();
});

test('snoozing persists across a complete process restart', async ({ desktop }) => {
  await settings(desktop, { proactiveEnabled: true });
  let ball = await desktop.ball();
  await ball.getByRole('button', { name: '30分钟后提醒', exact: true }).click();
  const snooze = (await desktop.read()).proactive!;
  expect(Date.parse(snooze.taskStates!['stale-paper'].snoozedUntil!)).toBeGreaterThan(Date.now() + 29 * 60_000);
  await desktop.restart();
  expect((await desktop.read()).proactive?.taskStates?.['stale-paper'].snoozedUntil).toBe(snooze.taskStates!['stale-paper'].snoozedUntil);
  expect((await desktop.read()).proactive?.taskStates?.['stale-paper'].snoozeCount).toBe(1);
  expect((await desktop.read()).proactive?.count).toBe(1);
  ball = await desktop.ball();
  await expect(ball.getByRole('button', { name: '打开悬浮球对话' })).toBeVisible();
});

test('today dismissal survives restart and task changes cannot bypass it', async ({ desktop }) => {
  await settings(desktop, { proactiveEnabled: true });
  await (await desktop.ball()).getByRole('button', { name: '展开任务进度提醒', exact: true }).click();
  await (await desktop.ball()).getByRole('button', { name: '今天先休息', exact: true }).click();
  const state = await desktop.read();
  expect(state.proactive?.dismissedDate).toBe(state.activeDate);
  await desktop.restart();
  await settings(desktop, { proactiveIntervalMinutes: 30 });
  expect((await desktop.read()).proactive?.dismissedDate).toBe(state.activeDate);
  expect((await desktop.read()).proactive?.active).toBeUndefined();
  await expect((await desktop.ball()).getByRole('button', { name: '打开悬浮球对话' })).toBeVisible();
  await desktop.main.getByRole('button', { name: '设置', exact: true }).click();
  await desktop.main.getByRole('button', { name: '恢复主动提醒', exact: true }).click();
  expect((await desktop.read()).proactive?.dismissedDate).toBeUndefined();
  expect((await desktop.read()).proactive?.count).toBe(1);
  desktop.main.once('dialog', dialog => dialog.accept());
  await desktop.main.getByRole('button', { name: '清理全部数据', exact: true }).click();
  await expect.poll(async () => (await desktop.read()).tasks.length).toBe(0);
  expect((await desktop.read()).proactive).toBeUndefined();
  expect((await desktop.read()).settings.proactiveEnabled).toBe(true);
});

test('stuck guidance enters the shared chat with the actual task and waits for the user to send', async ({ desktop }, info) => {
  await settings(desktop, { proactiveEnabled: true });
  const ball = await desktop.ball();
  await ball.getByRole('button', { name: '展开任务进度提醒', exact: true }).click();
  await ball.getByRole('button', { name: '有点卡住了', exact: true }).click();
  const input = ball.getByRole('textbox', { name: '悬浮球对话输入', exact: true });
  await expect(ball.getByRole('combobox')).toHaveCount(0);
  await expect(ball.getByText(/正在聊：/)).toHaveCount(0);
  await expect(input).toHaveValue(/论文初稿/);
  await expect(input).toHaveValue(/日期：.*当前进度：20%/);
  await expect(input).not.toHaveValue(/stale-paper/);
  expect(desktop.requests).toHaveLength(0);
  await ball.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ball.getByText('卡住也没关系。先用五分钟写下论文的一个小标题，再告诉我进展。', { exact: true })).toBeVisible();
  expect(desktop.requests).toHaveLength(1);
  expect(desktop.requests[0].tools.some((tool: any) => tool.function.name === 'update_task')).toBe(true);
  expect((await desktop.read()).tasks[0].progress).toBe(20);
  const userMessage = (await desktop.read()).chatSessions[0].messages.find(message => message.role === 'user');
  expect(userMessage?.taskContext).toBeUndefined();
  await expect.poll(() => ball.getByText('卡住也没关系。先用五分钟写下论文的一个小标题，再告诉我进展。', { exact: true }).evaluate(element => {
    let current: Element | null = element;
    while (current) { if (Number(getComputedStyle(current).opacity) < 1) return false; current = current.parentElement; }
    return true;
  })).toBe(true);
  await ball.screenshot({ path: info.outputPath('proactive-guidance.png') });
});

test('a reminder becomes invalid when another window updates the task', async ({ desktop }) => {
  await settings(desktop, { proactiveEnabled: true });
  const ball = await desktop.ball();
  await expect(ball.getByRole('button', { name: '展开任务进度提醒', exact: true })).toBeVisible();
  const reminder = (await desktop.read()).proactive!.active!;
  await desktop.main.evaluate(() => {
    const before = window.electronAPI!.storeGet()!;
    const state = JSON.parse(before); state.tasks[0].progress = 80;
    if (!window.electronAPI!.storeCommit(JSON.stringify(state), before)) throw new Error('save failed');
  });
  await expect.poll(async () => (await desktop.read()).proactive?.active).toBeUndefined();
  const result = await ball.evaluate(id => window.electronAPI!.reminderAction(id, 'update', 40), reminder.id);
  expect(result.ok).toBe(false);
  expect((await desktop.read()).tasks[0].progress).toBe(80);
});

test('settings expose the reminder controls and quiet hours suppress reminders', async ({ desktop }) => {
  const { main } = desktop;
  await main.getByRole('button', { name: '设置', exact: true }).click();
  const checkbox = main.getByRole('checkbox', { name: '开启主动进度提醒', exact: true });
  await expect(checkbox).not.toBeChecked();
  const hour = new Date().getHours();
  const start = `${String((hour + 23) % 24).padStart(2, '0')}:00`;
  const end = `${String((hour + 1) % 24).padStart(2, '0')}:00`;
  await main.getByLabel('主动提醒静默开始时间', { exact: true }).fill(start);
  await main.getByLabel('主动提醒静默结束时间', { exact: true }).fill(end);
  await main.getByLabel('未更新多久后提醒', { exact: true }).selectOption('60');
  await checkbox.check();
  expect((await desktop.read()).settings.proactiveIntervalMinutes).toBe(60);
  await desktop.restart();
  await expect((await desktop.ball()).getByRole('button', { name: '打开悬浮球对话' })).toBeVisible();
  expect((await desktop.read()).proactive?.active).toBeUndefined();
  await settings(desktop, { proactiveQuietStart: '00:00', proactiveQuietEnd: '00:00' });
  await expect((await desktop.ball()).getByRole('button', { name: '展开任务进度提醒', exact: true })).toBeVisible();
});

for (const [button, progress] of [['完成了', 100], ['推进了一点', 30], ['还没变化', 20]] as const) {
  test(`quick feedback ${button} saves progress and confirmation time offline`, async ({ desktop }) => {
    const prior = (await desktop.read()).tasks[0].lastProgressAt!;
    await settings(desktop, { proactiveEnabled: true });
    const ball = await desktop.ball();
    await ball.getByRole('button', { name: '展开任务进度提醒', exact: true }).click();
    await ball.getByRole('button', { name: button }).click();
    await expect.poll(async () => (await desktop.read()).proactive?.active).toBeUndefined();
    const state = await desktop.read();
    expect(state.tasks[0].progress).toBe(progress);
    expect(Date.parse(state.tasks[0].lastProgressAt!)).toBeGreaterThan(Date.parse(prior));
    expect(desktop.requests).toHaveLength(0);
    await desktop.restart();
    expect((await desktop.read()).tasks[0].progress).toBe(progress);
  });
}

test('single-task dismissal survives restart and can be restored without clearing the reminder count', async ({ desktop }) => {
  await settings(desktop, { proactiveEnabled: true });
  const ball = await desktop.ball();
  await ball.getByRole('button', { name: '展开任务进度提醒', exact: true }).click();
  await ball.getByRole('button', { name: '今天不提醒这项', exact: true }).click();
  const before = await desktop.read();
  expect(before.proactive?.taskStates?.['stale-paper'].dismissedDate).toBe(before.activeDate);
  expect(before.proactive?.dismissedDate).toBeUndefined();
  await desktop.restart();
  expect((await desktop.read()).proactive?.taskStates?.['stale-paper'].dismissedDate).toBe(before.activeDate);
  await desktop.main.getByRole('button', { name: '设置', exact: true }).click();
  await expect(desktop.main.getByText('今天已暂停 1 项任务的提醒。', { exact: true })).toBeVisible();
  await desktop.main.getByRole('button', { name: '恢复主动提醒', exact: true }).click();
  expect((await desktop.read()).proactive?.taskStates?.['stale-paper'].dismissedDate).toBeUndefined();
  expect((await desktop.read()).proactive?.count).toBe(1);
});

for (const edge of ['left', 'right'] as const) {
  test(`nudge retains the pet position at the ${edge} edge and details can collapse back`, async ({ desktop }) => {
    const ball = await desktop.ball();
    await ball.evaluate(edge => {
      const area = window.electronAPI!.screenGetWorkArea();
      window.electronAPI!.windowDragStart();
      window.electronAPI!.windowDragTo(edge === 'left' ? area.x : area.x + area.width - 48, area.y + 20);
      window.electronAPI!.windowDragEnd();
    }, edge);
    await expect.poll(async () => {
      return ball.evaluate(edge => {
        const area = window.electronAPI!.screenGetWorkArea();
        return window.electronAPI!.windowGetBounds().x === (edge === 'left' ? area.x : area.x + area.width - 48);
      }, edge);
    }).toBe(true);
    const original = await ball.evaluate(() => window.electronAPI!.windowGetBounds());
    await settings(desktop, { proactiveEnabled: true });
    await expect(ball.getByRole('button', { name: '展开任务进度提醒', exact: true })).toBeVisible();
    await expect.poll(() => ball.evaluate(() => window.electronAPI!.windowGetBounds().width)).toBe(328);
    const pet = await ball.getByRole('button', { name: '提醒中的桌宠' }).boundingBox();
    const bounds = await ball.evaluate(() => window.electronAPI!.windowGetBounds());
    expect(Math.round(bounds.x + pet!.x)).toBe(original.x);
    expect(Math.round(bounds.y + pet!.y)).toBe(original.y);
    await ball.getByRole('button', { name: '展开任务进度提醒', exact: true }).click();
    await expect.poll(() => ball.evaluate(() => window.electronAPI!.windowGetBounds().height)).toBe(380);
    await ball.getByRole('button', { name: '收起为小气泡', exact: true }).click();
    await expect(ball.getByRole('button', { name: '提醒中的桌宠' })).toBeVisible();
    await expect.poll(() => ball.evaluate(() => window.electronAPI!.windowGetBounds().height)).toBe(112);
    expect((await desktop.read()).proactive?.count).toBe(1);
  });
}

test('chat continues legacy conversations without a task selector or persistent binding', async ({ desktop }, info) => {
  await desktop.main.evaluate(() => {
    const before = window.electronAPI!.storeGet()!;
    const state = JSON.parse(before);
    const session = state.chatSessions.find((item: any) => item.id === state.activeChatSessionId);
    session.messages.push({ id: 'legacy-user', role: 'user', text: '这项任务先聊到这里。',
      taskContext: { taskId: 'deleted-task', taskName: '旧关联任务', taskDate: '2026-09-01' } });
    session.messages.push({ id: 'legacy-reply', role: 'model', text: '好的，我们也可以聊别的。' });
    if (!window.electronAPI!.storeCommit(JSON.stringify(state), before)) throw new Error('save failed');
  });
  const ball = await desktop.ball();
  await ball.getByRole('button', { name: '打开悬浮球对话', exact: true }).click();
  await ball.getByRole('button', { name: '固定在桌面', exact: true }).click();
  await expect(ball.getByRole('combobox')).toHaveCount(0);
  await expect(ball.getByText(/当前关联任务|正在聊：|旧关联任务/)).toHaveCount(0);
  await expect(ball.getByText('这项任务先聊到这里。', { exact: true })).toBeVisible();
  const input = ball.getByRole('textbox', { name: '悬浮球对话输入', exact: true });
  await input.fill('先不聊任务了，随便聊聊。');
  await ball.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ball.getByText('卡住也没关系。先用五分钟写下论文的一个小标题，再告诉我进展。', { exact: true })).toBeVisible();
  expect(desktop.requests).toHaveLength(1);
  const messages = (await desktop.read()).chatSessions[0].messages;
  expect(messages.find(message => message.id === 'legacy-user')?.taskContext?.taskId).toBe('deleted-task');
  expect(messages.find(message => message.text === '先不聊任务了，随便聊聊。')?.taskContext).toBeUndefined();
  await ball.getByRole('button', { name: '收起悬浮球对话', exact: true }).click();
  await ball.getByRole('button', { name: '打开悬浮球对话', exact: true }).click();
  await ball.getByRole('button', { name: '固定在桌面', exact: true }).click();
  await expect(ball.getByRole('combobox')).toHaveCount(0);
  await expect(input).toBeVisible();
  await ball.screenshot({ path: info.outputPath('simple-pet-chat.png') });
});


test('keyboard progress changes save automatically when the adjustment ends', async ({ desktop }) => {
  await settings(desktop, { proactiveEnabled: true });
  const ball = await desktop.ball();
  await ball.getByRole('button', { name: '展开任务进度提醒', exact: true }).click();
  const slider = ball.getByRole('slider', { name: '提醒任务进度' });
  await slider.focus();
  await ball.keyboard.down('ArrowRight');
  await ball.keyboard.down('ArrowRight');
  await expect(slider).toHaveValue('22');
  expect((await desktop.read()).tasks[0].progress).toBe(20);
  await ball.keyboard.up('ArrowRight');
  await expect.poll(async () => (await desktop.read()).tasks[0].progress).toBe(22);
  await expect.poll(async () => (await desktop.read()).proactive?.active).toBeUndefined();
  expect(desktop.requests).toHaveLength(0);
});
