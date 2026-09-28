import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUpsRequirement, normalizeUpsRequirement, normalizeUpsProduct,
  assessUpsProduct, rankUpsProducts, diffUpsCatalog } from '../src/modules/ups-selection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const active = { status: 'active', source: '测试目录', version: 'T1', reviewedAt: '2026-09-25' };
const product = { 型号: 'T-200', 描述: '200kVA三进三出长机', 功率因数: '0.9', 并机数量: '4', 并机卡: '自带', 并机线: '可选5m', 电池: '30-34', 安装: '塔式', 通讯: '可选SNMP卡' };
const parsed = parseUpsRequirement('UPS额定容量 200kVA，负荷功率 150kW，三进三出，后备时间不低于30分钟，支持SNMP');
assert.equal(parsed.capacityKva, 200);
assert.equal(parsed.loadKw, 150);
assert.equal(parsed.inputOutputPhase, '3:3');
assert.equal(parsed.backupMinutes, 30);
assert.equal(parsed.needsSnmp, true);
assert.equal(normalizeUpsRequirement({ capacityKva: '', parallelUnits: '-1' }).capacityKva, null);
assert.equal(normalizeUpsProduct(product).outputKw, 180);
assert.equal(assessUpsProduct(product, { capacityKva: 200, inputOutputPhase: '3:3', loadKw: 150 }, active).overall, 'pass');
assert.equal(assessUpsProduct(product, { capacityKva: 201 }, active).overall, 'fail');
assert.equal(assessUpsProduct(product, { inputOutputPhase: '1:1' }, active).overall, 'fail');
assert.equal(assessUpsProduct(product, { loadKw: 150 }, { status: 'unverified' }).overall, 'unknown');
assert.equal(assessUpsProduct(product, { loadKw: 150 }, { status: 'discontinued' }).overall, 'fail');
assert.equal(assessUpsProduct(product, { loadKw: 150, backupMinutes: 30 }, active).overall, 'unknown');
assert.equal(assessUpsProduct(product, { batteryCells: 32 }, active).overall, 'pass');
assert.equal(assessUpsProduct(product, { batteryCells: 35 }, active).overall, 'fail');
assert.equal(assessUpsProduct(product, { batteryType: 'lithium' }, active).overall, 'unknown');
assert.equal(assessUpsProduct(product, { loadKw: 150, parallelUnits: 2, redundancy: 'N+1' }, active).overall, 'pass');
assert.equal(assessUpsProduct({ ...product, 并机线: '无资料' }, { loadKw: 150, parallelUnits: 2 }, active).overall, 'unknown');
assert.equal(assessUpsProduct(product, { loadKw: 190, parallelUnits: 2, redundancy: 'N+1' }, active).overall, 'fail');
assert.equal(assessUpsProduct(product, { loadKw: 150, redundancy: 'N+1' }, active).overall, 'unknown');
assert.equal(assessUpsProduct(product, { loadKw: 150, redundancy: '2N' }, active).overall, 'unknown');
assert.equal(assessUpsProduct({ 型号: 'T-?', 描述: '三进三出', 功率因数: '/' }, { loadKw: 150 }, active).overall, 'unknown');

const ranked = rankUpsProducts([product, { ...product, 型号: 'T-100', 描述: '100kVA单进单出' }],
  { capacityKva: 200, inputOutputPhase: '3:3' }, { 'T-200': active, 'T-100': active });
assert.deepEqual(ranked.qualified.map(item => item.model), ['T-200']);
assert.equal(ranked.rejected.length, 1);
const diff = diffUpsCatalog([product], [{ ...product, 功率因数: '1' }, { ...product, 型号: 'T-300' }]);
assert.deepEqual(diff.changed, ['T-200']);
assert.deepEqual(diff.added, ['T-300']);
assert.deepEqual(diff.removed, []);
assert.deepEqual(diffUpsCatalog([product], []).removed, ['T-200']);
assert.deepEqual(diffUpsCatalog([product], [{ ...product, 目录价: '仅本机填写' }]).changed, []);

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const match = html.match(/^const PRODUCTS = (\[.*\]);$/m);
assert.ok(match, '内置 UPS 目录应可读取');
const catalog = JSON.parse(match[1]);
assert.ok(catalog.length >= 100);
const catalogResult = rankUpsProducts(catalog, { capacityKva: 200, inputOutputPhase: '3:3' }, {});
assert.equal(catalogResult.qualified.length, 0, '未经在售核对的内置目录不能直接标为完全匹配');
assert.ok(catalogResult.pending.length > 0);
console.log('UPS 选型确定性校核测试通过');
