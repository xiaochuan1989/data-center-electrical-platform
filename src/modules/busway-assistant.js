import { createPresalesSnapshot, normalizePresalesConfig, verifyPresalesEvidence, PRODUCT_PROFILES } from './nonstandard-presales.js';
import { normalizeBuswayRegionRow, BUSWAY_REGION_FIELDS, buswayClauseFacts } from './busway-rules.js';
const fail=(v,m)=>{if(!v) throw new Error(m);};
const text=v=>String(v??'').trim();
export function createBuswayRegionProposal(input,equipmentId,options) {
  createPresalesSnapshot(input);
  const equipment=input.equipment.find(e=>e.id===equipmentId);
  fail(equipment?.category==='busway','区域助手仅用于已登记智能母线设备');
  fail(options?.quantityBasis==='region' && equipment.quantity===1,'请明确选择本区域整套口径，并将本设备数量登记为1个区域包；不默认或重复乘算');
  fail(typeof options.basisNote==='string' && text(options.basisNote) && options.basisNote.length<=4000,'请填写区域数量归属依据（不超过4000字符）');
  const ids=options.requirementIds;
  fail(Array.isArray(ids) && ids.length>0 && ids.length<=200 && new Set(ids).size===ids.length,'请明确选择1～200条本设备要求');
  const requirements=input.requirements.filter(r=>r.equipmentId===equipmentId);
  const selected=ids.map(id=>{const r=requirements.find(r=>r.id===id);
    fail(r && r.reviewStatus!=='stale' && r.candidates.length && r.candidates.every(c=>verifyPresalesEvidence(input,c.evidence,c.value)),'选取条款跨设备、失效或证据不匹配');
    fail(!['deviation','not-applicable'].includes(r.response),'偏离/不适用条款不能自动作为区域草稿依据');return r;});
  const quotes=selected.flatMap(r=>r.candidates.map(c=>c.evidence.quote));
  fail(quotes.reduce((n,q)=>n+q.length,0)<=200000,'选取条款过多，请分批核对');
  fail(Array.isArray(options.rows) && options.rows.length>0 && options.rows.length<=200,'区域供货表须有1～200行');
  const rows=options.rows.map(normalizeBuswayRegionRow);
  const config=normalizePresalesConfig('busway',options.config||{}),facts=buswayClauseFacts(quotes);
  const confirmed=requirements.filter(r=>r.field!=='clause' && r.reviewStatus==='confirmed' && r.response==='met' && r.confirmedValue!=null
    && r.forbiddenDeviation!=null && r.candidates.length && r.candidates.every(c=>verifyPresalesEvidence(input,c.evidence,c.value)));
  for(const r of confirmed) {
    fail(config[r.field]==null || JSON.stringify(config[r.field])===JSON.stringify(r.confirmedValue),`${PRODUCT_PROFILES.busway.fields[r.field].label}采用输入与已确认要求不一致`);
    config[r.field]=r.confirmedValue;
  }
  for(const [role,key] of Object.entries(BUSWAY_REGION_FIELDS)) {
    const group=rows.filter(r=>r.role===role); if(!group.length) continue;
    if(group.some(r=>r.quantity==null)) {
      fail(config[key]==null,`${PRODUCT_PROFILES.busway.fields[key].label}明细含未知，不能采用局部总量`); config[key]=null; continue;
    }
    const sum=group.reduce((n,r)=>n+r.quantity,0);
    fail(Number.isFinite(sum) && sum<=Number.MAX_SAFE_INTEGER && (role==='busway' || Number.isSafeInteger(sum)),'区域用途合计超出安全数量范围');
    fail(config[key]==null || Math.abs(config[key]-sum)<=1e-9,`${PRODUCT_PROFILES.busway.fields[key].label}与区域供货表合计不一致`);
    config[key]=sum;
  }
  for(const [key,value] of Object.entries(facts.config)) {
    // 明确采用输入不被未经确认功能全文覆盖；原文仍在全部要求中。
    if(config[key]==null) config[key]=value;
  }
  const risks=[...(facts.tentative?['选定原文含暂定/设计联络限定，数量映射及参数待确认']:[]),...facts.issues];
  const components=rows.map(row=>({...row,brand:'',model:'',code:'',modelStatus:'pending',requirementIds:[...ids],risk:risks.join('；'),
    reference:`人工区域表归属：${text(options.basisNote)}；选定原文是候选依据，非逐行自动提取或已批准型号`}));
  if(facts.hasAccessories && !rows.some(r=>r.role==='accessory')) components.push({name:'母线安装/连接/末端附件（明细待确认）',
    role:'accessory',specification:[config.supports,config.endAccessories].filter(Boolean).join('\n'),quantity:null,unit:'套',brand:'',model:'',code:'',modelStatus:'pending',
    requirementIds:[...ids],reference:'选定原文要求的功能附件，非物理模块计数',risk:[...risks,'附件分段、规格及数量待确认'].join('；')});
  return {equipmentId,name:text(options.name)||`${equipment.label}区域母线询价讨论稿`,config,components,
    requirementIds:requirements.map(r=>r.id),origin:'busway-assistant',
    assistant:{version:1,kind:'busway-region',quantityBasis:'region',sourceRevision:input.revision,sourceRequirementIds:[...ids],basisNote:text(options.basisNote)},
    assumptions:['区域表为明确人工归属输入，不自动确认客户要求/满足应答；设备数量1表示整区域清单，不是默认器件数。',...risks],
    exclusions:['不由区域箱数推回路、PDU分配或保护器件；路由分段、附件、品牌/型号及完整生产BOM需另行核对。']};
}
