// Playwright CLI run-code --filename；合成软件验收，非客户技术承诺。
async page => {
  const assert = {
    equal: (a, b, message = '') => { if (a !== b) throw new Error(`断言失败：${message} ${JSON.stringify(a)} != ${JSON.stringify(b)}`); },
    deepEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`数组断言失败：${JSON.stringify(a)}`); },
    match: (value, regex) => { if (!regex.test(value)) throw new Error(`内容断言失败：${value}`); }
  };
  const out = 'D:/Claude 安装/UPS选型助手_开发包/output/playwright/nonstandard-n2';
  const path = { join: (...parts) => parts.join('/') };
  const errors = [], externalWrites = [];
  await page.setViewportSize({ width: 1366, height: 768 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method()) && !request.url().startsWith('http://127.0.0.1:5193')) externalWrites.push(request.url()); });
  await page.getByRole('button', { name: '非标配电售前方案', exact: true }).click();
  const add = async (category, label, count = '') => {
    await page.getByRole('combobox', { name: '品类', exact: true }).selectOption(category);
    await page.getByRole('textbox', { name: '设备名称/位号', exact: true }).fill(label);
    await page.getByRole('spinbutton', { name: '设备数量', exact: true }).fill(count);
    await page.getByRole('textbox', { name: '变更原因', exact: true }).fill('合成软件验收登记，非真实设备配置');
    await page.getByRole('button', { name: '添加设备项', exact: true }).click();
  };
  await add('cabinet', 'TEST-柜', '2'); await add('pdu', 'TEST-PDU'); await add('busway', 'TEST-母线', '1');
  assert.equal(await page.locator('.ns-equipment').count(), 3);
  await page.getByRole('textbox', { name: '资料名称', exact: true }).fill('合成验收文本');
  await page.getByRole('textbox', { name: '粘贴原文', exact: true }).fill('额定电流：630A\n额定电流：800A\n尺寸按图\n主母线电流：800A\n<script>window.__nsXss=1</script>');
  await page.getByRole('button', { name: '添加粘贴资料', exact: true }).click();
  await page.getByRole('button', { name: '提取待复核条款', exact: true }).click();
  assert.equal(await page.locator('.ns-requirement').count(), 5);
  assert.equal(await page.evaluate(() => window.__nsXss), undefined);
  await page.getByRole('button', { name: '提取待复核条款', exact: true }).click();
  assert.equal(await page.locator('.ns-requirement').count(), 5);
  const map = async quote => {
    const row = page.locator('.ns-requirement').filter({ has: page.locator('blockquote', { hasText: quote }) });
    await row.getByRole('combobox', { name: '归属设备', exact: true }).selectOption({ label: '配电柜 · TEST-柜' });
    await row.getByRole('textbox', { name: '复核/修改原因', exact: true }).fill('合成测试确认归属TEST-柜');
    await row.getByRole('button', { name: '分配/更新字段', exact: true }).click();
  };
  await map('额定电流：630A'); await map('额定电流：800A');
  let row = page.locator('.ns-requirement').filter({ has: page.locator('blockquote', { hasText: '额定电流：630A' }) });
  assert.match(await row.locator('[data-ns-status]').textContent(), /冲突/);
  assert.equal(await row.getByRole('textbox', { name: '确认值', exact: true }).inputValue(), '');
  await row.getByRole('textbox', { name: '确认值', exact: true }).fill('800');
  await row.getByRole('combobox', { name: '禁止偏离', exact: true }).selectOption('true');
  await row.getByRole('combobox', { name: '人工应答', exact: true }).selectOption('deviation');
  await row.getByRole('textbox', { name: '复核/修改原因', exact: true }).fill('合成测试原因');
  await row.getByRole('button', { name: '确认本条要求', exact: true }).click();
  assert.match(await page.locator('#ns-message').textContent(), /禁止偏离/);
  await row.getByRole('combobox', { name: '人工应答', exact: true }).selectOption('met');
  await row.getByRole('button', { name: '确认本条要求', exact: true }).click();
  assert.match(await row.locator('[data-ns-status]').textContent(), /已确认/);
  await row.getByRole('textbox', { name: '确认值', exact: true }).fill('630');
  assert.match(await row.locator('[data-ns-status]').textContent(), /待复核/);
  await row.getByRole('combobox', { name: '人工应答', exact: true }).selectOption('met');
  await row.getByRole('textbox', { name: '复核/修改原因', exact: true }).fill('合成测试改回630');
  await row.getByRole('button', { name: '确认本条要求', exact: true }).click();
  await page.getByRole('checkbox', { name: '仅本机自动保存（含客户原文）', exact: true }).check();
  const storage = await page.evaluate(() => JSON.parse(localStorage.getItem('nonstandard_presales_working_v1')));
  assert.equal(storage.snapshot.package.requirements.find(r => r.field === 'ratedCurrentA').confirmedValue, 630);
  assert.equal(storage.snapshot.package.equipment.find(e => e.category === 'pdu').quantity, null);
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: '备份方案工作稿JSON', exact: true }).click();
  const backupPath = path.join(out, 'working.json'); await (await backup).saveAs(backupPath);
  const excel = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出技术要求Excel工作稿', exact: true }).click();
  await (await excel).saveAs(path.join(out, 'requirements.xlsx'));
  const before = await page.evaluate(() => localStorage.getItem('nonstandard_presales_working_v1'));
  await page.locator('#ns-file').setInputFiles({ name: '空.txt', mimeType: 'text/plain', buffer: Buffer.from(' ') });
  await page.getByRole('status').filter({ hasText: '有效文字' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('nonstandard_presales_working_v1')), before);
  // 真正的SheetJS写入/读取文件；不是模拟解析组件。
  const bytes = await page.evaluate(() => {
    const sheet = XLSX.utils.aoa_to_sheet([['参数', '禁止偏离'], ['额定电流：32A', '是'], ['输入接口按图', '否']]);
    sheet.A4 = { t: 'n', f: '1+1', v: 2 }; sheet['!ref'] = 'A1:B4';
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, '需求表');
    return [...new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))];
  });
  const catalogBefore = await page.evaluate(() => JSON.stringify(PRODUCTS));
  assert.equal(await page.evaluate(() => PRODUCTS.length), 105, '核对真实UPS目录变量');
  await page.locator('#ns-file').setInputFiles({ name: '合成需求.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) });
  await page.getByRole('status').filter({ hasText: '文件已导入' }).waitFor();
  assert.match(await page.locator('#ns-read-warnings').textContent(), /公式/);
  assert.equal(await page.evaluate(() => JSON.stringify(PRODUCTS)), catalogBefore);
  await page.getByRole('button', { name: '提取待复核条款', exact: true }).click();
  const xlsxRow = page.locator('.ns-requirement').filter({ has: page.locator('blockquote', { hasText: '额定电流：32A' }) });
  assert.match(await xlsxRow.textContent(), /需求表!A2/);
  assert.equal(await xlsxRow.getByRole('combobox', { name: '禁止偏离', exact: true }).inputValue(), 'true');
  // 备份恢复必须明确确认，且不沿用旧的“已确认”。
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#ns-restore').setInputFiles(backupPath);
  await page.getByRole('status').filter({ hasText: '工作稿已恢复' }).waitFor();
  assert.match(await page.locator('.ns-requirement').filter({ has: page.locator('blockquote', { hasText: '额定电流：630A' }) }).locator('[data-ns-status]').textContent(), /待复核/);
  // 存储配额失败不假报成功。
  await page.evaluate(() => { window.__nsSet = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'nonstandard_presales_working_v1') throw new DOMException('quota', 'QuotaExceededError'); return window.__nsSet.call(this, key, value); }; });
  await page.getByRole('textbox', { name: '资料名称', exact: true }).fill('存储失败测试');
  await page.getByRole('textbox', { name: '粘贴原文', exact: true }).fill('额定电流：63A');
  await page.getByRole('button', { name: '添加粘贴资料', exact: true }).click();
  assert.match(await page.locator('#ns-message').textContent(), /保存失败/);
  await page.evaluate(() => { Storage.prototype.setItem = window.__nsSet; delete window.__nsSet; });
  const beforeRace = await page.locator('#ns-source-select option').count();
  await page.evaluate(() => { window.__nsArrayBuffer = File.prototype.arrayBuffer; File.prototype.arrayBuffer = async function() { await new Promise(resolve => setTimeout(resolve, 400)); return window.__nsArrayBuffer.call(this); }; });
  await page.locator('#ns-file').setInputFiles({ name: '异步测试.txt', mimeType: 'text/plain', buffer: Buffer.from('额定电流：125A') });
  await page.getByRole('textbox', { name: '粘贴原文', exact: true }).fill('读取期间的新输入');
  await page.getByRole('status').filter({ hasText: '旧结果未应用' }).waitFor();
  assert.equal(await page.locator('#ns-source-select option').count(), beforeRace);
  await page.evaluate(() => { File.prototype.arrayBuffer = window.__nsArrayBuffer; delete window.__nsArrayBuffer; });
  await page.locator('#ns-file').setInputFiles(path.join(out, '..', 'ups-evidence', 'multi-page.pdf'));
  await page.locator('#ns-source-select option').filter({ hasText: 'multi-page.pdf' }).waitFor({ state: 'attached' });
  assert.match(await page.locator('#ns-read-warnings').textContent(), /第2页/);
  await page.getByRole('button', { name: '提取待复核条款', exact: true }).click();
  const pdfRow = page.locator('.ns-requirement').filter({ has: page.locator('blockquote', { hasText: 'UPS容量300kVA' }) });
  assert.match(await pdfRow.textContent(), /PDF第3页/);
  assert.equal(await pdfRow.getByRole('combobox', { name: '归属设备', exact: true }).inputValue(), '', '多个容量不自动分配为同一设备');
  // 原文替换确认后，旧条款必须失效，并可重新提取归档。
  await page.getByRole('combobox', { name: '已导入来源', exact: true }).selectOption({ label: '合成验收文本' });
  await page.getByRole('textbox', { name: '粘贴原文', exact: true }).fill('额定电流：250A');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '用粘贴内容替换选中来源', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '来源已替换' }).waitFor();
  assert.match(await page.locator('.ns-requirement').filter({ has: page.locator('blockquote', { hasText: '额定电流：630A' }) }).locator('[data-ns-status]').textContent(), /来源已失效/);
  await page.getByRole('button', { name: '提取待复核条款', exact: true }).click();
  assert.equal(await page.locator('.ns-requirement').filter({ has: page.locator('blockquote', { hasText: '额定电流：630A' }) }).count(), 0);
  for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 900, height: 900 }]) {
    await page.setViewportSize(size);
    await page.waitForFunction(() => innerWidth > 900 || document.querySelector('.platform-sidebar').getBoundingClientRect().right <= 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, '无横向溢出');
    await page.screenshot({ path: path.join(out, `requirements-${size.width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []); assert.deepEqual(externalWrites, []);
  const result = { passed: true, synthetic: true, errors, externalWrites, widths: [1366, 1920, 900], catalogUnchanged: true, catalogCount: 105, pdfPages: [1, 3], emptyPageWarning: 2, staleReadRejected: true, sourceReplacementInvalidated: true, testedAt: new Date().toISOString() };
  const savedResult = page.waitForEvent('download');
  await page.evaluate(value => {
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); link.download = 'browser-result.json'; link.click();
  }, result);
  await (await savedResult).saveAs(path.join(out, 'browser-result.json'));
  return result;
}
