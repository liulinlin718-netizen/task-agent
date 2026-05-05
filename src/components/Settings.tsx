import { useRef, useEffect } from "react";
import { useStore } from "../Store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";

export function Settings() {
  const { state, setState } = useStore();
  const hourRef = useRef<HTMLInputElement>(null);
  const minRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const preventScroll = (e: WheelEvent) => e.preventDefault();
    const elH = hourRef.current;
    const elM = minRef.current;
    if (elH) elH.addEventListener('wheel', preventScroll, { passive: false });
    if (elM) elM.addEventListener('wheel', preventScroll, { passive: false });
    return () => {
      if (elH) elH.removeEventListener('wheel', preventScroll);
      if (elM) elM.removeEventListener('wheel', preventScroll);
    };
  }, []);


  const updateSetting = (key: keyof typeof state.settings, value: any) => {
    setState(s => ({ ...s, settings: { ...s.settings, [key]: value } }));
  };

  return (
    <div className="flex-1 overflow-y-auto auto-hide-scrollbar w-full h-full">
      <div className="flex flex-col w-full max-w-2xl mx-auto pt-12 pb-32 px-6 animate-in fade-in duration-300">
        <h2 className="text-3xl font-semibold tracking-tight mb-8 text-foreground">设置</h2>
        
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
            <div className="flex items-center justify-center border border-gray-200 dark:border-neutral-700/50 rounded-xl bg-white dark:bg-neutral-800 shadow-sm focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/30 focus-within:border-blue-400 text-foreground w-28 text-lg transition-all h-[42px]">
              <input
                ref={hourRef}
                type="text"
                placeholder="02"
                maxLength={2}
                value={state.settings.rolloverTime.split(':')[0] || '02'}
                className="w-8 bg-transparent outline-none text-center p-0 m-0"
                onChange={e => {
                  let val = e.target.value.replace(/\D/g, '');
                  updateSetting('rolloverTime', `${val}:${state.settings.rolloverTime.split(':')[1] || '00'}`);
                }}
                onWheel={e => {
                  let h = parseInt(state.settings.rolloverTime.split(':')[0] || '02', 10);
                  if (isNaN(h)) h = 2;
                  if (e.deltaY < 0) {
                    h = (h + 1) % 24;
                  } else {
                    h = (h - 1 + 24) % 24;
                  }
                  updateSetting('rolloverTime', `${h.toString().padStart(2, '0')}:${state.settings.rolloverTime.split(':')[1] || '00'}`);
                }}
                onBlur={e => {
                  let h = parseInt(e.target.value, 10);
                  if (isNaN(h)) h = 2;
                  if (h > 23) h = 23;
                  updateSetting('rolloverTime', `${h.toString().padStart(2, '0')}:${state.settings.rolloverTime.split(':')[1] || '00'}`);
                }}
              />
              <span className="text-gray-400 pb-0.5">:</span>
              <input
                ref={minRef}
                type="text"
                placeholder="00"
                maxLength={2}
                value={state.settings.rolloverTime.split(':')[1] || '00'}
                className="w-8 bg-transparent outline-none text-center p-0 m-0"
                onChange={e => {
                  let val = e.target.value.replace(/\D/g, '');
                  updateSetting('rolloverTime', `${state.settings.rolloverTime.split(':')[0] || '02'}:${val}`);
                }}
                onWheel={e => {
                  let m = parseInt(state.settings.rolloverTime.split(':')[1] || '00', 10);
                  if (isNaN(m)) m = 0;
                  if (e.deltaY < 0) {
                    m = (m + 1) % 60;
                  } else {
                    m = (m - 1 + 60) % 60;
                  }
                  updateSetting('rolloverTime', `${state.settings.rolloverTime.split(':')[0] || '02'}:${m.toString().padStart(2, '0')}`);
                }}
                onBlur={e => {
                  let m = parseInt(e.target.value, 10);
                  if (isNaN(m)) m = 0;
                  if (m > 59) m = 59;
                  updateSetting('rolloverTime', `${state.settings.rolloverTime.split(':')[0] || '02'}:${m.toString().padStart(2, '0')}`);
                }}
              />
            </div>
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
              <p className="text-sm text-gray-500 dark:text-gray-400">所有供应商统一使用 OpenAI 兼容格式</p>
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
              <p className="text-sm text-gray-500 dark:text-gray-400">桌面助理悬浮球，支持快捷对话。</p>
            </div>
            <input 
              type="checkbox" 
              checked={state.settings.floatingBallEnabled}
              onChange={e => updateSetting('floatingBallEnabled', e.target.checked)}
              className="w-5 h-5 accent-blue-600 rounded border-gray-300 dark:border-neutral-600 cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 dark:border-neutral-800 pt-10">
            <div>
              <h3 className="text-lg font-medium text-foreground">清理缓存</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">仅清理对话记录和生成的评估报告，保留设置和任务信息。</p>
            </div>
            <button 
              onClick={() => {
                if (window.confirm("确定要清理历史对话、生成的历史记录和总结报告吗？")) {
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
              <p className="text-sm text-gray-500 dark:text-gray-400">清除所有报告、任务卡片、个人中心输入的内容和对话记录。(不可恢复)</p>
            </div>
            <button 
              onClick={() => {
                if (window.confirm("❗ 确定要清理全部数据吗？包括任务、个人中心内容、所有报告和记录，此操作不可逆！")) {
                  const newSessionId = Date.now().toString();
                  setState(s => ({
                    ...s,
                    tasks: [],
                    profile: { name: "", major: "", goal: "", skills: "", bio: "" },
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
              className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shadow-sm text-sm font-medium"
            >
              清理全部数据
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
