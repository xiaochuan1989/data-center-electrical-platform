import {
  calculateApf,
  calculateBranch,
  calculateBusway,
  calculateLoadSummary,
  calculateSmartBusway,
  calculateSvg,
  selectCatalogItem
} from '../modules/engineering-calculators.js';
import { allTools, TEMPLATE_CATALOG, TOOL_GROUPS } from './tool-registry.js';
import busbarCatalog from '../data/busbar-catalog.json';
import cableCatalog from '../data/cable-catalog.json';
import conductorCatalog from '../data/conductor-catalog.json';
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

const state = {
  project: null,
  catalogs: { busbars: [], conductors: [], cables: [] },
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

function buildSidebar() {
  return `<aside class="platform-sidebar" aria-label="平台导航">
    <button class="platform-nav-item" data-platform-view="project"><span>▣</span><b>项目工作台</b></button>
    <button class="platform-nav-item" data-platform-view="tools"><span>⌘</span><b>工具中心</b></button>
    <div class="platform-nav-label">UPS 与电池</div>
    <button class="platform-nav-item" data-platform-view="home"><span>◎</span>智能选型</button>
    <button class="platform-nav-item" data-platform-view="battery"><span>▤</span>UPS 与电池配置</button>
    <button class="platform-nav-item" data-platform-view="runtime"><span>◷</span>后备时间反算</button>
    <button class="platform-nav-item" data-platform-view="lead"><span>▧</span>电池方法一 / 锂电</button>
    <button class="platform-nav-item" data-platform-view="dc"><span>◇</span>数据中心方案校核</button>
    <button class="platform-nav-item" data-platform-view="db"><span>◉</span>产品数据库</button>
    <div class="platform-nav-label">工程设计</div>
    <button class="platform-nav-item" data-platform-view="load"><span>∑</span>负荷与配电</button>
    <button class="platform-nav-item" data-platform-view="conductor"><span>⌁</span>电缆与导体</button>
    <button class="platform-nav-item" data-platform-view="busway"><span>═</span>母线系统</button>
    <button class="platform-nav-item" data-platform-view="power-quality"><span>∿</span>电能质量</button>
    <div class="platform-nav-label">成果管理</div>
    <button class="platform-nav-item" data-platform-view="delivery"><span>▥</span>编码与交付</button>
    <button class="platform-nav-item" data-platform-view="templates"><span>□</span>模板中心</button>
  </aside>`;
}

function projectView() {
  const steps = [
    ['项目信息', 'project'], ['负荷计算', 'load'], ['UPS与电池', 'battery'], ['配电设备', 'load'],
    ['电缆/铜排/母线', 'conductor'], ['电能质量', 'power-quality'], ['编码与成果输出', 'delivery']
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

function conductorView() {
  return viewPanel('conductor', '电缆与导体选型', '合并电缆、铜排和导体数据库；当前先提供载流量条件筛选与来源追溯。', `
    <div class="platform-form-grid cols-4">
      <label>对象<select id="conductor-kind"><option value="cable">电缆</option><option value="busbar">铜排</option><option value="conductor">导体</option></select></label>
      <label>所需载流量(A)<input id="conductor-current" type="number" value="400"></label>
      <label>环境温度(°C)<input id="conductor-ambient" type="number" value="30"></label>
      <div class="field-action"><button id="calculate-conductor" class="primary">查询当前数据库</button></div>
    </div>
    <div id="conductor-result" class="catalog-result"></div>
    <p class="engineering-warning">⚠ 并联根数、敷设方式、桥架层数、环境温度及绝缘温度均会影响最终结果。当前结果只用于初步筛选。</p>`);
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
  return [projectView(), toolsView(), loadView(), conductorView(), buswayView(), powerQualityView(), deliveryView(), templatesView()].join('');
}

function resultCards(items) {
  return items.map(item => `<div><small>${item[0]}</small><strong>${item[1]}</strong><em>${item[2] || ''}</em></div>`).join('');
}

async function loadCatalogs() {
  state.catalogs = {
    busbars: busbarCatalog,
    conductors: conductorCatalog,
    cables: cableCatalog
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

function calculateConductorSelection() {
  const kind = document.getElementById('conductor-kind').value;
  const required = numberValue('conductor-current');
  const ambient = numberValue('conductor-ambient', 30);
  let item;
  if (kind === 'busbar') item = selectCatalogItem(state.catalogs.busbars, required, 'coatedCurrentA');
  else if (kind === 'conductor') item = selectCatalogItem(state.catalogs.conductors, required, 'current70A', ambient ? { ambientC: ambient } : {});
  else item = selectCatalogItem(state.catalogs.cables, required, 'currentA', ambient ? { ambientC: ambient } : {});
  const result = document.getElementById('conductor-result');
  if (!item) {
    result.innerHTML = `<div class="no-result">当前筛选条件下没有满足 ${format(required)}A 的数据，请调整温度或改用工程复核。</div>`;
    return;
  }
  state.project.cables = { kind, requiredCurrentA: required, ambientC: ambient, selected: item };
  result.innerHTML = `<div class="catalog-answer"><span>建议起点</span><strong>${htmlEscape(item.size || item.spec || item.type || '匹配项')}</strong><pre>${htmlEscape(JSON.stringify(item, null, 2))}</pre></div>`;
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
  document.getElementById('calculate-conductor').addEventListener('click', calculateConductorSelection);
  document.getElementById('calculate-smart-busway').addEventListener('click', calculateBuswayConfig);
  document.getElementById('calculate-power-quality').addEventListener('click', calculatePowerQuality);
  document.getElementById('export-project-excel').addEventListener('click', exportExcel);
  document.querySelectorAll('[data-calc-tab]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-calc-tab]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('[data-calc-pane]').forEach(pane => { pane.hidden = pane.dataset.calcPane !== button.dataset.calcTab; });
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
  if (appbar) appbar.insertAdjacentHTML('afterbegin', '<button id="platform-sidebar-toggle" class="platform-sidebar-toggle" aria-label="展开平台导航">☰</button>');
  document.getElementById('platform-sidebar-toggle')?.addEventListener('click', () => document.body.classList.toggle('platform-sidebar-open'));
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
  const migrationElement = document.getElementById('migration-status');
  migrationElement.textContent = `旧版数据已安全复制：${migration.copiedKeys?.length || 0} 项；旧数据仍保留。`;
  bindEvents();
  buildAiDrawer();
  updateAiContext();
  await activateView('project');

  window.dcPlatform = { state, activateView, save: () => saveProject(collectProjectForm()), tools: allTools() };
}
