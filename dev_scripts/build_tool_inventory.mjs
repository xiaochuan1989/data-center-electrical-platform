#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsRoot = path.join(root, '工具模板');
const output = path.join(root, 'docs', 'tool-inventory.md');

const currentFiles = new Set([
  '报价模板\\A-报价模板-A40.xlsm',
  '供配电配置模版-20250728V1.xlsx',
  '配电柜申请编码生成模板-持续更新.xlsx',
  '商务输出模板\\A-商务成本输出模板-A00.xlsx',
  '数据中心电能质量治理：交互式容量计算 SVG+APF.html',
  '数据中心负荷计算表\\数据中心负荷计算表.xlsx',
  '数据中心母线电流计算-A00.xlsx',
  '数据中心配电简易计算与选型-持续更新.xlsx',
  '铜排载流量-A03.xlsx',
  '微模块电气负荷计算表-A00.xlsx',
  '下单编码模板.xlsx',
  '智能母线配置与选型.xlsx',
  'A-导体电缆选型-A05.xlsx',
  'APF容量配置.xlsx',
  'B-电缆选型-A00.xlsm',
  '电池监控仪配置器-A02.xlsm',
  '锂电池-选型模板-A00.xlsx',
  'UPS后备时间蓄电池容量速算.xlsx',
  'UPS蓄电池配置表.xlsx',
  'XGM-智能母线-商务成本\\XGM-智能母线-商务成本-A11.xlsm'
]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function category(file) {
  const name = file.toLowerCase();
  if (name.includes('ups') || name.includes('电池')) return ['UPS 与电池', '现有成熟功能核对源', 'P0'];
  if (name.includes('负荷') || name.includes('变压器') || name.includes('供配电')) return ['负荷与配电', '工程主链', 'P1'];
  if (name.includes('电缆') || name.includes('导体') || name.includes('铜排')) return ['电缆与导体', '导体选型', 'P2'];
  if (name.includes('母线')) return ['母线系统', '母线配置', 'P2'];
  if (name.includes('apf') || name.includes('svg') || name.includes('电能质量')) return ['电能质量', 'APF/SVG', 'P2'];
  if (name.includes('编码')) return ['编码与交付', '编码输出', 'P3'];
  if (name.includes('报价') || name.includes('商务') || name.includes('价格')) return ['模板中心', '商务成本空模板', 'P3'];
  return ['模板中心', '资料/模板', 'P4'];
}

function disposition(relative) {
  const lower = relative.toLowerCase();
  if (lower.includes('带价格') || lower.includes('价格') || lower.includes('报价')) {
    return currentFiles.has(relative) ? ['核对源（受限）', '禁止原件进入公开构建；仅提取无价格规则或生成空模板'] : ['历史归档（受限）', '禁止原件进入公开构建'];
  }
  if (/常用ups速查表-v[0-7]/i.test(relative) || /2018/.test(relative)) {
    return ['历史归档', '以网页 v1.8.39 / UPS 速查表 V8.0 为准'];
  }
  if (relative.includes('历史版本') || /-a(?:0[0-9]|1[0])-/.test(lower) || /-a(?:0[0-9]|1[0])\./.test(lower)) {
    if (!currentFiles.has(relative)) return ['历史归档', '不进入正常工具入口'];
  }
  if (currentFiles.has(relative)) return ['当前核对版', '网页化或作为脱敏模板候选'];
  if (/\.(md|png|bas|json)$/i.test(relative)) return ['辅助资料', '仅供核对，不直接发布'];
  return ['待人工确认', '确认独有规则后并入当前模块或归档'];
}

const files = walk(toolsRoot)
  .filter(file => !path.basename(file).startsWith('~$'))
  .map(file => path.relative(toolsRoot, file).replaceAll('/', '\\'))
  .sort((a, b) => a.localeCompare(b, 'zh-CN'));

const rows = files.map((relative, index) => {
  const [business, module, priority] = category(relative);
  const [status, migration] = disposition(relative);
  return `| ${index + 1} | ${relative.replaceAll('|', '\\|')} | ${business} | ${module} | ${status} | ${priority} | ${migration} |`;
});

const currentCount = files.filter(file => currentFiles.has(file)).length;
const restrictedCount = files.filter(file => /带价格|价格|报价/.test(file)).length;
const document = `# 工具主清单与迁移优先级表

生成日期：2026-09-14

核对范围：\`工具模板/\` 中除 Excel 临时锁文件外的全部文件。
合计：**${files.length} 个文件**；已指定当前核对版：**${currentCount} 个**；名称显示价格/报价风险：**${restrictedCount} 个**。

## 治理口径

- 当前 UPS、电池、后备时间和产品数据库以网页 v1.8.39 / 常用 UPS 速查表 V8.0 为迁移基线，旧 Excel 不重复开发。
- 重复版本按业务能力合并，正常入口只显示唯一当前能力；A00～A11、V5～V7 等历史版本进入归档。
- 原始工作簿不随 GitHub Pages 发布；只发布网页计算逻辑、无价格基础数据及通过检查的脱敏模板。
- 商务成本只生成空白格式，不内置目录价、供应商价或历史成交价。名称或内容涉及价格/报价的原件全部标为受限核对源。
- “待人工确认”表示尚未完成公式逐项等价验证，不代表文件无价值。

## 主清单

| # | 来源文件 | 业务分类 | 新平台模块 | 版本状态 | 优先级 | 迁移方式 |
|---:|---|---|---|---|---|---|
${rows.join('\n')}

## 首批验收样例

| 模块 | 正常样例 | 边界/风险样例 | 等价来源 |
|---|---|---|---|
| 负荷汇总 | 10×10kW、Kd=0.9、PF=0.9 | 空行、PF=1、零负荷、超出变压器表列 | 数据中心负荷计算表、微模块 A00 |
| 支路断路器 | 30kW、三相380V、PF=0.9、系数1.2 | 单相/三相切换、超出1600A | 数据中心母线电流 A00 |
| 母线电流 | 500kW、Kd=0.9、PF=0.9 | 谐波降容、超出6300A | 数据中心母线电流 A00 |
| 铜排/电缆 | 所需400A、30°C | 无匹配、不同敷设/温度/并联根数 | 铜排 A03、导体电缆 A05/B-A00 |
| APF/SVG | 1250kVA、80%负载、THDi=30% | THDi=0、目标PF不低于当前PF | APF容量配置、SVG+APF HTML |
| 智能母线 | 两排各10个600柜+2个600空调 | 单排为空、柜顶/吊装、触摸屏切换 | 智能母线配置与选型 |
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, document, 'utf8');
console.log(`已生成 ${path.relative(root, output)}，共 ${files.length} 个文件`);
