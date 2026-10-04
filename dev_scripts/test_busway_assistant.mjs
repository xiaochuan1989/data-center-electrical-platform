import assert from 'node:assert/strict';
import {createPresalesPackage,addEquipment,addPresalesSource,addRequirement,adoptPresalesScheme,createPresalesSnapshot,
  restorePresalesSnapshot,buildPresalesDeliverable,confirmPresalesScheme,replacePresalesSource,confirmPresalesRequirement,
  updateEquipmentQuantity,schemeReviewProblems} from '../src/modules/nonstandard-presales.js';
import {createBuswayRegionProposal} from '../src/modules/busway-assistant.js';
import {parseBuswayRegionTable,buswayClauseFacts} from '../src/modules/busway-rules.js';
import {buildPresalesOutput,presalesReportHtml} from '../src/modules/nonstandard-deliverable.js';

// 合成软件数据，与客户实际区域数量不同；不是厂家或工程已确认方案。
const table='用途\t名称\t功能规格\t区域数量\t单位\n主控箱\tTEST主控\t集中显示\t3\t套\n母线槽\tTEST轨道\t轨道式\t125.5\t米\n端口箱\tTEST端口\t输入计量\t12\t台\n插线箱\tTEST插线\t馈出监控\t64\t台';
const rows=parseBuswayRegionTable(table);
assert.deepEqual(rows.map(r=>r.role),['controller','busway','endpoint','plugbox']);
assert.equal(rows[1].unit,'m'); assert.equal(rows[1].quantity,125.5);
for(const q of ['0','-1','2/3','≥2','2~3','1+1','1e2','Infinity','9007199254740992','2.5'])
  assert.throws(()=>parseBuswayRegionTable(`端口箱|TEST|规格|${q}|台`),/数量/);
for(const q of ['','XX','未知','待确认']) assert.equal(parseBuswayRegionTable(`端口箱|TEST|规格|${q}|台`)[0].quantity,null);
assert.throws(()=>parseBuswayRegionTable('端口箱|TEST|规格|2|m'),/单位/);
assert.throws(()=>parseBuswayRegionTable('母线槽|TEST|规格|2|段'),/单位/);
assert.throws(()=>parseBuswayRegionTable('TEST|TEST|规格|2|台'),/用途/);
assert.throws(()=>parseBuswayRegionTable('端口箱|TEST|规格|2'),/五列/);
assert.throws(()=>parseBuswayRegionTable('端口箱\tTEST|规格\t2\t台'),/混用/);
assert.throws(()=>parseBuswayRegionTable(''),/粘贴/);
assert.throws(()=>parseBuswayRegionTable('x'.repeat(100001)),/100000/);
assert.throws(()=>parseBuswayRegionTable(Array(201).fill('端口箱|TEST|规格|2|台').join('\n')),/200/);
const series=buswayClauseFacts(['额定电压380V/415V，频率50/60Hz，插接箱IP40及以上，连接器16A/32A/63A。']);
assert.deepEqual(series.config,{},'多值/子组件规格不推广为全系统标量');
let pack=addEquipment(createPresalesPackage('合成区域母线QA'),{category:'busway',label:'TEST区域A',quantity:1,unit:'区域包'},'合成明确整区域');
pack=addEquipment(pack,{category:'busway',label:'TEST区域B',quantity:1,unit:'区域包'},'合成区域B');
pack=addEquipment(pack,{category:'pdu',label:'TEST-PDU',quantity:2},'合成其他品类');
const eid=pack.equipment[0].id;
const add=(p,quote,field='clause',value=quote,equipmentId=eid)=>{
  p=addPresalesSource(p,{type:'text',name:'合成母线.txt',text:quote,segments:[{start:0,end:quote.length}]},'合成来源');
  return addRequirement(p,{equipmentId,field,candidates:[{value,evidence:{sourceId:p.sources.at(-1).id,start:0,end:quote.length,quote}}]},'合成原文');
};
pack=add(pack,'暂按两排考虑；母线槽吊装，含悬挂件、连接件、盖板组件和末端组件。');
pack=add(pack,'主控箱集中监控，端口箱监测电参量；插接箱馈出断路器配置分励脱扣器，具备分时下电。');
pack=add(pack,'RS485通讯，MODBUS协议，主控箱以太网接口；监控单元同品牌。');
pack=add(pack,'母线内部为三相五线制，N线至少100%，PE至少50%。');
pack=add(pack,'相数：3（三相四线制）；额定电压380V/415V，频率50/60Hz。');
const ids=pack.requirements.map(r=>r.id),options={quantityBasis:'region',basisNote:'合成人工分区域表；箱数/米数非每通道',requirementIds:ids,rows};
const before=JSON.stringify(pack),proposal=createBuswayRegionProposal(pack,eid,options);
assert.equal(JSON.stringify(pack),before,'纯函数不突变');
assert.equal(proposal.config.buswayLengthM,125.5); assert.equal(proposal.config.controllerCount,3);
assert.equal(proposal.config.endpointCount,12); assert.equal(proposal.config.plugBoxCount,64);
for(const key of ['phase','voltageV','frequencyHz','terminalCount','plugBoxOutputs','runCount','neutralRatioPct','ipRating','ratedCurrentA']) assert.equal(proposal.config[key],undefined,key);
assert.ok(proposal.components.every(c=>!c.brand && !c.model && !c.code && c.modelStatus==='pending'));
assert.ok(proposal.components.every(c=>c.risk.includes('四线制') && c.risk.includes('暂定')));
assert.equal(proposal.components.at(-1).quantity,null,'附件不补1');
assert.ok(proposal.config.monitoring.includes('分励脱扣'));
assert.equal(proposal.config.brandRequirement,undefined,'监控品牌不推广为全系统');
assert.throws(()=>createBuswayRegionProposal(pack,eid,{...options,quantityBasis:''}),/口径/);
assert.throws(()=>createBuswayRegionProposal(updateEquipmentQuantity(pack,eid,2,'合成错误数量'),eid,options),/区域包/);
assert.throws(()=>createBuswayRegionProposal(updateEquipmentQuantity(pack,eid,null,'合成未知'),eid,options),/区域包/);
assert.throws(()=>createBuswayRegionProposal(pack,eid,{...options,basisNote:''}),/依据/);
assert.throws(()=>createBuswayRegionProposal(pack,eid,{...options,requirementIds:[]}),/明确选择/);
assert.throws(()=>createBuswayRegionProposal(pack,eid,{...options,requirementIds:[ids[0],ids[0]]}),/明确选择/);
assert.throws(()=>createBuswayRegionProposal(pack,pack.equipment[1].id,options),/跨设备/);
assert.throws(()=>createBuswayRegionProposal(pack,pack.equipment[2].id,options),/智能母线/);
assert.throws(()=>createBuswayRegionProposal(pack,eid,{...options,config:{endpointCount:9}}),/合计不一致/);
const bad=structuredClone(pack);bad.requirements[0].candidates[0].evidence.quote='伪造';
assert.throws(()=>createBuswayRegionProposal(bad,eid,options),/证据不匹配/);
const stale=replacePresalesSource(pack,pack.sources[0].id,{type:'text',name:'替换.txt',text:'新要求',segments:[{start:0,end:3}]},'合成替换');
assert.throws(()=>createBuswayRegionProposal(stale,eid,options),/失效/);
const deviation=structuredClone(pack);deviation.requirements[0].response='deviation';
assert.throws(()=>createBuswayRegionProposal(deviation,eid,options),/偏离/);
const unresolvedRows=rows.concat({...rows[2],name:'TEST未知端口',quantity:null});
assert.equal(createBuswayRegionProposal(pack,eid,{...options,rows:unresolvedRows}).config.endpointCount,null,'未知不局部合计');
assert.throws(()=>createBuswayRegionProposal(pack,eid,{...options,rows:unresolvedRows,config:{endpointCount:12}}),/局部总量/);
assert.throws(()=>createBuswayRegionProposal(pack,eid,{...options,rows:[{...rows[2],quantity:Number.MAX_SAFE_INTEGER},{...rows[2],quantity:1}]}),/安全/);
let scalar=add(pack,'端口箱数量：9台','endpointCount',9);
scalar=confirmPresalesRequirement(scalar,scalar.requirements.at(-1).id,{value:9,forbiddenDeviation:false,response:'met'},'合成确认');
assert.throws(()=>createBuswayRegionProposal(scalar,eid,options),/合计不一致/);
let saved=adoptPresalesScheme(pack,proposal,'合成保存区域工作稿'); const sid=saved.schemes.at(-1).id;
const out=buildPresalesDeliverable(saved,sid);
assert.equal(out.status,'discussion-draft'); assert.deepEqual(out.bom.map(c=>c.totalQuantity),[3,125.5,12,64,null]);
assert.ok(out.description.some(p=>p.includes('端口箱12')));
assert.throws(()=>confirmPresalesScheme(saved,sid,'合成不可确认'),/待复核|型号待核对/);
const snapshot=createPresalesSnapshot(saved);
assert.equal(restorePresalesSnapshot(snapshot).schemes[0].reviewStatus,'pending');
for(const mutate of [s=>s.assistant.sourceRevision=999999,s=>s.assistant.quantityBasis='rack',s=>s.assistant.basisNote='',s=>s.assistant.sourceRequirementIds=['不存在'],s=>s.requirementIds=[]]) {
  const copy=structuredClone(snapshot);mutate(copy.package.schemes[0]);assert.throws(()=>restorePresalesSnapshot(copy),/元数据|不存在|未关联/);
}
const changedQuantity=updateEquipmentQuantity(saved,eid,2,'合成防重复乘');
assert.ok(buildPresalesDeliverable(changedQuantity,sid).bom.every(c=>c.totalQuantity==null));
assert.ok(schemeReviewProblems(changedQuantity,sid).some(p=>p.includes('区域包')));
assert.equal(saved.equipment[0].quantity,1);
const wrongUnit=structuredClone(saved.schemes[0]);wrongUnit.components.find(c=>c.role==='controller').unit='路';
const wrongUnitPack=adoptPresalesScheme(saved,wrongUnit,'合成手改箱体单位');
assert.ok(schemeReviewProblems(wrongUnitPack,sid).some(p=>p.includes('单位与母线区域用途')));
const decimalBox=structuredClone(saved.schemes[0]);decimalBox.components.find(c=>c.role==='controller').quantity=3.5;
assert.ok(schemeReviewProblems(adoptPresalesScheme(saved,decimalBox,'合成手改箱体小数'),sid).some(p=>p.includes('安全范围')));
const revised=structuredClone(saved.schemes[0]);revised.config.buswayLengthM=130.5;revised.config.endpointCount=13;
revised.components.find(c=>c.role==='busway').quantity=130.5;revised.components.find(c=>c.role==='endpoint').quantity=13;
saved=adoptPresalesScheme(saved,revised,'合成更改区域米数/箱数');const data=buildPresalesOutput(saved,sid);
assert.ok(data.output.description.some(p=>p.includes('长度130.5 m') && p.includes('端口箱13')));
assert.equal(data.output.bom.find(c=>c.role==='endpoint').totalQuantity,13);
assert.ok(presalesReportHtml(data).includes('长度130.5 m'));
assert.ok(data.tables.header.some(r=>r[1]==='智能母线条款＋人工区域供货表（未自动确认采用）'));
const mismatch=structuredClone(saved.schemes[0]);mismatch.components.find(c=>c.role==='endpoint').quantity=14;
saved=adoptPresalesScheme(saved,mismatch,'合成不一致草稿');
assert.ok(schemeReviewProblems(saved,sid).some(p=>p.includes('端口箱数量与清单')));
// 旧手工母线方案仍按设备数量乘算，新增用途不改旧v1。
const old=adoptPresalesScheme(updateEquipmentQuantity(pack,eid,2,'合成旧口径'),{equipmentId:eid,name:'TEST旧方案',config:{buswayLengthM:10},
  components:[{name:'TEST旧母线',specification:'旧规格',quantity:10,unit:'m',role:'busway'}],requirementIds:ids},'合成旧手工');
assert.equal(buildPresalesDeliverable(old,old.schemes.at(-1).id).bom[0].totalQuantity,20);
assert.equal(restorePresalesSnapshot(createPresalesSnapshot(old)).schemes[0].origin,'manual');
console.log('智能母线区域口径、用途/单位、证据隔离、未知/限定、数量防重乘、同源说明和旧v1回归通过（合成软件验收）');
