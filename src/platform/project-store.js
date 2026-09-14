import { createProject, normalizeProject } from './project-schema.js';

const DB_NAME = 'dc_electrical_platform_db';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const META = 'meta';
const CURRENT_PROJECT_KEY = 'dc_platform_current_project_id';
const MIGRATION_KEY = 'legacy-v1-migration';

const LEGACY_KEYS = [
  'ups_config',
  'ups_selection_history',
  'ups_db_favorites_v1',
  'ups_summary_column_widths_v1',
  'ups_db_split_ratio',
  'ups_db_column_widths_v1',
  'ups_custom_prompt'
];

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function openProjectDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) {
        const store = db.createObjectStore(PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listProjects() {
  const db = await openProjectDb();
  const tx = db.transaction(PROJECTS, 'readonly');
  const result = await requestResult(tx.objectStore(PROJECTS).getAll());
  await transactionDone(tx);
  db.close();
  return result.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getProject(id) {
  if (!id) return null;
  const db = await openProjectDb();
  const tx = db.transaction(PROJECTS, 'readonly');
  const result = await requestResult(tx.objectStore(PROJECTS).get(id));
  await transactionDone(tx);
  db.close();
  return result || null;
}

export async function saveProject(project) {
  const normalized = normalizeProject(project);
  normalized.updatedAt = new Date().toISOString();
  const db = await openProjectDb();
  const tx = db.transaction(PROJECTS, 'readwrite');
  tx.objectStore(PROJECTS).put(normalized);
  await transactionDone(tx);
  db.close();
  localStorage.setItem(CURRENT_PROJECT_KEY, normalized.id);
  return normalized;
}

export async function createAndSaveProject(name) {
  return saveProject(createProject(name));
}

export async function copyProject(project) {
  const copy = normalizeProject(structuredClone(project));
  copy.id = crypto.randomUUID ? crypto.randomUUID() : `project-${Date.now()}`;
  copy.name = `${project.name} - 副本`;
  copy.createdAt = new Date().toISOString();
  return saveProject(copy);
}

export async function getCurrentProject() {
  const currentId = localStorage.getItem(CURRENT_PROJECT_KEY);
  const current = await getProject(currentId);
  if (current) return current;
  const projects = await listProjects();
  if (projects[0]) {
    localStorage.setItem(CURRENT_PROJECT_KEY, projects[0].id);
    return projects[0];
  }
  return createAndSaveProject('我的第一个项目');
}

function safeParse(value) {
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return value; }
}

export async function migrateLegacyBrowserData() {
  const db = await openProjectDb();
  const checkTx = db.transaction(META, 'readonly');
  const migrated = await requestResult(checkTx.objectStore(META).get(MIGRATION_KEY));
  await transactionDone(checkTx);
  if (migrated) {
    db.close();
    return migrated;
  }

  const snapshot = {};
  for (const key of LEGACY_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) snapshot[key] = safeParse(value);
  }
  const projectsTx = db.transaction(PROJECTS, 'readonly');
  const count = await requestResult(projectsTx.objectStore(PROJECTS).count());
  await transactionDone(projectsTx);

  let project;
  if (count === 0) {
    project = createProject('从 UPS 助手迁移的项目');
    project.legacy = {
      ...snapshot,
      sourceDatabase: 'ups_data_db/products_data',
      migratedAt: new Date().toISOString()
    };
  }

  const writeTx = db.transaction([PROJECTS, META], 'readwrite');
  if (project) writeTx.objectStore(PROJECTS).put(project);
  const record = {
    key: MIGRATION_KEY,
    completedAt: new Date().toISOString(),
    copiedKeys: Object.keys(snapshot),
    legacyProductDatabaseRetained: true
  };
  writeTx.objectStore(META).put(record);
  await transactionDone(writeTx);
  db.close();
  if (project) localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
  return record;
}

export function exportProject(project) {
  const blob = new Blob([JSON.stringify(normalizeProject(project), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name || '项目'}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importProject(file) {
  const parsed = JSON.parse(await file.text());
  if (!parsed || typeof parsed !== 'object') throw new Error('项目文件格式不正确');
  const project = normalizeProject(parsed);
  project.id = crypto.randomUUID ? crypto.randomUUID() : `project-${Date.now()}`;
  project.name = parsed.name || file.name.replace(/\.json$/i, '');
  return saveProject(project);
}
