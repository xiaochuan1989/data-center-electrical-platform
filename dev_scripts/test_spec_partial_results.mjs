import assert from 'node:assert/strict';
import {analyzeSpecSource, validateSpecAnalysis, validateSpecDraft} from '../src/modules/spec-extraction.js';
import {specResultMarkup, specExportSheets, mountSpecExtraction} from '../src/platform/spec-extraction-view.js';

// Deliberately invalid synthetic responses reproduce the reported failure; no customer data or live API.
const text='合成软件测试，不是工程参数。UPS-A额定功率100kVA，额定电流不低于630A。UPS-B额定功率200kVA。';
const source={id:'partial-test',name:'合成部分结果.pdf',type:'pdf',text,segments:[{start:0,end:text.length,page:1}],warnings:[]};
const parameter=(name,value,original_text)=>({name,value,original_text,evidence_status:'VERIFIED',source_status:'DOCUMENT',risk:'LOW'});
function response(input, mode='valid') {
  const data=JSON.parse(input.user);
  if(data.task==='discovery')return {complete:true,devices:['UPS-A','UPS-B'].map(device_name=>({device_type:'UPS主机',device_name,scope:'',original_text:device_name}))};
  if(data.task==='review') {
    if(mode==='review-failure')throw new Error('合成复核网络故障');
    return {complete:true,source_checked:true,checked_parameter_ids:data.review_parameters.map(p=>p.parameter_id),issues:[]};
  }
  const first=parameter('额定功率','100kVA','UPS-A额定功率100kVA');
  if(mode==='bad-condition')Object.assign(first,{condition:'正常运行时',condition_original_text:'UPS-A额定功率100kVA'});
  if(mode==='all-invalid')first.value='999kVA';
  return {complete:true,products:data.known_devices.map((p,i)=>({...p,params_detail:i===0
    ?[first,...(mode==='all-invalid'?[]:[parameter('额定电流','不低于630A','额定电流不低于630A')])]
    :[parameter('额定功率',mode==='all-invalid'?'999kVA':'200kVA','UPS-B额定功率200kVA')]}))};
}
const snapshots=[];
const partial=await analyzeSpecSource(source,{allowPartial:true,onDraft:d=>snapshots.push(d),request:async input=>response(input,'bad-condition')});
assert.equal(partial.complete,false);
assert.equal(partial.processingState,'needs_review');
assert.equal(partial.products.length,2);
assert.equal(partial.products.flatMap(p=>p.params_detail).length,2,'后续参数与后续设备继续校验');
assert.equal(partial.rejectedParameters.length,1);
assert.match(partial.rejectedParameters[0].reason,/适用条件没有原文依据/);
assert.equal(partial.rejectedParameters[0].candidate.condition,'正常运行时','失败条件必须保留，不能删掉后冒充已核验');
assert.equal(partial.products[0].params_detail.some(d=>d.name==='额定功率'),false);
assert(snapshots.some(s=>s.processingState==='running'&&s.products.some(p=>p.params_detail.length)),'复核前已有可查看的工作稿');
assert.equal(partial.semanticReview.checkedParameterIds.length,2,'失败项不混入复核完成的参数');
await validateSpecDraft(source,partial);
await assert.rejects(()=>validateSpecAnalysis(source,partial),/版本或状态/);
await assert.rejects(()=>validateSpecAnalysis(source,{...partial,complete:true}),/不能冒充/);
await assert.rejects(()=>validateSpecDraft({...source,text:text+'修订'},partial),/已改变/);
const forged=structuredClone(partial);
forged.products[0].params_detail.push({...partial.rejectedParameters[0].candidate,evidence_status:'VERIFIED',source_status:'DOCUMENT',risk:'LOW'});
await assert.rejects(()=>validateSpecDraft(source,forged),/缺少位置证据/);
const markup=specResultMarkup(partial);
assert.match(markup,/2项有原文依据的参数/);
assert.match(markup,/未完成工作稿/);
assert.match(markup,/模型候选条件（未核验）：正常运行时/);
assert(!markup.includes('全部文字分段已处理'));
const sheets=specExportSheets(partial);
assert.equal(sheets[2].name,'未通过校验项');
assert(!sheets[0].rows.flat().includes('正常运行时'));
assert(sheets[2].rows.flat().includes('正常运行时'));
assert(sheets[2].rows.flat().includes('参数适用条件没有原文依据'));

const allInvalid=await analyzeSpecSource(source,{allowPartial:true,request:async input=>response(input,'all-invalid')});
await validateSpecDraft(source,allInvalid);
assert.equal(allInvalid.products.flatMap(p=>p.params_detail).length,0);
assert.equal(allInvalid.rejectedParameters.length,2);
assert.match(specResultMarkup(allInvalid),/尚无通过校验的参数/);
assert.match(specResultMarkup(allInvalid),/0项有原文依据的参数/);

const interrupted=[];
await assert.rejects(()=>analyzeSpecSource(source,{allowPartial:true,onDraft:d=>interrupted.push(d),request:async input=>response(input,'review-failure')}),/合成复核网络故障/);
const stopped=interrupted.at(-1);
await validateSpecDraft(source,stopped);
assert.equal(stopped.processingState,'stopped');
assert.equal(stopped.products.flatMap(p=>p.params_detail).length,3);
assert.equal(stopped.semanticReview,undefined);
assert.match(specResultMarkup(stopped),/语义复核尚未完成/);
assert.match(specResultMarkup(stopped),/合成复核网络故障/);
const controller=new AbortController(),cancelled=[];
await assert.rejects(()=>analyzeSpecSource(source,{allowPartial:true,signal:controller.signal,onDraft:d=>{cancelled.push(d);if(d.coverage.extraction.length)controller.abort();},request:async input=>response(input)}),/取消/);
await validateSpecDraft(source,cancelled.at(-1));
assert.equal(cancelled.at(-1).products.flatMap(p=>p.params_detail).length,3);
assert.equal(cancelled.at(-1).complete,false);

// Repeated wording must retain its actual later-page coordinates in both live drafts and final results.
const quote='UPS-A额定功率100kVA。',pageText='合成重复页测试。\n'+quote+'\n'+'合成说明'.repeat(140)+'\n';
const repeated={...source,id:'repeated-pages',text:pageText+pageText,segments:[{start:0,end:pageText.length,page:1},{start:pageText.length,end:pageText.length*2,page:2}]};
const repeatedResult=await analyzeSpecSource(repeated,{allowPartial:true,chunkSize:500,onDraft:d=>validateSpecDraft(repeated,d),request:async input=>{
  const data=JSON.parse(input.user);
  if(data.task==='review')return {complete:true,source_checked:true,checked_parameter_ids:data.review_parameters.map(p=>p.parameter_id),issues:[]};
  if(data.task==='discovery')return {complete:true,devices:data.document_text.includes('UPS-A')?[{device_type:'UPS主机',device_name:'UPS-A',scope:'',original_text:'UPS-A'}]:[]};
  return {complete:true,products:data.document_text.includes(quote)?[{...data.known_devices[0],params_detail:[parameter('额定功率','100kVA',quote)]}]:[]};
}});
await validateSpecAnalysis(repeated,repeatedResult);
assert.equal(repeatedResult.products[0].params_detail.length,2);
assert.match(repeatedResult.products[0].params_detail[1].evidence.location,/第2页/);

// Exercise the real view controller, storage and export handlers with a minimal DOM event surface.
class Element {
  constructor(){this.listeners={};this.value='';this.textContent='';this.innerHTML='';this.hidden=false;}
  addEventListener(name,handler){this.listeners[name]=handler;}
  async click(){await this.listeners.click?.();}
}
const elements=new Map();
const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const previousGlobals=Object.fromEntries(['document','localStorage','fetch','getBaseUrl','addEventListener'].map(k=>[k,globalThis[k]]));
let mode='valid',selected=source,autosave=true;
const stored=new Map(),downloads=[];
try {
  globalThis.document={getElementById:get,addEventListener(){}};
  globalThis.localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)};
  globalThis.getBaseUrl=()=> 'https://synthetic.invalid/v1';
  globalThis.addEventListener=()=>{};
  get('model').value='synthetic';get('apikey').value='synthetic-local-only';
  globalThis.fetch=async (_url,options)=>{
    const body=JSON.parse(options.body),input={user:body.messages[1].content};
    const out=response(input,mode);
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(out)}}]})};
  };
  const root={querySelector:selector=>get(selector.slice(1)),ownerDocument:document};
  const api={source:()=>selected,autosave:()=>autosave,download:(...args)=>downloads.push(args)};
  const view=mountSpecExtraction(root,api);await view.render();
  await get('ns-ai-analyze').click();
  const completeCache=stored.get('spec_ai_extractions_v1');
  assert(completeCache.includes('100kVA'));
  mode='bad-condition';await get('ns-ai-analyze').click();
  assert.equal(stored.get('spec_ai_extractions_v1'),completeCache,'问题批次不覆盖上次完整工作稿');
  assert.match(get('ns-ai-results').innerHTML,/2项有原文依据的参数/);
  assert.match(get('ns-ai-results').innerHTML,/查看上次完整工作稿/);
  assert.equal(get('ns-ai-exports').hidden,false);
  await get('ns-ai-json').click();
  const exported=JSON.parse(downloads.at(-1)[0]);
  assert.equal(exported.analysis.complete,false);
  assert.equal(exported.analysis.rejectedParameters.length,1);
  // Restore the unfinished draft as unfinished, retaining the last complete result separately.
  const restored=mountSpecExtraction(root,api);await restored.render();
  assert.match(get('ns-ai-results').innerHTML,/未完成工作稿/);
  assert.match(get('ns-ai-progress').textContent,/未完成工作稿/);
  mode='review-failure';await get('ns-ai-analyze').click();
  assert.match(get('ns-ai-results').innerHTML,/3项有原文依据的参数/);
  assert.match(get('ns-ai-results').innerHTML,/合成复核网络故障/);
  assert.equal(stored.get('spec_ai_extractions_v1'),completeCache);
  // Replacing the source invalidates BOTH old complete and unfinished evidence.
  selected={...source,text:text+'更换原文'};await restored.render();
  assert.equal(get('ns-ai-results').innerHTML,'');
  assert.equal(get('ns-ai-exports').hidden,true);
  selected=source;mode='valid';await restored.render();await get('ns-ai-analyze').click();
  assert.equal(stored.get('spec_ai_partial_extractions_v1'),'[]','完整重试后移除旧失败工作稿');
  assert(!get('ns-ai-results').innerHTML.includes('未完成工作稿'));
  const beforeNoSave=JSON.stringify([...stored]);autosave=false;mode='bad-condition';await get('ns-ai-analyze').click();
  assert.equal(JSON.stringify([...stored]),beforeNoSave,'未勾选本机保存时不写入原文或工作稿');
  assert.match(get('ns-ai-results').innerHTML,/未完成工作稿/);
} finally {
  for(const [key,value] of Object.entries(previousGlobals))if(value===undefined)delete globalThis[key];else globalThis[key]=value;
}
console.log('部分提取结果：无依据条件隔离、后续参数保留、全部失败可见、复核失败/取消保留、旧稿不覆盖、缓存复验与导出通过（合成软件用例）。');
