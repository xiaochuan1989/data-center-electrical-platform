import assert from 'node:assert/strict';
import {analyzeSpecSource,validateSpecAnalysis} from '../src/modules/spec-extraction.js';
import {requestSpecJson,specThinkingPolicy} from '../src/modules/spec-ai-client.js';
import {specResultMarkup,specExportSheets,specProgressMessage} from '../src/platform/spec-extraction-view.js';

// Synthetic scope/omission errors are deliberately injected. This is not a model accuracy test.
const text='合成技术规范，仅供软件验收。\nUPS-A技术要求：额定功率100kVA。\nUPS-B技术要求：额定功率200kVA。\nUPS-A还须提供型式试验报告。';
const source={id:'review-source',type:'pdf',name:'合成复核.pdf',text,segments:[{start:0,end:text.length,page:1}],warnings:[]};
const detail=(name,value,quote)=>({name,value,original_text:quote,risk:'LOW',evidence_status:'VERIFIED',source_status:'DOCUMENT'});
function response(input) {
  const data=JSON.parse(input.user);
  if(data.task==='discovery') return {complete:true,devices:['UPS-A','UPS-B'].map(device_name=>({device_type:'UPS主机',device_name,scope:'',original_text:device_name}))};
  if(data.task==='review') return {complete:true,source_checked:true,checked_parameter_ids:data.review_parameters.map(p=>p.parameter_id),issues:[]};
  return {complete:true,products:data.known_devices.map(p=>({...p,params_detail:[detail('额定功率',p.device_name==='UPS-A'?'100kVA':'200kVA',p.device_name==='UPS-A'?'额定功率100kVA':'额定功率200kVA')]}))};
}
const calls=[];
const result=await analyzeSpecSource(source,{request:async input=>{
  const data=JSON.parse(input.user);calls.push(input.phase);
  const out=response(input);
  if(data.task==='extraction') out.products[0].params_detail=[detail('额定功率','200kVA','UPS-B技术要求：额定功率200kVA。')];
  if(data.task==='review')out.issues=[
    {kind:'OWNERSHIP',severity:'ERROR',parameter_id:data.review_parameters[0].parameter_id,message:'UPS-A的功率证据属于UPS-B，须核对设备归属。',original_text:'UPS-B技术要求：额定功率200kVA。'},
    {kind:'OMISSION',severity:'WARNING',parameter_id:null,message:'可能漏提型式试验报告要求。',original_text:'UPS-A还须提供型式试验报告。'}];
  return out;
}});
assert.deepEqual(calls,['discovery','extraction','review']);
assert.equal(result.semanticReview.status,'ISSUES_FOUND');
assert.equal(result.semanticReview.findings.length,2);
assert.equal(result.products[0].params_detail[0].value,'200kVA','复核意见不得静默修改参数');
await validateSpecAnalysis(source,result);
assert.match(specResultMarkup(result),/设备归属/);assert.match(specResultMarkup(result),/可能漏项/);
assert.match(specResultMarkup(result),/同一模型另发请求/);
const sheets=specExportSheets(result);assert.equal(sheets[1].rows.length,5);
assert(sheets[1].rows.flat().includes('UPS-A的功率证据属于UPS-B，须核对设备归属。'));
for (const mutate of [
  r=>{r.products[0].params_detail[0].name='其他功率';},
  r=>{r.semanticReview.checkedParameterIds.pop();},
  r=>{r.semanticReview.checkedParameterIds.push(r.semanticReview.checkedParameterIds[0]);},
  r=>{r.semanticReview.coverage[0].start=1;},
  r=>{r.semanticReview.sourceFingerprint='stale';},
  r=>{r.semanticReview.findings[0].evidence.start++;},
  r=>{r.semanticReview.findings[0].reviewStatus='confirmed';},
  r=>{r.semanticReview.status='MODEL_REVIEWED';}
]) {const bad=structuredClone(result);mutate(bad);await assert.rejects(()=>validateSpecAnalysis(source,bad));}
const legacy=structuredClone(result);legacy.contractVersion=3;delete legacy.semanticReview;
await validateSpecAnalysis(source,legacy);assert.match(specResultMarkup(legacy),/尚未执行语义复核/);

for (const alter of [
  out=>{out.checked_parameter_ids=[];},
  out=>{out.source_checked=false;},
  out=>{out.complete=false;}
]) await assert.rejects(()=>analyzeSpecSource(source,{request:async input=>{const out=response(input);if(input.phase==='review')alter(out);return out;}}));
// 单条疑点不合规（证据捏造、原生文字冒称OCR、类型非法）只隔离该条：不计入已校验疑点，整次复核照常完成并保留模型原话。
{
  const isolated=await analyzeSpecSource(source,{request:async input=>{const out=response(input);if(input.phase==='review')out.issues=[
    {kind:'OMISSION',severity:'WARNING',parameter_id:null,message:'捏造疑点',original_text:'文档没有这段证据'},
    {kind:'OCR_UNCERTAINTY',severity:'WARNING',parameter_id:null,message:'原生文字不能冒称OCR歧义',original_text:'额定功率100kVA'},
    {kind:'STYLE',severity:'WARNING',parameter_id:null,message:'非法类型',original_text:'额定功率100kVA'},
    {kind:'OMISSION',severity:'WARNING',parameter_id:null,message:'可能漏提型式试验报告要求。',original_text:'UPS-A还须提供型式试验报告。'}];return out;}});
  const review=isolated.semanticReview;
  assert.equal(review.findings.length,1,'只有合规疑点计入');
  assert.equal(review.findings[0].message,'可能漏提型式试验报告要求。');
  assert.deepEqual(review.rejectedFindings.map(r=>r.message),['捏造疑点','原生文字不能冒称OCR歧义','非法类型']);
  assert.match(review.rejectedFindings[0].reason,/不在当前原文/);
  assert.match(review.rejectedFindings[1].reason,/OCR疑点须指向OCR来源/);
  await validateSpecAnalysis(source,isolated);
  const html=specResultMarkup(isolated);
  assert.match(html,/另有3条复核意见未通过结构校验/);assert.match(html,/原生文字不能冒称OCR歧义/);
  assert(specExportSheets(isolated)[1].rows.some(r=>String(r[6]).startsWith('未采纳（')),'Excel保留未采纳意见及原因');
  const forged=structuredClone(isolated);forged.semanticReview.rejectedFindings[0].reason=1;
  await assert.rejects(()=>validateSpecAnalysis(source,forged),/未采纳复核意见结构无效/);
}
// 网页模式：复核批次漏写参数编号时单独补复核一次；补后覆盖则正常完成，仍漏写则记为未复核、结果保留并标为待处理。
{
  let calls = 0;
  const once = await analyzeSpecSource(source, { allowPartial: true, request: async input => { const out = response(input);
    if (input.phase === 'review' && ++calls === 1) out.checked_parameter_ids = out.checked_parameter_ids.slice(1).concat(['不存在的编号']); return out; } });
  assert.equal(once.complete, true, '补复核一次后全部覆盖');
  assert.equal('uncheckedParameterIds' in once.semanticReview, false);
  assert.equal(calls, 2);
  await validateSpecAnalysis(source, once);
  const never = await analyzeSpecSource(source, { allowPartial: true, request: async input => { const out = response(input);
    if (input.phase === 'review') out.checked_parameter_ids = out.checked_parameter_ids.filter(id => !id.endsWith('/p1') || !id.startsWith('device-1')); return out; } });
  assert.equal(never.complete, false);
  assert.equal(never.processingState, 'needs_review');
  assert.deepEqual(never.semanticReview.uncheckedParameterIds, ['device-1/p1']);
  assert.match(never.pipelineError, /1项参数语义复核时被模型漏查/);
  assert.match(specResultMarkup(never), /另有1项参数复核时被模型漏查/);
  const { validateSpecDraft } = await import('../src/modules/spec-extraction.js');
  await validateSpecDraft(source, never);
  const overlap = structuredClone(never); overlap.semanticReview.uncheckedParameterIds.push(overlap.semanticReview.checkedParameterIds[0]);
  await assert.rejects(() => validateSpecDraft(source, overlap), /已复核与未复核清单/);
}
// 复核按16项分批；疑点可指向其他批次中真实存在的参数（模型能看到完整catalogue），不存在的参数编号仍不计入。
{
  const lines=Array.from({length:20},(_,i)=>`第${i+1}项额定电流${(i+1)*10}A。`);
  const many='合成分批复核资料。\nUPS-A技术要求：\n'+lines.join('\n');
  const manySource={id:'review-many',type:'pdf',name:'合成分批复核.pdf',text:many,segments:[{start:0,end:many.length,page:1}],warnings:[]};
  let batch=0;
  const cross=await analyzeSpecSource(manySource,{request:async input=>{const data=JSON.parse(input.user);
    if(data.task==='discovery')return {complete:true,devices:[{device_type:'UPS主机',device_name:'UPS-A',scope:'',original_text:'UPS-A'}]};
    if(data.task==='review'){batch++;const issues=batch===2?[
      {kind:'CONFLICT',severity:'WARNING',parameter_id:data.catalogue[0].parameter_id,message:'与第1项对照核对。',original_text:lines[0]},
      {kind:'CONFLICT',severity:'WARNING',parameter_id:'device-9/p1',message:'不存在的参数',original_text:lines[0]}]:[];
      return {complete:true,source_checked:true,checked_parameter_ids:data.review_parameters.map(p=>p.parameter_id),issues};}
    return {complete:true,products:data.known_devices.map(d=>({...d,params_detail:lines.map((l,i)=>detail(`第${i+1}项额定电流`,`${(i+1)*10}A`,l))}))};
  }});
  assert.equal(batch,2,'20项参数分两批复核');
  assert.deepEqual(cross.semanticReview.findings.map(f=>f.message),['与第1项对照核对。']);
  assert.match(cross.semanticReview.rejectedFindings[0].reason,/不存在的参数/);
  await validateSpecAnalysis(manySource,cross);
}

// Review can retry with a larger reasoning budget, then split a dense parameter batch.
const batchSizes=[];let grew=false;
const dense=await analyzeSpecSource(source,{request:async input=>{
  const data=JSON.parse(input.user),out=response(input);
  if(input.phase==='extraction')out.products=out.products.slice(0,1).map(p=>({...p,params_detail:Array.from({length:23},(_,i)=>detail('合成参数'+i,'100kVA','额定功率100kVA'))}));
  if(input.phase==='discovery')out.devices=out.devices.slice(0,1);
  if(input.phase==='review') {
    batchSizes.push(data.review_parameters.length);assert.equal(data.catalogue.length,23);
    if(!grew){grew=true;const error=new Error('length');error.code='TRUNCATED';error.canIncreaseBudget=true;throw error;}
    if(data.review_parameters.length>4){const error=new Error('length');error.code='TRUNCATED';throw error;}
  }
  return out;
}});
assert.equal(dense.semanticReview.checkedParameterIds.length,23);assert(batchSizes.some(n=>n>4));
await validateSpecAnalysis(source,dense);
const cancel=new AbortController();
await assert.rejects(()=>analyzeSpecSource(source,{signal:cancel.signal,request:async input=>{if(input.phase==='review')cancel.abort();return response(input);}}),e=>e.name==='AbortError');

const cfg={baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:'synthetic',anthropic:false};
assert.equal(specThinkingPolicy(cfg,'extraction').outputLimit,32768);
assert.equal(specThinkingPolicy(cfg,'extraction',1).outputLimit,65536);
assert.equal(specThinkingPolicy(cfg,'review').outputLimit,65536);
assert.equal(specThinkingPolicy(cfg,'review',1).outputLimit,131072);
for(const [phase,step,limit,effort] of [['discovery',0,32768,'low'],['review',0,65536,'high'],['review',1,131072,'high']]){
  await requestSpecJson(cfg,{system:'仅JSON',user:'合成',phase,budgetStep:step},async(url,init)=>{
    const body=JSON.parse(init.body);assert.equal(body.thinking.type,'enabled');assert.equal(body.reasoning_effort,effort);assert.equal(body.max_tokens,limit);
    assert(!('temperature' in body));
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{}',reasoning_content:'不得缓存或展示的推理文本'}}]})};
  });
}
await assert.rejects(()=>requestSpecJson(cfg,{phase:'review'},async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length'}],usage:{completion_tokens:65536}})})),e=>e.code==='TRUNCATED'&&e.canIncreaseBudget&&e.completionTokens===65536);
await assert.rejects(()=>requestSpecJson(cfg,{phase:'review',budgetStep:1},async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length'}]})})),e=>e.code==='TRUNCATED'&&!e.canIncreaseBudget);
assert.match(specProgressMessage({phase:'review',retry:'budget'}),/保留思考/);
assert.match(specProgressMessage({phase:'review',retry:'review_batch',batchRows:16}),/16项/);
console.log('思考与语义复核：分阶段预算、截断扩容/分批、设备归属与漏项疑点、原文/参数覆盖、篡改失效、旧稿兼容、取消和同源导出通过（合成软件验证）。');
