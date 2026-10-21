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
  if (inputData.task === 'review') return {complete:true,source_checked:true,checked_parameter_ids:inputData.review_parameters.map(p=>p.parameter_id),issues:[]};
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
const continuedRequest = async input => JSON.parse(input.user).task === 'review'
  ? {complete:true,source_checked:true,checked_parameter_ids:JSON.parse(input.user).review_parameters.map(p=>p.parameter_id),issues:[]}
  : JSON.parse(input.user).task === 'discovery' ? { complete: true, devices: [{ device_type: '电池开关箱', device_name: '电池开关箱', scope: '', original_text: '电池开关箱。' }] }
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
  assert.equal(body.thinking.type,'enabled'); assert.equal(body.reasoning_effort,'low'); assert.equal(body.response_format.type,'json_object'); assert.equal(body.max_tokens,32768);
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
// 设备别名：6万字以内整篇一次识别设备（封面/章节/配置表叫法须一起看到）；超长资料分段识别时，后续片段沿用
// known_devices 名称而本段原文只出现别名，不得因"名称不在本段原文"整轮失败。
{
  const buildAlias = repeat => '合成软件验收资料。\n一、UPS电池开关箱\n' + '本行为合成填充文字，用于把资料撑到需要分段处理的长度，不含任何技术参数。\n'.repeat(repeat) + '二、配置表\n合成快速开关箱额定电压为DC480V。\n';
  const aliasSource = { id: 'synthetic-alias', type: 'text', name: '合成别名验收.txt', text: buildAlias(14), warnings: [], segments: [] };
  assert(splitSpecSource(aliasSource, 500, 50).length >= 2, '合成资料参数整理须分成多段');
  let discoveryCalls = 0;
  const aliasResponse = (newName = null, echoName = null) => async input => {
    const data = JSON.parse(input.user), raw = data.document_text;
    if (data.task === 'review') return { complete: true, source_checked: true, checked_parameter_ids: data.review_parameters.map(p => p.parameter_id), issues: [] };
    if (data.task === 'discovery') {
      discoveryCalls++;
      const first = raw.includes('一、UPS电池开关箱'), second = raw.includes('合成快速开关箱');
      if (first && second) return { complete: true, devices: [{ device_type: '电池开关箱', device_name: newName || 'UPS电池开关箱', scope: '', original_text: newName ? '合成快速开关箱额定电压为DC480V。' : '一、UPS电池开关箱' }] };
      if (first) return { complete: true, devices: [{ device_type: '电池开关箱', device_name: 'UPS电池开关箱', scope: '', original_text: '一、UPS电池开关箱' }] };
      if (second) return { complete: true, devices: [{ device_type: '电池开关箱', device_name: newName || data.known_devices[0].device_name, scope: '', original_text: '合成快速开关箱额定电压为DC480V。' }] };
      return { complete: true, devices: [] };
    }
    return { complete: true, products: raw.includes('DC480V') ? data.known_devices.map(d => ({ device_id: d.device_id, device_type: d.device_type, device_name: echoName || d.device_name,
      params_detail: [detail('额定电压', 'DC480V', '合成快速开关箱额定电压为DC480V。')] })) : [] };
  };
  const aliased = await analyzeSpecSource(aliasSource, { request: aliasResponse(), chunkSize: 500 });
  assert.equal(discoveryCalls, 1, '短资料整篇一次识别设备');
  assert.equal(aliased.products.length, 1, '沿用已识别设备名称不得拆成新设备');
  assert.equal(aliased.products[0].device_name, 'UPS电池开关箱');
  assert.equal(aliased.products[0].params_detail[0].value, 'DC480V');
  assert.equal(aliased.products[0].nameInEvidence, true);
  assert.equal(await validateSpecAnalysis(aliasSource, aliased), aliased);
  // 名称是归一标签：未逐字出现在证据中时接收并标记待核对，证据本身仍须真实可定位。
  const renamed = await analyzeSpecSource(aliasSource, { request: aliasResponse('电池开关箱（配置表）'), chunkSize: 500 });
  const flagged = renamed.products.find(p => p.device_name === '电池开关箱（配置表）');
  assert.equal(flagged?.nameInEvidence, false);
  assert.equal(flagged.evidence.quote, '合成快速开关箱额定电压为DC480V。');
  assert.equal(await validateSpecAnalysis(aliasSource, renamed), renamed);
  assert.match(specResultMarkup(renamed), /设备名称为AI归纳，原文写法：“合成快速开关箱额定电压为DC480V。”/);
  const tamperedFlag = structuredClone(renamed); tamperedFlag.products.find(p => p.nameInEvidence === false).nameInEvidence = true;
  await assert.rejects(() => validateSpecAnalysis(aliasSource, tamperedFlag), /名称来源标记/);
  // 超长资料（>6万字）分段识别：后续片段沿用已识别名称、本段原文只有别名，仍识别为同一设备。
  const longSource = { ...aliasSource, id: 'synthetic-alias-long', text: buildAlias(1700) };
  assert(longSource.text.length > 61000);
  discoveryCalls = 0;
  const longRun = await analyzeSpecSource(longSource, { request: aliasResponse(), chunkSize: 30000 });
  assert(discoveryCalls >= 2, '超长资料分段识别设备');
  assert.equal(longRun.products.length, 1);
  assert.equal(longRun.products[0].params_detail[0].value, 'DC480V');
  // 参数阶段回显设备名称时空格/全半角不同，按设备编号对应，不整轮失败。
  const echoed = await analyzeSpecSource(aliasSource, { request: aliasResponse(null, 'UPS 电池开关箱'), chunkSize: 500 });
  assert.equal(echoed.products[0].params_detail[0].value, 'DC480V');
  // 证据不在原文中仍拒收：防编造的底线不变。
  await assert.rejects(() => analyzeSpecSource(aliasSource, { request: async input => { const d = JSON.parse(input.user);
    return d.task === 'discovery' ? { complete: true, devices: [{ device_type: '电池开关箱', device_name: 'X', scope: '', original_text: '原文没有这句话' }] } : { complete: true, products: [] }; }, chunkSize: 500 }), /证据不在当前原文片段内/);
}
// 页眉页脚：程序识别的重复行传给模型；值混入页眉（常伴后半句丢失）转入待核对；正确省略页眉的跨页值通过。
{
  const header = '合成保密页眉：仅供软件验收不得外传的资料\n';
  const pages = ['一、电池开关箱\n电池开关箱安装方式为落地式安装。\n', '二、结构\n裸露铜排需加装透明\n', '绝缘防护板。\n三、其他\n外壳防护等级IP20。\n'];
  let furnText = '', furnSegments = [];
  for (const [i, body] of pages.entries()) { const start = furnText.length; furnText += header + body; furnSegments.push({ start, end: furnText.length, page: i + 1 }); }
  const furnSource = { id: 'synthetic-furniture', type: 'pdf', name: '合成页眉验收.pdf', text: furnText, warnings: [], segments: furnSegments };
  const crossQuote = furnText.slice(furnText.indexOf('裸露铜排'), furnText.indexOf('绝缘防护板。') + 6);
  let seenFurniture = null;
  const furnRequest = (polluted, quote = crossQuote) => async input => {
    const data = JSON.parse(input.user);
    if (data.task === 'review') return { complete: true, source_checked: true, checked_parameter_ids: data.review_parameters.map(p => p.parameter_id), issues: [] };
    if (data.task === 'discovery') return { complete: true, devices: [{ device_type: '电池开关箱', device_name: '电池开关箱', scope: '', original_text: '一、电池开关箱' }] };
    seenFurniture = data.page_furniture;
    assert(data.known_devices.every(d => !('evidence' in d)), '参数整理不得附带设备证据原文（可能来自片段之外）');
    return { complete: true, products: data.known_devices.map(d => ({ device_id: d.device_id, device_type: d.device_type, device_name: d.device_name, params_detail: [
      detail('安装方式', '落地式安装', '电池开关箱安装方式为落地式安装。'),
      detail('裸露铜排防护', polluted ? '裸露铜排需加装透明合成保密页眉：仅供软件验收' : '裸露铜排需加装透明绝缘防护板', quote)] })) };
  };
  const clean = await analyzeSpecSource(furnSource, { request: furnRequest(false) });
  assert.deepEqual(seenFurniture, ['合成保密页眉：仅供软件验收不得外传的资料'], '页眉页脚清单须交给模型');
  const crossed = clean.products[0].params_detail.find(d => d.name === '裸露铜排防护');
  assert.equal(crossed.evidence.pageFurnitureOmittedInValue, true);
  assert.equal(await validateSpecAnalysis(furnSource, clean), clean);
  const partial = await analyzeSpecSource(furnSource, { request: furnRequest(true), allowPartial: true });
  assert.deepEqual(partial.products[0].params_detail.map(d => d.name), ['安装方式']);
  assert.match(partial.rejectedParameters[0].reason, /混入了页眉页脚文字/);
  await assert.rejects(() => analyzeSpecSource(furnSource, { request: furnRequest(true) }), /混入了页眉页脚文字/);
  // 模型在 original_text 中也省略了页眉：按跳过页眉的文字定位，证据仍存为含页眉的真实连续原文。
  const omitted = await analyzeSpecSource(furnSource, { request: furnRequest(false, '裸露铜排需加装透明\n绝缘防护板。') });
  const located = omitted.products[0].params_detail.find(d => d.name === '裸露铜排防护');
  assert.equal(located.original_text, crossQuote, '证据须为原文中含页眉的连续片段');
  assert.equal(furnSource.text.slice(located.evidence.start, located.evidence.end), crossQuote);
  assert.equal(await validateSpecAnalysis(furnSource, omitted), omitted);
  // 非页眉的正文被跳过时仍拒收：只允许省略程序识别的页眉页脚。
  await assert.rejects(() => analyzeSpecSource(furnSource, { request: furnRequest(false, '电池开关箱安装方式为落地式安装。外壳防护等级IP20。') }), /证据不在当前原文/);
}
console.log('AI规范提取：设备隔离、比较条件、原文/缓存证据、全段覆盖、截断细分、取消、接口协议、空结果、跨片段设备别名、页眉页脚与HTML转义回归通过（合成软件用例）');
