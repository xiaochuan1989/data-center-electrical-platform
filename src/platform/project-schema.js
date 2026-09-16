export const SCHEMA_VERSION = 2;

export function createProject(name = '未命名项目') {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID ? crypto.randomUUID() : `project-${Date.now()}`,
    name,
    createdAt: now,
    updatedAt: now,
    info: {
      customer: '',
      location: '',
      designer: '',
      stage: '方案设计',
      note: ''
    },
    topology: {
      voltage: 380,
      frequency: 50,
      redundancy: 'N+1'
    },
    loads: {
      rows: [],
      summary: null
    },
    ups: {},
    battery: {},
    distribution: {},
    cables: {},
    busbars: { smartBuswayDesign: null },
    powerQuality: {},
    deliverables: [],
    legacy: {},
    notes: []
  };
}

export function normalizeProject(input) {
  const base = createProject(input?.name || '导入项目');
  const project = { ...base, ...(input || {}) };
  project.info = { ...base.info, ...(input?.info || {}) };
  project.topology = { ...base.topology, ...(input?.topology || {}) };
  project.loads = { ...base.loads, ...(input?.loads || {}) };
  project.ups = { ...base.ups, ...(input?.ups || {}) };
  project.battery = { ...base.battery, ...(input?.battery || {}) };
  project.distribution = { ...base.distribution, ...(input?.distribution || {}) };
  project.cables = { ...base.cables, ...(input?.cables || {}) };
  project.busbars = { ...base.busbars, ...(input?.busbars || {}) };
  project.powerQuality = { ...base.powerQuality, ...(input?.powerQuality || {}) };
  project.legacy = { ...base.legacy, ...(input?.legacy || {}) };
  if (input?.schemaVersion < 2 && input?.busbars?.smartBusway && !project.legacy.smartBuswayV1) {
    project.legacy.smartBuswayV1 = structuredClone(input.busbars.smartBusway);
    delete project.busbars.smartBusway;
  }
  project.deliverables = Array.isArray(input?.deliverables) ? input.deliverables : [];
  project.notes = Array.isArray(input?.notes) ? input.notes : [];
  project.schemaVersion = SCHEMA_VERSION;
  project.updatedAt = new Date().toISOString();
  return project;
}
