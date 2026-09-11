import { useState } from "react";
import { useStore } from "../Store";
import { logicalDate, normalizeState } from "../state/appState";
import { reviseMemory } from "../state/memory";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";

export function Settings() {
  const { state, setState } = useStore();
  const [showReportConfig, setShowReportConfig] = useState(false);
  const [pwDialog, setPwDialog] = useState<{ mode: 'export' | 'import'; pw: string } | null>(null);
  const isDesktop = Boolean(window.electronAPI?.reminderAction);
  const proactiveEnabled = state.settings.proactiveEnabled !== false;
  const dismissedToday = state.proactive?.dismissedDate === logicalDate(new Date(), state.settings.rolloverTime);
  const snoozedUntil = state.proactive?.snoozedUntil ? new Date(state.proactive.snoozedUntil) : null;
  const isSnoozed = Boolean(snoozedUntil && snoozedUntil.getTime() > Date.now());

  const updateSetting = (key: keyof typeof state.settings, value: any) => {
    setState(s => ({ ...s, settings: { ...s.settings, [key]: value } }));
  };

  return (
    <div className="flex-1 overflow-y-auto auto-hide-scrollbar w-full h-full">
      <div className="flex flex-col w-full max-w-2xl mx-auto pt-12 pb-32 px-6 animate-in fade-in duration-300">
        <h2 className="text-3xl font-semibold tracking-tight mb-8 text-foreground">设置</h2>
        
        <p className="mb-6 text-sm text-gray-500">任务、档案、长期记忆与配置保存在本机。使用 AI 时，相关内容会发送到你配置的模型服务；开启自动学习时还会分析当次自述。</p>
        <div className="space-y-10">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-foreground">外观</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">选择深色或浅色模式。</p>
            </div>
            <Select value={state.settings.theme || 'light'} onValueChange={val => updateSetting('theme', val)}>
              <SelectTrigger className="w-32 bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 rounded-xl focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 h-[42px] px-3 py-2 text-sm">
                <SelectValue placeholder="选择主题" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} sideOffset={8} className="rounded-xl shadow-lg min-w-32">
                <SelectItem value="light">浅色</SelectItem>
                <SelectItem value="dark">深色</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-foreground">生物钟</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">新的一天对你来说什么时候开始？</p>
            </div>
            <input type="time" aria-label="新一天开始时间" step="60"
              value={state.settings.rolloverTime}
              onChange={e => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value)) updateSetting('rolloverTime', e.target.value); }}
              className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-foreground" />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-foreground">自定义助理名称</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">给你的任务助理起个名字吧。</p>
            </div>
            <input 
              type="text" 
              value={state.settings.agentName || ''}
              onChange={e => updateSetting('agentName', e.target.value)}
              placeholder="任务助理"
              className="h-[42px] px-3 py-2 border border-gray-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 shadow-sm outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 focus:border-blue-400 text-foreground w-40 text-right text-sm"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-foreground">助理模式</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">助理应该如何与你互动？</p>
            </div>
            <Select value={state.settings.agentStyle} onValueChange={val => updateSetting('agentStyle', val)}>
              <SelectTrigger className="w-64 bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 rounded-xl focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 h-[42px] px-3 py-2 text-sm">
                <SelectValue placeholder="选择助理模式" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} sideOffset={8} className="rounded-xl shadow-lg w-64">
                <SelectItem value="academic">专业导师 (Professional Mentor)</SelectItem>
                <SelectItem value="gentle">贴心助手 (Gentle Assistant)</SelectItem>
                <SelectItem value="strict">严厉督导 (Strict Supervisor)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 dark:border-neutral-800 pt-10">
            <div>
              <h3 className="text-lg font-medium text-foreground">API Base URL</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">请使用支持工具调用的 OpenAI 兼容服务与模型</p>
            </div>
            <input 
              type="text" 
              value={state.settings.apiBaseUrl || ''}
              onChange={e => updateSetting('apiBaseUrl', e.target.value)}
              placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
              className="h-[42px] px-3 py-2 border border-gray-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 shadow-sm outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 focus:border-blue-400 text-foreground w-80 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2 -mt-2">
            {[
              { label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
              { label: 'OpenAI', url: 'https://api.openai.com/v1' },
              { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
              { label: 'Kimi', url: 'https://api.moonshot.cn/v1' },
              { label: 'Qwen', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
            ].map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => updateSetting('apiBaseUrl', p.url)}
                className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                  state.settings.apiBaseUrl === p.url
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                    : 'bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-foreground">模型名称 (Model)</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">例如: qwen2.5, gpt-4o, gemini-2.5-flash</p>
            </div>
            <input 
              type="text" 
              value={state.settings.apiModel || ''}
              onChange={e => updateSetting('apiModel', e.target.value)}
              placeholder="gemini-2.5-flash"
              className="h-[42px] px-3 py-2 border border-gray-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 shadow-sm outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 focus:border-blue-400 text-foreground w-48 text-right text-sm"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-foreground">API Key</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">凭证 (本地无需鉴权可随便填写一项不为空)</p>
            </div>
            <input 
              type="password" 
              value={state.settings.apiKey || ''}
              onChange={e => updateSetting('apiKey', e.target.value)}
              placeholder="sk-..."
              className="h-[42px] px-3 py-2 border border-gray-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 shadow-sm outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 focus:border-blue-400 text-foreground w-48 text-sm"
            />
          </div>

          {/* Report Agent collapsible config */}
          <div className="border border-gray-200 dark:border-neutral-700 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowReportConfig(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-neutral-800/50 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors text-sm"
            >
              <span className="font-medium text-foreground">高级：Report Agent 独立配置</span>
              <span className="text-gray-400 text-xs">{showReportConfig ? '▾ 收起' : '▸ 展开'}</span>
            </button>
            {showReportConfig && (
              <div className="px-4 py-4 space-y-4 border-t border-gray-200 dark:border-neutral-700">
                <p className="text-xs text-gray-400 dark:text-gray-500">留空则使用上方全局配置。报告生成可使用更强的深度模型。</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">报告模型</span>
                  <input
                    type="text"
                    value={state.settings.reportModel || ''}
                    onChange={e => updateSetting('reportModel', e.target.value)}
                    placeholder={state.settings.apiModel || 'gemini-2.5-flash'}
                    className="h-[36px] px-3 py-1 border border-gray-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-foreground w-48 text-sm outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">报告 API Key</span>
                  <input
                    type="password"
                    value={state.settings.reportApiKey || ''}
                    onChange={e => updateSetting('reportApiKey', e.target.value)}
                    placeholder="与全局相同"
                    className="h-[36px] px-3 py-1 border border-gray-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-foreground w-48 text-sm outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">报告 Base URL</span>
                  <input
                    type="text"
                    value={state.settings.reportApiBaseUrl || ''}
                    onChange={e => updateSetting('reportApiBaseUrl', e.target.value)}
                    placeholder={state.settings.apiBaseUrl || '与全局相同'}
                    className="h-[36px] px-3 py-1 border border-gray-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-foreground w-48 text-sm outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 dark:border-neutral-800 pt-10">
            <div>
              <h3 className="text-lg font-medium text-foreground">桌面侧边栏</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">启用边缘触发快速预览。</p>
            </div>
            <input 
              type="checkbox" 
              checked={state.settings.sidebarEnabled}
              onChange={e => updateSetting('sidebarEnabled', e.target.checked)}
              className="w-5 h-5 accent-blue-600 rounded border-gray-300 dark:border-neutral-600 cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-foreground">桌面悬浮球</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">桌面助理悬浮球，支持快捷对话；关闭后也会停止主动提醒。</p>
            </div>
            <input 
              type="checkbox"
              aria-label="开启桌面悬浮球"
              checked={state.settings.floatingBallEnabled}
              onChange={e => updateSetting('floatingBallEnabled', e.target.checked)}
              className="w-5 h-5 accent-blue-600 rounded border-gray-300 dark:border-neutral-600 cursor-pointer"
            />
          </div>

          <section aria-label="主动提醒设置" className="space-y-5 rounded-2xl border border-sky-100 bg-sky-50/40 p-5 dark:border-sky-900/40 dark:bg-sky-950/10">
            <div className="flex items-start justify-between gap-5">
              <div>
                <h3 className="text-lg font-medium text-foreground">主动进度提醒</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-500 dark:text-gray-400">任务一段时间没有更新时，桌宠轻轻问候一下。没有更新记录，不代表没有努力。</p>
              </div>
              <input type="checkbox" aria-label="开启主动进度提醒" checked={proactiveEnabled}
                onChange={event => updateSetting('proactiveEnabled', event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded border-gray-300 accent-blue-600 dark:border-neutral-600" />
            </div>
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {isDesktop ? '需要同时开启桌面悬浮球。关闭此开关将停止主动提醒，仍可使用悬浮球对话。' : '主动提醒仅在桌面版可用，需要同时开启桌面悬浮球；浏览器中只保存设置。'}
            </p>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="proactive-interval" className="text-sm text-foreground">未更新多久后提醒</label>
              <select id="proactive-interval" aria-label="未更新多久后提醒" value={state.settings.proactiveIntervalMinutes ?? 120}
                onChange={event => updateSetting('proactiveIntervalMinutes', Number(event.target.value))}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-sky-200 dark:border-neutral-700 dark:bg-neutral-800">
                <option value={30}>30 分钟</option>
                <option value={60}>1 小时</option>
                <option value={120}>2 小时（默认）</option>
                <option value={240}>4 小时</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-foreground">静默时段</span>
              <div className="flex items-center gap-2">
                <input type="time" aria-label="主动提醒静默开始时间" step="60" value={state.settings.proactiveQuietStart ?? '22:00'}
                  onChange={event => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(event.target.value)) updateSetting('proactiveQuietStart', event.target.value); }}
                  className="rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm text-foreground dark:border-neutral-700 dark:bg-neutral-800" />
                <span className="text-xs text-gray-400">至</span>
                <input type="time" aria-label="主动提醒静默结束时间" step="60" value={state.settings.proactiveQuietEnd ?? '09:00'}
                  onChange={event => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(event.target.value)) updateSetting('proactiveQuietEnd', event.target.value); }}
                  className="rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm text-foreground dark:border-neutral-700 dark:bg-neutral-800" />
              </div>
            </div>
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">默认 2 小时未更新后提醒，22:00—09:00 静默；起止时间相同则不设静默时段。按上方生物钟，每天最多提醒 3 次。提醒不抢焦点，5 分钟未响应会自动收起，下次按所选间隔提醒。</p>
            {(dismissedToday || isSnoozed) && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sky-100 pt-4 dark:border-sky-900/40">
              <p role="status" className="text-xs text-sky-700 dark:text-sky-300">{dismissedToday ? '今天已选择休息，主动提醒已暂停。' : `已稍后提醒，暂停至 ${snoozedUntil!.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}。`}</p>
              <button type="button" onClick={() => setState(current => current.proactive ? {
                ...current, proactive: { ...current.proactive, snoozedUntil: undefined, dismissedDate: undefined },
              } : current)} className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:bg-neutral-900 dark:text-sky-300">恢复主动提醒</button>
              <p className="w-full text-xs text-gray-500 dark:text-gray-400">恢复后仍遵守开关、静默时段和提醒间隔，不重置当天次数。</p>
            </div>}
          </section>

          <div className="flex items-center justify-between border-t border-gray-100 dark:border-neutral-800 pt-10">
            <div>
              <h3 className="text-lg font-medium text-foreground">清理缓存</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">清理对话记录、日报和总结报告，保留任务、个人档案、长期记忆与设置。</p>
            </div>
            <button 
              onClick={() => {
                if (window.confirm("确定清理对话记录、日报和总结报告吗？任务、个人档案、长期记忆与设置会保留。")) {
                  const newSessionId = Date.now().toString();
                  setState(s => ({
                    ...s,
                    chatSessions: [{ 
                      id: newSessionId, 
                      title: '新对话', 
                      messages: [{ id: 'initial', role: 'model', text: '你好！我是你的' + (s.settings.agentName || '任务助理') + '。今天我能帮你做些什么？' }], 
                      updatedAt: new Date().toISOString() 
                    }],
                    activeChatSessionId: newSessionId,
                    reports: [],
                    historySummaries: []
                  }));
                }
              }}
              className="px-4 py-2 border border-blue-200 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors shadow-sm text-sm font-medium"
            >
              清理缓存
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-red-600 dark:text-red-400">清理全部数据</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">清除任务、报告、对话、个人档案、全部对话记忆与提醒记录，保留外观、API 和提醒等设置。清除后需从备份恢复。</p>
            </div>
            <button 
              onClick={() => {
                if (window.confirm("确定清除任务、报告、对话、个人档案、全部对话记忆与提醒记录吗？设置会保留，清除后需从备份恢复。")) {
                  const newSessionId = Date.now().toString();
                  setState(s => reviseMemory({
                    ...s,
                    tasks: [],
                    proactive: undefined,
                    profile: { major: "", goal: "", skills: "", bio: "" },
                    chatSessions: [{ 
                      id: newSessionId, 
                      title: '新对话', 
                      messages: [{ id: 'initial', role: 'model', text: '你好！我是你的' + (s.settings.agentName || '任务助理') + '。今天我能帮你做些什么？' }], 
                      updatedAt: new Date().toISOString() 
                    }],
                    activeChatSessionId: newSessionId,
                    reports: [],
                    historySummaries: []
                  }, memory => ({ ...memory, facts: [] })));
                }
              }}
              className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shadow-sm text-sm font-medium"
            >
              清理全部数据
            </button>
          </div>

          <div className="flex flex-col gap-3 pt-4 border-t border-gray-100 dark:border-neutral-800">
            <p className="text-sm text-gray-500">加密备份包含任务、对话、个人档案、长期记忆和 API 配置，请妥善保管密码。导入导出需要桌面版。</p>
            <div className="flex items-center gap-3">
              <button
                disabled={!window.electronAPI?.dataExport}
                onClick={() => setPwDialog({ mode: 'export', pw: '' })}
                className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors shadow-sm text-sm font-medium"
              >
                📤 导出数据
              </button>
              <button
                disabled={!window.electronAPI?.dataImport}
                onClick={() => setPwDialog({ mode: 'import', pw: '' })}
                className="px-4 py-2 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-900/50 rounded-xl hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors shadow-sm text-sm font-medium"
              >
                📥 导入数据
              </button>
            </div>

            {pwDialog && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700">
                <input
                  autoFocus
                  type="password"
                  placeholder={pwDialog.mode === 'export' ? '设置导出密码...' : '输入导入密码...'}
                  value={pwDialog.pw}
                  onChange={e => setPwDialog({ ...pwDialog, pw: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Escape') setPwDialog(null); }}
                  className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-foreground outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/50"
                />
                <button
                  disabled={!pwDialog.pw}
                  onClick={async () => {
                    const { mode, pw } = pwDialog;
                    setPwDialog(null);
                    if (mode === 'export') {
                      const ok = await window.electronAPI?.dataExport?.(pw);
                      if (ok) alert('导出成功！');
                      else if (ok === false) alert('导出失败。');
                    } else {
                      const result = await window.electronAPI?.dataImport?.(pw);
                      if (result === '__ERROR__') {
                        alert('导入失败：密码错误或文件损坏。');
                      } else if (result) {
                        setState(normalizeState(JSON.parse(result)));
                        alert('导入成功！数据已恢复。');
                      }
                    }
                  }}
                  className="px-3 py-1.5 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors font-medium"
                >
                  确认
                </button>
                <button
                  onClick={() => setPwDialog(null)}
                  className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
