// 区域清单助手纯规则；不是布局设计、自动选型或标准合格判断。
const fail = (v, m) => { if (!v) throw new Error(m); };
const text = v => String(v ?? '').trim();
const unknown = v => v == null || /^(?:|未知|待确认|待选型|按图|X{2,})$/i.test(text(v));
export const BUSWAY_REGION_FIELDS = Object.freeze({ busway:'buswayLengthM', controller:'controllerCount', endpoint:'endpointCount', terminal:'terminalCount', plugbox:'plugBoxCount' });
export const BUSWAY_REGION_ROLES = Object.freeze({ busway:'母线槽',controller:'主控箱',endpoint:'端口箱',terminal:'始端箱',plugbox:'插接箱',accessory:'附件' });
const roles = { ...Object.fromEntries(Object.keys(BUSWAY_REGION_ROLES).map(k=>[k,k])),
  ...Object.fromEntries(Object.entries(BUSWAY_REGION_ROLES).map(([k,v])=>[v,k])),插线箱:'plugbox' };
export function normalizeBuswayRegionRow(row,index=0) {
  fail(row && typeof row === 'object',`区域表第${index+1}行非法`);
  const role=Object.hasOwn(roles,text(row.role)) ? roles[text(row.role)] : null;
  fail(role,`区域表第${index+1}行用途须为母线槽、主控箱、端口箱、始端箱、插接箱或附件`);
  fail(typeof row.name === 'string' && text(row.name),`区域表第${index+1}行名称缺失`);
  fail(unknown(row.specification) || typeof row.specification === 'string',`区域表第${index+1}行规格须为文字`);
  const unit=text(row.unit)==='米' ? 'm' : text(row.unit);
  fail(role==='busway' ? unit==='m' : role==='accessory' ? !!unit : ['套','台','个','只'].includes(unit),`区域表第${index+1}行单位与用途不匹配`);
  let quantity=null;
  if (!unknown(row.quantity)) {
    fail(['number','string'].includes(typeof row.quantity) && /^\d+(?:\.\d+)?$/.test(text(row.quantity)),`区域表第${index+1}行数量须为单一正数或留空`);
    quantity=Number(row.quantity);
    fail(Number.isFinite(quantity) && quantity>0 && quantity<=Number.MAX_SAFE_INTEGER
      && (['busway','accessory'].includes(role) || Number.isSafeInteger(quantity)),`区域表第${index+1}行数量非法或超出安全范围`);
  }
  return {role,name:text(row.name),specification:unknown(row.specification)?'':text(row.specification),quantity,unit};
}
export function parseBuswayRegionTable(value) {
  fail(typeof value==='string' && value.length<=100000,'区域供货表须为不超过100000字符的文字');
  const lines=value.split(/\r?\n/).filter(v=>v.trim()); fail(lines.length,'请粘贴区域供货表');
  const sep=lines[0].includes('\t')?'\t':'|';
  fail(lines.every(v=>sep==='\t' ? !v.includes('|') : !v.includes('\t')),'区域供货表不能混用制表符与竖线');
  const rows=lines.map(v=>v.split(sep).map(text));
  if(rows[0].join('|')==='用途|名称|功能规格|区域数量|单位') rows.shift();
  fail(rows.length>0 && rows.length<=200,'区域供货表须有1～200行');
  return rows.map((v,i)=>{ fail(v.length===5,`区域表第${i+1}行须为五列：用途、名称、功能规格、区域数量、单位`);
    return normalizeBuswayRegionRow({role:v[0],name:v[1],specification:v[2],quantity:v[3],unit:v[4]},i); });
}
export function buswayClauseFacts(quotes) {
  const config={},issues=[],tentative=quotes.some(q=>/暂定|暂按|待确认|后续.*确定|设计联络.*确定/.test(q));
  const whole=quotes.join('\n');
  if(/三相四线制/.test(whole) && /三相五线制/.test(whole)) issues.push('选定原文同时有三相四线制与三相五线制，N/PE结构待澄清，不自动选一边');
  for(const [key,re] of [['monitoring',/监控|监测|电参数|分时|分励脱扣/],['communication',/通讯|通信|RS485|MODBUS|以太网/i],
    ['installation',/吊装|安装在/],['supports',/悬挂件|支架/],['endAccessories',/连接件|盖板|末端组件/],['antiCondensation',/防凝露/]]) {
    const matches=[...new Set(quotes.filter(q=>re.test(q)))]; if(matches.length) config[key]=matches.join('\n');
  }
  return {config,issues,tentative,hasAccessories:/悬挂件|支架|连接件|盖板|末端组件/.test(whole)};
}
export function validateBuswayAssistant(v,category,revision) {
  fail(v && v.version===1 && v.kind==='busway-region' && category==='busway' && v.quantityBasis==='region'
    && Number.isSafeInteger(v.sourceRevision) && v.sourceRevision>=0 && v.sourceRevision<=revision
    && Array.isArray(v.sourceRequirementIds) && v.sourceRequirementIds.length>0 && v.sourceRequirementIds.length<=200
    && v.sourceRequirementIds.every(id=>typeof id==='string' && id.trim()) && new Set(v.sourceRequirementIds).size===v.sourceRequirementIds.length
    && typeof v.basisNote==='string' && v.basisNote.trim() && v.basisNote.length<=4000,'母线助手来源/区域口径元数据非法');
  return {version:1,kind:'busway-region',quantityBasis:'region',sourceRevision:v.sourceRevision,sourceRequirementIds:[...v.sourceRequirementIds],basisNote:v.basisNote.trim()};
}
export function buswayAssistantProblems(scheme,equipment) {
  if(scheme.origin!=='busway-assistant') return [];
  const issues=[];
  if(equipment.quantity!==1) issues.push('区域母线助手设备数量须明确为1个区域包；当前总数量不乘算，须复核口径');
  if(!scheme.components.some(c=>c.role==='busway')) issues.push('区域母线槽长度明细待补充');
  for(const c of scheme.components) {
    if(c.role==='busway' && c.unit!=='m' || ['controller','endpoint','terminal','plugbox'].includes(c.role) && !['套','台','个','只'].includes(c.unit)) issues.push(`${c.name}单位与母线区域用途不匹配`);
    if(c.quantity!=null && (c.quantity>Number.MAX_SAFE_INTEGER || (!['busway','accessory'].includes(c.role) && !Number.isSafeInteger(c.quantity)))) issues.push(`${c.name}数量超出区域用途安全范围`);
  }
  return issues;
}
export function buswaySchemeNarrative(scheme,equipment) {
  if(scheme.origin!=='busway-assistant') return [];
  const known=v=>v==null || v===''?'待确认':String(v);
  return [
    `智能母线区域询价方案：原文为候选依据，人工区域表为设计输入，未自动确认满足；来源包版本${scheme.assistant.sourceRevision}。以下使用当前保存的配置和清单。`,
    `数量口径：本区域整套清单；设备数量${known(equipment.quantity)}，仅明确为1时输出区域总量，不再乘通道、机柜、A/B路或PDU数。归属依据：${scheme.assistant.basisNote}。`,
    `本区域母线长度${known(scheme.config.buswayLengthM)} m；主控箱${known(scheme.config.controllerCount)}，端口箱${known(scheme.config.endpointCount)}，始端箱${known(scheme.config.terminalCount)}，插接箱${known(scheme.config.plugBoxCount)}。主控箱不当进线箱，端口箱不自动等同始端箱；各箱之间及PDU接线映射待核对。`,
    ...scheme.components.map(c=>`${c.name}：功能规格${known(c.specification)}；区域数量${known(c.quantity)}${known(c.unit)}；型号${known(c.model||c.code)}${c.risk?`；待澄清：${c.risk}`:''}。`),
    `供货边界：${known(scheme.config.supplyBoundary)}。母线米数不是实际分段组合，插接箱数不是输出路数；保护器件、短路/温升、N/PE、路由分段和附件完整性需另行复核，非生产图纸。`
  ];
}
