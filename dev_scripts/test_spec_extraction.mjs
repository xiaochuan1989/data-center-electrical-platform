import assert from 'node:assert/strict';
import { analyzeSpecSource, splitSpecSource, validateSpecAnalysis, specSourceFingerprint } from '../src/modules/spec-extraction.js';
import { requestSpecJson, readSpecAiConfig, specAiDestination } from '../src/modules/spec-ai-client.js';
import { SPEC_DEVICE_REGISTRY } from '../src/data/spec-extraction-reference.js';
import { specResultMarkup } from '../src/platform/spec-extraction-view.js';

// Synthetic software fixtures only. Never presented as a real customer extraction.
assert.equal(Object.keys(SPEC_DEVICE_REGISTRY).length, 29);
const text = '合成软件验收资料，不是客户工程参数。\n一、UPS-A\nUPS-A额定功率为100kVA，额定电流不低于630A。\n二、UPS-B\nUPS-B额定功率为200kVA。\nUPS-B通信接口详见附件A。';
const source = { id: 'synthetic-source', type: 'pdf', name: '合成软件验收.pdf', text, warnings: [], segments: [{ start: 0, end: text.indexOf('二、'), page: 1 }, { start: text.indexOf('二、'), end: text.length, page: 2 }] };
const detail = (name, value, original_text) => ({ name, value, original_text, risk: 'LOW', evidence_status: 'VERIFIED', source_status: 'DOCUMENT' });
const responseFor = input => {
  const inputData = JSON.parse(input.user), raw = inputData.document_text;
  if (inputData.task === 'discovery') return { complete: true, devices: ['UPS-A', 'UPS-B'].filter(name => raw.includes(name)).map(name => ({ device_type: 'UPS主机', device_name: name, scope: '', original_text: name })) };
  return { complete: true, products: inputData.known_devices.map(d => ({ device_id: d.device_id, device_type: d.device_type, device_name: d.device_name,
    params_detail: [raw.includes(`${d.device_name}额定功率为`) ? detail('额定功率', d.device_name === 'UPS-A' ? '100kVA' : '200kVA', `${d.device_name}额定功率为${d.device_name === 'UPS-A' ? '100' : '200'}kVA`) : null,
      d.device_name === 'UPS-A' && raw.includes('额定电流不低于630A') ? detail('额定电流', '不低于630A', 'UPS-A额定功率为100kVA，额定电流不低于630A。') : null].filter(Boolean)
  })).filter(p => p.params_detail.length) };
};
const result = await analyzeSpecSource(source, { request: async input => responseFor(input) });
assert.equal(result.products.length, 2);
assert.equal(result.products[0].params_detail[0].value, '100kVA');
assert.equal(result.products[1].params_detail[0].value, '200kVA');
assert.equal(result.products[0].params_detail[1].value, '不低于630A');
assert.equal(result.products.every(p => p.params_detail.every(d => !d.multipleValues)), true, '不同设备不同容量不是同设备多个值');
assert.match(result.products[1].params_detail[0].evidence.location, /第2页/);
assert.equal(await validateSpecAnalysis(source, result), result);
assert.equal(result.reviewStatus, 'pending');
await assert.rejects(() => validateSpecAnalysis({ ...source, text: text + '修订' }, result), /已改变/);
await assert.rejects(() => validateSpecAnalysis(source, { ...result, coverage: { discovery: [{ start: 1, end: text.length }], extraction: result.coverage.extraction } }), /遗漏/);
const badCache = structuredClone(result); badCache.products[0].params_detail[0].evidence.start += 1;
await assert.rejects(() => validateSpecAnalysis(source, badCache), /失配/);
const noEvidence = structuredClone(result); delete noEvidence.products[0].params_detail[0].evidence;
await assert.rejects(() => validateSpecAnalysis(source, noEvidence), /缺少位置证据/);
const scoped = await analyzeSpecSource(source, { request: async input => {
  const response = responseFor(input);
  if (response.products) Object.assign(response.products[0].params_detail[0], { condition: '一、UPS-A', condition_original_text: '一、UPS-A' });
  return response;
} });
await validateSpecAnalysis(source, scoped);
assert.equal(scoped.products[0].params_detail[0].condition, '一、UPS-A');
assert.match(specResultMarkup(scoped), /适用条件：一、UPS-A/);
const tamperedCondition = structuredClone(scoped); tamperedCondition.products[0].params_detail[0].conditionEvidence.start += 1;
await assert.rejects(() => validateSpecAnalysis(source, tamperedCondition), /适用条件证据位置/);
const negativeSource = { ...source, text: source.text + '\nUPS-A工作温度-25℃。' };
await assert.rejects(() => analyzeSpecSource(negativeSource, { request: async input => {
  const response = responseFor(input); if (response.products) response.products[0].params_detail.push(detail('工作温度', '25℃', 'UPS-A工作温度-25℃。')); return response;
} }), /正负号/);
const missingValue = async input => {
  const response = responseFor(input);
  if (response.products) response.products[0].params_detail[0].value = '999kVA';
  return response;
};
await assert.rejects(() => analyzeSpecSource(source, { request: missingValue }), /无法由引用原文支持/);
await assert.rejects(() => analyzeSpecSource(source, { request: async input => {
  const response = responseFor(input); if (response.products) response.products[0].params_detail[0].value = '100KVA'; return response;
} }), /单位或限定条件/, '单位大小写不默默改写，避免将mA与MA视为相同');
await assert.rejects(() => analyzeSpecSource(source, { request: async input => {
  const response = responseFor(input); if (response.products) response.products[0].params_detail[1].value = '630A'; return response;
} }), /比较条件/);
const dcSource = { ...source, text: source.text + '\nUPS-A直流电压DC900V。' };
await assert.rejects(() => analyzeSpecSource(dcSource, { request: async input => {
  const response = responseFor(input); if (response.products) response.products[0].params_detail.push(detail('直流电压', '900V', 'UPS-A直流电压DC900V。')); return response;
} }), /丢失了电气前缀/);
await assert.rejects(() => analyzeSpecSource(source, { request: async input => {
  const response = responseFor(input); if (response.products) response.products[0].params_detail[0].source_status = 'DEFAULT'; return response;
} }), /来源状态/);
await assert.rejects(() => analyzeSpecSource(source, { request: async () => ({ complete: false, devices: [] }) }), /未完整完成/);
await assert.rejects(() => analyzeSpecSource(source, { request: async () => ({ complete: true, devices: [] }) }), /未识别/);
const referenced = await analyzeSpecSource(source, { request: async input => {
  const response = responseFor(input);
  if (response.products) response.products[1].params_detail.push({ name: '通信接口', value: '详见附件A', original_text: 'UPS-B通信接口详见附件A。', risk: 'MEDIUM', evidence_status: 'REFERENCED_EXTERNAL', source_status: 'DOCUMENT_REFERENCE', reference_target: '附件A', reference_type: 'ATTACHMENT' },
    { name: '认证要求', value: '文档未明确要求', original_text: '', risk: 'LOW', evidence_status: 'NOT_STATED', source_status: 'NOT_IN_DOCUMENT' });
  return response;
} });
await validateSpecAnalysis(source, referenced);
assert.equal(referenced.products[1].params_detail[1].evidence_status, 'REFERENCED_EXTERNAL');
assert.equal(referenced.products[1].params_detail[2].evidence, null);
// Repeated page furniture may interrupt a real requirement; arbitrary正文 may not.
const header = '合成文档重复页眉，仅用于软件测试';
const pageTexts = [`${header}\n带★标记条款：为本文中不可偏离项。\n电池开关箱。\n★工作模式 在线测试。\n`, `${header}\n裸露铜排需加装透明\n`, `${header}\n绝缘防护板。\n`];
let position = 0;
const continued = { id: 'continued', name: '合成跨页.pdf', type: 'pdf', text: pageTexts.join(''), warnings: [], segments: pageTexts.map((text, i) => { const page = { start: position, end: position + text.length, page: i + 1 }; position += text.length; return page; }) };
const continuedRequest = async input => JSON.parse(input.user).task === 'discovery' ? { complete: true, devices: [{ device_type: '电池开关箱', device_name: '电池开关箱', scope: '', original_text: '电池开关箱。' }] }
  : { complete: true, products: [{ device_id: 'device-1', device_type: '电池开关箱', device_name: '电池开关箱', params_detail: [detail('工作模式', '在线测试', '★工作模式 在线测试。'), detail('绝缘防护', '裸露铜排需加装透明绝缘防护板', `裸露铜排需加装透明\n${header}\n绝缘防护板。`)] }] };
const continuedResult = await analyzeSpecSource(continued, { request: continuedRequest });
await validateSpecAnalysis(continued, continuedResult);
assert.equal(continuedResult.products[0].params_detail[0].forbiddenDeviation, true);
assert.match(continuedResult.products[0].params_detail[0].deviationRuleEvidence.quote, /不可偏离项/);
assert.equal(continuedResult.products[0].params_detail[1].forbiddenDeviation, null);
assert.equal(continuedResult.products[0].params_detail[1].evidence.pageFurnitureOmittedInValue, true);
assert.match(continuedResult.products[0].params_detail[1].evidence.location, /第2—3页/);
assert.ok(continuedResult.products[0].params_detail[1].original_text.includes(header), '完整原文证据仍保留页眉');
assert.match(specResultMarkup(continuedResult), /★ 不可偏离/);
const badMark = structuredClone(continuedResult); badMark.products[0].params_detail[0].forbiddenDeviation = false;
await assert.rejects(() => validateSpecAnalysis(continued, badMark), /不可偏离标记/);
const lostMark = structuredClone(continuedResult); delete lostMark.products[0].params_detail[0].forbiddenDeviation;
await assert.rejects(() => validateSpecAnalysis(continued, lostMark), /不可偏离标记缺失/);
const interrupted = { ...continued, text: continued.text.replace(`透明\n${header}`, `透明\n必须加装熔断器\n${header}`) };
await assert.rejects(() => analyzeSpecSource(interrupted, { request: async input => {
  const response = await continuedRequest(input);
  if (response.products) response.products[0].params_detail[1].original_text = response.products[0].params_detail[1].original_text.replace('透明\n', '透明\n必须加装熔断器\n');
  return response;
} }), /无法由引用原文支持/, '不能省略中间真实正文以拼成参数值');
await assert.rejects(() => analyzeSpecSource(source, { request: async input => {
  const response = responseFor(input); if (response.products) response.products[0].params_detail[0].original_text = '不存在的证据'; return response;
} }), /不在当前原文/);
await assert.rejects(() => analyzeSpecSource(source, { request: async input => {
  const response = responseFor(input); if (response.products) response.products[0].device_id = 'unknown-device'; return response;
} }), /未识别设备/);
await assert.rejects(() => analyzeSpecSource({ ...source, warnings: ['PDF第2页未读取到文字，需另行识别/核对'] }, { request: async () => { throw new Error('不应请求'); } }), /未读取完整/);
const abort = new AbortController(); abort.abort();
await assert.rejects(() => analyzeSpecSource(source, { request: async () => responseFor({ user: '{}' }), signal: abort.signal }), /取消/);

// Long input must cover every source character in both phases, with exact original offsets.
const longSource = { ...source, text: text + '\n' + '非技术正文，无需新增参数。\n'.repeat(220), segments: [{ start: 0, end: 10000, page: 1 }] };
const chunks = splitSpecSource(longSource, 1000, 100);
assert.equal(chunks[0].start, 0); assert.equal(chunks.at(-1).end, longSource.text.length);
for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i].start < chunks[i - 1].end);
let truncated = false;
const longResult = await analyzeSpecSource(longSource, { chunkSize: 2000, request: async input => {
  if (!truncated) { truncated = true; const e = new Error('truncated'); e.code = 'TRUNCATED'; throw e; }
  return responseFor(input);
} });
await validateSpecAnalysis(longSource, longResult);
assert.ok(longResult.requestCount > 4);
assert.equal(longResult.products[0].params_detail.length, 2, '重叠片段不重复追加同一参数证据');
const mediumSource = { ...source, text: text + '\n' + '非技术正文，无需新增参数。\n'.repeat(60) };
let mediumTruncated = false; const events = [];
const recovered = await analyzeSpecSource(mediumSource, { onProgress: event => events.push(event), request: async input => {
  if (!mediumTruncated) { mediumTruncated = true; const error = new Error('length'); error.code='TRUNCATED'; throw error; }
  return responseFor(input);
} });
await validateSpecAnalysis(mediumSource,recovered);
assert(events.some(e=>e.retry==='truncated' && e.chunkChars<1800),'不足1800字的片段也能自动恢复');
await assert.rejects(()=>analyzeSpecSource(source,{request:async()=>{
  const error=new Error('模型回答达到长度限制'); error.code='TRUNCATED'; error.completionTokens=8192; throw error;
}}),error=>error.code==='TRUNCATION_EXHAUSTED' && /拆分已停止/.test(error.message) && !/正在/.test(error.message));
assert.notEqual(await specSourceFingerprint(source), await specSourceFingerprint({ ...source, segments: [{ start: 0, end: text.length, page: 9 }] }));

const config = { baseUrl: 'https://example.invalid/v1', model: 'synthetic-model', apiKey: 'synthetic-only', anthropic: false };
let sent;
const success = await requestSpecJson(config, { user: 'synthetic', system: 'synthetic' }, async (url, init) => {
  sent = { url, init }; return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '```json\n{"complete":true}\n```' } }] }) };
});
assert.equal(success.complete, true); assert.equal(sent.url, 'https://example.invalid/v1/chat/completions');
assert.equal(JSON.parse(sent.init.body).max_tokens, 8192);
assert.equal('thinking' in JSON.parse(sent.init.body),false,'兼容接口不能收到DeepSeek专用参数');
await requestSpecJson({...config,baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash'}, {system:'只输出JSON',user:'合成验证'},async(url,init)=>{
  const body=JSON.parse(init.body);
  assert.equal(body.thinking.type,'disabled'); assert.equal(body.response_format.type,'json_object'); assert.equal(body.max_tokens,16384);
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]})};
});
await requestSpecJson({...config,model:'deepseek-flash'}, {},async(url,init)=>{
  const body=JSON.parse(init.body); assert.equal(body.max_tokens,8192); assert.equal('thinking' in body,false,'同名模型的第三方接口不强加参数');
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{}'}}]})};
});
await assert.rejects(() => requestSpecJson(config, {}, async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }) })), e => e.code === 'TRUNCATED');
await assert.rejects(() => requestSpecJson(config, {}, async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) })), /未正常结束/);
await assert.rejects(() => requestSpecJson(config, {}, async () => ({ ok: false, status: 401 })), /HTTP 401/);
await assert.rejects(() => requestSpecJson(config, {}, async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{bad' } }] }) })), /合法 JSON/);
const anthropic = await requestSpecJson({ ...config, baseUrl: 'https://api.anthropic.com/v1', anthropic: true }, {}, async (url, init) => {
  assert.match(url, /\/messages$/); assert.equal(init.headers['x-api-key'], 'synthetic-only');
  return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'ignored' }, { type: 'text', text: '{"ok":true}' }] }) };
});
assert.equal(anthropic.ok, true);
const doc = { getElementById: id => ({ value: { model: 'test-model', apikey: 'synthetic-secret' }[id] || '' }) };
assert.equal(readSpecAiConfig(doc, () => 'https://example.invalid/v1/').baseUrl, config.baseUrl);
assert.equal(specAiDestination(doc, () => 'https://example.invalid/v1').includes('synthetic-secret'), false);
assert.throws(() => readSpecAiConfig(doc, () => 'https://example.invalid/v1?key=secret'), /查询参数/);
const html = specResultMarkup({ ...result, products: [{ ...result.products[0], device_name: '<img src=x onerror=alert(1)>' }] });
assert.equal(html.includes('<img'), false); assert.match(html, /&lt;img/);
console.log('AI规范提取：设备隔离、比较条件、原文/缓存证据、全段覆盖、截断细分、取消、接口协议、空结果与HTML转义回归通过（合成软件用例）');
