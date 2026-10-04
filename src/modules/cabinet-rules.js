// 结构骨架与已声明回路的一致性；不作电气安全或厂家选型结论。
export const CABINET_TEMPLATES = Object.freeze({
  distribution: '进出线配置骨架（不含母联）', sectional: '含母联配置骨架'
});
export const CABINET_CIRCUIT_FIELDS = Object.freeze({ incoming: 'incomingCount', tie: 'tieCount', outgoing: 'outgoingCount' });
export const CABINET_ROLE_LABELS = Object.freeze({ incoming: '进线', tie: '母联', outgoing: '出线' });

export function validateCabinetAssistant(assistant, category, revision) {
  if (!assistant || assistant.version !== 1 || assistant.kind !== 'cabinet-circuits' || category !== 'cabinet'
    || !Object.hasOwn(CABINET_TEMPLATES, assistant.template) || !Number.isSafeInteger(assistant.sourceRevision)
    || assistant.sourceRevision < 0 || assistant.sourceRevision > revision) throw new Error('配电柜助手来源元数据非法');
  return { version: 1, kind: 'cabinet-circuits', template: assistant.template, sourceRevision: assistant.sourceRevision };
}

export function cabinetAssistantProblems(scheme) {
  if (scheme.origin !== 'cabinet-assistant') return [];
  const { config, components, assistant } = scheme, problems = [];
  for (const [key, label] of [['incomingCount', '进线'], ['outgoingCount', '出线']]) {
    if (!(config[key] > 0)) problems.push(`配电柜辅助方案${label}数量待确认`);
  }
  if (assistant.template === 'distribution'
    && (config.tieCount !== 0 || components.some(c => c.role === 'tie'))) problems.push('不含母联骨架须明确母联数量0且无母联明细');
  if (assistant.template === 'sectional' && !(config.tieCount > 0)) problems.push('含母联骨架的母联数量待确认');
  return problems;
}

export function cabinetSchemeNarrative(scheme) {
  if (scheme.origin !== 'cabinet-assistant') return [];
  const known = v => v == null || v === '' ? '待确认' : String(v);
  const config = scheme.config;
  return [
    `结构骨架：${CABINET_TEMPLATES[scheme.assistant.template]}；生成依据为包版本${scheme.assistant.sourceRevision}。人工回路表是设计输入，不冒充原文提取或厂家典型图。`,
    `每设备回路配置：进线${known(config.incomingCount)}，母联${known(config.tieCount)}，出线${known(config.outgoingCount)}；备用数量${known(config.spareCount)}，不自动追加备用器件。`,
    `采用额定电压${known(config.voltageV)} V，额定电流${known(config.ratedCurrentA)} A；主母线电流${known(config.busbarCurrentA)} A。以上值按当前已存配置输出，未知不补造。`,
    ...scheme.components.filter(c => Object.hasOwn(CABINET_ROLE_LABELS, c.role)).map(c =>
      `${CABINET_ROLE_LABELS[c.role]}分组：${c.name}；每设备数量${known(c.quantity)}；功能规格${known(c.specification)}；型号${known(c.model || c.code)}。`),
    `供货边界：${known(config.supplyBoundary)}。柜体、主母线、附件及回路规格的完整性仍需核对；本助手不推算柜体尺寸、保护整定、温升、短路耐受或施工设计。`
  ];
}
