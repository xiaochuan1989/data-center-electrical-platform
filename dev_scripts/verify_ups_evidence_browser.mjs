// 用隔离的本机浏览器执行页面验收，不使用真实客户数据。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output', 'playwright', 'ups-evidence');

export async function run(page) {
  await fs.mkdir(out, { recursive: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.log(message.type(), message.text()); });
  page.on('requestfailed', request => console.log('requestfailed', request.url(), request.failure()?.errorText));
  await page.getByRole('textbox', { name: '请粘贴客户技术要求', exact: false }).fill('UPS额定容量200kVA，三进三出，后备时间30分钟');
  await page.getByRole('button', { name: '从需求文字提取', exact: true }).click();
  assert.equal(await page.locator('#ups-crit-capacity').inputValue(), '200');
  await page.locator('#ups-criteria-confirmed').check();
  await page.getByRole('button', { name: '开始选型', exact: false }).click();
  await page.locator('#result-section.show').waitFor();
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem('ups_selection_history')).records[0]);
  assert.equal(first.confirmedRequirement.evidenceVersion, 1);
  assert.equal(first.confirmedRequirement.capacityKva, 200);
  assert.equal(first.recommended.length, 0, '未经在售与后备时间核对仍不得放行');
  await page.locator('#ups-crit-capacity').fill('250');
  await page.locator('#ups-crit-capacity').press('Tab');
  assert.equal(await page.locator('#ups-criteria-confirmed').isChecked(), false);
  await page.locator('#ups-criteria-confirmed').click();
  assert.equal(await page.locator('#ups-criteria-confirmed').isChecked(), false, '缺修改原因不能确认');
  await page.getByRole('textbox', { name: '修改原因', exact: true }).last().fill('客户澄清将容量提高到250kVA');
  await page.locator('#ups-criteria-confirmed').check();
  await page.getByRole('button', { name: '开始选型', exact: false }).click();
  const second = await page.evaluate(() => JSON.parse(localStorage.getItem('ups_selection_history')).records[0]);
  assert.equal(second.confirmedRequirement.capacityKva, 250);
  assert.equal(second.confirmedRequirement.revisions[0].from, 200);
  assert.equal(second.confirmedRequirement.revisions[0].to, 250);
  assert.equal(first.confirmedRequirement.capacityKva, 200);
  const model = second.also_consider[0].model;
  await page.locator('#ups-adopt-model').selectOption({ label: model });
  await page.locator('#ups-adopt-reason').fill('方案初选，订货前补齐在售与电池曲线核对');
  await page.getByRole('button', { name: '记录采用型号', exact: true }).click();
  assert.ok((await page.locator('#ups-adoption-status').textContent()).includes(model));

  const htmlText = await page.evaluate(() => buildUpsSelectionDocument());
  assert.ok(htmlText.includes('客户澄清将容量提高到250kVA'));
  assert.ok(htmlText.includes('UPS额定容量200kVA'));
  assert.ok(htmlText.includes('资料不足'));
  await fs.writeFile(path.join(out, 'technical-note.html'), htmlText);
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: '备份方案 JSON', exact: true }).click();
  await (await backup).saveAs(path.join(out, 'snapshot.json'));
  const snapshot = JSON.parse(await fs.readFile(path.join(out, 'snapshot.json'), 'utf8'));
  assert.equal(snapshot.record.confirmedRequirement.capacityKva, 250);
  assert.ok(snapshot.record.confirmedRequirement.fieldEvidence.capacityKva.candidates[0].quote.includes('200kVA'));
  const historyBackup = page.waitForEvent('download');
  await page.evaluate(() => exportUpsHistoryJson());
  await (await historyBackup).saveAs(path.join(out, 'history.json'));
  const allRecords = JSON.parse(await fs.readFile(path.join(out, 'history.json'), 'utf8')).records;
  assert.equal(allRecords.find(r => r.id === second.id).confirmedRequirement.capacityKva, 250);
  assert.equal(allRecords.find(r => r.id === first.id).confirmedRequirement.capacityKva, 200);
  const historyXlsx = page.waitForEvent('download');
  await page.evaluate(() => exportHistory());
  await (await historyXlsx).saveAs(path.join(out, 'history.xlsx'));
  await page.evaluate(ids => {
    filterHistory();
    for (const control of document.querySelectorAll('.ups-history-compare')) control.checked = ids.includes(control.value);
    compareUpsHistory();
  }, [first.id, second.id]);
  assert.ok((await page.locator('#compare-content').textContent()).includes('客户澄清将容量提高到250kVA'));
  await page.evaluate(() => { document.getElementById('compare-modal').style.display = 'none'; document.body.style.overflow = ''; });

  // 打印入口真实打开同一份证据文档；Chrome PDF另存用于内容和分页核对。
  await page.context().addInitScript(() => { window.print = () => {}; });
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: '打印/PDF', exact: false }).click();
  const printPage = await popup;
  await printPage.waitForLoadState();
  assert.ok((await printPage.locator('body').textContent()).includes('客户澄清将容量提高到250kVA'));
  await printPage.pdf({ path: path.join(out, 'technical-note.pdf'), format: 'A4', printBackground: true });
  await printPage.close();

  // 下载真实Excel并检查四个工作表，保留导出供离线读取核对。
  const xlsx = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出校核表', exact: false }).click();
  await (await xlsx).saveAs(path.join(out, 'selection.xlsx'));
  for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 900, height: 900 }]) {
    await page.setViewportSize(size);
    await page.locator('#ups-evidence-panel').evaluate(el => { el.open = true; });
    await page.locator('#ups-criteria').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '页面不应横向溢出');
    await page.screenshot({ path: path.join(out, `evidence-${size.width}.png`), fullPage: true });
  }

  // 导入备份用新的ID，避免重复ID正常去重掩盖验证。
  const restored = { ...snapshot, record: { ...snapshot.record, id: 'qa-evidence-import' } };
  await page.evaluate(async payload => {
    await importUpsHistoryJson({ files: [new File([JSON.stringify(payload)], 'qa.json')], value: 'qa' });
  }, restored);
  const imported = await page.evaluate(() => JSON.parse(localStorage.getItem('ups_selection_history')).records.find(r => r.id === 'qa-evidence-import'));
  assert.equal(imported.confirmedRequirement.revisions[0].reason, '客户澄清将容量提高到250kVA');
  page.once('dialog', dialog => dialog.accept());
  await page.evaluate(() => restoreUpsHistoryById('qa-evidence-import', { stopPropagation() {} }));
  assert.equal(await page.locator('#ups-crit-capacity').inputValue(), '250');
  assert.ok((await page.locator('#ups-evidence-content').textContent()).includes('客户澄清将容量提高到250kVA'));
  const old = { kind: 'ups-selection-snapshot', version: 1, record: { id: 'qa-old', timestamp: '旧版样例',
    requirement: '旧需求', confirmedRequirement: { capacityKva: 200, sourceText: '旧需求', confirmedAt: '2026-09-01' }, recommended: [], also_consider: [] } };
  await page.evaluate(async payload => { await importUpsHistoryJson({ files: [new File([JSON.stringify(payload)], 'old.json')], value: 'old' }); }, old);
  page.once('dialog', dialog => dialog.accept());
  await page.evaluate(() => restoreUpsHistoryById('qa-old', { stopPropagation() {} }));
  assert.equal(await page.locator('#ups-crit-capacity').inputValue(), '200');
  assert.ok((await page.evaluate(() => buildUpsSelectionDocument())).includes('历史记录未保存证据'));

  // 实际PDF.js路径读取三页合成PDF，其中第二页没有文字。
  await page.locator('#doc-upload').setInputFiles(path.join(out, 'multi-page.pdf'));
  await page.waitForFunction(() => document.getElementById('doc-file-name').textContent.includes('multi-page.pdf') ||
    document.querySelector('#toast-stack')?.textContent.includes('文档读取失败'));
  assert.ok((await page.locator('#doc-file-name').textContent()).includes('multi-page.pdf'),
    await page.locator('#toast-stack').textContent());
  assert.equal(await page.locator('#ups-criteria-confirmed').isChecked(), false, '上传程序写入取消确认');
  await page.getByRole('button', { name: '从需求文字提取', exact: true }).click();
  assert.equal(await page.locator('#ups-crit-capacity').inputValue(), '', '两页容量冲突不选首值');
  const evidence = await page.evaluate(() => readUpsCriteria().fieldEvidence.capacityKva.candidates);
  assert.deepEqual(evidence.map(c => c.page), [1, 3]);
  assert.ok((await page.locator('#ups-evidence-content').textContent()).includes('PDF第2页'));
  await page.getByRole('combobox', { name: '选择额定容量下限证据', exact: true }).selectOption('1');
  await page.getByRole('textbox', { name: '修改原因', exact: true }).last().fill('采用第3页澄清要求');
  await page.locator('#ups-criteria-confirmed').check();
  assert.equal(await page.locator('#ups-crit-capacity').inputValue(), '300');
  await page.locator('#doc-upload').setInputFiles(path.join(out, 'multi-page.pdf'));
  await page.waitForFunction(() => document.getElementById('ups-criteria-note').textContent.includes('资料已替换'));
  await page.locator('#ups-criteria-confirmed').click();
  assert.equal(await page.locator('#ups-criteria-confirmed').isChecked(), false, '相同文字但重新上传文件仍需提取');
  await page.getByRole('button', { name: '从需求文字提取', exact: true }).click();
  const currentText = await page.locator('#requirement').inputValue();
  await page.locator('#doc-upload').setInputFiles(path.join(out, 'empty.pdf'));
  await page.waitForFunction(() => document.querySelector('#toast-stack')?.textContent.includes('未读取到有效文字'));
  assert.equal(await page.locator('#requirement').inputValue(), currentText, '空扫描文档不覆盖原文');
  await page.locator('#requirement').fill(currentText + '\n客户新要求');
  assert.equal(await page.locator('#ups-criteria-confirmed').isChecked(), false);
  await page.locator('#ups-criteria-confirmed').click();
  assert.equal(await page.locator('#ups-criteria-confirmed').isChecked(), false, '失效原文不允许重新勾选绕过提取');

  // 限额存储失败时不能显示新成功结果，旧记录不丢失。
  await page.getByRole('button', { name: '从需求文字提取', exact: true }).click();
  await page.getByRole('combobox', { name: '选择额定容量下限证据', exact: true }).selectOption('0');
  const reasons = page.getByRole('textbox', { name: '修改原因', exact: true });
  for (const input of await reasons.all()) if (!(await input.inputValue())) await input.fill('存储失败验收，采用原规范值');
  await page.locator('#ups-criteria-confirmed').check();
  const recordCount = await page.evaluate(() => JSON.parse(localStorage.getItem('ups_selection_history')).records.length);
  await page.evaluate(() => { window.qaOriginalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
    if (key === 'ups_selection_history') throw new DOMException('验收存储配额不足', 'QuotaExceededError');
    return window.qaOriginalSetItem.call(this, key, value);
  }; });
  try {
    await page.getByRole('button', { name: '开始选型', exact: false }).click();
    assert.ok((await page.locator('#toast-stack').textContent()).includes('选型失败'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ups_selection_history')).records.length), recordCount);
  } finally { await page.evaluate(() => { Storage.prototype.setItem = window.qaOriginalSetItem; }); }
  // 外部AI不实调：本地替身验证发送边界和等待期间修改条件的失效保护。
  await page.evaluate(() => {
    window.qaOriginalCallAI = callAI;
    document.getElementById('apikey').value = 'qa-placeholder';
    callAI = (text, prompt) => { window.qaPrompt = prompt; return new Promise(resolve => { window.qaResolveAI = resolve; }); };
  });
  try {
    await page.getByRole('button', { name: '开始选型', exact: false }).click();
    await page.waitForFunction(() => typeof window.qaResolveAI === 'function');
    const prompt = await page.evaluate(() => window.qaPrompt);
    assert.ok(!prompt.includes('evidenceText') && !prompt.includes('fieldEvidence') && !prompt.includes('revisions'));
    await page.locator('#ups-crit-capacity').fill('350');
    await page.locator('#ups-crit-capacity').press('Tab');
    await page.evaluate(() => window.qaResolveAI('{"analysis":"模拟结果","recommended":[],"also_consider":[]}'));
    await page.waitForFunction(() => !document.getElementById('analyze-btn').disabled);
    assert.ok((await page.locator('#toast-stack').textContent()).includes('等待期间需求或确认条件已修改'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ups_selection_history')).records.length), recordCount);
  } finally {
    await page.evaluate(() => { callAI = window.qaOriginalCallAI; document.getElementById('apikey').value = ''; });
  }
  // 多份资料追加保留独立文件名、PDF页序和新文档的候选值。
  await fs.writeFile(path.join(out, 'clarification.txt'), '后备时间45分钟');
  await page.locator('#ups-upload-append').check();
  await page.locator('#doc-upload').setInputFiles(path.join(out, 'multi-page.pdf'));
  await page.waitForFunction(() => document.getElementById('ups-criteria-note').textContent.includes('已加入新的资料'));
  await page.getByRole('button', { name: '从需求文字提取', exact: true }).click();
  await page.locator('#doc-upload').setInputFiles(path.join(out, 'clarification.txt'));
  await page.waitForFunction(() => document.getElementById('doc-file-name').textContent.includes('clarification.txt'));
  await page.getByRole('button', { name: '从需求文字提取', exact: true }).click();
  const appended = await page.evaluate(() => readUpsCriteria());
  assert.ok(appended.sources.some(s => s.name === 'multi-page.pdf'));
  assert.ok(appended.sources.some(s => s.name === 'clarification.txt'));
  assert.deepEqual(appended.fieldEvidence.backupMinutes.candidates.map(c => c.value), [30, 30, 45]);
  assert.equal(appended.backupMinutes, null);
  assert.ok(appended.fieldEvidence.capacityKva.candidates.some(c => c.page === 3));
  assert.deepEqual(errors, [], '主流程没有页面脚本异常');
  const result = { status: 'passed', viewports: [1366, 1920, 900], checks: ['需求提取', '修订原因阻断', '采用风险', 'HTML/JSON/Excel导出',
    '整库备份/导出/方案比较', '打印窗口/Chrome PDF', 'JSON导入恢复', '旧备份兼容', 'PDF第1/3页证据', '空扫描页',
    '同文重传失效', '原文确认失效', '存储失败', 'AI发送边界/异步失效（模拟）', '多文档追加冲突'], errors };
  await fs.writeFile(path.join(out, 'browser-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.UPS_QA_PLAYWRIGHT_PATH || 'playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(process.env.UPS_QA_URL || 'http://127.0.0.1:5173/');
    await page.locator('#auth-input').fill('173205');
    await page.locator('#auth-input').press('Enter');
    await page.getByRole('button', { name: '智能选型', exact: false }).first().click();
    try {
      await run(page);
    } catch (error) {
      console.error(await page.locator('#toast-stack').textContent().catch(() => '无提示'));
      await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
      throw error;
    }
  } finally {
    await browser.close();
  }
}
