// 有限语法的候选映射，不是工程校核或完整自然语言理解。
const requireThat = (test, message) => { if (!test) throw new Error(message); };
const positive = v => Number.isFinite(v) && v > 0;
const count = v => Number.isSafeInteger(v) && v > 0;
export function parsePduSpecClause(quote) {
  requireThat(typeof quote === 'string' && quote.length <= 100000, 'PDU条款须为不超过100000字符的文字');
  const config = {}, outputs = [], issues = [];
  const inputs = [...quote.matchAll(/输入\s*(?:AC|交流)?\s*(\d+(?:\.\d+)?)\s*V\s*[,，\s]*\s*(\d+(?:\.\d+)?)\s*A/gi)];
  if (inputs.length > 1) issues.push('同条款包含多组输入，请拆分设备或澄清');
  else if (inputs.length === 1) {
    const suffix = quote.slice(inputs[0].index + inputs[0][0].length).split(/[，,。；;\n]/)[0];
    const prefix = quote.slice(0, inputs[0].index).split(/[，,。；;\n]/).at(-1);
    if (/[～~\/／]|以上|以下|或|可选|(?:及|和)\s*\d.*A/i.test(suffix)
      || /不低于|不少于|不高于|至少|最多|[≥≤<>]|可选|或/.test(prefix)) issues.push('输入规格含范围或备选，电压/电流待确认');
    else {
      const voltage = Number(inputs[0][1]), current = Number(inputs[0][2]);
      requireThat(positive(voltage) && positive(current), 'PDU输入数值非法');
      config.voltageV = voltage; config.ratedCurrentA = current;
    }
  }
  if (/输出/.test(quote) && /插座/.test(quote)) {
    const part = quote.slice(quote.indexOf('输出') + 2).split(/[，,。；;\n]/)[0].trim();
    const groups = [...part.matchAll(/(\d+)\s*(?:位|个)\s*([^+＋,，;；。\n]*?\d+(?:\.\d+)?\s*A\s*插座)/gi)];
    const remainder = part.replace(/(\d+)\s*(?:位|个)\s*([^+＋,，;；。\n]*?\d+(?:\.\d+)?\s*A\s*插座)/gi, '').replace(/[+＋\s]/g, '');
    // 未识别片段/备选/范围不得被跳过后称为完整输出列表。
    if (!groups.length || remainder || /不低于|不少于|至少|最多|[≥≤<>～~]|或者|或|可选/.test(part)) {
      issues.push('输出列表含未识别、范围或备选内容，插座明细与总数待确认');
    } else {
      for (const m of groups) {
        const quantity = Number(m[1]); requireThat(count(quantity), 'PDU插座数量须为正安全整数');
        outputs.push({ quantity, specification: m[2].trim() });
      }
      const total = outputs.reduce((n, row) => n + row.quantity, 0);
      requireThat(count(total), 'PDU输出数量合计超出安全整数范围');
      config.outputCount = total;
    }
  }
  if (/插座级|每个插座|远程上下电/.test(quote)) config.monitoring = quote.trim();
  if (/本地计量|液晶电表/.test(quote)) config.meteringLevel = quote.trim();
  if (/同品牌/.test(quote)) config.brandRequirement = quote.trim();
  if (/A\s*[/／]\s*B|A\/B|双路/.test(quote)) config.redundancy = quote.trim();
  if (/安装在|固定方式/.test(quote)) config.installation = quote.trim();
  const tentative = /暂定|暂按|待确认|后续.*确定|设计联络.*确定/.test(quote);
  return { config, outputs, issues, tentative };
}

export function validatePduAssistant(value, category, revision) {
  requireThat(value && value.version === 1 && value.kind === 'pdu-spec' && category === 'pdu'
    && Number.isSafeInteger(value.sourceRevision) && value.sourceRevision >= 0 && value.sourceRevision <= revision
    && Array.isArray(value.sourceRequirementIds) && value.sourceRequirementIds.length > 0 && value.sourceRequirementIds.length <= 200
    && value.sourceRequirementIds.every(v => typeof v === 'string' && v.trim())
    && new Set(value.sourceRequirementIds).size === value.sourceRequirementIds.length, 'PDU助手来源元数据非法');
  return { version: 1, kind: 'pdu-spec', sourceRevision: value.sourceRevision, sourceRequirementIds: [...value.sourceRequirementIds] };
}
export function pduAssistantProblems(scheme) {
  if (scheme.origin !== 'pdu-assistant') return [];
  const problems = [];
  if (scheme.config.pduType !== 'rack') problems.push('PDU辅助方案须明确机架PDU类型');
  for (const [key,label] of [['voltageV','输入电压'],['ratedCurrentA','输入电流'],['outputCount','输出数量']]) {
    if (!(scheme.config[key] > 0)) problems.push(`PDU辅助方案${label}待确认`);
  }
  return problems;
}
export function pduSchemeNarrative(scheme) {
  if (scheme.origin !== 'pdu-assistant') return [];
  const known = v => v == null || v === '' ? '待确认' : String(v);
  return [
    `PDU条款辅助方案：来源包版本${scheme.assistant.sourceRevision}；生成时选取的原文仅作为候选，未自动确认客户要求或满足应答。以下描述使用当前已保存配置。`,
    `每条PDU：输入电压${known(scheme.config.voltageV)} V，输入电流${known(scheme.config.ratedCurrentA)} A；输出插座${known(scheme.config.outputCount)}位。设备项数量表示本区域PDU供货总量，不再乘每柜PDU条数。`,
    ...scheme.components.map(c => `${c.name}：功能规格${known(c.specification)}；每条数量${known(c.quantity)}${known(c.unit)}；型号${known(c.model || c.code)}${c.risk ? `；待澄清：${c.risk}` : ''}。`),
    `供货边界：${known(scheme.config.supplyBoundary)}。插座数量不等于保护分路数量，不将插座额定电流相加当输入容量；接线、相别分配、保护配合及附件完整性需另行核对。`
  ];
}
