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
  calculateSmartBuswayDesign,
  createSmartBuswayDesign,
  calculateSvg
} from '../modules/engineering-calculators.js';
import { allTools, TEMPLATE_CATALOG, TOOL_GROUPS } from './tool-registry.js';
import busbarCatalog from '../data/busbar-catalog.json';
import cableCatalog from '../data/cable-catalog.json';
import awgCatalog from '../data/awg-catalog.json';
import smartBuswayCatalog from '../data/smart-busway-catalog.json';
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
  catalogs: { busbars: [], cables: [], awg: [], smartBusway: {} },
  activeView: 'project',
  buswayStep: 1,
  buswayZoom: 1,
  buswayDrag: null
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
    ${navButton('busway', '智能母线', 'device-desktop-analytics')}
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
      <div class="busbar-source-note"><b>计算口径</b><span>基础载流量来自 DIN43671-1975，环境温度 35°C。A03 原表的“涂层”列不再等同于热缩套管；全镀锡、热缩或特殊结构请转到“按规格算载流量”并填写经验证的热工参数。</span></div>
      <div class="platform-form-grid cols-4 busbar-inputs">
        <label>负载电流(A)<input id="busbar-load-current" type="number" min="1" max="20000" step="1" value="1600"></label>
        <label>安装环境<select id="busbar-environment"><option value="ventilated">通风</option><option value="sealed">IP54 / 密封</option></select></label>
        <label>载流量数据列<select id="busbar-surface"><option value="bare">裸排列（A03 原表）</option><option value="coated">涂层列（A03 原表，非热缩）</option></select></label>
        <label>选型温升口径<select id="busbar-temperature-rise"><option value="iec50">50K 温升修正（通风 × 1.3）</option><option value="din30">30K 温升基准（DIN 原值）</option></select></label>
      </div>
      <div class="busbar-formula-strip" aria-label="计算说明">
        <span><b>最佳规格</b> 全表取满足需求的最接近规格</span>
        <span><b>主母线优先</b> 单片 → 双拼 → 三拼 → 四拼</span>
        <span><b>50K温升修正</b> 通风 × 1.3，密封 × 1.0</span>
        <span><b>PE截面</b> 按 S、16、S/2 或 S/4</span>
      </div>
      <button id="calculate-busbar" class="platform-primary-action">计算铜排配置</button>
      <div id="busbar-result" class="busbar-result" aria-live="polite"></div>
    </div>
    <div class="busbar-pane" data-busbar-pane="ampacity" hidden>
      <div class="busbar-source-note"><b>计算口径</b><span>热平衡采用 I²R=Pconv+Prad。默认用同规格 DIN 30K 裸排数据反求参考等效换热系数，再按自然对流规律随温差修正；无同规格数据时自动回退到自然对流关联式。标准提示按现行 GB/T 7251.1-2023、GB/T 24276-2025 更新；结果用于工程估算，不替代成套温升试验。</span></div>
      <div class="busbar-ampacity-scope">
        <b>温升口径</b>
        <span>70K 是铜排相对外部环境的工程控制温升：35 + 70 = 105℃。若柜内空气比房间再高 15K，则柜内空气为 50℃，铜排对柜内空气的有效散热温差为 105 − 50 = 55K；它与 DIN 表的 30K 查表条件不是同一个量。</span>
      </div>
      <div class="busbar-ampacity-scope">
        <b>适用边界</b>
        <span>本模型只适用于单片、非并联、四个表面均可自然散热的初步估算。并排互热、柜壁遮挡、热缩绝缘、接头损耗、强迫风冷及实际交流附加损耗必须另行校核；柜内空气温升应优先采用项目实测或整柜温升计算结果。</span>
      </div>
      <div class="platform-form-grid cols-4 busbar-inputs busbar-ampacity-inputs">
        <label>铜排宽度 (mm)<input id="busbar-ampacity-width" type="number" min="1" max="500" step="1" value="120"></label>
        <label>铜排厚度 (mm)<input id="busbar-ampacity-thickness" type="number" min="0.5" max="100" step="0.5" value="10"></label>
        <label>外部环境温度 (℃)<input id="busbar-ampacity-room-temperature" type="number" min="-50" max="100" step="1" value="35"><small>GB/T 7251 常用基准环境温度</small></label>
        <label>工程控制温升 (K)<input id="busbar-ampacity-rise-limit" type="number" min="1" max="105" step="1" value="70"><small>相对外部环境；项目默认采用 70K</small></label>
        <label>铜排最高温度 (℃)<input id="busbar-ampacity-maximum-temperature" type="number" value="105" readonly><small>外部环境温度 + 工程控制温升（自动计算）</small></label>
        <label>柜内空气温升 (K)<input id="busbar-ampacity-internal-rise" type="number" min="0" max="100" step="1" value="15"><small>密闭柜体 Excel 默认 15K；开放空气可填 0K</small></label>
        <label>电流类型<select id="busbar-ampacity-current-type"><option value="dc">直流 / 忽略交流附加损耗</option><option value="ac">交流（使用修正系数）</option></select></label>
        <label>设计裕量系数<select id="busbar-ampacity-design-factor"><option value="0.7">70%</option><option value="0.8" selected>80%（建议默认）</option><option value="0.9">90%</option><option value="1">100%（热平衡极限，不推荐）</option></select></label>
        <label>DIN同规格对照<select id="busbar-ampacity-din-reference"><option value="bareCurrentA">裸排载流量（35℃ / 30K）</option></select><small>对照时自动统一到DIN温升条件</small></label>
      </div>
      <details class="busbar-advanced">
        <summary>高级热工参数 <span>默认采用DIN反校模型，可展开切换独立关联式</span></summary>
        <div class="platform-form-grid cols-3 compact">
          <label>对流计算模型<select id="busbar-ampacity-convection-model"><option value="din-calibrated" selected>DIN同规格反校（推荐）</option><option value="natural-correlation">自然对流关联式（独立估算）</option><option value="custom">自定义等效换热系数</option></select><small>不再对全部规格固定使用 h=5</small></label>
          <label>安装方向<select id="busbar-ampacity-orientation" disabled><option value="edgewise-horizontal" selected>铜排水平、宽面竖直</option><option value="vertical-run">铜排沿长度方向竖直</option><option value="flat-horizontal">铜排水平、宽面水平</option></select><small>仅自然对流关联式使用</small></label>
          <label>自定义等效 h<input id="busbar-ampacity-convection" type="number" min="0.1" max="100" step="0.1" value="5" disabled><small>W/(m²·K)；仅自定义模式使用</small></label>
          <label>表面状态 / 发射率<select id="busbar-ampacity-surface-mode"><option value="bright-tin" selected>新亮全镀锡（ε=0.05，建议默认）</option><option value="conservative-tin">电镀铜保守校核（ε=0.03）</option><option value="excel">原 Excel 历史参数（状态未注明，ε=0.35）</option><option value="custom">自定义发射率</option></select><small>0.35 不代表镀锡；氧化、粗糙或特殊表面须依据实测</small></label>
          <label>计算采用的发射率 ε<input id="busbar-ampacity-emissivity" type="number" min="0" max="1" step="0.01" value="0.05" disabled><small>这是辐射散热参数，不是铜排电阻发热系数</small></label>
          <label>辐射视角系数 F<input id="busbar-ampacity-view-factor" type="number" min="0.05" max="1" step="0.05" value="0.8"><small>1为完全可见；柜壁、相邻铜排会降低视角系数</small></label>
          <label>有效散热面积系数<input id="busbar-ampacity-surface-factor" type="number" min="0.1" max="1" step="0.05" value="1"><small>四面无遮挡取1；支撑、遮挡或邻近结构应降低</small></label>
          <label>20℃铜电阻率 ρ₂₀<input id="busbar-ampacity-resistivity" type="number" min="0" max="0.000001" step="0.000000000001" value="0.000000017241"><small>Ω·m；按高导电退火铜，材料不明时应保守提高</small></label>
          <label>电阻温度系数 α<input id="busbar-ampacity-temperature-coefficient" type="number" min="0" max="0.02" step="0.00001" value="0.00393"><small>/℃</small></label>
          <label>交流电阻修正系数<input id="busbar-ampacity-ac-factor" type="number" min="1" max="5" step="0.01" value="1" disabled><small>1.00 表示尚未计入交流附加损耗</small></label>
        </div>
      </details>
      <div class="busbar-method-strip" aria-label="规格反算方法">
        <span><b>最高温度</b> 外部环境 + 工程控制温升</span>
        <span><b>柜内空气温度</b> 外部环境 + 柜内空气温升</span>
        <span><b>对流散热</b> DIN反校 h 或自然对流 Nu/Ra 关联式</span>
        <span><b>辐射散热</b> ε × F × σ × As × (T⁴ − Tamb⁴)</span>
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
  return viewPanel('busway', '智能母线', '从机柜级负荷生成 A/B 母线方案、插接箱组合、微模块布局图与配置清单。', `
    <div class="smart-busway-steps" role="tablist" aria-label="智能母线设计流程">
      <button class="active" data-bw-step="1"><b>1</b><span>快速配置<small>建立两排布局</small></span></button>
      <button data-bw-step="2"><b>2</b><span>布局微调<small>逐柜编辑与图纸</small></span></button>
      <button data-bw-step="3"><b>3</b><span>计算与清单<small>选型、附件与导出</small></span></button>
    </div>
    <section class="smart-busway-pane" data-bw-pane="1">
      <div class="smart-busway-intro"><b>快速建立微模块</b><span>空调会在整排中均匀分布；生成后仍可逐柜调整功率、相制与 A/B 供电。</span></div>
      <div class="busway-row-grid">
        ${[1, 2].map(row => `<fieldset><legend>第 ${row} 排</legend><label>600mm IT机柜<input id="bw-r${row}-600" type="number" min="0" value="10"></label><label>800mm IT机柜<input id="bw-r${row}-800" type="number" min="0" value="0"></label><label>300mm列间空调<input id="bw-r${row}-ac300" type="number" min="0" value="0"></label><label>600mm列间空调<input id="bw-r${row}-ac600" type="number" min="0" value="2"></label></fieldset>`).join('')}
      </div>
      <div class="platform-form-grid cols-4 compact smart-busway-basics">
        <label>默认单柜功率 (kW)<input id="bw-default-power" type="number" min="0" step="0.1" value="10"></label>
        <label>默认相制<select id="bw-default-phase"><option value="auto">自动（≥8kW 三相）</option><option value="three">三相</option><option value="single">单相</option></select></label>
        <label>供电拓扑<select id="bw-topology"><option value="dual">A/B 双路</option><option value="single">A 单路</option></select></label>
        <label>默认冷通道 (mm)<input id="bw-aisle-width" type="number" min="600" step="100" value="1200"></label>
        <label>安装方式<select id="bw-installation"><option value="cabinet-top">柜顶安装</option><option value="ceiling">吊装</option></select></label>
        <label>需要系数 Kd<input id="bw-demand" type="number" min="0" max="1" step="0.01" value="1"></label>
        <label>安全系数 Ks<input id="bw-safety" type="number" min="1" step="0.05" value="1.15"></label>
        <label>谐波系数 Kh<input id="bw-harmonic" type="number" min="0.01" max="1" step="0.05" value="1"></label>
        <label>N 线配置<select id="bw-neutral"><option value="auto">自动建议</option><option value="100">人工 100% N</option><option value="200">人工 200% N</option></select></label>
        <label class="checkbox-field"><input id="bw-touchscreen" type="checkbox"> 配置触摸屏</label>
      </div>
      <div class="smart-busway-actions"><button id="generate-smart-busway" class="platform-primary-action">生成布局并计算</button><span>项目负荷仅用于首次预填；生成后以逐柜明细为准。</span></div>
    </section>
    <section class="smart-busway-pane" data-bw-pane="2" hidden>
      <div class="smart-busway-layout-toolbar">
        <div><button data-bw-add="rack">＋ 机柜</button><button data-bw-add="ac">＋ 空调</button><button id="bw-fit-view">适配视图</button></div>
        <label>缩放 <button id="bw-zoom-out" aria-label="缩小">−</button><input id="bw-zoom" type="range" min="0.7" max="1.8" step="0.1" value="1"><button id="bw-zoom-in" aria-label="放大">＋</button><output id="bw-zoom-value">100%</output></label>
        <div class="smart-busway-legend"><span class="rack">IT机柜</span><span class="ac">列间空调</span><span class="path-a">A路</span><span class="path-b">B路</span></div>
      </div>
      <div class="smart-busway-editor">
        <div class="smart-busway-canvas"><div id="smart-busway-svg-wrap"></div><div id="smart-busway-side-view"></div></div>
        <aside id="smart-busway-inspector" class="smart-busway-inspector"></aside>
      </div>
      <div class="smart-busway-actions"><button data-bw-step="1">返回快速配置</button><button id="recalculate-smart-busway" class="platform-primary-action">重新计算并查看清单</button></div>
    </section>
    <section class="smart-busway-pane" data-bw-pane="3" hidden>
      <div id="smart-busway-path-result"></div>
      <div class="smart-busway-output-bar"><div><button id="bw-export-png">导出 PNG</button><button id="bw-print-pdf">打印 / 保存 PDF</button><button id="bw-export-excel" class="primary">导出项目 Excel</button></div><span>Excel 将新增“智能母线设计、机柜明细、配置清单”工作表。</span></div>
      <div id="smart-busway-bom"></div>
      <div id="smart-busway-warnings"></div>
      <div class="smart-busway-actions"><button data-bw-step="2">返回布局微调</button></div>
    </section>
    <p class="engineering-warning">⚠ ${ENGINEERING_WARNING}</p>`);
}

function powerQualityView() {
  return viewPanel('power-quality', '数据中心电能质量治理', '用 APF 治理谐波电流，用 SVG 动态补偿无功；结果可回写当前项目。', `
    <div class="quality-intro"><div><b>治理对象</b><span>UPS、服务器电源、变频空调等非线性负荷</span></div><div><b>设计路径</b><span>总负荷 → 谐波/无功分量 → APF/SVG 初选容量</span></div><div><b>参考来源</b><span>数据中心电能质量治理：交互式容量计算 SVG+APF</span></div></div>
    <div class="quality-flow" aria-label="电能质量治理流程">
      <div class="quality-flow-node source"><span>负荷侧</span><strong>UPS / IT / VFD</strong><small>非线性负荷</small></div><div class="quality-flow-arrow">→</div>
      <div class="quality-flow-node"><span>检测</span><strong>THDi + PF</strong><small>识别污染类型</small></div><div class="quality-flow-arrow">→</div>
      <div class="quality-flow-node apf"><span>APF</span><strong>谐波电流</strong><small>注入反向补偿</small></div><div class="quality-flow-arrow">+</div>
      <div class="quality-flow-node svg"><span>SVG</span><strong>无功容量</strong><small>动态调节 PF</small></div>
    </div>
    <div class="quality-grid"><fieldset class="quality-panel apf-panel"><legend>APF · 谐波治理</legend>
      <p class="quality-panel-note">按参考页公式：<code>Ih = S × K × THDi ÷ (√3 × U)</code>，再乘 1.25 安全裕量。</p>
      <label>变压器容量 S (kVA)<input id="apf-transformer" type="number" min="1" value="2000"></label><label>负载率 K<input id="apf-load-rate" type="number" min="0" max="1" step="0.01" value="0.7"></label><label>估算 THDi (%)<input id="apf-thdi" type="number" min="0" step="1" value="20"></label><label>二次侧线电压 U (V)<input id="apf-voltage" type="number" min="1" value="400"></label><label>安全裕量<input id="apf-safety" type="number" min="1" step="0.05" value="1.25"></label>
    </fieldset><fieldset class="quality-panel svg-panel"><legend>SVG · 无功治理</legend>
      <p class="quality-panel-note">感性滞后按差额补偿；容性超前按初始与目标无功相加抵消。</p>
      <label>有功功率 P (kW)<input id="svg-power" type="number" min="0" value="1000"></label><label>当前功率因数 PF₁<input id="svg-pf-before" type="number" min="0.01" max="1" step="0.01" value="0.92"></label><label>功率因数类型<select id="svg-pf-type"><option value="leading" selected>超前（容性）</option><option value="lagging">滞后（感性）</option></select></label><label>目标功率因数 PF₂<input id="svg-pf-target" type="number" min="0.01" max="1" step="0.01" value="0.99"></label>
    </fieldset></div><button id="calculate-power-quality" class="platform-primary-action">计算 APF / SVG</button><div id="power-quality-result" class="quality-result"></div>
    <p class="engineering-warning">⚠ 初步容量校核不替代现场电能质量测试。谐波频谱、补偿点、短路阻抗、谐振风险、三相不平衡和设备滤波率仍需由厂家及专业工程师复核。</p>`);
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
    awg: awgCatalog,
    smartBusway: smartBuswayCatalog
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
  if (view === 'busway') renderSmartBusway();
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
  const convectionModel = document.getElementById('busbar-ampacity-convection-model');
  const convectionCoefficient = document.getElementById('busbar-ampacity-convection');
  const orientation = document.getElementById('busbar-ampacity-orientation');
  const currentType = document.getElementById('busbar-ampacity-current-type');
  const acFactor = document.getElementById('busbar-ampacity-ac-factor');
  const roomTemperature = document.getElementById('busbar-ampacity-room-temperature');
  const riseLimit = document.getElementById('busbar-ampacity-rise-limit');
  const maximumTemperature = document.getElementById('busbar-ampacity-maximum-temperature');
  if (!surfaceMode || !emissivity || !currentType || !acFactor) return;
  const surfacePresets = { excel: '0.35', 'bright-tin': '0.05', 'conservative-tin': '0.03' };
  const usesSurfacePreset = Object.hasOwn(surfacePresets, surfaceMode.value);
  if (usesSurfacePreset) emissivity.value = surfacePresets[surfaceMode.value];
  emissivity.disabled = usesSurfacePreset;
  if (convectionModel && convectionCoefficient) convectionCoefficient.disabled = convectionModel.value !== 'custom';
  if (convectionModel && orientation) orientation.disabled = convectionModel.value !== 'natural-correlation';
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
    convectionModel: document.getElementById('busbar-ampacity-convection-model').value,
    orientation: document.getElementById('busbar-ampacity-orientation').value,
    convectionCoefficient: numberValue('busbar-ampacity-convection'),
    emissivity: numberValue('busbar-ampacity-emissivity'),
    radiationViewFactor: numberValue('busbar-ampacity-view-factor'),
    exposedSurfaceFactor: numberValue('busbar-ampacity-surface-factor'),
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
  const convectionModelLabels = {
    'din-calibrated': 'DIN同规格30K反校',
    'natural-correlation': '自然对流Nu/Ra关联式',
    custom: '自定义等效换热系数'
  };
  const orientationLabels = {
    'edgewise-horizontal': '铜排水平、宽面竖直',
    'vertical-run': '铜排沿长度方向竖直',
    'flat-horizontal': '铜排水平、宽面水平'
  };
  const convectionModelLabel = convectionModelLabels[result.convectionModel] || result.convectionModel;
  const isThermalLimit = result.designFactor >= 0.999;
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
    : `${result.dinNormalizedThermalCurrentA >= result.dinCurrentA ? '高于' : '低于'}DIN ${dinLabel}数据 ${format(Math.abs(result.dinDifferencePercent) * 100, 1)}%`;
  const dinComparison = result.dinMatch
    ? `<div class="busbar-din-comparison ${differenceClass}">
        <div><span>DIN同规格</span><strong>${htmlEscape(result.dinMatch.spec)} · 单片</strong></div>
        <div><span>DIN ${dinLabel}载流量</span><strong>${format(result.dinCurrentA, 0)} A</strong></div>
        <div><span>模型归一到35℃ / 30K</span><strong>${format(result.dinNormalizedThermalCurrentA, 0)} A</strong></div>
        <div><span>同条件差异</span><strong>${htmlEscape(differenceText)}</strong></div>
        <p>已统一到DIN的35℃环境和30K温升后比较；项目条件下的热平衡值不再直接与30K表值对比。</p>
      </div>`
    : `<div class="busbar-din-comparison neutral"><p>${htmlEscape(differenceText)}；仍可使用热平衡结果，但无法完成DIN同规格对照。</p></div>`;

  target.innerHTML = `
    <div class="busbar-result-hero busbar-ampacity-hero">
      <div class="busbar-best-spec"><span>${isThermalLimit ? '热平衡极限电流' : '建议持续工作电流'}</span><strong>${format(result.recommendedCurrentA, 0)} A</strong><small>${isThermalLimit ? '100%无设计裕量，不建议直接作为额定值' : `热平衡值 × ${format(result.designFactor * 100, 0)}%设计裕量`}</small></div>
      <div class="busbar-capacity"><span>项目条件热平衡载流量</span><strong>${format(result.thermalBalanceCurrentA, 0)} A</strong><small>${htmlEscape(convectionModelLabel)} · h=${format(result.convectionCoefficient, 2)}</small></div>
      <div><span>设计电流下估算温度</span><strong>${format(result.estimatedOperatingTemperatureC, 1)} ℃</strong><small>内部环境 ${format(result.internalAmbientTemperatureC, 1)}℃</small></div>
      <div><span>建议电流密度</span><strong>${format(result.currentDensityAmm2, 2)} A/mm²</strong><small>铜排截面 ${format(result.areaMm2, 0)}mm²</small></div>
    </div>
    <div class="result-grid busbar-result-grid busbar-ampacity-process">${resultCards([
      ['允许总温升', format(result.permittedTemperatureRiseK, 1), 'K'],
      ['对柜内空气散热温差', format(result.effectiveTemperatureRiseK, 1), 'K'],
      ['项目条件等效 h', format(result.convectionCoefficient, 2), 'W/(m²·K)'],
      ['每米散热表面积', format(result.surfaceAreaM2PerM, 4), 'm²/m'],
      ['直流电阻', format(result.dcResistanceOhmPerM * 1000, 5), 'mΩ/m'],
      ['计算采用电阻', format(result.usedResistanceOhmPerM * 1000, 5), 'mΩ/m'],
      ['对流散热', format(result.convectionLossWPerM, 1), 'W/m'],
      ['辐射散热', format(result.radiationLossWPerM, 1), 'W/m'],
      ['总散热能力', format(result.totalDissipationWPerM, 1), 'W/m'],
      ['建议电流下损耗', format(result.designLossWPerM, 1), 'W/m'],
      ['DIN 30K归一化值', format(result.dinNormalizedThermalCurrentA, 0), 'A']
    ])}</div>
    ${dinComparison}
    <details class="busbar-calculation-details">
      <summary>查看完整计算方法</summary>
      <div class="busbar-calculation-flow">
        <p><b>对流模型：</b>${htmlEscape(convectionModelLabel)}${result.convectionModel === 'natural-correlation' ? `；安装方向：${htmlEscape(orientationLabels[result.orientation] || result.orientation)}` : ''}</p>
        ${result.dinReferenceConvectionCoefficient !== null ? `<p><b>DIN反校：</b>同规格裸排在35℃ / 30K条件下反求参考 h=${format(result.dinReferenceConvectionCoefficient, 3)}W/(m²·K)，项目温差按 h∝ΔT<sup>0.25</sup>修正。</p>` : ''}
        <p><b>表面参数：</b>${htmlEscape(surfaceLabel)}；计算采用 ε=${format(result.emissivity, 2)}</p>
        <p><b>截面积：</b>${format(result.widthMm, 1)} × ${format(result.thicknessMm, 1)} = ${format(result.areaMm2, 1)}mm²</p>
        <p><b>铜排最高温度：</b>外部环境 ${format(result.roomTemperatureC, 1)}℃ + 工程控制温升 ${format(result.permittedTemperatureRiseK, 1)}K = ${format(result.maximumTemperatureC, 1)}℃</p>
        <p><b>柜内空气温度：</b>外部环境 ${format(result.roomTemperatureC, 1)}℃ + 柜内空气温升 ${format(result.internalTemperatureRiseC, 1)}K = ${format(result.internalAmbientTemperatureC, 1)}℃</p>
        <p><b>有效散热温差：</b>${format(result.maximumTemperatureC, 1)} − ${format(result.internalAmbientTemperatureC, 1)} = ${format(result.effectiveTemperatureRiseK, 1)}K</p>
        <p><b>有效散热面积：</b>四面总面积 ${format(result.grossSurfaceAreaM2PerM, 4)} × ${format(result.exposedSurfaceFactor, 2)} = ${format(result.surfaceAreaM2PerM, 4)}m²/m</p>
        <p><b>对流散热：</b>h(规格、温差、方向) × As × ΔT = ${format(result.convectionLossWPerM, 2)}W/m</p>
        <p><b>辐射散热：</b>ε × F(${format(result.radiationViewFactor, 2)}) × σ × As × (Tmax⁴ − Tamb⁴) = ${format(result.radiationLossWPerM, 2)}W/m</p>
        <p><b>热平衡电流：</b>√[(Pconv + Prad) ÷ R] = ${format(result.thermalBalanceCurrentA, 2)}A</p>
        <p><b>建议持续电流：</b>${format(result.thermalBalanceCurrentA, 2)} × ${format(result.designFactor, 2)} = ${format(result.recommendedCurrentA, 2)}A</p>
      </div>
    </details>
    <div class="busbar-notices">
      <p class="${result.convectionFallback ? 'warning' : 'safe'}">${result.convectionFallback ? '当前规格在DIN表中没有完全匹配项，已自动回退到自然对流关联式；请重点复核安装方向和结构条件。' : `当前采用${htmlEscape(convectionModelLabel)}，不再对所有规格固定使用 h=5。`}</p>
      <p class="neutral">70K 为本项目采用的工程控制口径，并非所有母线场景的统一限值；实际最高温度还应受端子、绝缘、连接件、相邻元件和验证条件中的最低限值约束。</p>
      <p class="${surfaceModeElement.value === 'excel' ? 'warning' : 'neutral'}">${surfaceModeElement.value === 'excel' ? '当前使用原 Excel 的 ε=0.35 历史参数，其表面状态和依据未注明；它不代表新亮镀锡铜排，可能使载流量估算偏高。' : '新亮镀锡默认采用 ε=0.05；需要更保守时可选择 ε=0.03，其他表面状态应采用实测或验证值。'}</p>
      <p class="${isThermalLimit ? 'warning' : 'neutral'}">${isThermalLimit ? '当前选择100%：结果是达到最高温度时的理论热平衡极限，没有连续运行设计裕量。' : `当前已采用 ${format(result.designFactor * 100, 0)}% 设计系数；该系数是工程裕量，不是标准统一规定。`}</p>
      <p class="warning">柜内空气温升、安装方向、有效散热面积、辐射视角系数和设计裕量都会影响结果；并排互热及接头损耗仍需专项校核。</p>
      <p class="${result.requiresAcVerification ? 'warning' : 'neutral'}">${result.requiresAcVerification ? '当前选择交流，但交流电阻修正系数仍为1.00，尚未计入集肤、邻近和谐波附加损耗。' : `当前采用${result.currentType === 'ac' ? `交流电阻系数 ${format(result.acResistanceFactor, 2)}` : '直流电阻'}进行计算。`}</p>
      <p class="${result.requiresShortCircuitCheck ? 'warning' : 'neutral'}">${result.requiresShortCircuitCheck ? '建议电流达到4000A及以上，必须专项校核短路耐受能力 Icw。' : '仍须结合项目短路电流、连接件和绝缘支撑条件校核。'}</p>
    </div>`;
}

function quickBuswayInput() {
  const row = index => ({ cabinets600: numberValue(`bw-r${index}-600`), cabinets800: numberValue(`bw-r${index}-800`), ac300: numberValue(`bw-r${index}-ac300`), ac600: numberValue(`bw-r${index}-ac600`) });
  const powerKw = numberValue('bw-default-power', 10);
  const phaseSetting = document.getElementById('bw-default-phase').value;
  return {
    row1: row(1), row2: row(2), defaultPowerKw: powerKw,
    defaultPhase: phaseSetting === 'auto' ? (powerKw >= 8 ? 'three' : 'single') : phaseSetting,
    topology: document.getElementById('bw-topology').value,
    aisleWidthMm: numberValue('bw-aisle-width', 1200),
    installation: document.getElementById('bw-installation').value,
    demandFactor: numberValue('bw-demand', 1), safetyFactor: numberValue('bw-safety', 1.15), harmonicFactor: numberValue('bw-harmonic', 1),
    neutralMode: document.getElementById('bw-neutral').value,
    touchscreen: document.getElementById('bw-touchscreen').checked,
    voltage: state.project?.topology?.voltage || 380,
    powerFactor: 0.95
  };
}

function currentBuswayDesign() {
  if (!state.project.busbars) state.project.busbars = {};
  if (!state.project.busbars.smartBuswayDesign) state.project.busbars.smartBuswayDesign = createSmartBuswayDesign(quickBuswayInput());
  return state.project.busbars.smartBuswayDesign;
}

function setBuswayStep(step) {
  state.buswayStep = Number(step) || 1;
  document.querySelectorAll('[data-bw-pane]').forEach(pane => { pane.hidden = Number(pane.dataset.bwPane) !== state.buswayStep; });
  document.querySelectorAll('.smart-busway-steps > button').forEach(button => button.classList.toggle('active', Number(button.dataset.bwStep) === state.buswayStep));
  if (state.buswayStep >= 2) renderSmartBusway();
}

function calculateBuswayConfig({ goToResults = true } = {}) {
  const result = calculateSmartBuswayDesign(currentBuswayDesign());
  state.project.busbars.smartBuswayDesign = result.design;
  renderSmartBusway();
  if (goToResults) setBuswayStep(3);
  return result;
}

function generateBuswayConfig() {
  state.project.busbars.smartBuswayDesign = createSmartBuswayDesign(quickBuswayInput());
  calculateBuswayConfig({ goToResults: false });
  setBuswayStep(2);
}

function buswayItemPosition(design, rowIndex, itemId, scale, margin) {
  const row = design.rows[rowIndex];
  let x = margin;
  for (const item of row.items) {
    const width = item.widthMm * scale;
    if (item.id === itemId) return { x, width, center: x + width / 2 };
    x += width;
  }
  return { x: margin, width: 0, center: margin };
}

function smartBuswaySvg(design, result) {
  const margin = 90;
  const maximumLengthMm = Math.max(3600, ...design.rows.map(row => row.items.reduce((sum, item) => sum + Number(item.widthMm || 0), 0)));
  const viewWidth = 1320;
  const scale = Math.min(0.18, (viewWidth - margin * 2) / maximumLengthMm);
  // The referenced CAD plan uses an 800/850 mm cabinet footprint. Keep the
  // plan depth tied to the same drawing scale instead of drawing shallow cards.
  const cabinetDepthMm = 800;
  const rowHeight = Math.max(112, Math.min(144, cabinetDepthMm * scale));
  const aisleY = 285;
  const rowY = [aisleY - rowHeight - 24, aisleY + 120 + 45];
  const paths = result.paths.map(item => item.path);
  const definitions = `<defs><pattern id="bw-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#dce7f0" stroke-width="1"/></pattern><filter id="bw-shadow"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#173b5b" flood-opacity=".12"/></filter></defs>`;
  const rowMarkup = design.rows.map((row, rowIndex) => {
    let x = margin;
    const items = row.items.map((item, itemIndex) => {
      const width = item.widthMm * scale;
      const selected = item.id === design.selectedItemId;
      const isRack = item.kind === 'rack';
      const fill = isRack ? '#f7fbff' : '#e8f8f4';
      const stroke = selected ? '#155eef' : isRack ? '#6e8fac' : '#3b9b83';
      const currentX = x;
      x += width;
      const feed = isRack ? (item.feed || 'AB') : '';
      const label = item.name || (isRack ? `机柜${itemIndex + 1}` : '列间空调');
      return `<g class="bw-svg-item${selected ? ' selected' : ''}" data-bw-item="${item.id}" data-bw-row="${rowIndex}" tabindex="0" role="button" aria-label="${htmlEscape(label)}">
        <rect x="${currentX}" y="${rowY[rowIndex]}" width="${width}" height="${rowHeight}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="${selected ? 3 : 1.5}"/>
        <rect x="${currentX + 5}" y="${rowY[rowIndex] + 7}" width="${Math.max(8, width - 10)}" height="5" rx="2" fill="${isRack ? '#b9cce0' : '#74c9b4'}"/>
        <text x="${currentX + width / 2}" y="${rowY[rowIndex] + 49}" text-anchor="middle" class="bw-svg-title">${htmlEscape(label)}</text>
        <text x="${currentX + width / 2}" y="${rowY[rowIndex] + 69}" text-anchor="middle" class="bw-svg-meta">${item.widthMm}mm${isRack ? ` · ${format(item.powerKw, 1)}kW` : ''}</text>
        ${isRack ? `<text x="${currentX + width / 2}" y="${rowY[rowIndex] + 91}" text-anchor="middle" class="bw-svg-feed feed-${feed.toLowerCase()}">${feed}</text>` : '<text x="' + (currentX + width / 2) + '" y="' + (rowY[rowIndex] + 91) + '" text-anchor="middle" class="bw-svg-meta">AC</text>'}
      </g>`;
    }).join('');
    const lengthWidth = row.exactLengthM * 1000 * scale;
    const topBusY = rowIndex === 0 ? rowY[0] - 58 : rowY[1] + rowHeight + 38;
    const busLines = paths.map((path, pathIndex) => `<g class="bw-svg-path path-${path.toLowerCase()}"><line x1="${margin - 20}" y1="${topBusY + pathIndex * 25}" x2="${margin + lengthWidth + 20}" y2="${topBusY + pathIndex * 25}"/><rect x="${margin - 37}" y="${topBusY - 10 + pathIndex * 25}" width="18" height="20" rx="3"/><text x="${margin - 49}" y="${topBusY + 4 + pathIndex * 25}" text-anchor="end">${path}路始端</text><rect x="${margin + lengthWidth + 21}" y="${topBusY - 8 + pathIndex * 25}" width="8" height="16" rx="2"/><text x="${margin + lengthWidth + 38}" y="${topBusY + 4 + pathIndex * 25}">末端</text></g>`).join('');
    return `${busLines}${items}<text x="${margin}" y="${rowY[rowIndex] - 20}" class="bw-svg-row-name">${htmlEscape(row.name)} · 实长 ${format(row.exactLengthM, 2)}m / 订货 ${row.orderLengthM}m</text>`;
  }).join('');
  const plugMarkup = result.plugBoxGroups.map((group, index) => {
    const positions = group.memberIds.map(id => buswayItemPosition(design, group.rowIndex, id, scale, margin));
    const x = positions.reduce((sum, position) => sum + position.center, 0) / Math.max(1, positions.length);
    const y = group.rowIndex === 0 ? 118 - (group.path === 'B' ? 2 : 25) : 575 + (group.path === 'B' ? 25 : 0);
    const cabinetY = group.rowIndex === 0 ? rowY[0] : rowY[1] + rowHeight;
    const label = `${group.breakerA || '—'}A ${group.phase}`;
    return `<g class="bw-svg-plug path-${group.path.toLowerCase()}"><line x1="${x}" y1="${y}" x2="${x}" y2="${cabinetY}"/><rect x="${x - 25}" y="${y - 10}" width="50" height="20" rx="4"/><text x="${x}" y="${y + 4}" text-anchor="middle">${label}</text></g>`;
  }).join('');
  return `<svg id="smart-busway-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} 720" role="img" aria-label="两排微模块智能母线俯视布局图">
    ${definitions}<rect width="${viewWidth}" height="720" fill="#f8fbfe"/><rect x="40" y="32" width="${viewWidth - 80}" height="650" rx="16" fill="url(#bw-grid)" stroke="#d8e5ef"/>
    <rect x="${margin}" y="${aisleY}" width="${Math.max(300, maximumLengthMm * scale)}" height="120" rx="8" fill="#edf5ff" stroke="#9fc2e8" stroke-dasharray="8 6"/>
    <text x="${margin + Math.max(300, maximumLengthMm * scale) / 2}" y="${aisleY + 55}" text-anchor="middle" class="bw-svg-aisle">冷通道 ${design.aisleWidthMm}mm</text><text x="${margin + Math.max(300, maximumLengthMm * scale) / 2}" y="${aisleY + 78}" text-anchor="middle" class="bw-svg-meta">宽度可在配置中调整 · 柜体按真实宽度比例</text>
    ${rowMarkup}${plugMarkup}
    <text x="${margin}" y="698" class="bw-svg-caption">机柜平面深度按 CAD 800mm 关系表达</text><text x="${viewWidth - 54}" y="698" text-anchor="end" class="bw-svg-caption">智能母线微模块布局 · 方案图（非施工定位图）</text>
  </svg>`;
}

function smartBuswaySideSvg(design, result) {
  const ceiling = design.installation === 'ceiling';
  const row = design.rows[0];
  const rowLengthMm = Math.max(1, row.items.reduce((sum, item) => sum + Number(item.widthMm || 0), 0));
  const elevationX = 70;
  const elevationFloorY = 292;
  const elevationWidth = 650;
  const elevationScale = Math.min(0.075, elevationWidth / rowLengthMm);
  const cabinetHeight = 2200 * elevationScale;
  let cursorX = elevationX;
  const itemPositions = new Map();
  const elevationItems = row.items.map((item, index) => {
    const width = Math.max(21, item.widthMm * elevationScale);
    const x = cursorX;
    cursorX += width;
    itemPositions.set(item.id, { x, width, center: x + width / 2 });
    const isRack = item.kind === 'rack';
    const label = item.name || (isRack ? `机柜${index + 1}` : `空调${index + 1}`);
    return `<g class="side-elevation-item ${isRack ? 'rack' : 'ac'}"><rect x="${x}" y="${elevationFloorY - cabinetHeight}" width="${width}" height="${cabinetHeight}" rx="2"/><line x1="${x + 4}" y1="${elevationFloorY - cabinetHeight + 12}" x2="${x + width - 4}" y2="${elevationFloorY - cabinetHeight + 12}"/><text x="${x + width / 2}" y="${elevationFloorY - 16}" text-anchor="middle">${isRack ? index + 1 : 'AC'}</text><title>${htmlEscape(label)} · ${item.widthMm}mm</title></g>`;
  }).join('');
  const rowEndX = cursorX;
  const busAY = ceiling ? 66 : elevationFloorY - cabinetHeight - 39;
  const busBY = busAY + 22;
  const elevationHangers = ceiling
    ? [elevationX + 22, (elevationX + rowEndX) / 2, rowEndX - 22].map(x => `<path d="M${x} 34V${busBY + 8}" class="side-hanger"/>`).join('')
    : [elevationX + 18, (elevationX + rowEndX) / 2, rowEndX - 18].map(x => `<path d="M${x} ${elevationFloorY - cabinetHeight}v-21h13" class="side-bracket"/>`).join('');
  const plugGroups = result.plugBoxGroups.filter(group => group.rowIndex === 0);
  const plugs = plugGroups.map(group => {
    const positions = group.memberIds.map(id => itemPositions.get(id)).filter(Boolean);
    if (!positions.length) return '';
    const x = positions.reduce((sum, position) => sum + position.center, 0) / positions.length;
    const y = group.path === 'A' ? busAY : busBY;
    const cabinetTopY = elevationFloorY - cabinetHeight;
    return `<g class="side-plug path-${group.path.toLowerCase()}"><rect x="${x - 12}" y="${y - 6}" width="24" height="12" rx="2"/><path d="M${x} ${y + 6}V${cabinetTopY}"/><title>${group.path}路 · ${group.breakerA || '—'}A · ${group.phase}</title></g>`;
  }).join('');
  const sectionScale = 0.064;
  const sectionRackW = 800 * sectionScale;
  const sectionRackH = 2200 * sectionScale;
  const sectionAisleW = Math.max(62, Number(design.aisleWidthMm || 1200) * sectionScale);
  const sectionFloorY = 292;
  const sectionLeftX = 840;
  const sectionRightX = sectionLeftX + sectionRackW + sectionAisleW;
  const sectionRackTop = sectionFloorY - sectionRackH;
  const sectionBusY = ceiling ? 67 : sectionRackTop - 33;
  const sectionPair = x => `<rect x="${x - 3}" y="${sectionBusY}" width="${sectionRackW + 6}" height="9" rx="2" class="side-bus-a"/><rect x="${x - 3}" y="${sectionBusY + 13}" width="${sectionRackW + 6}" height="9" rx="2" class="side-bus-b"/>`;
  const sectionSupport = ceiling
    ? `<path d="M${sectionLeftX + 8} 34V${sectionBusY}M${sectionLeftX + sectionRackW - 8} 34V${sectionBusY}M${sectionRightX + 8} 34V${sectionBusY}M${sectionRightX + sectionRackW - 8} 34V${sectionBusY}" class="side-hanger"/>`
    : `<path d="M${sectionLeftX + 7} ${sectionRackTop}v-25h11M${sectionLeftX + sectionRackW - 7} ${sectionRackTop}v-25h-11M${sectionRightX + 7} ${sectionRackTop}v-25h11M${sectionRightX + sectionRackW - 7} ${sectionRackTop}v-25h-11" class="side-bracket"/>`;
  return `<div class="smart-busway-side-head"><b>安装关系侧视</b><span>${ceiling ? '吊装' : '柜顶安装'} · 参照 CAD 比例 · 非施工标高</span></div><svg viewBox="0 0 1100 350" role="img" aria-label="智能母线整排立面和冷通道安装剖面示意">
    <g class="side-panel"><text x="56" y="22" class="side-panel-title">整排立面示意 · 第1排</text><line x1="56" y1="34" x2="${rowEndX + 14}" y2="34" class="side-ceiling"/>${elevationHangers}
      <rect x="${elevationX - 10}" y="${busAY - 7}" width="${rowEndX - elevationX + 20}" height="14" rx="3" class="side-bus-a"/><rect x="${elevationX - 10}" y="${busBY - 7}" width="${rowEndX - elevationX + 20}" height="14" rx="3" class="side-bus-b"/>
      <text x="${elevationX - 18}" y="${busAY + 4}" text-anchor="end" class="side-path-a">A路</text><text x="${elevationX - 18}" y="${busBY + 4}" text-anchor="end" class="side-path-b">B路</text>${plugs}${elevationItems}<line x1="56" y1="${elevationFloorY}" x2="${rowEndX + 14}" y2="${elevationFloorY}" class="side-floor"/>
      <path d="M42 ${elevationFloorY - cabinetHeight}H54M42 ${elevationFloorY}H54M48 ${elevationFloorY - cabinetHeight}V${elevationFloorY}" class="side-dimension"/><text x="38" y="${elevationFloorY - cabinetHeight / 2}" text-anchor="middle" transform="rotate(-90 38 ${elevationFloorY - cabinetHeight / 2})">机柜高 2200mm</text><text x="${(elevationX + rowEndX) / 2}" y="326" text-anchor="middle">连续母线槽 · 插接箱与所带机柜对齐 · 实际设备数量</text>
    </g>
    <line x1="786" y1="18" x2="786" y2="330" class="side-divider"/>
    <g class="side-panel"><text x="816" y="22" class="side-panel-title">冷通道剖面示意</text><line x1="816" y1="34" x2="1070" y2="34" class="side-ceiling"/>${sectionSupport}${sectionPair(sectionLeftX)}${sectionPair(sectionRightX)}
      <rect x="${sectionLeftX}" y="${sectionRackTop}" width="${sectionRackW}" height="${sectionRackH}" rx="2" class="side-rack"/><rect x="${sectionRightX}" y="${sectionRackTop}" width="${sectionRackW}" height="${sectionRackH}" rx="2" class="side-rack"/><text x="${sectionLeftX + sectionRackW / 2}" y="${sectionFloorY - 55}" text-anchor="middle">机柜</text><text x="${sectionRightX + sectionRackW / 2}" y="${sectionFloorY - 55}" text-anchor="middle">机柜</text>
      <path d="M${sectionLeftX + sectionRackW} ${sectionFloorY - 22}H${sectionRightX}" class="side-dimension"/><text x="${(sectionLeftX + sectionRackW + sectionRightX) / 2}" y="${sectionFloorY - 30}" text-anchor="middle">冷通道 ${design.aisleWidthMm}mm</text><text x="${sectionLeftX + sectionRackW / 2}" y="312" text-anchor="middle">深800</text><text x="${sectionRightX + sectionRackW / 2}" y="312" text-anchor="middle">深800</text><line x1="816" y1="${sectionFloorY}" x2="1070" y2="${sectionFloorY}" class="side-floor"/><text x="943" y="326" text-anchor="middle">每排均配置 A/B 双路母线</text>
    </g>
  </svg>`;
}

function selectedBuswayItem(design) {
  for (let rowIndex = 0; rowIndex < design.rows.length; rowIndex += 1) {
    const itemIndex = design.rows[rowIndex].items.findIndex(item => item.id === design.selectedItemId);
    if (itemIndex >= 0) return { rowIndex, itemIndex, item: design.rows[rowIndex].items[itemIndex] };
  }
  return null;
}

function smartBuswayInspector(design) {
  const selected = selectedBuswayItem(design);
  if (!selected) return `<div class="smart-busway-inspector-empty"><b>选择设备</b><p>点击图中的机柜或空调，在这里编辑属性。也可以拖到另一设备位置完成排序。</p></div>`;
  const { item, rowIndex } = selected;
  const rackFields = item.kind === 'rack' ? `<label>单柜功率 (kW)<input data-bw-field="powerKw" type="number" min="0" step="0.1" value="${item.powerKw}"></label>
    <label>相制<select data-bw-field="phase"><option value="three"${item.phase === 'three' ? ' selected' : ''}>三相 380V</option><option value="single"${item.phase === 'single' ? ' selected' : ''}>单相 220V</option></select></label>
    <label>功率因数<input data-bw-field="powerFactor" type="number" min="0.01" max="1" step="0.01" value="${item.powerFactor ?? 0.95}"></label>
    <label>支路安全系数<input data-bw-field="safetyFactor" type="number" min="1" step="0.05" value="${item.safetyFactor ?? 1.25}"></label>
    <label>供电方式<select data-bw-field="feed"><option value="AB"${item.feed === 'AB' ? ' selected' : ''}>A+B 双电源</option><option value="A"${item.feed === 'A' ? ' selected' : ''}>仅 A 路</option><option value="B"${item.feed === 'B' ? ' selected' : ''}>仅 B 路</option></select></label>
    <label class="checkbox-field"><input data-bw-field="manualSplit" type="checkbox"${item.manualSplit ? ' checked' : ''}> 独立插接箱，不参与三柜组合</label>
    <div class="smart-busway-branch-readout"><span>支路电流</span><b>${format(item.branch?.designCurrentA)} A</b><span>断路器</span><b>${item.branch?.breakerA || '超上限'} A</b></div>` : '';
  return `<div class="smart-busway-inspector-title"><div><small>${design.rows[rowIndex].name}</small><b>${htmlEscape(item.name)}</b></div><span>${item.kind === 'rack' ? 'IT机柜' : '列间空调'}</span></div>
    <label>设备名称<input data-bw-field="name" value="${htmlEscape(item.name)}"></label><label>宽度 (mm)<select data-bw-field="widthMm"><option value="600"${item.widthMm === 600 ? ' selected' : ''}>600</option><option value="${item.kind === 'rack' ? 800 : 300}"${item.widthMm !== 600 ? ' selected' : ''}>${item.kind === 'rack' ? 800 : 300}</option></select></label>
    ${rackFields}<div class="smart-busway-order-actions"><button data-bw-move="back">← 前移</button><button data-bw-move="forward">后移 →</button></div><button data-bw-delete class="danger">删除该设备</button>`;
}

function renderSmartBuswayResults(result) {
  const pathHost = document.getElementById('smart-busway-path-result');
  if (!pathHost) return;
  pathHost.innerHTML = `<div class="smart-busway-path-grid">${result.paths.map(path => `<article class="${path.configurable ? '' : 'danger'}"><header><b>${path.path} 路母线</b><span>${path.configurable ? `${path.ratedCurrentA}A` : '超 800A'}</span></header><dl><div><dt>正常工况</dt><dd>${format(path.normalPowerKw)} kW</dd></div><div><dt>另一路失电</dt><dd>${format(path.failurePowerKw)} kW</dd></div><div><dt>计算电流</dt><dd>${format(path.currentA)} A</dd></div><div><dt>选型电流</dt><dd>${format(path.designCurrentA)} A</dd></div><div><dt>额定档位</dt><dd>${path.ratedCurrentA ? `${path.ratedCurrentA} A` : `工程参考 ${path.engineeringRatedCurrentA || '超表列'} A`}</dd></div><div><dt>负载率</dt><dd>${path.loadRate === null ? '—' : `${format(path.loadRate * 100)}%`}</dd></div></dl></article>`).join('')}</div>
    <div class="smart-busway-summary-strip"><span><b>${result.neutralRecommendation}</b> N线自动建议</span><span><b>${result.selectedNeutral}</b> 当前采用</span><span><b>${result.plugBoxGroups.length}</b> 插接箱</span><span><b>${format(result.accessories.buswayLengthM, 1)}m</b> 订货母线总长</span></div>`;
  const bomHost = document.getElementById('smart-busway-bom');
  bomHost.innerHTML = result.bomBlocked ? `<div class="smart-busway-blocked"><b>BOM 已停止生成</b><p>智能母线选型超过 800A。计算结果保留，请分段设计或改用固定式母线。</p></div>` : `<div class="smart-busway-table-head"><div><h2>配置清单</h2><p>仅含确认型号与工程数量，不含价格。</p></div><b>${result.bom.length} 项</b></div><div class="data-entry-table smart-busway-bom-table"><table><thead><tr><th>分类</th><th>产品型号</th><th>说明</th><th>路径</th><th>数量</th><th>单位</th></tr></thead><tbody>${result.bom.map(item => `<tr class="${item.status === 'pending' ? 'pending' : ''}"><td>${htmlEscape(item.category)}</td><td><code>${htmlEscape(item.status === 'pending' ? '型号待确认' : item.code || '—')}</code></td><td>${htmlEscape(item.description)}</td><td>${htmlEscape(item.path || '—')}</td><td>${format(item.quantity, 2)}</td><td>${htmlEscape(item.unit)}</td></tr>`).join('')}</tbody></table></div>`;
  document.getElementById('smart-busway-warnings').innerHTML = result.warnings.length ? `<div class="smart-busway-warning-list"><h2>需要关注 <span>${result.warnings.length}</span></h2>${result.warnings.map(warning => `<p>⚠ ${htmlEscape(warning)}</p>`).join('')}</div>` : '<div class="smart-busway-ok">当前计算未发现越界或型号缺口。</div>';
}

function renderSmartBusway() {
  const design = currentBuswayDesign();
  const result = calculateSmartBuswayDesign(design);
  state.project.busbars.smartBuswayDesign = result.design;
  const svgWrap = document.getElementById('smart-busway-svg-wrap');
  if (svgWrap) {
    svgWrap.innerHTML = smartBuswaySvg(result.design, result);
    svgWrap.style.setProperty('--bw-zoom', state.buswayZoom);
  }
  const side = document.getElementById('smart-busway-side-view');
  if (side) side.innerHTML = smartBuswaySideSvg(result.design, result);
  const inspector = document.getElementById('smart-busway-inspector');
  if (inspector) inspector.innerHTML = smartBuswayInspector(result.design);
  const output = document.getElementById('bw-zoom-value');
  const range = document.getElementById('bw-zoom');
  if (output) output.value = `${Math.round(state.buswayZoom * 100)}%`;
  if (range) range.value = state.buswayZoom;
  renderSmartBuswayResults(result);
}

function updateSelectedBuswayField(target) {
  const design = currentBuswayDesign();
  const selected = selectedBuswayItem(design);
  if (!selected) return;
  const field = target.dataset.bwField;
  selected.item[field] = target.type === 'checkbox' ? target.checked : target.type === 'number' || field === 'widthMm' ? Number(target.value) : target.value;
  renderSmartBusway();
}

function moveSelectedBuswayItem(direction) {
  const design = currentBuswayDesign();
  const selected = selectedBuswayItem(design);
  if (!selected) return;
  const row = design.rows[selected.rowIndex].items;
  const nextIndex = direction === 'back' ? selected.itemIndex - 1 : selected.itemIndex + 1;
  if (nextIndex < 0 || nextIndex >= row.length) return;
  [row[selected.itemIndex], row[nextIndex]] = [row[nextIndex], row[selected.itemIndex]];
  renderSmartBusway();
}

function addBuswayItem(kind) {
  const design = currentBuswayDesign();
  const selected = selectedBuswayItem(design);
  const rowIndex = selected?.rowIndex ?? 0;
  const item = kind === 'ac'
    ? { id: `ac-${Date.now()}`, kind: 'ac', name: `列间空调${design.rows[rowIndex].items.filter(entry => entry.kind === 'ac').length + 1}`, widthMm: 600 }
    : { id: `rack-${Date.now()}`, kind: 'rack', name: `机柜${design.rows[rowIndex].items.filter(entry => entry.kind === 'rack').length + 1}`, widthMm: 600, powerKw: 10, phase: 'three', powerFactor: 0.95, safetyFactor: 1.25, feed: design.topology === 'single' ? 'A' : 'AB', manualSplit: false };
  const insertAt = selected ? selected.itemIndex + 1 : design.rows[rowIndex].items.length;
  design.rows[rowIndex].items.splice(insertAt, 0, item);
  design.selectedItemId = item.id;
  renderSmartBusway();
}

function deleteSelectedBuswayItem() {
  const design = currentBuswayDesign();
  const selected = selectedBuswayItem(design);
  if (!selected) return;
  design.rows[selected.rowIndex].items.splice(selected.itemIndex, 1);
  design.selectedItemId = null;
  renderSmartBusway();
}

function exportSmartBuswayPng() {
  const svg = document.getElementById('smart-busway-svg');
  if (!svg) return;
  const source = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2640; canvas.height = 1440;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${state.project.name || '项目'}-智能母线布局.png`;
    link.click();
  };
  image.src = url;
}

function calculatePowerQuality() {
  const apf = calculateApf({ transformerKva: numberValue('apf-transformer'), loadRate: numberValue('apf-load-rate'), thdi: numberValue('apf-thdi') / 100, voltage: numberValue('apf-voltage', state.project.topology?.voltage || 380), safetyFactor: numberValue('apf-safety', 1.25) });
  const svg = calculateSvg({ activePowerKw: numberValue('svg-power'), currentPowerFactor: numberValue('svg-pf-before'), targetPowerFactor: numberValue('svg-pf-target'), powerFactorType: document.getElementById('svg-pf-type').value });
  state.project.powerQuality = { apf, svg };
  document.getElementById('power-quality-result').innerHTML = `<div class="quality-result-hero"><div class="quality-result-card apf-result"><span>APF 建议容量</span><strong>${format(apf.recommendedA, 0)} A</strong><small>谐波电流 ${format(apf.harmonicCurrentA, 1)}A × ${format(apf.safetyFactor, 2)}</small></div><div class="quality-result-card svg-result"><span>SVG 建议容量</span><strong>${format(svg.recommendedKvar, 0)} kvar</strong><small>${svg.powerFactorType === 'leading' ? '超前无功抵消' : '滞后无功补偿'} · 计算值 ${format(svg.compensationKvar, 1)} kvar</small></div></div>${resultCards([['总负荷电流', format(apf.totalCurrentA), 'A'], ['设计谐波电流', format(apf.designCurrentA), 'A'], ['初始无功', format(svg.initialReactiveKvar), 'kvar'], ['目标无功', format(svg.targetReactiveKvar), 'kvar']])}<div class="quality-method"><b>容量建议</b><span>APF 采用 25A 标准档向上取整，SVG 采用 25kvar 标准档向上取整；实际设备并联台数、模块容量和安装位置需结合厂家样本确认。</span></div>`;
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
  const smartDesign = state.project.busbars?.smartBuswayDesign;
  const smartResult = smartDesign ? calculateSmartBuswayDesign(smartDesign) : null;
  const buswaySummaryRows = smartResult ? [
    ['智能母线设计', state.project.name], ['拓扑', smartResult.design.topology === 'dual' ? 'A/B双路' : 'A单路'], ['安装方式', smartResult.design.installation === 'cabinet-top' ? '柜顶安装' : '吊装'],
    ['冷通道(mm)', smartResult.design.aisleWidthMm], ['需要系数 Kd', smartResult.design.demandFactor], ['安全系数 Ks', smartResult.design.safetyFactor], ['谐波系数 Kh', smartResult.design.harmonicFactor],
    ['N线自动建议', smartResult.neutralRecommendation], ['当前N线', smartResult.selectedNeutral], [],
    ['路径', '正常功率(kW)', '单路故障功率(kW)', '计算电流(A)', '选型电流(A)', '额定档位(A)', '负载率'],
    ...smartResult.paths.map(path => [path.path, path.normalPowerKw, path.failurePowerKw, path.currentA, path.designCurrentA, path.ratedCurrentA || `超800（工程参考${path.engineeringRatedCurrentA || '超表列'}）`, path.loadRate ?? ''])
  ] : [['智能母线设计', '尚未生成']];
  const cabinetRows = [['排', '顺序', '设备名称', '类型', '宽度(mm)', '功率(kW)', '相制', '功率因数', '供电方式', '支路电流(A)', '断路器(A)', '插接箱覆盖']];
  if (smartResult) smartResult.design.rows.forEach((row, rowIndex) => row.items.forEach((item, itemIndex) => {
    const groups = smartResult.plugBoxGroups.filter(group => group.memberIds.includes(item.id)).map(group => `${group.path}:${group.productCode || '型号待确认'}`).join('；');
    cabinetRows.push([row.name, itemIndex + 1, item.name, item.kind === 'rack' ? 'IT机柜' : '列间空调', item.widthMm, item.kind === 'rack' ? item.powerKw : '', item.kind === 'rack' ? (item.phase === 'single' ? '单相' : '三相') : '', item.kind === 'rack' ? item.powerFactor : '', item.kind === 'rack' ? item.feed : '', item.branch?.designCurrentA ?? '', item.branch?.breakerA ?? '', groups]);
  }));
  const buswayBomRows = [['分类', '产品型号', '说明', '路径', '数量', '单位', '状态'], ...(smartResult?.bom || []).map(item => [item.category, item.status === 'pending' ? '型号待确认' : item.code || '—', item.description, item.path, item.quantity, item.unit, item.status === 'pending' ? '待确认' : item.code ? '已确认' : '工程附件'])];
  if (smartResult?.bomBlocked) buswayBomRows.push(['提示', '', '选型电流超过800A，未生成智能母线BOM', '', '', '', '停止生成']);
  const workbook = window.XLSX.utils.book_new();
  const overviewSheet = window.XLSX.utils.aoa_to_sheet(overview);
  const loadSheet = window.XLSX.utils.aoa_to_sheet(loadRows);
  const costSheet = window.XLSX.utils.aoa_to_sheet(costRows);
  const buswaySheet = window.XLSX.utils.aoa_to_sheet(buswaySummaryRows);
  const cabinetSheet = window.XLSX.utils.aoa_to_sheet(cabinetRows);
  const buswayBomSheet = window.XLSX.utils.aoa_to_sheet(buswayBomRows);
  overviewSheet['!cols'] = [{ wch: 22 }, { wch: 56 }];
  loadSheet['!cols'] = [22, 10, 16, 14, 12, 18, 18].map(wch => ({ wch }));
  costSheet['!cols'] = [8, 20, 36, 10, 10, 18, 18, 24].map(wch => ({ wch }));
  buswaySheet['!cols'] = [22, 22, 22, 18, 18, 18, 16].map(wch => ({ wch }));
  cabinetSheet['!cols'] = [10, 8, 18, 12, 12, 12, 10, 12, 12, 16, 14, 40].map(wch => ({ wch }));
  buswayBomSheet['!cols'] = [12, 24, 32, 10, 12, 10, 12].map(wch => ({ wch }));
  window.XLSX.utils.book_append_sheet(workbook, overviewSheet, '项目汇总');
  window.XLSX.utils.book_append_sheet(workbook, loadSheet, '负荷计算');
  window.XLSX.utils.book_append_sheet(workbook, costSheet, '商务成本空白表');
  window.XLSX.utils.book_append_sheet(workbook, buswaySheet, '智能母线设计');
  window.XLSX.utils.book_append_sheet(workbook, cabinetSheet, '机柜明细');
  window.XLSX.utils.book_append_sheet(workbook, buswayBomSheet, '配置清单');
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
  document.getElementById('busbar-ampacity-convection-model').addEventListener('change', syncBusbarAmpacityControls);
  document.getElementById('busbar-ampacity-current-type').addEventListener('change', syncBusbarAmpacityControls);
  document.getElementById('busbar-ampacity-room-temperature').addEventListener('input', syncBusbarAmpacityControls);
  document.getElementById('busbar-ampacity-rise-limit').addEventListener('input', syncBusbarAmpacityControls);
  document.getElementById('busbar-catalog-configuration').addEventListener('change', renderBusbarCatalog);
  document.getElementById('busbar-catalog-search').addEventListener('input', renderBusbarCatalog);
  document.getElementById('generate-smart-busway').addEventListener('click', generateBuswayConfig);
  document.getElementById('recalculate-smart-busway').addEventListener('click', () => calculateBuswayConfig());
  document.getElementById('bw-export-png').addEventListener('click', exportSmartBuswayPng);
  document.getElementById('bw-print-pdf').addEventListener('click', () => {
    document.body.classList.add('smart-busway-printing');
    window.addEventListener('afterprint', () => document.body.classList.remove('smart-busway-printing'), { once: true });
    window.print();
  });
  document.getElementById('bw-export-excel').addEventListener('click', exportExcel);
  const buswayPanel = document.getElementById('platform-view-busway');
  buswayPanel.addEventListener('click', event => {
    const stepButton = event.target.closest('[data-bw-step]');
    if (stepButton) setBuswayStep(stepButton.dataset.bwStep);
    const itemTarget = event.target.closest('[data-bw-item]');
    if (itemTarget) {
      const design = currentBuswayDesign();
      const dragged = state.buswayDrag;
      if (dragged && dragged.itemId !== itemTarget.dataset.bwItem) {
        const sourceRow = design.rows[dragged.rowIndex];
        const sourceIndex = sourceRow.items.findIndex(item => item.id === dragged.itemId);
        const [item] = sourceIndex >= 0 ? sourceRow.items.splice(sourceIndex, 1) : [];
        if (item) {
          const targetRowIndex = Number(itemTarget.dataset.bwRow);
          const targetRow = design.rows[targetRowIndex];
          const targetIndex = targetRow.items.findIndex(entry => entry.id === itemTarget.dataset.bwItem);
          targetRow.items.splice(Math.max(0, targetIndex), 0, item);
        }
      }
      design.selectedItemId = itemTarget.dataset.bwItem;
      state.buswayDrag = null;
      renderSmartBusway();
    }
    const addButton = event.target.closest('[data-bw-add]');
    if (addButton) addBuswayItem(addButton.dataset.bwAdd);
    const moveButton = event.target.closest('[data-bw-move]');
    if (moveButton) moveSelectedBuswayItem(moveButton.dataset.bwMove);
    if (event.target.closest('[data-bw-delete]')) deleteSelectedBuswayItem();
  });
  buswayPanel.addEventListener('pointerdown', event => {
    const item = event.target.closest('[data-bw-item]');
    if (item) state.buswayDrag = { itemId: item.dataset.bwItem, rowIndex: Number(item.dataset.bwRow) };
  });
  buswayPanel.addEventListener('pointerup', event => {
    const target = event.target.closest('[data-bw-item]');
    const dragged = state.buswayDrag;
    if (target && dragged && dragged.itemId !== target.dataset.bwItem) {
      const design = currentBuswayDesign();
      const sourceRow = design.rows[dragged.rowIndex];
      const sourceIndex = sourceRow.items.findIndex(item => item.id === dragged.itemId);
      const [item] = sourceIndex >= 0 ? sourceRow.items.splice(sourceIndex, 1) : [];
      if (item) {
        const targetRow = design.rows[Number(target.dataset.bwRow)];
        const targetIndex = targetRow.items.findIndex(entry => entry.id === target.dataset.bwItem);
        targetRow.items.splice(Math.max(0, targetIndex), 0, item);
        design.selectedItemId = item.id;
        renderSmartBusway();
      }
      state.buswayDrag = null;
      return;
    }
    if (!target) state.buswayDrag = null;
  });
  buswayPanel.addEventListener('keydown', event => {
    const item = event.target.closest('[data-bw-item]');
    if (!item) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      currentBuswayDesign().selectedItemId = item.dataset.bwItem;
      moveSelectedBuswayItem(event.key === 'ArrowLeft' ? 'back' : 'forward');
    }
  });
  buswayPanel.addEventListener('change', event => {
    if (event.target.matches('[data-bw-field]')) updateSelectedBuswayField(event.target);
    if (event.target.id === 'bw-zoom') {
      state.buswayZoom = Number(event.target.value);
      renderSmartBusway();
    }
  });
  document.getElementById('bw-zoom-in').addEventListener('click', () => { state.buswayZoom = Math.min(1.8, state.buswayZoom + 0.1); renderSmartBusway(); });
  document.getElementById('bw-zoom-out').addEventListener('click', () => { state.buswayZoom = Math.max(0.7, state.buswayZoom - 0.1); renderSmartBusway(); });
  document.getElementById('bw-fit-view').addEventListener('click', () => { state.buswayZoom = 1; renderSmartBusway(); });
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
