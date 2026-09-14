export const TOOL_GROUPS = [
  {
    id: 'ups-battery', name: 'UPS 与电池', icon: '⚡',
    tools: [
      { id: 'home', name: 'UPS 智能选型', status: 'available', source: '现有成熟功能' },
      { id: 'battery', name: 'UPS 与电池配置', status: 'available', source: '现有成熟功能' },
      { id: 'runtime', name: '后备时间反算', status: 'available', source: '现有成熟功能' },
      { id: 'lead', name: '电池计算（方法一/锂电）', status: 'available', source: '现有成熟功能' },
      { id: 'dc', name: '数据中心方案校核', status: 'available', source: '现有成熟功能' },
      { id: 'db', name: 'UPS 产品数据库', status: 'available', source: '常用 UPS 速查表 V8.0' }
    ]
  },
  {
    id: 'engineering', name: '工程主链', icon: '▦',
    tools: [
      { id: 'load', name: '负荷与变压器校核', status: 'available', source: '数据中心负荷计算表/微模块电气负荷计算表 A00' },
      { id: 'distribution', name: '支路断路器与母线电流', status: 'available', source: '数据中心母线电流计算 A00' },
      { id: 'conductor', name: '电缆与导体选型', status: 'available', source: 'A-导体电缆选型 A05 / B-电缆选型 A00' },
      { id: 'busway', name: '智能母线配置', status: 'available', source: '智能母线配置与选型' },
      { id: 'power-quality', name: 'APF / SVG 校核', status: 'available', source: 'APF容量配置 / SVG+APF 交互计算' }
    ]
  },
  {
    id: 'delivery', name: '编码与交付', icon: '▤',
    tools: [
      { id: 'delivery', name: '项目汇总与标准输出', status: 'foundation', source: '统一项目数据' },
      { id: 'templates', name: '模板中心', status: 'governed', source: '仅发布已脱敏当前有效版' }
    ]
  }
];

export const TEMPLATE_CATALOG = [
  { category: '负荷与配电', current: '数据中心负荷计算表.xlsx', migration: '已网页化', publish: false },
  { category: '微模块', current: '微模块电气负荷计算表-A00.xlsx', migration: '已并入负荷模块', publish: false },
  { category: '母线电流', current: '数据中心母线电流计算-A00.xlsx', migration: '已网页化', publish: false },
  { category: '电缆与导体', current: 'A-导体电缆选型-A05.xlsx', migration: '数据已提取，规则持续核对', publish: false },
  { category: '铜排', current: '铜排载流量-A03.xlsx', migration: '数据已提取，规则持续核对', publish: false },
  { category: '智能母线', current: '智能母线配置与选型.xlsx', migration: '已网页化', publish: false },
  { category: '电能质量', current: 'APF容量配置.xlsx', migration: '已网页化', publish: false },
  { category: '编码', current: '配电柜申请编码生成模板-持续更新.xlsx', migration: '待下一阶段网页化', publish: false },
  { category: '商务成本', current: '商务成本空白模板', migration: '待完成脱敏空模板', publish: false, note: '不含目录价、供应商价或内置价格' }
];

export function allTools() {
  return TOOL_GROUPS.flatMap(group => group.tools.map(tool => ({ ...tool, group: group.name, groupId: group.id })));
}
