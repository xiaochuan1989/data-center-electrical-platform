// Uses the same controls as the existing UPS AI settings. Never persists keys.
export function readSpecAiConfig(doc = document, resolveBase = globalThis.getBaseUrl) {
  const model = doc.getElementById('model')?.value.trim();
  const apiKey = doc.getElementById('apikey')?.value.trim();
  const baseUrl = String(resolveBase?.() || '').trim().replace(/\/+$/, '');
  if (!baseUrl || !model || !apiKey) throw new Error('请先在页面“设置”中填写 AI 接口地址、模型和 API Key');
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('AI 接口地址无效，请检查设置'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('AI 接口须使用不含账号、查询参数或片段的 HTTP(S) 地址');
  return { model, apiKey, baseUrl, anthropic: url.hostname === 'api.anthropic.com' };
}
export function specAiDestination(doc = document, resolveBase = globalThis.getBaseUrl) {
  try {
    const config = readSpecAiConfig(doc, resolveBase);
    return `${new URL(config.baseUrl).host} · ${config.model}`;
  } catch { return '尚未完整配置；请先打开页面“设置”'; }
}
export async function requestSpecJson(config, { system, user, signal }, fetchImpl = fetch) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 180000);
  try {
    const body = config.anthropic
      ? { model: config.model, max_tokens: 8192, system, messages: [{ role: 'user', content: user }] }
      : { model: config.model, max_tokens: 8192, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    const response = await fetchImpl(config.baseUrl + (config.anthropic ? '/messages' : '/chat/completions'), {
      method: 'POST', signal: controller.signal,
      headers: config.anthropic ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' }
        : { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`AI 接口请求失败（HTTP ${response.status}），请检查设置、额度或接口服务；本次未生成结果`);
    let data;
    try { data = await response.json(); } catch { throw new Error('AI 接口未返回有效 JSON 响应'); }
    const stop = config.anthropic ? data.stop_reason : data.choices?.[0]?.finish_reason;
    if (['max_tokens', 'length', 'model_context_window_exceeded'].includes(stop)) {
      const error = new Error('模型输出被截断，正在尝试缩小分析片段'); error.code = 'TRUNCATED'; throw error;
    }
    if (!(config.anthropic ? ['end_turn', 'stop_sequence'] : ['stop']).includes(stop)) throw new Error('模型未正常结束回答，无法确认输出完整性；请更换兼容接口或重试');
    const content = config.anthropic ? data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') : data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('模型未返回文字结果');
    const raw = content.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```$/, '');
    let result;
    try { result = JSON.parse(raw); } catch { throw new Error('模型返回的提取结果不是完整合法 JSON，本次结果未采用'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('模型结果须为结构化对象');
    return result;
  } catch (error) {
    if (timedOut) throw new Error('AI 请求超时，本次整理未完成；请拆分文档或重试');
    if (controller.signal.aborted) { const cancelled = new Error('已取消 AI 整理'); cancelled.name = 'AbortError'; throw cancelled; }
    if (error instanceof TypeError) throw new Error('无法连接 AI 接口；请检查网络及接口是否支持浏览器跨域请求');
    throw error;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
