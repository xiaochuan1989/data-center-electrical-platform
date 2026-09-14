#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'dist/index.html 不存在，请先运行 npm run build');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const files = walk(dist);
assert.ok(!files.some(file => /\.(xlsx|xlsm|xls|pdf)$/i.test(file)), '公开构建包含原始工作簿或 PDF');
const text = files.filter(file => /\.(html|js|css|json)$/i.test(file)).map(file => fs.readFileSync(file, 'utf8')).join('\n');
assert.ok(!/priceEnc:\s*"[^"\s]+"/.test(text), '公开构建仍包含编码后的目录价数据');
assert.ok(!/供应商价\s*[：:]\s*[¥￥]?\s*\d/.test(text), '公开构建包含供应商价格值');
assert.ok(!/目录价\s*[：:]\s*[¥￥]\s*\d/.test(text), '公开构建包含目录价格值');
assert.ok(text.includes('01021107'), '产品编码未进入公开构建');
assert.ok(text.includes('功率模块'), '功率模块编码语义未保留');
console.log(`✅ 公开构建门禁通过：${files.length} 个文件，无原始工作簿/PDF和内置价格值`);
