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
  out=>{out.complete=false;},
  out=>{out.issues=[{kind:'OMISSION',severity:'WARNING',parameter_id:null,message:'捏造疑点',original_text:'文档没有这段证据'}];},
  out=>{out.issues=[{kind:'OCR_UNCERTAINTY',severity:'WARNING',parameter_id:null,message:'原生文字不能冒称OCR歧义',original_text:'额定功率100kVA'}];}
]) await assert.rejects(()=>analyzeSpecSource(source,{request:async input=>{const out=response(input);if(input.phase==='review')alter(out);return out;}}));

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
