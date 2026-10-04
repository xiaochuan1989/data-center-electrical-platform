// Playwright CLI函数；仅合成软件验收，不是客户配电柜验收。
async page => {
  const assert = (v, message) => { if (!v) throw new Error(message); };
  const out = 'D:/Claude 安装/UPS选型助手_开发包/output/playwright/cabinet-assistant';
  const errors = [], externalWrites = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method()) && !r.url().startsWith('http://127.0.0.1:5193')) externalWrites.push(r.url()); });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('button', { name: '非标配电售前方案', exact: true }).click();
  // 合成资料通过已公开的独立工具包接口导入，只用于QA会话。
  const fixture = await page.evaluate(async () => {
    const m = await import('/src/modules/nonstandard-presales.js');
    let p = m.addEquipment(m.createPresalesPackage('合成柜助手浏览器QA'), { category: 'cabinet', label: 'TEST-CAB', quantity: 2 }, '合成登记');
    p = m.addEquipment(p, { category: 'pdu', label: 'TEST-PDU' }, '合成登记');
    for (const [field, value, quote] of [['ratedCurrentA', 630, '额定电流：630A'], ['incomingCount', 1, '进线数量：1路'], ['tieCount', 0, '母联数量：0路'], ['outgoingCount', 3, '出线数量：3路']]) {
      p = m.addPresalesSource(p, { type: 'text', name: `合成-${field}.txt`, text: quote, segments: [{ start: 0, end: quote.length }] }, '合成来源');
      p = m.addRequirement(p, { equipmentId: p.equipment[0].id, field, forbiddenDeviation: false,
        candidates: [{ value, evidence: { sourceId: p.sources.at(-1).id, start: 0, end: quote.length, quote } }] }, '合成提取');
    }
    return JSON.stringify(m.createPresalesSnapshot(p));
  });
  const accept = dialog => dialog.accept(); page.on('dialog', accept);
  await page.locator('#ns-restore').setInputFiles({ name: '合成柜助手.json', mimeType: 'application/json', buffer: Buffer.from(fixture) });
  await page.getByRole('status').filter({ hasText: '工作稿已恢复' }).waitFor(); page.removeListener('dialog', accept);
  const catalog = await page.evaluate(() => JSON.stringify(PRODUCTS));
  const busway = await page.evaluate(() => JSON.stringify(dcPlatform.state.project?.busbars?.smartBuswayDesign ?? null));
  for (let i = 0; i < 4; i++) {
    const row = page.locator('.ns-requirement').nth(i);
    await row.locator('[data-ns-forbidden]').selectOption('false'); await row.locator('[data-ns-response]').selectOption('met');
    await row.locator('[data-ns-reason]').fill('合成复核非客户应答'); await row.locator('[data-ns-action=confirm]').click();
  }
  await page.locator('#ns-cabinet-assistant > summary').click();
  await page.locator('#ns-cabinet-template').selectOption('distribution');
  const table = '用途\t名称\t功能规格\t每套数量\n进线\tTEST-I\t合成规格I\t1\n出线\tTEST-OA\t合成规格A\t2\n出线\tTEST-OB\t合成规格B\t1';
  await page.locator('#ns-cabinet-circuits').fill(table);
  await page.locator('#ns-scheme-save').click();
  assert((await page.locator('#ns-message').textContent()).includes('辅助回路表尚未生成'), '未生成回路输入不得被保存静默丢弃');
  const equipmentRow = page.locator('[data-ns-equipment-row]').first();
  await equipmentRow.locator('[data-ns-quantity]').fill('2');
  await equipmentRow.locator('[data-ns-quantity-reason]').fill('合成外部提交');
  await equipmentRow.locator('[data-ns-quantity-save]').click();
  assert(await page.locator('#ns-cabinet-circuits').inputValue() === table, '外部提交保留辅助回路输入');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#ns-scheme-equipment').selectOption({ label: 'PDU · TEST-PDU' });
  assert(await page.locator('#ns-cabinet-circuits').inputValue() === table, '未生成输入取消切换不丢失');
  await page.locator('#ns-cabinet-generate').click();
  assert(await page.locator('.ns-component').count() === 3, '辅助生成三组');
  assert(await page.locator('[data-ns-config=ratedCurrentA]').inputValue() === '630', '带入有效确认要求');
  assert((await page.locator('#ns-scheme-state').textContent()).includes('未保存'), '生成仅未保存草稿');
  await page.locator('#ns-scheme-excel').click(); assert((await page.locator('#ns-message').textContent()).includes('未保存'), '未保存不能导出');
  await page.locator('[data-ns-config=supplyBoundary]').fill('合成柜供货边界');
  await page.locator('#ns-scheme-reason').fill('合成采用回路表'); await page.locator('#ns-scheme-save').click();
  assert((await page.locator('#ns-scheme-preview').textContent()).includes('出线3'), '说明来自已存配置');
  await page.locator('#ns-scheme-reason').fill('合成核对未完成型号'); await page.locator('#ns-scheme-confirm').click();
  assert((await page.locator('#ns-message').textContent()).includes('型号待核对'), '未核对型号阻断确认');
  const download = async (id, name) => { const pending = page.waitForEvent('download'); await page.locator(`#${id}`).click(); await (await pending).saveAs(`${out}/${name}`); };
  await download('ns-scheme-html', 'cabinet-assistant.html'); await download('ns-backup', 'cabinet-assistant.json');
  // 已存方案选择明确载入新草稿，取消时保留编辑和原方案。
  await page.locator('#ns-scheme-name').fill('TEST-未保存编辑');
  await page.locator('#ns-cabinet-assistant > summary').click();
  await page.locator('#ns-cabinet-template').selectOption('distribution'); await page.locator('#ns-cabinet-circuits').fill(table);
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#ns-cabinet-generate').click();
  assert(await page.locator('#ns-scheme-name').inputValue() === 'TEST-未保存编辑', '取消生成保留编辑');
  await page.locator('#ns-cabinet-circuits').fill(table.replace('合成规格B\t1', '合成规格B\t2'));
  await page.locator('#ns-cabinet-generate').click();
  assert((await page.locator('#ns-message').textContent()).includes('出线数量与回路表'), '回路错配阻断生成');
  await page.locator('#ns-cabinet-circuits').fill(table);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#ns-cabinet-generate').click();
  assert(await page.locator('#ns-scheme-select').inputValue() === '', '生成新方案不覆盖旧方案');
  assert(await page.locator('#ns-scheme-select option').count() === 2, '原方案仍保留');
  for (const width of [1366, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => innerWidth > 900 || document.querySelector('.platform-sidebar').getBoundingClientRect().right <= 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '无文档横向溢出');
    await page.locator('#ns-cabinet-assistant').evaluate(el => { el.open = true; });
    await page.locator('#ns-cabinet-assistant').screenshot({ path: `${out}/assistant-${width}.png` });
  }
  page.once('dialog', dialog => dialog.accept()); await page.locator('#ns-scheme-equipment').selectOption({ label: 'PDU · TEST-PDU' });
  assert(await page.locator('#ns-cabinet-assistant').count() === 0, '其他品类无柜助手');
  assert(await page.evaluate(() => JSON.stringify(PRODUCTS)) === catalog, 'UPS目录未变');
  assert(await page.evaluate(() => JSON.stringify(dcPlatform.state.project?.busbars?.smartBuswayDesign ?? null)) === busway, '既有母线设计未变');
  assert(!errors.length && !externalWrites.length, '无浏览器异常及外部写请求');
  const result = { passed: true, synthetic: true, generatedDraft: true, cancelledGenerationPreserved: true, mismatchBlocked: true,
    savedSchemePreserved: true, unverifiedModelBlocked: true, existingBuswayUnchanged: true, helperInputPreserved: true, errors, externalWrites, testedAt: new Date().toISOString() };
  const pending = page.waitForEvent('download');
  await page.evaluate(value => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); a.download = 'browser-result.json'; a.click(); }, result);
  await (await pending).saveAs(`${out}/browser-result.json`); return result;
}
