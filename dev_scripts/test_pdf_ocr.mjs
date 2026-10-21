import assert from 'node:assert/strict';
import { readPresalesFile, joinPdfTextItems } from '../src/platform/nonstandard-file-reader.js';
import { localOcrUrls, hasLargePdfImage, createLocalOcrSession } from '../src/platform/local-pdf-ocr.js';
import { createPresalesPackage, addPresalesSource, restorePresalesSnapshot, createPresalesSnapshot } from '../src/modules/nonstandard-presales.js';
import { analyzeSpecSource, validateSpecAnalysis } from '../src/modules/spec-extraction.js';
import { specResultMarkup } from '../src/platform/spec-extraction-view.js';

// 同一行首尾相接的文字片段直接拼接，表格单元格（间距大）与换行保留；无位置信息时沿用补空格。
const at=(str,x,w,y=100,eol=false)=>({str,transform:[12,0,0,12,x,y],width:w,height:12,hasEOL:eol});
assert.equal(joinPdfTextItems([at('再批量',80,36),at('生',116,12),at('产为',128,24),at('宜',152,12,100,true)]),'再批量生产为宜\n');
assert.equal(joinPdfTextItems([at('温度',159,20),at('工作范围',330,48,100,true)]),'温度 工作范围\n','单元格不得粘连');
assert.equal(joinPdfTextItems([at('上一行末',80,48),at('下一行首',80,48,86,true)]),'上一行末 下一行首\n','不同行不拼接');
assert.equal(joinPdfTextItems([{str:'甲'},{str:'乙',hasEOL:true}]),'甲 乙\n');
const urls=localOcrUrls('https://test.invalid/platform/index.html');
assert.equal(urls.workerPath,'https://test.invalid/platform/vendor/ocr/worker.min.js');
assert.equal(urls.langPath,'https://test.invalid/platform/vendor/ocr/lang/');
let terminated=0,cleaned=0,destroyed=0,recognized=0;
const native='UPS-A额定功率100kVA，输入电压380VAC。此行是合成软件用例，提供完整文字层以验证无需OCR的页。';
const ocrText='UPS-B额定功率200kVA，输入电压400VAC。OCR合成软件用例，仅验证来源和处理流程。';
const OPS={save:1,restore:2,transform:3,paintImageXObject:4};
const page=(text,image=false)=>({getTextContent:async()=>({items:[{str:text}]}),getViewport:()=>({width:600,height:800}),
  getOperatorList:async()=>({fnArray:image?[3,4]:[],argsArray:image?[[600,0,0,800,0,0],['image']]:[]}),cleanup(){cleaned++;}});
assert.equal(await hasLargePdfImage(page(native,true),{OPS}),true,'文字页眉不能掩盖大幅扫描图片');
const file={name:'合成混合.pdf',size:10,arrayBuffer:async()=>new ArrayBuffer(10)};
const canvas={};
let pages=[page(native),page('',true),page('')];
const libs={document:{baseURI:'https://test.invalid/platform/'},pdfjsLib:{OPS,getDocument:()=>({promise:Promise.resolve({numPages:pages.length,getPage:async n=>pages[n-1]}),destroy:async()=>{destroyed++;}})},
  renderPdfForOcr:async p=>({canvas,blank:p===pages[2],dpi:300}),
  createLocalOcrSession:()=>({recognize:async()=>{recognized++;return {text:ocrText,confidence:86};},close:async()=>{terminated++;}})};
const parsed=await readPresalesFile(file,libs);
assert.equal(recognized,1);assert.equal(terminated,1);assert.equal(cleaned,3);assert.equal(destroyed,1);
assert.deepEqual(parsed.pageRecords.map(p=>p.method),['native','ocr','blank']);
assert.equal(parsed.segments[1].page,2);assert.equal(parsed.segments[1].method,'ocr');
assert.match(parsed.warnings[0],/86%/);assert.equal(parsed.text.includes(ocrText),true);
const pack=addPresalesSource(createPresalesPackage(),parsed,'合成测试');
const restored=restorePresalesSnapshot(createPresalesSnapshot(pack));
assert.deepEqual(restored.sources[0].pageRecords,parsed.pageRecords);
assert.equal(restored.sources[0].segments[1].ocrEngine,'tesseract.js-7.0.0');
const source=restored.sources[0];
const extracted=await analyzeSpecSource(source,{request:async input=>{
  const request=JSON.parse(input.user);
  if(request.task==='review')return {complete:true,source_checked:true,checked_parameter_ids:request.review_parameters.map(p=>p.parameter_id),issues:[]};
  if(request.task==='discovery') return {complete:true,devices:[{device_type:'UPS主机',device_name:'UPS-B',scope:'',original_text:'UPS-B'}]};
  return {complete:true,products:[{...request.known_devices[0],params_detail:[{name:'额定功率',value:'200kVA',original_text:'UPS-B额定功率200kVA',risk:'LOW',evidence_status:'VERIFIED',source_status:'DOCUMENT'}]}]};
}});
await validateSpecAnalysis(source,extracted);
assert.deepEqual(extracted.products[0].params_detail[0].evidence.ocrPages,[2]);
assert.match(specResultMarkup(extracted),/OCR文字/);
const hiddenOcr=structuredClone(extracted);delete hiddenOcr.products[0].params_detail[0].evidence.ocrPages;
await assert.rejects(()=>validateSpecAnalysis(source,hiddenOcr),/OCR来源/);
const changed=structuredClone(source);changed.pageRecords[2].method='native';
await assert.rejects(()=>validateSpecAnalysis(changed,extracted),/已改变/);
await assert.rejects(()=>readPresalesFile(file,{...libs,createLocalOcrSession:()=>({recognize:async()=>({text:'',confidence:0}),close:async()=>{terminated++;}})}),/OCR未识别/);
// 每页重复的长文字页眉 + 大幅扫描图：去掉页眉后正文不足，仍须OCR，页眉不能掩盖扫描正文。
const header='合成文字页眉：机密资料，未经书面许可不得以任何形式披露、传播或扩散，第1页\n';
pages=[1,2,3].map(n=>page(header.replace('第1页',`第${n}页`),true));recognized=0;
const scanned=await readPresalesFile(file,libs);
assert.deepEqual(scanned.pageRecords.map(p=>p.method),['ocr','ocr','ocr']);assert.equal(recognized,3);
// 同样页眉 + 整页底纹/水印大图，但各页文字层有不同的完整正文：保留文字层不做OCR，并提示可强制OCR。
// （各页正文只差编号时与重复页眉无法区分，按页眉处理走OCR，这是有意的。）
const bodies=['环境要求：户内安装，环境温度零下十度至四十度，海拔不超过一千米，相对湿度百分之十至九十，地震烈度按八度设防。',
  '电气要求：电池组电压直流四百八十伏，最大支持六百伏，放电电流不超过一千六百安，充放电电流控制精度优于百分之一。',
  '结构要求：冷板喷塑箱体，双开门并自带锁具，上下出线设计，内部铜排正负极套绝缘套管，裸露铜排加装透明绝缘防护板。'];
assert(bodies.every(b=>b.length>=40),'合成正文须达到文字层判定下限');
pages=bodies.map((body,i)=>page(header.replace('第1页',`第${i+1}页`)+body,true));recognized=0;
const watermarked=await readPresalesFile(file,libs);
assert.deepEqual(watermarked.pageRecords.map(p=>p.method),['native','native','native']);assert.equal(recognized,0);
assert.equal(watermarked.text.includes(bodies[1]),true);
{const w=watermarked.warnings.filter(x=>/含大幅图片，已使用文字层/.test(x));assert.equal(w.length,1,"多页同类提示合并为一条");assert.match(w[0],/^PDF第1、2、3页含大幅图片/);}
pages=[page('只有页眉',true)];
const forced=await readPresalesFile(file,libs,{forceOcr:true});assert.equal(forced.segments[0].method,'ocr');
const controller=new AbortController();controller.abort();
await assert.rejects(()=>readPresalesFile(file,libs,{signal:controller.signal}),e=>e.name==='AbortError');
let engineOptions,workerTerminated=false;
const session=createLocalOcrSession({document:libs.document,Tesseract:{createWorker:async(langs,oem,options)=>{
  assert.equal(langs,'chi_sim+eng');engineOptions=options;
  return {setParameters:async()=>{},recognize:async()=>({data:{text:ocrText,confidence:90}}),terminate:async()=>{workerTerminated=true;}};
}}});
await session.recognize({},1);await session.close();
assert.equal(workerTerminated,true);assert.equal(engineOptions.cacheMethod,'none');assert.equal(engineOptions.workerBlobURL,false);
assert.equal(engineOptions.workerPath,urls.workerPath);
const cancel=new AbortController();let release,lateTerminated=false;
const slow=createLocalOcrSession({document:libs.document,Tesseract:{createWorker:()=>new Promise(resolve=>{release=resolve;})}},{signal:cancel.signal});
const pending=slow.recognize({},1);await new Promise(resolve=>setTimeout(resolve,0));cancel.abort();
await assert.rejects(()=>pending,e=>e.name==='AbortError');
release({terminate:async()=>{lateTerminated=true;}});await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(lateTerminated,true,'取消初始化后迟到的worker必须释放');await slow.close();
console.log('PDF OCR：同源中英模型、混合页/空白页覆盖、页眉图片检测、失败阻断、取消释放、来源恢复与AI证据标注通过（合成软件测试）。');
