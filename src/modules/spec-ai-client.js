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
    return `${new URL(config.baseUrl).host} · ${config.model} · ${specThinkingPolicy(config).deepseek ? '思考提取＋加强复核' : '单独语义复核（思考能力由模型决定）'}`;
  } catch { return '尚未完整配置；请先打开页面“设置”'; }
}
export function specThinkingPolicy(config, phase = 'extraction', budgetStep = 0) {
  const deepseek = !config.anthropic && new URL(config.baseUrl).hostname === 'api.deepseek.com'
    && ['deepseek-flash', 'deepseek-v4-pro'].includes(config.model);
  const review = phase === 'review';
  return { deepseek, effort: review ? 'high' : 'low',
    outputLimit: deepseek ? (review ? 65536 : 32768) * (budgetStep === 1 ? 2 : 1) : 8192 };
}
// 浏览器报 Failed to fetch 时给出可操作的原因：网页受跨域限制，桌面程序不受；第三方中转站常不支持网页跨域调用。
export function specConnectionHint(baseUrl) {
  let host = '';
  try { host = new URL(baseUrl).hostname; } catch { /* 地址已在读取设置时校验 */ }
  if (['127.0.0.1', 'localhost'].includes(host)) return '无法连接本机转发：请确认 tools\\start-ai-proxy.cmd 窗口仍在运行，且 Chrome 已允许本网站访问本地网络；本次未生成结果';
  return '无法连接 AI 接口（浏览器报 Failed to fetch）：可能是网络/DNS 暂时连不上该接口，或接口不支持网页跨域调用（第三方中转站多见）。中转站可运行 tools\\start-ai-proxy.cmd 本机转发，并把设置里的 Base URL 改为 http://127.0.0.1:8787；本次未生成结果';
}
export async function requestSpecJson(config, { system, user, signal, phase = 'extraction', budgetStep = 0 }, fetchImpl = fetch) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const policy = specThinkingPolicy(config, phase, budgetStep);
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, policy.deepseek ? 300000 : 180000);
  try {
    // These options are supported by the current official DeepSeek models only.
    // Other OpenAI-compatible providers retain their existing request contract.
    const { deepseek, outputLimit } = policy;
    const body = config.anthropic
      ? { model: config.model, max_tokens: outputLimit, system, messages: [{ role: 'user', content: user }] }
      : { model: config.model, max_tokens: outputLimit, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        ...(deepseek ? { thinking: { type: 'enabled' }, reasoning_effort: policy.effort, response_format: { type: 'json_object' } } : {}) };
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
      const error = new Error('模型回答达到长度限制，未完整返回');
      error.code = 'TRUNCATED'; error.finishReason = stop; error.outputLimit = outputLimit;
      error.completionTokens = Number.isFinite(data.usage?.completion_tokens) ? data.usage.completion_tokens : null;
      error.canIncreaseBudget = deepseek && budgetStep === 0 && stop === 'length';
      throw error;
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
    // 只把网络层失败（各浏览器 fetch 的 TypeError 文案）归为连接问题；读取响应结构出错的 TypeError 原样抛出。
    if (error instanceof TypeError && /fetch|NetworkError|Load failed/i.test(error.message)) throw new Error(specConnectionHint(config.baseUrl));
    throw error;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
