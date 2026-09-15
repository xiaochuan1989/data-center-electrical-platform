import {
  CABLE_AIR_SPACING_FACTORS,
  CABLE_TRAY_LAYER_FACTORS,
  calculateApf,
  calculateBranch,
  calculateBusbarAmpacity,
  calculateBusbarSelection,
  calculateCableSelection,
  calculateBusway,
  calculateLoadSummary,
  calculateSmartBusway,
  calculateSvg
} from '../modules/engineering-calculators.js';
import { allTools, TEMPLATE_CATALOG, TOOL_GROUPS } from './tool-registry.js';
import busbarCatalog from '../data/busbar-catalog.json';
import cableCatalog from '../data/cable-catalog.json';
import awgCatalog from '../data/awg-catalog.json';
import {
  copyProject,
  createAndSaveProject,
  exportProject,
  getCurrentProject,
  importProject,
  listProjects,
  migrateLegacyBrowserData,
  saveProject
} from './project-store.js';

const LEGACY_VIEWS = new Set(['home', 'battery', 'runtime', 'lead', 'dc', 'db']);
const ENGINEERING_WARNING = '初步设计校核结果，仅用于方案比较；最终设计与订货前须结合项目规范、厂家数据及注册工程师审核。';
const SIDEBAR_PREF_KEY = 'dc_platform_sidebar_collapsed';

const state = {
  project: null,
  catalogs: { busbars: [], cables: [], awg: [] },
  activeView: 'project'
};

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function numberValue(id, fallback = 0) {
  const value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function format(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—';
}

function statusLabel(status) {
  const labels = { available: '可用', foundation: '基础版', governed: '治理中' };
  return labels[status] || status;
}

function viewPanel(id, title, subtitle, body) {
  return `<section class="platform-view platform-card" id="platform-view-${id}" hidden>
    <header class="platform-section-head"><div><h1>${title}</h1><p>${subtitle}</p></div></header>${body}
  </section>`;
}

function navIcon(name) {
  return `<span class="platform-nav-icon" aria-hidden="true"><svg class="ti ti-${name}"><use href="#ti-${name}"/></svg></span>`;
}

function navButton(view, label, icon, strong = false) {
  return `<button class="platform-nav-item" data-platform-view="${view}" title="${label}">${navIcon(icon)}<span class="platform-nav-text${strong ? ' strong' : ''}">${label}</span></button>`;
}

function buildSidebar() {
  return `<aside class="platform-sidebar" aria-label="平台导航">
    <button type="button" class="platform-sidebar-control" data-sidebar-toggle aria-label="收起平台导航" aria-expanded="true" title="收起左侧导航">
      ${navIcon('chevron-down')}<span class="platform-nav-text platform-sidebar-control-text">收起导航</span>
    </button>
    ${navButton('project', '项目工作台', 'clipboard-data', true)}
    ${navButton('tools', '工具中心', 'tool', true)}
    <div class="platform-nav-label">UPS 与电池</div>
    ${navButton('home', '智能选型', 'target')}
    ${navButton('battery', 'UPS 与电池配置', 'battery-3')}
    ${navButton('runtime', '后备时间反算', 'clock-hour-4')}
    ${navButton('lead', '电池方法一 / 锂电', 'calculator')}
    ${navButton('dc', '数据中心方案校核', 'building')}
    ${navButton('db', '产品数据库', 'database')}
    <div class="platform-nav-label">工程设计</div>
    ${navButton('load', '负荷与配电', 'chart-dots-3')}
    ${navButton('cable', '电缆选型', 'plug')}
    ${navButton('busbar', '铜排计算', 'stack-2')}
    ${navButton('busway', '母线系统', 'device-desktop-analytics')}
    ${navButton('power-quality', '电能质量', 'calculator')}
    <div class="platform-nav-label">资料管理</div>
    ${navButton('templates', '模板中心', 'clipboard-data')}
  </aside>`;
}

function projectView() {
  const steps = [
    ['项目信息', 'project'], ['负荷计算', 'load'], ['UPS与电池', 'battery'], ['配电设备', 'load'],
    ['电缆/铜排/母线', 'cable'], ['电能质量', 'power-quality']
  ];
  return viewPanel('project', '项目工作台', '一个项目、一套参数，计算结果可在模块之间复用。', `
    <div class="project-toolbar">
      <label>当前项目<select id="platform-project-select"></select></label>
      <button data-project-action="new">＋ 新建</button><button data-project-action="copy">复制</button>
      <button data-project-action="save" class="primary">保存项目</button>
      <button data-project-action="import">导入 JSON</button><button data-project-action="export">导出 JSON</button>
      <input id="platform-project-import" type="file" accept="application/json,.json" hidden>
    </div>
    <div class="project-overview-grid">
      <div class="project-info-card">
        <h2>项目信息</h2>
        <div class="platform-form-grid cols-2">
          <label>项目名称<input id="project-name" autocomplete="off"></label>
          <label>客户名称<input id="project-customer" autocomplete="off"></label>
          <label>项目地点<input id="project-location" autocomplete="off"></label>
          <label>设计阶段<select id="project-stage"><option>方案设计</option><option>初步设计</option><option>施工图设计</option><option>投标配合</option></select></label>
          <label>设计人员<input id="project-designer" autocomplete="off"></label>
          <label>供电冗余<select id="project-redundancy"><option>N</option><option>N+1</option><option>2N</option><option>2N+1</option></select></label>
        </div>
      </div>
      <aside class="project-status-card"><h2>本地数据说明</h2>
        <p>项目、用户填写价格和 AI 配置只保存在本机浏览器。访问密码仅为提示性门槛，不具备真正的数据保密能力。</p>
        <div id="migration-status" class="migration-status">正在检查旧版数据…</div>
      </aside>
    </div>
    <div class="project-flow" aria-label="项目设计流程">${steps.map(([name, view], index) => `
      <button data-platform-view="${view}"><span>${index + 1}</span><b>${name}</b></button>`).join('')}</div>
    <div class="platform-metrics">
      <div><small>有功负荷</small><strong id="dashboard-active-power">—</strong><em>kW</em></div>
      <div><small>视在功率</small><strong id="dashboard-apparent-power">—</strong><em>kVA</em></div>
      <div><small>设计电流</small><strong id="dashboard-current">—</strong><em>A</em></div>
      <div><small>建议变压器</small><strong id="dashboard-transformer">—</strong><em>kVA</em></div>
    </div>`);
}

function toolsView() {
  return viewPanel('tools', '工具中心', '按业务能力整合重复版本；正常入口只显示当前有效能力。', `
    <div class="tool-search"><input id="platform-tool-search" placeholder="搜索工具、来源或模块…"></div>
    <div class="tool-groups" id="platform-tool-groups">${TOOL_GROUPS.map(group => `
      <section class="tool-group" data-search="${htmlEscape(group.name)}"><h2><span>${group.icon}</span>${group.name}</h2>
        <div class="tool-grid">${group.tools.map(tool => `<button class="tool-card" data-platform-view="${tool.id}" data-search="${htmlEscape(`${tool.name} ${tool.source} ${group.name}`)}">
          <span class="tool-status ${tool.status}">${statusLabel(tool.status)}</span><b>${tool.name}</b><small>${tool.source}</small></button>`).join('')}</div>
      </section>`).join('')}</div>`);
}

function loadView() {
  return viewPanel('load', '负荷与配电', '负荷汇总、变压器初选、支路断路器和母线电流使用同一组项目参数。', `
    <div class="engineering-tabs"><button class="active" data-calc-tab="load-summary">负荷汇总</button><button data-calc-tab="branch">支路与母线</button></div>
    <div class="calc-pane" data-calc-pane="load-summary">
      <div class="platform-form-grid compact cols-4">
        <label>系统电压(V)<input id="load-voltage" type="number" value="380"></label>
        <label>电流安全系数<input id="load-safety" type="number" step="0.05" value="1.2"></label>
        <label>变压器目标负载率<input id="load-transformer-rate" type="number" step="0.05" value="0.8"></label>
        <div class="field-action"><button id="add-load-row">＋ 添加负荷</button></div>
      </div>
      <div class="data-entry-table"><table><thead><tr><th>负荷名称</th><th>数量</th><th>单台功率(kW)</th><th>需要系数</th><th>功率因数</th><th></th></tr></thead><tbody id="load-rows"></tbody></table></div>
      <button id="calculate-load" class="platform-primary-action">计算并写入项目</button>
      <div id="load-result" class="result-grid"></div>
    </div>
    <div class="calc-pane" data-calc-pane="branch" hidden>
      <div class="platform-form-grid cols-4">
        <label>支路功率(kW)<input id="branch-power" type="number" value="30"></label>
        <label>相制<select id="branch-phase"><option value="three">三相</option><option value="single">单相</option></select></label>
        <label>功率因数<input id="branch-pf" type="number" step="0.01" value="0.9"></label>
        <label>安全系数<input id="branch-safety" type="number" step="0.05" value="1.2"></label>
        <label>母线总有功(kW)<input id="busway-power" type="number" value="500"></label>
        <label>母线需要系数<input id="busway-demand" type="number" step="0.05" value="0.9"></label>
        <label>母线谐波降容系数<input id="busway-harmonic" type="number" step="0.05" value="1"></label>
      </div>
      <button id="calculate-distribution" class="platform-primary-action">计算支路与母线</button><div id="distribution-result" class="result-grid"></div>
    </div><p class="engineering-warning">⚠ ${ENGINEERING_WARNING}</p>`);
}

function cableView() {
  const typeYj = 'YJV、YJLV、YJY、YJLY型(铜芯)';
  const airColumns = [1, 2, 3, 4, 5, 6];
  const trayColumns = [1, 2, 3, 4];
  return viewPanel('cable', '电缆选型', '按 B-电缆选型-A00 工作簿进行电缆计算；导体选型已移除，铜排请使用独立计算页。', `
    <div class="engineering-tabs cable-tabs" role="tablist" aria-label="电缆工具">
      <button class="active" role="tab" aria-selected="true" data-cable-tab="calculator">电缆智能选型</button>
      <button role="tab" aria-selected="false" data-cable-tab="correction">电缆修正系数数据表</button>
      <button role="tab" aria-selected="false" data-cable-tab="catalog">电缆数据库 <span>${cableCatalog.length} 条</span></button>
      <button role="tab" aria-selected="false" data-cable-tab="awg">中美线规对照表 <span>${awgCatalog.length} 条</span></button>
    </div>
    <div class="cable-pane" data-cable-pane="calculator">
      <div class="busbar-source-note cable-source-note"><b>计算口径</b><span>基础载流量、输入条件和推荐逻辑均来自 B-电缆选型-A00；修正系数采用 GB 50217-2018 表 D.0.5、D.0.6。</span></div>
      <div class="platform-form-grid cols-4 cable-inputs">
        <label>电缆类型<select id="cable-type"><option>BV、BVR型(铜芯)</option><option selected>${typeYj}</option></select></label>
        <label>芯数<select id="cable-core-count"><option>单芯</option><option>三芯/五芯</option></select></label>
        <label>敷设方式<select id="cable-installation" disabled><option>明敷</option></select></label>
        <label>环境温度(℃)<select id="cable-ambient"><option>25</option><option>30</option><option selected>35</option><option>40</option></select></label>
        <label>负载电流(A)<input id="cable-current" type="number" min="1" max="1600" step="1" value="400"></label>
        <label>并联根数<select id="cable-parallel-count"><option>1</option><option>2</option><option selected>3</option><option>4</option></select></label>
        <label>并列根数（S=d）<select id="cable-group-count"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option selected>6</option></select><small id="cable-group-hint" class="cable-field-hint"></small></label>
        <label>电源系统<select id="cable-system"><option>交流</option><option>直流</option></select></label>
        <label>单芯排列方式<select id="cable-arrangement"><option>品字形</option><option>水平形</option><option>不考虑</option></select></label>
        <label>桥架类别<select id="cable-tray-type"><option>梯架</option><option>托盘</option></select></label>
        <label>叠置电缆层数<select id="cable-stacked-layers"><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
        <div class="cable-factor-preview" id="cable-factor-preview" aria-live="polite"></div>
      </div>
      <button id="calculate-cable" class="platform-primary-action">计算推荐线径</button>
      <div id="cable-result" class="cable-result" aria-live="polite"></div>
      <p class="engineering-warning">⚠ 空气中单层并列系数不适用于三相交流系统单芯电缆；超过 1600A 建议采用密集母线。最终选型仍需校核电压降、短路热稳定和实际敷设条件。</p>
    </div>
    <div class="cable-pane" data-cable-pane="correction" hidden>
      <div class="reference-table-intro"><b>GB 50217-2018 修正系数</b><span>完整保留工作簿中的表 D.0.5 与表 D.0.6，便于核对当前计算采用的系数。</span></div>
      <div class="correction-table-grid">
        <section class="reference-table-card">
          <header><div><h2>表 D.0.5</h2><p>空气中单层并列时的载流量校正系数</p></div><span>电缆根数</span></header>
          <div class="data-entry-table reference-data-table compact-table"><table>
            <thead><tr><th>中心间距</th>${airColumns.map(value => `<th>${value}</th>`).join('')}</tr></thead>
            <tbody>${Object.entries(CABLE_AIR_SPACING_FACTORS).map(([spacing, factors]) => `<tr><td><b>${spacing}</b></td>${airColumns.map(value => `<td>${format(factors[value], 2)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
          <p class="busbar-table-footnote">S 为电缆中心间距，d 为电缆外径；不适用于三相交流系统单芯电缆。</p>
        </section>
        <section class="reference-table-card">
          <header><div><h2>表 D.0.6</h2><p>梯架或托盘多层并列时的载流量校正系数</p></div><span>叠置层数</span></header>
          <div class="data-entry-table reference-data-table compact-table"><table>
            <thead><tr><th>桥架类型</th>${trayColumns.map(value => `<th>${value}</th>`).join('')}</tr></thead>
            <tbody>${Object.entries(CABLE_TRAY_LAYER_FACTORS).map(([tray, factors]) => `<tr><td><b>${tray}</b></td>${trayColumns.map(value => `<td>${format(factors[value], 2)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
          <p class="busbar-table-footnote">适用于水平状并列的电缆数量不少于 7 根。</p>
        </section>
      </div>
    </div>
    <div class="cable-pane" data-cable-pane="catalog" hidden>
      <div class="reference-data-toolbar cable-catalog-toolbar">
        <label>电缆类型<select id="cable-catalog-type"><option value="">全部类型</option><option>BV、BVR型(铜芯)</option><option>${typeYj}</option></select></label>
        <label>芯数<select id="cable-catalog-core"><option value="">全部芯数</option><option>单芯</option><option>三芯/五芯</option></select></label>
        <label>环境温度<select id="cable-catalog-ambient"><option value="">全部温度</option><option value="25">25℃</option><option value="30">30℃</option><option value="35">35℃</option><option value="40">40℃</option></select></label>
        <label>排列方式<select id="cable-catalog-arrangement"><option value="">全部排列</option><option>不考虑</option><option>品字形</option><option>水平形</option></select></label>
        <label class="reference-search">快速筛选<input id="cable-catalog-search" placeholder="输入线径、类型或排列方式"></label>
        <div class="reference-table-summary" id="cable-catalog-summary"></div>
      </div>
      <div class="data-entry-table reference-data-table cable-database-table"><table>
        <thead><tr><th>电缆类型</th><th>芯数</th><th>敷设方式</th><th>环境温度(℃)</th><th>允许载流量(A)</th><th>线径(mm²)</th><th>排列方式</th></tr></thead>
        <tbody id="cable-catalog-body"></tbody>
      </table></div>
      <p class="busbar-table-footnote">此处展示工作簿的基础载流量数据；实际推荐结果还会叠加并联根数、并列根数或桥架叠层修正系数。</p>
    </div>
    <div class="cable-pane" data-cable-pane="awg" hidden>
      <div class="awg-query">
        <label>美国线规线号（AWG）<select id="awg-size">${awgCatalog.map(item => `<option value="${htmlEscape(item.awg)}">${htmlEscape(item.awg)}</option>`).join('')}</select></label>
        <button id="query-awg" class="primary">查询线规</button>
      </div>
      <div id="awg-result" class="result-grid"></div>
      <div class="reference-data-toolbar awg-catalog-toolbar">
        <label class="reference-search">快速筛选<input id="awg-catalog-search" placeholder="输入 AWG 线号、线径或截面积"></label>
        <div class="reference-table-summary" id="awg-catalog-summary"></div>
      </div>
      <div class="data-entry-table reference-data-table awg-database-table"><table>
        <thead><tr><th>AWG线号</th><th>美国线径(mm)</th><th>中国线径(mm)</th><th>截面积(mm²)</th><th>阻值(Ω/km)</th><th>正常载流量(A)</th><th>最大载流量(A)</th></tr></thead>
        <tbody id="awg-catalog-body"></tbody>
      </table></div>
      <p class="busbar-table-footnote">线径、截面积、阻值及载流量来自 B-电缆选型-A00 的“中美线规对照表”。</p>
    </div>`);
}

function busbarView() {
  return viewPanel('busbar', '铜排计算', '按负载电流选择规格，或按已知铜排规格进行独立热平衡估算。', `
    <div class="engineering-tabs busbar-tabs" role="tablist" aria-label="铜排工具">
      <button class="active" role="tab" aria-selected="true" data-busbar-tab="selection">按电流选铜排</button>
      <button role="tab" aria-selected="false" data-busbar-tab="ampacity">按规格算载流量</button>
      <button role="tab" aria-selected="false" data-busbar-tab="catalog">载流量数据表 <span>${busbarCatalog.length} 条</span></button>
    </div>
    <div class="busbar-pane" data-busbar-pane="selection">
      <div class="busbar-source-note"><b>计算口径</b><span>基础载流量来自 DIN43671-1975，环境温度 35°C；A03 工作簿中的温升、安装环境和表面处理规则均已保留。</span></div>
      <div class="platform-form-grid cols-4 busbar-inputs">
        <label>负载电流(A)<input id="busbar-load-current" type="number" min="1" max="20000" step="1" value="1600"></label>
        <label>安装环境<select id="busbar-environment"><option value="ventilated">通风</option><option value="sealed">IP54 / 密封</option></select></label>
        <label>表面处理<select id="busbar-surface"><option value="bare-or-tinned">光裸 / 全镀锡</option><option value="heat-shrink">热缩套管</option></select></label>
        <label>选型温升口径<select id="busbar-temperature-rise"><option value="iec50">A03 修正口径 (50K)</option><option value="din30">DIN 基准口径 (30K)</option></select></label>
      </div>
      <div class="busbar-formula-strip" aria-label="计算说明">
        <span><b>最佳规格</b> 全表取满足需求的最接近规格</span>
        <span><b>主母线优先</b> 单片 → 双拼 → 三拼 → 四拼</span>
        <span><b>A03 50K修正</b> 通风 1.3，密封 1.0</span>
        <span><b>PE截面</b> 按 S、16、S/2 或 S/4</span>
      </div>
      <button id="calculate-busbar" class="platform-primary-action">计算铜排配置</button>
      <div id="busbar-result" class="busbar-result" aria-live="polite"></div>
    </div>
    <div class="busbar-pane" data-busbar-pane="ampacity" hidden>
      <div class="busbar-source-note"><b>公式来源</b><span>依据《铜排载流量工程计算器-A00.xlsx》的单片铜排热平衡模型；默认按外部环境 35℃、工程控制温升 70K，自动得到铜排最高温度 105℃。标准提示按现行 GB/T 7251.1-2023、GB/T 24276-2025 更新；结果用于工程估算，不替代成套温升试验。</span></div>
      <div class="busbar-ampacity-scope">
        <b>温升口径</b>
        <span>70K 是铜排相对外部环境的工程控制温升：35 + 70 = 105℃。若柜内空气比房间再高 15K，则柜内空气为 50℃，铜排对柜内空气的有效散热温差为 105 − 50 = 55K；它与 DIN 表的 30K 查表条件不是同一个量。</span>
      </div>
      <div class="platform-form-grid cols-4 busbar-inputs busbar-ampacity-inputs">
        <label>铜排宽度 (mm)<input id="busbar-ampacity-width" type="number" min="1" max="500" step="1" value="120"></label>
        <label>铜排厚度 (mm)<input id="busbar-ampacity-thickness" type="number" min="0.5" max="100" step="0.5" value="10"></label>
        <label>外部环境温度 (℃)<input id="busbar-ampacity-room-temperature" type="number" min="-50" max="100" step="1" value="35"><small>GB/T 7251 常用基准环境温度</small></label>
        <label>工程控制温升 (K)<input id="busbar-ampacity-rise-limit" type="number" min="1" max="105" step="1" value="70"><small>相对外部环境；项目默认采用 70K</small></label>
        <label>铜排最高温度 (℃)<input id="busbar-ampacity-maximum-temperature" type="number" value="105" readonly><small>外部环境温度 + 工程控制温升（自动计算）</small></label>
        <label>柜内空气温升 (K)<input id="busbar-ampacity-internal-rise" type="number" min="0" max="100" step="1" value="15"><small>密闭柜体 Excel 默认 15K；开放空气可填 0K</small></label>
        <label>电流类型<select id="busbar-ampacity-current-type"><option value="dc">直流 / 忽略交流附加损耗</option><option value="ac">交流（使用修正系数）</option></select></label>
        <label>设计裕量系数<select id="busbar-ampacity-design-factor"><option value="0.7">70%</option><option value="0.8" selected>80%（Excel默认）</option><option value="0.9">90%</option><option value="1">100%（无裕量）</option></select></label>
        <label>DIN同规格对照<select id="busbar-ampacity-din-reference"><option value="bareCurrentA">裸排载流量</option><option value="coatedCurrentA">涂层载流量</option></select></label>
      </div>
      <details class="busbar-advanced">
        <summary>高级热工参数 <span>默认值来自原 Excel，可展开查看和修改</span></summary>
        <div class="platform-form-grid cols-3 compact">
          <label>表面状态 / 发射率<select id="busbar-ampacity-surface-mode"><option value="excel">Excel原始默认（状态未注明，ε=0.35）</option><option value="bright-tin">新亮镀锡参考（ε=0.06）</option><option value="custom">自定义发射率</option></select><small>发射率随表面氧化、粗糙度和温度变化</small></label>
          <label>计算采用的发射率 ε<input id="busbar-ampacity-emissivity" type="number" min="0" max="1" step="0.01" value="0.35" disabled><small>选择“自定义”后可直接输入</small></label>
          <label>对流换热系数 h<input id="busbar-ampacity-convection" type="number" min="0.1" max="100" step="0.1" value="5"><small>W/(m²·K)，属于工程假设</small></label>
          <label>20℃铜电阻率 ρ₂₀<input id="busbar-ampacity-resistivity" type="number" min="0" max="0.000001" step="0.0000000001" value="0.0000000172"><small>Ω·m</small></label>
          <label>电阻温度系数 α<input id="busbar-ampacity-temperature-coefficient" type="number" min="0" max="0.02" step="0.00001" value="0.00393"><small>/℃</small></label>
          <label>交流电阻修正系数<input id="busbar-ampacity-ac-factor" type="number" min="1" max="5" step="0.01" value="1" disabled><small>1.00 表示尚未计入交流附加损耗</small></label>
        </div>
      </details>
      <div class="busbar-method-strip" aria-label="规格反算方法">
        <span><b>最高温度</b> 外部环境 + 工程控制温升</span>
        <span><b>柜内空气温度</b> 外部环境 + 柜内空气温升</span>
        <span><b>散热能力</b> 对流散热 + 辐射散热</span>
        <span><b>热平衡电流</b> √(总散热 ÷ 每米电阻)</span>
        <span><b>建议电流</b> 热平衡电流 × 设计裕量</span>
      </div>
      <button id="calculate-busbar-ampacity" class="platform-primary-action">按规格计算载流量</button>
      <div id="busbar-ampacity-result" class="busbar-result busbar-ampacity-result" aria-live="polite"></div>
    </div>
    <div class="busbar-pane" data-busbar-pane="catalog" hidden>
      <div class="busbar-catalog-toolbar">
        <label>结构形式<select id="busbar-catalog-configuration"><option value="">全部结构</option><option>单片</option><option>双拼</option><option>三拼</option><option>四拼</option></select></label>
        <label>快速筛选<input id="busbar-catalog-search" placeholder="输入 80 x 10、插值等关键词"></label>
        <div class="busbar-table-summary" id="busbar-table-summary"></div>
      </div>
      <div class="data-entry-table busbar-data-table"><table>
        <thead><tr><th>ID</th><th>规格名称</th><th>配置</th><th>涂层载流(A)</th><th>裸排载流(A)</th><th>截面积(mm²)</th><th>备注</th></tr></thead>
        <tbody id="busbar-catalog-body"></tbody>
      </table></div>
      <p class="busbar-table-footnote">数据口径：DIN43671-1975，允许温升 30K，环境温度 35°C。标注“根据插入法计算”的规格为 A03 原表插值数据。</p>
    </div>
    <p class="engineering-warning">⚠ 铜排间距、相间距、柜内温升、短路耐受能力和实际散热条件仍需结合成套结构复核；大于等于 4000A 时必须专项校核 Icw。</p>`);
}

function buswayView() {
  return viewPanel('busway', '母线系统', '按两排机柜布局估算母线长度、始端箱、插接箱及安装附件。', `
    <div class="busway-row-grid">
      ${[1, 2].map(row => `<fieldset><legend>第 ${row} 排</legend><label>600mm机柜<input id="bw-r${row}-600" type="number" value="10"></label><label>800mm机柜<input id="bw-r${row}-800" type="number" value="0"></label><label>300mm空调<input id="bw-r${row}-ac300" type="number" value="0"></label><label>600mm空调<input id="bw-r${row}-ac600" type="number" value="2"></label></fieldset>`).join('')}
    </div>
    <div class="platform-form-grid cols-2 compact"><label>安装方式<select id="bw-installation"><option value="cabinet-top">柜顶安装</option><option value="ceiling">吊装</option></select></label><label class="checkbox-field"><input id="bw-touchscreen" type="checkbox"> 配置触摸屏</label></div>
    <button id="calculate-smart-busway" class="platform-primary-action">生成配置估算</button><div id="smart-busway-result" class="result-grid"></div>
    <p class="engineering-warning">⚠ ${ENGINEERING_WARNING}</p>`);
}

function powerQualityView() {
  return viewPanel('power-quality', '电能质量', 'APF 谐波电流和 SVG 无功补偿容量独立校核。', `
    <div class="quality-grid"><fieldset><legend>APF 容量</legend>
      <label>变压器容量(kVA)<input id="apf-transformer" type="number" value="1250"></label><label>负载率<input id="apf-load-rate" type="number" step="0.05" value="0.8"></label><label>THDi（小数）<input id="apf-thdi" type="number" step="0.01" value="0.3"></label>
    </fieldset><fieldset><legend>SVG 容量</legend>
      <label>有功功率(kW)<input id="svg-power" type="number" value="800"></label><label>当前功率因数<input id="svg-pf-before" type="number" step="0.01" value="0.8"></label><label>目标功率因数<input id="svg-pf-target" type="number" step="0.01" value="0.95"></label>
    </fieldset></div><button id="calculate-power-quality" class="platform-primary-action">计算 APF / SVG</button><div id="power-quality-result" class="result-grid"></div>
    <p class="engineering-warning">⚠ 谐波源类型、频谱、变压器短路阻抗和系统谐振风险需由电能质量检测或仿真复核。</p>`);
}

function deliveryView() {
  return viewPanel('delivery', '编码与交付', '从当前项目生成统一汇总；商务成本输出只保留空白格式，不带任何内置价格。', `
    <div class="delivery-actions"><button id="export-project-excel" class="primary">导出项目标准 Excel</button><button data-platform-view="templates">查看模板治理状态</button></div>
    <div id="delivery-summary" class="delivery-summary"></div>
    <div class="empty-price-note"><b>商务成本口径</b><p>平台不会内置目录价、供应商价或历史成交价。导出表中的价格列为空，由用户在本机填写。</p></div>`);
}

function templatesView() {
  return viewPanel('templates', '模板中心', '原始工具只用于核对。公开构建仅允许经过版本确认、脱敏和安全检查的模板。', `
    <div class="template-policy">发布检查：隐藏工作表、宏、外部链接、定义名称、残留价格和供应商信息。未通过时不提供下载。</div>
    <div class="data-entry-table"><table><thead><tr><th>业务能力</th><th>当前核对版本</th><th>迁移状态</th><th>公开发布</th></tr></thead><tbody>${TEMPLATE_CATALOG.map(item => `<tr><td>${item.category}</td><td>${item.current}${item.note ? `<small>${item.note}</small>` : ''}</td><td>${item.migration}</td><td><span class="publish-state ${item.publish ? 'yes' : 'no'}">${item.publish ? '已批准' : '不发布原件'}</span></td></tr>`).join('')}</tbody></table></div>`);
}

function shellViews() {
  return [projectView(), toolsView(), loadView(), cableView(), busbarView(), buswayView(), powerQualityView(), deliveryView(), templatesView()].join('');
}

function resultCards(items) {
  return items.map(item => `<div><small>${item[0]}</small><strong>${item[1]}</strong><em>${item[2] || ''}</em></div>`).join('');
}

async function loadCatalogs() {
  state.catalogs = {
    busbars: busbarCatalog,
    cables: cableCatalog,
    awg: awgCatalog
  };
}

function addLoadRow(row = {}) {
  const tbody = document.getElementById('load-rows');
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input data-field="name" value="${htmlEscape(row.name || '')}" placeholder="如 IT机柜"></td>
    <td><input data-field="quantity" type="number" min="0" value="${row.quantity ?? 1}"></td>
    <td><input data-field="unitPowerKw" type="number" min="0" step="0.1" value="${row.unitPowerKw ?? 10}"></td>
    <td><input data-field="demandFactor" type="number" min="0" max="1" step="0.05" value="${row.demandFactor ?? 1}"></td>
    <td><input data-field="powerFactor" type="number" min="0.01" max="1" step="0.01" value="${row.powerFactor ?? 0.9}"></td>
    <td><button class="row-remove" title="删除">×</button></td>`;
  tr.querySelector('.row-remove').addEventListener('click', () => tr.remove());
  tbody.appendChild(tr);
}

function readLoadRows() {
  return [...document.querySelectorAll('#load-rows tr')].map(tr => Object.fromEntries(
    [...tr.querySelectorAll('[data-field]')].map(input => [input.dataset.field, input.type === 'number' ? Number(input.value) : input.value])
  ));
}

function fillProjectForm() {
  const project = state.project;
  if (!project) return;
  document.getElementById('project-name').value = project.name || '';
  document.getElementById('project-customer').value = project.info?.customer || '';
  document.getElementById('project-location').value = project.info?.location || '';
  document.getElementById('project-stage').value = project.info?.stage || '方案设计';
  document.getElementById('project-designer').value = project.info?.designer || '';
  document.getElementById('project-redundancy').value = project.topology?.redundancy || 'N+1';
  document.getElementById('load-voltage').value = project.topology?.voltage || 380;
  const tbody = document.getElementById('load-rows');
  tbody.innerHTML = '';
  const rows = project.loads?.rows?.length ? project.loads.rows : [
    { name: 'IT机柜', quantity: 20, unitPowerKw: 10, demandFactor: 0.9, powerFactor: 0.9 },
    { name: '精密空调', quantity: 4, unitPowerKw: 20, demandFactor: 0.8, powerFactor: 0.85 }
  ];
  rows.forEach(addLoadRow);
  updateDashboard();
  renderDeliverySummary();
}

function collectProjectForm() {
  state.project.name = document.getElementById('project-name').value.trim() || '未命名项目';
  state.project.info = {
    ...state.project.info,
    customer: document.getElementById('project-customer').value.trim(),
    location: document.getElementById('project-location').value.trim(),
    stage: document.getElementById('project-stage').value,
    designer: document.getElementById('project-designer').value.trim()
  };
  state.project.topology = {
    ...state.project.topology,
    voltage: numberValue('load-voltage', 380),
    redundancy: document.getElementById('project-redundancy').value
  };
  state.project.loads.rows = readLoadRows();
  try { state.project.legacy.ups_config = JSON.parse(localStorage.getItem('ups_config') || 'null'); } catch { /* retain prior */ }
  return state.project;
}

async function refreshProjectSelect() {
  const select = document.getElementById('platform-project-select');
  const projects = await listProjects();
  select.innerHTML = projects.map(project => `<option value="${project.id}">${htmlEscape(project.name)}</option>`).join('');
  select.value = state.project.id;
}

function updateDashboard() {
  const summary = state.project?.loads?.summary;
  const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  set('dashboard-active-power', summary ? format(summary.activePowerKw) : '—');
  set('dashboard-apparent-power', summary ? format(summary.apparentPowerKva) : '—');
  set('dashboard-current', summary ? format(summary.designCurrentA) : '—');
  set('dashboard-transformer', summary?.transformerKva || '—');
}

function renderDeliverySummary() {
  const element = document.getElementById('delivery-summary');
  if (!element || !state.project) return;
  const summary = state.project.loads?.summary;
  element.innerHTML = `<h2>${htmlEscape(state.project.name)}</h2><dl>
    <div><dt>客户</dt><dd>${htmlEscape(state.project.info?.customer || '未填写')}</dd></div>
    <div><dt>阶段</dt><dd>${htmlEscape(state.project.info?.stage || '—')}</dd></div>
    <div><dt>冗余</dt><dd>${htmlEscape(state.project.topology?.redundancy || '—')}</dd></div>
    <div><dt>负荷</dt><dd>${summary ? `${format(summary.activePowerKw)} kW / ${format(summary.apparentPowerKva)} kVA` : '尚未计算'}</dd></div>
    <div><dt>变压器建议</dt><dd>${summary?.transformerKva ? `${summary.transformerKva} kVA` : '尚未计算'}</dd></div>
  </dl>`;
}

function syncProjectToView(view) {
  const summary = state.project?.loads?.summary;
  if (!summary) return;
  if (view === 'battery') {
    const loadInput = document.getElementById('unified-load-kw');
    if (loadInput && !String(loadInput.value || '').trim()) {
      loadInput.value = Number(summary.activePowerKw.toFixed(2));
      loadInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  if (view === 'power-quality') {
    const transformer = document.getElementById('apf-transformer');
    const power = document.getElementById('svg-power');
    if (transformer && summary.transformerKva) transformer.value = summary.transformerKva;
    if (power) power.value = Number(summary.activePowerKw.toFixed(2));
  }
  if (view === 'load') {
    const buswayPower = document.getElementById('busway-power');
    if (buswayPower) buswayPower.value = Number(summary.activePowerKw.toFixed(2));
  }
}

async function activateView(view) {
  state.activeView = view;
  document.querySelectorAll('.platform-view').forEach(panel => { panel.hidden = true; });
  document.querySelectorAll('.platform-nav-item').forEach(button => button.classList.toggle('active', button.dataset.platformView === view));
  if (LEGACY_VIEWS.has(view)) {
    window.showMainTab?.(view);
  } else {
    window.showMainTab?.('__platform');
    const panel = document.getElementById(`platform-view-${view}`);
    if (panel) panel.hidden = false;
  }
  if (view === 'delivery') renderDeliverySummary();
  syncProjectToView(view);
  if (window.innerWidth < 900) document.body.classList.remove('platform-sidebar-open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function calculateLoad() {
  const summary = calculateLoadSummary(readLoadRows(), {
    voltage: numberValue('load-voltage', 380), safety: numberValue('load-safety', 1.2), transformerLoadRate: numberValue('load-transformer-rate', 0.8)
  });
  state.project.loads = { rows: summary.rows.map(({ activePowerKw, reactivePowerKvar, index, ...row }) => row), summary };
  state.project.topology.voltage = summary.voltage;
  document.getElementById('load-result').innerHTML = resultCards([
    ['有功负荷', format(summary.activePowerKw), 'kW'], ['无功负荷', format(summary.reactivePowerKvar), 'kvar'],
    ['视在功率', format(summary.apparentPowerKva), 'kVA'], ['计算电流', format(summary.currentA), 'A'],
    ['设计电流', format(summary.designCurrentA), 'A'], ['建议断路器', summary.breakerA || '超出表列', summary.breakerA ? 'A' : ''],
    ['所需变压器容量', format(summary.transformerRequiredKva), 'kVA'], ['建议变压器', summary.transformerKva || '超出表列', summary.transformerKva ? 'kVA' : '']
  ]);
  updateDashboard();
  renderDeliverySummary();
}

function calculateDistribution() {
  const branch = calculateBranch({ powerKw: numberValue('branch-power'), phase: document.getElementById('branch-phase').value, powerFactor: numberValue('branch-pf', 0.9), safety: numberValue('branch-safety', 1.2), voltage: document.getElementById('branch-phase').value === 'single' ? 220 : 380 });
  const busway = calculateBusway({ activePowerKw: numberValue('busway-power'), powerFactor: numberValue('branch-pf', 0.9), demandFactor: numberValue('busway-demand', 0.9), safety: numberValue('branch-safety', 1.2), harmonicFactor: numberValue('busway-harmonic', 1) });
  state.project.distribution = { branch, busway };
  document.getElementById('distribution-result').innerHTML = resultCards([
    ['支路计算电流', format(branch.baseCurrentA), 'A'], ['支路设计电流', format(branch.designCurrentA), 'A'], ['建议断路器', branch.breakerA || '超出表列', branch.breakerA ? 'A' : ''],
    ['母线计算电流', format(busway.currentA), 'A'], ['母线设计电流', format(busway.designCurrentA), 'A'], ['建议母线规格', busway.buswayA || '超出表列', busway.buswayA ? 'A' : '']
  ]);
}

function readCableInput() {
  return {
    type: document.getElementById('cable-type').value,
    coreCount: document.getElementById('cable-core-count').value,
    installation: '明敷',
    ambientC: numberValue('cable-ambient', 35),
    requiredCurrentA: numberValue('cable-current'),
    parallelCount: numberValue('cable-parallel-count', 1),
    groupCount: numberValue('cable-group-count', 1),
    system: document.getElementById('cable-system').value,
    arrangement: document.getElementById('cable-arrangement').value,
    trayType: document.getElementById('cable-tray-type').value,
    stackedLayers: numberValue('cable-stacked-layers', 1)
  };
}

function updateCableControls() {
  const type = document.getElementById('cable-type').value;
  const system = document.getElementById('cable-system').value;
  const core = document.getElementById('cable-core-count');
  const arrangement = document.getElementById('cable-arrangement');
  const groupCount = document.getElementById('cable-group-count');
  const trayType = document.getElementById('cable-tray-type');
  const layers = numberValue('cable-stacked-layers', 1);
  const mustUseSingleCore = type === 'BV、BVR型(铜芯)' || system === '直流';
  if (mustUseSingleCore) core.value = '单芯';
  core.disabled = mustUseSingleCore;
  const usesArrangement = type === 'YJV、YJLV、YJY、YJLY型(铜芯)' && core.value === '单芯';
  if (!usesArrangement) arrangement.value = '不考虑';
  arrangement.disabled = !usesArrangement;
  const usesAirFactor = layers === 1 && (system === '直流' || (system === '交流' && core.value === '三芯/五芯'));
  groupCount.disabled = false;
  trayType.disabled = usesAirFactor;
  document.getElementById('cable-group-hint').textContent = usesAirFactor
    ? '当前参与空气中单层并列修正'
    : '可按原表选择；当前条件不采用并列系数';
  const preview = calculateCableSelection(state.catalogs.cables, { ...readCableInput(), requiredCurrentA: 1 });
  document.getElementById('cable-factor-preview').innerHTML = `<span>当前修正系数</span><strong>${format(preview.correctionFactor, 2)}</strong><small>${htmlEscape(preview.correctionMode || '—')}</small>`;
}

function calculateCable() {
  const calculation = calculateCableSelection(state.catalogs.cables, readCableInput());
  const result = document.getElementById('cable-result');
  if (calculation.error) {
    result.innerHTML = `<div class="no-result"><b>${htmlEscape(calculation.error)}</b>${calculation.maximumCurrentA ? `<span>当前组合最大修正载流量：${format(calculation.maximumCurrentA)}A。</span>` : ''}${calculation.useBusway ? '<button type="button" data-platform-view="busway">前往母线系统</button>' : ''}</div>`;
    return;
  }
  state.project.cables = { input: readCableInput(), calculation };
  const loadClass = calculation.loadRate > 0.92 ? 'warning' : 'safe';
  result.innerHTML = `
    <div class="cable-result-hero">
      <div class="cable-best-size"><span>推荐线径</span><strong>${format(calculation.selected.size, 1)} mm²</strong><small>${calculation.parallelCount} 根并联 · ${htmlEscape(calculation.coreCount)}</small></div>
      <div><span>单根基础载流量</span><strong>${format(calculation.baseCurrentA, 1)} A</strong><small>${calculation.ambientC}℃ · ${htmlEscape(calculation.arrangement)}</small></div>
      <div><span>载流量修正系数</span><strong>${format(calculation.correctionFactor, 2)}</strong><small>${htmlEscape(calculation.correctionMode)}</small></div>
      <div class="cable-load-gauge ${loadClass}"><span>修正后总载流量</span><strong>${format(calculation.correctedCurrentA, 1)} A</strong><small>负载率 ${format(calculation.loadRate * 100, 1)}%</small></div>
    </div>
    <div class="cable-result-detail">
      <span><b>电缆类型</b>${htmlEscape(calculation.type)}</span>
      <span><b>允许长期工作温度</b>${calculation.workingTemperatureC}℃</span>
      <span><b>电源与敷设</b>${htmlEscape(calculation.system)} · ${htmlEscape(calculation.installation)}</span>
      <span><b>桥架条件</b>${htmlEscape(calculation.trayType)} · ${calculation.stackedLayers} 层</span>
    </div>`;
}

function renderAwgResult() {
  const value = document.getElementById('awg-size').value;
  const item = state.catalogs.awg.find(row => String(row.awg) === value);
  document.getElementById('awg-result').innerHTML = item ? resultCards([
    ['美国线径', format(item.diameterMm, 3), 'mm'],
    ['中国线径', item.cwgDiameterMm === '/' ? '—' : format(item.cwgDiameterMm, 3), 'mm'],
    ['截面积', format(item.areaMm2, 4), 'mm²'],
    ['阻值', format(item.resistanceOhmKm, 4), 'Ω/km'],
    ['正常载流量', format(item.normalCurrentA, 3), 'A'],
    ['最大载流量', format(item.maximumCurrentA, 3), 'A']
  ]) : '<div class="no-result">没有找到对应线规数据。</div>';
}

function renderCableCatalog() {
  const body = document.getElementById('cable-catalog-body');
  if (!body) return;
  const type = document.getElementById('cable-catalog-type')?.value || '';
  const core = document.getElementById('cable-catalog-core')?.value || '';
  const ambient = document.getElementById('cable-catalog-ambient')?.value || '';
  const arrangement = document.getElementById('cable-catalog-arrangement')?.value || '';
  const query = (document.getElementById('cable-catalog-search')?.value || '').trim().toLowerCase();
  const rows = state.catalogs.cables.filter(item => {
    if (type && item.type !== type) return false;
    if (core && item.coreCount !== core) return false;
    if (ambient && String(item.ambientC) !== ambient) return false;
    if (arrangement && item.arrangement !== arrangement) return false;
    const searchText = `${item.type} ${item.coreCount} ${item.installation} ${item.ambientC} ${item.currentA} ${item.size} ${item.arrangement}`.toLowerCase();
    return !query || searchText.includes(query);
  });
  body.innerHTML = rows.map(item => `<tr><td>${htmlEscape(item.type)}</td><td>${htmlEscape(item.coreCount)}</td><td>${htmlEscape(item.installation)}</td><td>${format(item.ambientC, 0)}</td><td><b>${format(item.currentA, 0)}</b></td><td><b>${format(item.size, 1)}</b></td><td>${htmlEscape(item.arrangement)}</td></tr>`).join('');
  document.getElementById('cable-catalog-summary').textContent = `显示 ${rows.length} / ${state.catalogs.cables.length} 条`;
}

function renderAwgCatalog() {
  const body = document.getElementById('awg-catalog-body');
  if (!body) return;
  const query = (document.getElementById('awg-catalog-search')?.value || '').trim().toLowerCase();
  const rows = state.catalogs.awg.filter(item => {
    const searchText = `${item.awg} ${item.diameterMm} ${item.cwgDiameterMm} ${item.areaMm2} ${item.resistanceOhmKm} ${item.normalCurrentA} ${item.maximumCurrentA}`.toLowerCase();
    return !query || searchText.includes(query);
  });
  body.innerHTML = rows.map(item => `<tr><td><b>${htmlEscape(item.awg)}</b></td><td>${format(item.diameterMm, 3)}</td><td>${item.cwgDiameterMm === '/' ? '—' : format(item.cwgDiameterMm, 3)}</td><td>${format(item.areaMm2, 4)}</td><td>${format(item.resistanceOhmKm, 4)}</td><td>${format(item.normalCurrentA, 3)}</td><td>${format(item.maximumCurrentA, 3)}</td></tr>`).join('');
  document.getElementById('awg-catalog-summary').textContent = `显示 ${rows.length} / ${state.catalogs.awg.length} 条`;
}

function renderBusbarCatalog() {
  const body = document.getElementById('busbar-catalog-body');
  if (!body) return;
  const configuration = document.getElementById('busbar-catalog-configuration')?.value || '';
  const query = (document.getElementById('busbar-catalog-search')?.value || '').trim().toLowerCase();
  const rows = state.catalogs.busbars.filter(item => {
    if (configuration && item.configuration !== configuration) return false;
    const searchText = `${item.spec} ${item.configuration} ${item.note || ''}`.toLowerCase();
    return !query || searchText.includes(query);
  });
  body.innerHTML = rows.map(item => {
    const sourceIndex = state.catalogs.busbars.indexOf(item) + 1;
    return `<tr><td>${sourceIndex}</td><td><b>${htmlEscape(item.spec)}</b></td><td>${htmlEscape(item.configuration)}</td><td>${format(item.coatedCurrentA, 0)}</td><td>${format(item.bareCurrentA, 0)}</td><td>${format(item.areaMm2, 0)}</td><td>${htmlEscape(item.note || '标准实测数据')}</td></tr>`;
  }).join('');
  document.getElementById('busbar-table-summary').textContent = `显示 ${rows.length} / ${state.catalogs.busbars.length} 条`;
}

function calculateBusbar() {
  const result = calculateBusbarSelection(state.catalogs.busbars, {
    loadCurrentA: numberValue('busbar-load-current'),
    installationEnvironment: document.getElementById('busbar-environment').value,
    surfaceTreatment: document.getElementById('busbar-surface').value,
    temperatureRise: document.getElementById('busbar-temperature-rise').value
  });
  const target = document.getElementById('busbar-result');
  if (result.error) {
    target.innerHTML = `<div class="no-result"><b>${htmlEscape(result.error)}</b>${result.lookupCurrentA ? `<span>折算需求电流为 ${format(result.lookupCurrentA)}A。</span>` : ''}</div>`;
    return;
  }

  state.project.busbars = { ...state.project.busbars, calculation: result };
  const warningClass = result.loadRate > 1 ? 'danger' : result.loadRate > 0.92 ? 'warning' : 'safe';
  const priorityMatchesBest = result.prioritySelected?.spec === result.selected.spec;
  target.innerHTML = `
    <div class="busbar-result-hero">
      <div class="busbar-best-spec"><span>最佳规格</span><strong>${htmlEscape(result.selected.spec)}</strong><small>${htmlEscape(result.selected.configuration)} · 全表最接近需求</small></div>
      <div class="busbar-priority-spec"><span>主母线结构优先</span><strong>${htmlEscape(result.prioritySelected.spec)}</strong><small>${htmlEscape(result.prioritySelected.configuration)}${priorityMatchesBest ? ' · 与最佳规格相同' : ' · 按结构顺序推荐'}</small></div>
      <div class="busbar-capacity"><span>系统额定载流</span><strong>${format(result.ratedCurrentA, 0)} A</strong><small>${result.currentField === 'bareCurrentA' ? '裸排载流量列' : '涂层载流量列'}</small></div>
      <div class="busbar-load-gauge ${warningClass}"><span>负载率</span><strong>${format(result.loadRate * 100, 1)}%</strong><small>${htmlEscape(result.loadWarning)}</small></div>
    </div>
    <div class="result-grid busbar-result-grid">${resultCards([
      ['综合系数 K_Total', format(result.totalFactor, 2), ''],
      ['折算需求电流', format(result.lookupCurrentA), 'A'],
      ['铜排总截面', format(result.areaMm2, 0), 'mm²'],
      ['PE排推荐', format(result.peAreaMm2, 0), 'mm²']
    ])}</div>
    <div class="busbar-notices">
      <p class="${result.isInterpolated ? 'warning' : 'safe'}">${result.isInterpolated ? '该规格为 A03 原表插值计算数据，订货前请复核。' : '该规格为 A03 中的 DIN 原值数据。'}</p>
      <p class="${result.requiresShortCircuitCheck ? 'warning' : 'neutral'}">${result.requiresShortCircuitCheck ? '大电流达到 4000A 及以上，请务必校核短路耐受能力 Icw。' : '当前电流低于 4000A，仍需按项目短路电流复核。'}</p>
    </div>`;
}

function syncBusbarAmpacityControls() {
  const surfaceMode = document.getElementById('busbar-ampacity-surface-mode');
  const emissivity = document.getElementById('busbar-ampacity-emissivity');
  const currentType = document.getElementById('busbar-ampacity-current-type');
  const acFactor = document.getElementById('busbar-ampacity-ac-factor');
  const roomTemperature = document.getElementById('busbar-ampacity-room-temperature');
  const riseLimit = document.getElementById('busbar-ampacity-rise-limit');
  const maximumTemperature = document.getElementById('busbar-ampacity-maximum-temperature');
  if (!surfaceMode || !emissivity || !currentType || !acFactor) return;
  const surfacePresets = { excel: '0.35', 'bright-tin': '0.06' };
  const usesSurfacePreset = Object.hasOwn(surfacePresets, surfaceMode.value);
  if (usesSurfacePreset) emissivity.value = surfacePresets[surfaceMode.value];
  emissivity.disabled = usesSurfacePreset;
  const usesAcFactor = currentType.value === 'ac';
  if (!usesAcFactor) acFactor.value = '1';
  acFactor.disabled = !usesAcFactor;
  const derivedMaximum = Number(roomTemperature?.value) + Number(riseLimit?.value);
  if (maximumTemperature && Number.isFinite(derivedMaximum)) maximumTemperature.value = String(derivedMaximum);
}

function calculateBusbarAmpacityResult() {
  const surfaceModeElement = document.getElementById('busbar-ampacity-surface-mode');
  const result = calculateBusbarAmpacity(state.catalogs.busbars, {
    widthMm: numberValue('busbar-ampacity-width'),
    thicknessMm: numberValue('busbar-ampacity-thickness'),
    roomTemperatureC: numberValue('busbar-ampacity-room-temperature'),
    permittedTemperatureRiseK: numberValue('busbar-ampacity-rise-limit'),
    internalTemperatureRiseC: numberValue('busbar-ampacity-internal-rise'),
    maximumTemperatureC: numberValue('busbar-ampacity-maximum-temperature'),
    currentType: document.getElementById('busbar-ampacity-current-type').value,
    designFactor: numberValue('busbar-ampacity-design-factor'),
    dinReferenceField: document.getElementById('busbar-ampacity-din-reference').value,
    convectionCoefficient: numberValue('busbar-ampacity-convection'),
    emissivity: numberValue('busbar-ampacity-emissivity'),
    resistivity20OhmM: numberValue('busbar-ampacity-resistivity'),
    temperatureCoefficient: numberValue('busbar-ampacity-temperature-coefficient'),
    acResistanceFactor: numberValue('busbar-ampacity-ac-factor', 1)
  });
  const target = document.getElementById('busbar-ampacity-result');
  if (result.error) {
    target.innerHTML = `<div class="no-result"><b>${htmlEscape(result.error)}</b><span>请检查规格、温度和高级热工参数。</span></div>`;
    return;
  }

  const surfaceLabel = surfaceModeElement.selectedOptions[0]?.textContent || '自定义发射率';
  state.project.busbars = {
    ...state.project.busbars,
    ampacityCalculation: { ...result, surfaceMode: surfaceModeElement.value, surfaceLabel }
  };
  const dinLabel = result.dinReferenceField === 'coatedCurrentA' ? '涂层' : '裸排';
  const differenceClass = result.dinDifferencePercent === null
    ? 'neutral'
    : Math.abs(result.dinDifferencePercent) > 0.15 ? 'warning' : 'safe';
  const differenceText = result.dinDifferencePercent === null
    ? 'DIN数据表中没有完全相同的单片规格'
    : `${result.recommendedCurrentA >= result.dinCurrentA ? '高于' : '低于'}DIN ${dinLabel}数据 ${format(Math.abs(result.dinDifferencePercent) * 100, 1)}%`;
  const dinComparison = result.dinMatch
    ? `<div class="busbar-din-comparison ${differenceClass}">
        <div><span>DIN同规格</span><strong>${htmlEscape(result.dinMatch.spec)} · 单片</strong></div>
        <div><span>DIN ${dinLabel}载流量</span><strong>${format(result.dinCurrentA, 0)} A</strong></div>
        <div><span>模型建议值差异</span><strong>${htmlEscape(differenceText)}</strong></div>
        <p>两者温升、散热和表面条件不同，只用于交叉核对，不能互相替代。</p>
      </div>`
    : `<div class="busbar-din-comparison neutral"><p>${htmlEscape(differenceText)}；仍可使用热平衡结果，但无法完成DIN同规格对照。</p></div>`;

  target.innerHTML = `
    <div class="busbar-result-hero busbar-ampacity-hero">
      <div class="busbar-best-spec"><span>建议持续工作电流</span><strong>${format(result.recommendedCurrentA, 0)} A</strong><small>热平衡值 × ${format(result.designFactor * 100, 0)}%设计裕量</small></div>
      <div class="busbar-capacity"><span>热平衡估算载流量</span><strong>${format(result.thermalBalanceCurrentA, 0)} A</strong><small>不是经型式试验验证的额定值</small></div>
      <div><span>设计电流下估算温度</span><strong>${format(result.estimatedOperatingTemperatureC, 1)} ℃</strong><small>内部环境 ${format(result.internalAmbientTemperatureC, 1)}℃</small></div>
      <div><span>建议电流密度</span><strong>${format(result.currentDensityAmm2, 2)} A/mm²</strong><small>铜排截面 ${format(result.areaMm2, 0)}mm²</small></div>
    </div>
    <div class="result-grid busbar-result-grid busbar-ampacity-process">${resultCards([
      ['允许总温升', format(result.permittedTemperatureRiseK, 1), 'K'],
      ['对柜内空气散热温差', format(result.effectiveTemperatureRiseK, 1), 'K'],
      ['每米散热表面积', format(result.surfaceAreaM2PerM, 4), 'm²/m'],
      ['直流电阻', format(result.dcResistanceOhmPerM * 1000, 5), 'mΩ/m'],
      ['计算采用电阻', format(result.usedResistanceOhmPerM * 1000, 5), 'mΩ/m'],
      ['对流散热', format(result.convectionLossWPerM, 1), 'W/m'],
      ['辐射散热', format(result.radiationLossWPerM, 1), 'W/m'],
      ['总散热能力', format(result.totalDissipationWPerM, 1), 'W/m'],
      ['建议电流下损耗', format(result.designLossWPerM, 1), 'W/m']
    ])}</div>
    ${dinComparison}
    <details class="busbar-calculation-details">
      <summary>查看完整计算方法</summary>
      <div class="busbar-calculation-flow">
        <p><b>表面参数：</b>${htmlEscape(surfaceLabel)}；计算采用 ε=${format(result.emissivity, 2)}</p>
        <p><b>截面积：</b>${format(result.widthMm, 1)} × ${format(result.thicknessMm, 1)} = ${format(result.areaMm2, 1)}mm²</p>
        <p><b>铜排最高温度：</b>外部环境 ${format(result.roomTemperatureC, 1)}℃ + 工程控制温升 ${format(result.permittedTemperatureRiseK, 1)}K = ${format(result.maximumTemperatureC, 1)}℃</p>
        <p><b>柜内空气温度：</b>外部环境 ${format(result.roomTemperatureC, 1)}℃ + 柜内空气温升 ${format(result.internalTemperatureRiseC, 1)}K = ${format(result.internalAmbientTemperatureC, 1)}℃</p>
        <p><b>有效散热温差：</b>${format(result.maximumTemperatureC, 1)} − ${format(result.internalAmbientTemperatureC, 1)} = ${format(result.effectiveTemperatureRiseK, 1)}K</p>
        <p><b>对流散热：</b>h × As × ΔT = ${format(result.convectionLossWPerM, 2)}W/m</p>
        <p><b>辐射散热：</b>ε × σ × As × (Tmax⁴ − Tamb⁴) = ${format(result.radiationLossWPerM, 2)}W/m</p>
        <p><b>热平衡电流：</b>√[(Pconv + Prad) ÷ R] = ${format(result.thermalBalanceCurrentA, 2)}A</p>
        <p><b>建议持续电流：</b>${format(result.thermalBalanceCurrentA, 2)} × ${format(result.designFactor, 2)} = ${format(result.recommendedCurrentA, 2)}A</p>
      </div>
    </details>
    <div class="busbar-notices">
      <p class="neutral">70K 为本项目采用的工程控制口径，并非所有母线场景的统一限值；实际最高温度还应受端子、绝缘、连接件、相邻元件和验证条件中的最低限值约束。</p>
      <p class="warning">“内部温升、换热系数、发射率和设计裕量”均会显著影响结果，请按实际结构或验证数据填写。</p>
      <p class="${result.requiresAcVerification ? 'warning' : 'neutral'}">${result.requiresAcVerification ? '当前选择交流，但交流电阻修正系数仍为1.00，尚未计入集肤、邻近和谐波附加损耗。' : `当前采用${result.currentType === 'ac' ? `交流电阻系数 ${format(result.acResistanceFactor, 2)}` : '直流电阻'}进行计算。`}</p>
      <p class="${result.requiresShortCircuitCheck ? 'warning' : 'neutral'}">${result.requiresShortCircuitCheck ? '建议电流达到4000A及以上，必须专项校核短路耐受能力 Icw。' : '仍须结合项目短路电流、连接件和绝缘支撑条件校核。'}</p>
    </div>`;
}

function calculateBuswayConfig() {
  const row = index => ({ cabinets600: numberValue(`bw-r${index}-600`), cabinets800: numberValue(`bw-r${index}-800`), ac300: numberValue(`bw-r${index}-ac300`), ac600: numberValue(`bw-r${index}-ac600`) });
  const result = calculateSmartBusway({ row1: row(1), row2: row(2), installation: document.getElementById('bw-installation').value, touchscreen: document.getElementById('bw-touchscreen').checked });
  state.project.busbars = { smartBusway: result };
  document.getElementById('smart-busway-result').innerHTML = resultCards([
    ['第1排长度', result.row1LengthM, 'm'], ['第2排长度', result.row2LengthM, 'm'], ['母线槽估算', result.buswayLengthM, 'm'],
    ['始端箱', result.startBoxes, '个'], ['插接箱', result.plugBoxes, '个'], ['端盖', result.endCovers, '个'],
    ['防尘盖', result.dustCovers, '个'], ['固定件', result.fixingPieces, '个'], ['安装支架', result.supports, '个'],
    ['串口服务器', result.serialServer, '台'], ['触摸屏', result.touchscreen, '台']
  ]);
}

function calculatePowerQuality() {
  const apf = calculateApf({ transformerKva: numberValue('apf-transformer'), loadRate: numberValue('apf-load-rate'), thdi: numberValue('apf-thdi'), voltage: state.project.topology?.voltage || 380 });
  const svg = calculateSvg({ activePowerKw: numberValue('svg-power'), currentPowerFactor: numberValue('svg-pf-before'), targetPowerFactor: numberValue('svg-pf-target') });
  state.project.powerQuality = { apf, svg };
  document.getElementById('power-quality-result').innerHTML = resultCards([
    ['谐波电流', format(apf.harmonicCurrentA), 'A'], ['APF建议容量', apf.recommendedA, 'A'],
    ['所需补偿容量', format(svg.compensationKvar), 'kvar'], ['SVG建议容量', svg.recommendedKvar, 'kvar']
  ]);
}

function exportExcel() {
  if (!window.XLSX) {
    window.showToast?.('Excel 组件尚未加载，请刷新后重试');
    return;
  }
  collectProjectForm();
  const summary = state.project.loads?.summary || {};
  const overview = [
    ['数据中心电气设计与选型平台', '项目汇总'], ['项目名称', state.project.name], ['客户名称', state.project.info.customer],
    ['项目地点', state.project.info.location], ['设计阶段', state.project.info.stage], ['设计人员', state.project.info.designer],
    ['供电冗余', state.project.topology.redundancy], ['有功负荷(kW)', summary.activePowerKw ?? ''], ['视在功率(kVA)', summary.apparentPowerKva ?? ''],
    ['设计电流(A)', summary.designCurrentA ?? ''], ['建议变压器(kVA)', summary.transformerKva ?? ''],
    [], ['商务成本说明', '价格列为空；平台不内置目录价、供应商价或历史成交价。'], ['免责声明', ENGINEERING_WARNING]
  ];
  const loadRows = [['负荷名称', '数量', '单台功率(kW)', '需要系数', '功率因数', '有功功率(kW)', '无功功率(kvar)'], ...(summary.rows || []).map(row => [row.name, row.quantity, row.unitPowerKw, row.demandFactor, row.powerFactor, row.activePowerKw, row.reactivePowerKvar])];
  const costRows = [['序号', '系统/设备', '规格说明', '数量', '单位', '单价（用户填写）', '合价（用户填写）', '备注']];
  const workbook = window.XLSX.utils.book_new();
  const overviewSheet = window.XLSX.utils.aoa_to_sheet(overview);
  const loadSheet = window.XLSX.utils.aoa_to_sheet(loadRows);
  const costSheet = window.XLSX.utils.aoa_to_sheet(costRows);
  overviewSheet['!cols'] = [{ wch: 22 }, { wch: 56 }];
  loadSheet['!cols'] = [22, 10, 16, 14, 12, 18, 18].map(wch => ({ wch }));
  costSheet['!cols'] = [8, 20, 36, 10, 10, 18, 18, 24].map(wch => ({ wch }));
  window.XLSX.utils.book_append_sheet(workbook, overviewSheet, '项目汇总');
  window.XLSX.utils.book_append_sheet(workbook, loadSheet, '负荷计算');
  window.XLSX.utils.book_append_sheet(workbook, costSheet, '商务成本空白表');
  window.XLSX.writeFile(workbook, `${state.project.name || '项目'}-电气设计汇总.xlsx`);
}

function buildAiDrawer() {
  document.body.insertAdjacentHTML('beforeend', `<button class="global-ai-fab" id="global-ai-fab" title="打开全局 AI 助手">AI</button>
    <aside class="global-ai-drawer" id="global-ai-drawer" aria-label="全局 AI 助手" aria-hidden="true"><header><div><b>全局 AI 助手</b><small>基于当前项目参数生成检查提示</small></div><button id="global-ai-close">×</button></header>
      <div id="global-ai-context" class="global-ai-context"></div><label>需要 AI 协助的内容<textarea id="global-ai-request" rows="7" placeholder="例如：根据当前负荷和 N+1 架构，检查 UPS 初选口径并列出待确认条件。"></textarea></label>
      <button id="global-ai-open-selector" class="primary">带入独立智能选型</button><p>AI 配置保存在本机浏览器。输出必须由工程人员复核。</p></aside>`);
  const drawer = document.getElementById('global-ai-drawer');
  const toggle = open => { drawer.classList.toggle('open', open); drawer.setAttribute('aria-hidden', String(!open)); updateAiContext(); };
  document.getElementById('global-ai-fab').addEventListener('click', () => toggle(true));
  document.getElementById('global-ai-close').addEventListener('click', () => toggle(false));
  document.getElementById('global-ai-open-selector').addEventListener('click', async () => {
    const request = document.getElementById('global-ai-request').value.trim();
    const summary = state.project.loads?.summary;
    const prompt = [`项目：${state.project.name}`, `冗余：${state.project.topology?.redundancy || '未填写'}`, summary ? `负荷：${format(summary.activePowerKw)}kW / ${format(summary.apparentPowerKva)}kVA` : '负荷：尚未计算', request].filter(Boolean).join('\n');
    const target = document.getElementById('requirement');
    if (target) target.value = prompt;
    toggle(false);
    await activateView('home');
  });
}

function updateAiContext() {
  const element = document.getElementById('global-ai-context');
  if (!element || !state.project) return;
  const summary = state.project.loads?.summary;
  element.innerHTML = `<b>${htmlEscape(state.project.name)}</b><span>${htmlEscape(state.project.topology?.redundancy || '未设冗余')}</span><span>${summary ? `${format(summary.activePowerKw)} kW · ${format(summary.apparentPowerKva)} kVA` : '尚未完成负荷计算'}</span>`;
}

function bindEvents() {
  document.addEventListener('click', event => {
    const viewButton = event.target.closest('[data-platform-view]');
    if (viewButton) activateView(viewButton.dataset.platformView);
  });
  document.getElementById('platform-tool-search').addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('.tool-card').forEach(card => { card.hidden = query && !card.dataset.search.toLowerCase().includes(query); });
    document.querySelectorAll('.tool-group').forEach(group => { group.hidden = ![...group.querySelectorAll('.tool-card')].some(card => !card.hidden); });
  });
  document.getElementById('add-load-row').addEventListener('click', () => addLoadRow());
  document.getElementById('calculate-load').addEventListener('click', calculateLoad);
  document.getElementById('calculate-distribution').addEventListener('click', calculateDistribution);
  document.getElementById('calculate-cable').addEventListener('click', calculateCable);
  ['cable-type', 'cable-core-count', 'cable-ambient', 'cable-parallel-count', 'cable-group-count', 'cable-system', 'cable-arrangement', 'cable-tray-type', 'cable-stacked-layers']
    .forEach(id => document.getElementById(id).addEventListener('change', updateCableControls));
  document.getElementById('query-awg').addEventListener('click', renderAwgResult);
  document.getElementById('awg-size').addEventListener('change', renderAwgResult);
  ['cable-catalog-type', 'cable-catalog-core', 'cable-catalog-ambient', 'cable-catalog-arrangement']
    .forEach(id => document.getElementById(id).addEventListener('change', renderCableCatalog));
  document.getElementById('cable-catalog-search').addEventListener('input', renderCableCatalog);
  document.getElementById('awg-catalog-search').addEventListener('input', renderAwgCatalog);
  document.getElementById('calculate-busbar').addEventListener('click', calculateBusbar);
  document.getElementById('calculate-busbar-ampacity').addEventListener('click', calculateBusbarAmpacityResult);
  document.getElementById('busbar-ampacity-surface-mode').addEventListener('change', syncBusbarAmpacityControls);
  document.getElementById('busbar-ampacity-current-type').addEventListener('change', syncBusbarAmpacityControls);
  document.getElementById('busbar-ampacity-room-temperature').addEventListener('input', syncBusbarAmpacityControls);
  document.getElementById('busbar-ampacity-rise-limit').addEventListener('input', syncBusbarAmpacityControls);
  document.getElementById('busbar-catalog-configuration').addEventListener('change', renderBusbarCatalog);
  document.getElementById('busbar-catalog-search').addEventListener('input', renderBusbarCatalog);
  document.getElementById('calculate-smart-busway').addEventListener('click', calculateBuswayConfig);
  document.getElementById('calculate-power-quality').addEventListener('click', calculatePowerQuality);
  document.getElementById('export-project-excel').addEventListener('click', exportExcel);
  document.querySelectorAll('[data-calc-tab]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-calc-tab]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('[data-calc-pane]').forEach(pane => { pane.hidden = pane.dataset.calcPane !== button.dataset.calcTab; });
  }));
  document.querySelectorAll('[data-busbar-tab]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-busbar-tab]').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-busbar-pane]').forEach(pane => { pane.hidden = pane.dataset.busbarPane !== button.dataset.busbarTab; });
    if (button.dataset.busbarTab === 'catalog') renderBusbarCatalog();
  }));
  document.querySelectorAll('[data-cable-tab]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-cable-tab]').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-cable-pane]').forEach(pane => { pane.hidden = pane.dataset.cablePane !== button.dataset.cableTab; });
    if (button.dataset.cableTab === 'catalog') renderCableCatalog();
    if (button.dataset.cableTab === 'awg') { renderAwgResult(); renderAwgCatalog(); }
  }));
  document.getElementById('platform-project-select').addEventListener('change', async event => {
    const projects = await listProjects();
    state.project = projects.find(project => project.id === event.target.value) || state.project;
    localStorage.setItem('dc_platform_current_project_id', state.project.id);
    fillProjectForm();
  });
  document.querySelectorAll('[data-project-action]').forEach(button => button.addEventListener('click', async () => {
    const action = button.dataset.projectAction;
    try {
      if (action === 'new') state.project = await createAndSaveProject(`新项目 ${new Date().toLocaleDateString('zh-CN')}`);
      if (action === 'copy') state.project = await copyProject(collectProjectForm());
      if (action === 'save') state.project = await saveProject(collectProjectForm());
      if (action === 'export') exportProject(collectProjectForm());
      if (action === 'import') document.getElementById('platform-project-import').click();
      if (['new', 'copy', 'save'].includes(action)) {
        await refreshProjectSelect(); fillProjectForm(); window.showToast?.('项目已保存在本机浏览器');
      }
    } catch (error) { window.showToast?.(`项目操作失败：${error.message}`); }
  }));
  document.getElementById('platform-project-import').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { state.project = await importProject(file); await refreshProjectSelect(); fillProjectForm(); window.showToast?.('项目导入成功'); }
    catch (error) { window.showToast?.(`项目导入失败：${error.message}`); }
    event.target.value = '';
  });
  const appbar = document.querySelector('.appbar-inner');
  if (appbar) appbar.insertAdjacentHTML('afterbegin', `<button type="button" class="platform-sidebar-toggle" data-sidebar-toggle aria-label="打开平台导航" aria-expanded="false" title="打开左侧导航">${navIcon('stack-2')}</button>`);
  const applySidebarState = collapsed => {
    document.body.classList.toggle('platform-sidebar-collapsed', collapsed);
    document.querySelectorAll('[data-sidebar-toggle]').forEach(toggle => {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? '展开平台导航' : '收起平台导航');
      toggle.setAttribute('title', collapsed ? '展开左侧导航' : '收起左侧导航');
    });
    document.querySelectorAll('.platform-sidebar-control-text').forEach(text => {
      text.textContent = collapsed ? '展开导航' : '收起导航';
    });
  };
  if (window.innerWidth >= 900) applySidebarState(localStorage.getItem(SIDEBAR_PREF_KEY) === '1');
  document.querySelectorAll('[data-sidebar-toggle]').forEach(toggle => toggle.addEventListener('click', () => {
    if (window.innerWidth < 900) {
      document.body.classList.toggle('platform-sidebar-open');
      toggle.setAttribute('aria-expanded', String(document.body.classList.contains('platform-sidebar-open')));
      return;
    }
    const collapsed = !document.body.classList.contains('platform-sidebar-collapsed');
    applySidebarState(collapsed);
    localStorage.setItem(SIDEBAR_PREF_KEY, collapsed ? '1' : '0');
  }));
}

export async function initializePlatform() {
  document.body.classList.add('platform-v2');
  const container = document.querySelector('.container');
  if (!container || !window.indexedDB) return;
  const layout = document.createElement('div');
  layout.className = 'platform-layout';
  container.parentNode.insertBefore(layout, container);
  layout.insertAdjacentHTML('afterbegin', buildSidebar());
  const workspace = document.createElement('main');
  workspace.className = 'platform-workspace';
  layout.appendChild(workspace);
  workspace.appendChild(container);
  container.insertAdjacentHTML('afterbegin', shellViews());

  const migration = await migrateLegacyBrowserData();
  state.project = await getCurrentProject();
  await Promise.all([refreshProjectSelect(), loadCatalogs()]);
  fillProjectForm();
  renderBusbarCatalog();
  syncBusbarAmpacityControls();
  updateCableControls();
  renderAwgResult();
  renderCableCatalog();
  renderAwgCatalog();
  const migrationElement = document.getElementById('migration-status');
  migrationElement.textContent = `旧版数据已安全复制：${migration.copiedKeys?.length || 0} 项；旧数据仍保留。`;
  bindEvents();
  buildAiDrawer();
  updateAiContext();
  await activateView('project');

  window.dcPlatform = { state, activateView, save: () => saveProject(collectProjectForm()), tools: allTools() };
}
