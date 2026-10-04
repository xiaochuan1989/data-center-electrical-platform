// Playwright CLI run-code --filename：合成软件验收，不是客户业务验收。
async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const out = 'D:/Claude 安装/UPS选型助手_开发包/output/playwright/nonstandard-n3';
  const errors = [], externalWrites = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method()) && !request.url().startsWith('http://127.0.0.1:5193')) externalWrites.push(request.url()); });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('button', { name: '非标配电售前方案', exact: true }).click();
  // 仅重置隔离QA工具包，便于失败后的原地复跑，不碰旧UPS/母线数据。
  const fresh = await page.evaluate(async () => { const mod = await import('/src/modules/nonstandard-presales.js'); return JSON.stringify(mod.createPresalesSnapshot(mod.createPresalesPackage('合成浏览器测试'))); });
  const acceptReset = dialog => dialog.accept(); page.on('dialog', acceptReset);
  await page.locator('#ns-restore').setInputFiles({ name: '合成空包.json', mimeType: 'application/json', buffer: Buffer.from(fresh) });
  await page.getByRole('status').filter({ hasText: '工作稿已恢复' }).waitFor(); page.removeListener('dialog', acceptReset);
  const catalog = await page.evaluate(() => JSON.stringify(PRODUCTS));
  const fill = (id, value) => page.locator(`#${id}`).fill(value);
  const add = async (category, label, count = '') => {
    await page.locator('#ns-category').selectOption(category); await fill('ns-equipment-label', label);
    await fill('ns-equipment-quantity', count); await fill('ns-equipment-reason', '合成软件测试登记'); await page.locator('#ns-add-equipment').click();
  };
  await add('cabinet', 'TEST-柜', '2'); await add('pdu', 'TEST-PDU'); await add('busway', 'TEST-母线', '2');
  await fill('ns-source-name', '合成要求'); await fill('ns-source-text', '额定电流：630A');
  await page.locator('#ns-add-source').click(); await page.locator('#ns-extract').click();
  let requirement = page.locator('.ns-requirement').first();
  await requirement.locator('[data-ns-equipment]').selectOption({ label: '配电柜 · TEST-柜' });
  await requirement.locator('[data-ns-reason]').fill('合成归属'); await requirement.locator('[data-ns-action=map]').click();
  requirement = page.locator('.ns-requirement').first();
  await requirement.locator('[data-ns-forbidden]').selectOption('true'); await requirement.locator('[data-ns-response]').selectOption('met');
  await requirement.locator('[data-ns-reason]').fill('合成复核非真实客户应答'); await requirement.locator('[data-ns-action=confirm]').click();
  await fill('ns-scheme-name', 'TEST-柜售前方案'); await page.locator('#ns-scheme-from-requirements').click();
  assert(await page.locator('[data-ns-config=ratedCurrentA]').inputValue() === '630', '已确认要求明确带入');
  await page.locator('[data-ns-config=supplyBoundary]').fill('合成柜体供货，施工不含');
  await page.locator('[data-ns-config=outgoingCount]').fill('3');
  await fill('ns-scheme-assumptions', '<script>window.__nsSchemeXss=1</script>');
  await page.getByText('方案关联要求（仅本设备）', { exact: true }).click();
  await page.locator('[data-ns-scheme-requirement]').check();
  const component = async (name, count) => {
    await page.locator('#ns-scheme-add-component').click();
    const row = page.locator('.ns-component').last();
    await row.locator('[data-ns-component-field=role]').selectOption('outgoing');
    for (const [key, value] of Object.entries({ name, specification: '仅合成测试规格', quantity: count, unit: '个', model: 'TEST-ONLY', reference: '合成依据，非厂家资料' })) await row.locator(`[data-ns-component-field=${key}]`).fill(value);
    await row.locator('[data-ns-component-field=modelStatus]').selectOption('verified');
  };
  await component('合成出线A', '2'); await component('=1+1', '1');
  await fill('ns-scheme-reason', '合成采用原因'); await page.locator('#ns-scheme-save').click();
  assert((await page.locator('#ns-scheme-preview').textContent()).includes('讨论稿'), '保存不自动确认');
  await fill('ns-scheme-reason', '合成确认，非真实工程验收'); await page.locator('#ns-scheme-confirm').click();
  assert((await page.locator('#ns-scheme-state').textContent()).includes('人工已复核'), '柜方案确认');
  const download = async (id, filename) => { const pending = page.waitForEvent('download'); await page.locator(`#${id}`).click(); const file = await pending; await file.saveAs(`${out}/${filename}`); return file; };
  await download('ns-export', 'requirements.xlsx');
  await download('ns-scheme-excel', 'cabinet.xlsx');
  const htmlFile = await download('ns-scheme-html', 'cabinet.html');
  const htmlStream = await htmlFile.createReadStream(); let html = ''; for await (const chunk of htmlStream) html += chunk.toString();
  assert(html.includes('&lt;script&gt;') && !html.includes('<script>'), 'HTML方案安全转义');
  assert(await page.evaluate(() => window.__nsSchemeXss) === undefined, '编辑和预览无脚本执行');
  // 修改即失效；外部数量更新不会覆盖尚未保存的组件编辑。
  await page.locator('.ns-component').last().locator('[data-ns-component-field=quantity]').fill('2');
  assert((await page.locator('#ns-scheme-state').textContent()).includes('未保存'), '方案编辑待保存');
  await page.locator('#ns-scheme-excel').click(); assert((await page.locator('#ns-message').textContent()).includes('未保存编辑'), '拒绝导出旧方案');
  const equipmentRow = page.locator('[data-ns-equipment-row]').first();
  await equipmentRow.locator('[data-ns-quantity]').fill('3'); await equipmentRow.locator('[data-ns-quantity-reason]').fill('合成套数修改'); await equipmentRow.locator('[data-ns-quantity-save]').click();
  assert(await page.locator('.ns-component').last().locator('[data-ns-component-field=quantity]').inputValue() === '2', '外部提交保留编辑');
  await fill('ns-scheme-reason', '合成错配检测'); await page.locator('#ns-scheme-save').click();
  await fill('ns-scheme-reason', '合成确认错配'); await page.locator('#ns-scheme-confirm').click();
  assert((await page.locator('#ns-message').textContent()).includes('出线数量与清单'), '数量错配不能确认');
  await page.locator('[data-ns-config=outgoingCount]').fill('4');
  // 取消切换不得丢编辑。
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#ns-scheme-equipment').selectOption({ label: 'PDU · TEST-PDU' });
  assert(await page.locator('[data-ns-config=outgoingCount]').inputValue() === '4', '取消切换保留编辑');
  await fill('ns-scheme-reason', '合成修订明细一致'); await page.locator('#ns-scheme-save').click();
  await fill('ns-scheme-reason', '合成重新确认'); await page.locator('#ns-scheme-confirm').click();
  await download('ns-scheme-excel', 'cabinet-revised.xlsx');
  await download('ns-backup', 'working.json');
  const snapshot = await page.evaluate(async () => {
    // QA读取下载前的同一独立缓存；不读取用户浏览器或业务数据。
    const pending = new Promise(resolve => { const original = URL.createObjectURL; URL.createObjectURL = blob => { blob.text().then(resolve); URL.createObjectURL = original; return original.call(URL, blob); }; });
    document.querySelector('#ns-backup').click(); return JSON.parse(await pending);
  });
  assert(snapshot.package.schemes[0].components.reduce((sum, c) => sum + c.quantity, 0) === 4, '备份为保存配置');
  assert(snapshot.package.schemes[0].reviewStatus === 'confirmed', '备份记录人工确认');
  // PDU数量和类型未知不补造，讨论稿允许输出，确认阻断。
  await page.locator('#ns-scheme-equipment').selectOption({ label: 'PDU · TEST-PDU' });
  await fill('ns-scheme-name', 'TEST-PDU讨论稿'); await page.locator('[data-ns-config=outputCount]').fill('4');
  await page.locator('#ns-scheme-add-component').click();
  let row = page.locator('.ns-component').first(); await row.locator('[data-ns-component-field=role]').selectOption('output');
  for (const [key, value] of Object.entries({ name: '合成接口', specification: '合成四接口', quantity: '4', unit: '个' })) await row.locator(`[data-ns-component-field=${key}]`).fill(value);
  await fill('ns-scheme-reason', '合成PDU待澄清'); await page.locator('#ns-scheme-save').click();
  assert((await page.locator('#ns-scheme-preview').textContent()).includes('PDU类型待确认'), 'PDU未知类型');
  await download('ns-scheme-excel', 'pdu-draft.xlsx');
  // 母线桥接使用显式合成的旧工具已生成快照，不使用新界面草稿，旧配置不回写。
  await page.locator('#ns-scheme-equipment').selectOption({ label: '智能母线 · TEST-母线' }); await fill('ns-scheme-reason', '合成母线桥接');
  await page.locator('#ns-scheme-from-busway').click();
  assert((await page.locator('#ns-message').textContent()).includes('尚无已生成'), '不从默认空布局桥接');
  const buswayBefore = await page.evaluate(async () => {
    const mod = await import('/src/modules/engineering-calculators.js');
    dcPlatform.state.project.busbars ||= {};
    dcPlatform.state.project.busbars.smartBuswayDesign = mod.calculateSmartBuswayDesign(mod.createSmartBuswayDesign({ row1: { cabinets600: 2 }, row2: {}, defaultPowerKw: 5, topology: 'single' })).design;
    return JSON.stringify(dcPlatform.state.project.busbars.smartBuswayDesign);
  });
  await page.locator('#ns-scheme-from-busway').click();
  assert((await page.locator('#ns-message').textContent()).includes('只读带入'), '母线桥接保存新方案');
  assert(await page.locator('.ns-component').count() > 0, '母线采用BOM');
  assert(await page.evaluate(() => JSON.stringify(dcPlatform.state.project.busbars.smartBuswayDesign)) === buswayBefore, '旧母线不回写');
  await download('ns-scheme-excel', 'busway-draft.xlsx');
  // 恢复前无需遗留草稿；恢复明确确认，确认失效。
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#ns-restore').setInputFiles(`${out}/working.json`);
  await page.getByRole('status').filter({ hasText: '工作稿已恢复' }).waitFor();
  await page.locator('#ns-scheme-select').selectOption({ label: 'TEST-柜售前方案' });
  assert((await page.locator('#ns-scheme-preview').textContent()).includes('讨论稿'), '恢复方案重新复核');
  assert((await page.locator('.ns-requirement').first().locator('[data-ns-status]').textContent()).includes('待复核'), '恢复要求重新复核');
  assert(await page.evaluate(() => JSON.stringify(PRODUCTS)) === catalog, 'UPS目录未变化');
  for (const size of [{ width: 1366, height: 900 }, { width: 1920, height: 1080 }, { width: 900, height: 900 }]) {
    await page.setViewportSize(size);
    await page.waitForFunction(() => innerWidth > 900 || document.querySelector('.platform-sidebar').getBoundingClientRect().right <= 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '无横向溢出');
    await page.locator('#ns-scheme-section').screenshot({ path: `${out}/scheme-${size.width}.png` });
  }
  assert(errors.length === 0, `浏览器异常：${errors}`); assert(externalWrites.length === 0, '客户内容无外发');
  const result = { passed: true, synthetic: true, categories: ['cabinet', 'pdu', 'busway'], quantityMismatchBlocked: true, dirtyExportBlocked: true,
    cancelledSwitchPreserved: true, externalEditPreserved: true, buswayReadOnly: true, restorePending: true, catalogUnchanged: true,
    nativeXlsx: true, requirementExport: true, xlsxCdnAvailable: await page.evaluate(() => typeof window.XLSX !== 'undefined'),
    widths: [1366, 1920, 900], errors, externalWrites, testedAt: new Date().toISOString() };
  const pendingResult = page.waitForEvent('download');
  await page.evaluate(value => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); a.download = 'browser-result.json'; a.click(); }, result);
  await (await pendingResult).saveAs(`${out}/browser-result.json`);
  return result;
}
