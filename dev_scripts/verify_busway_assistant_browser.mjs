// Playwright CLI function; isolated synthetic data only.
async page => {
  const assert=(v,m)=>{if(!v) throw new Error(m);};
  const out='D:/Claude 安装/UPS选型助手_开发包/output/playwright/busway-assistant';
  const errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()) && !r.url().startsWith('http://127.0.0.1:5193')) writes.push(r.url());});
  await page.setViewportSize({width:1366,height:900});
  await page.getByRole('button',{name:'非标配电售前方案',exact:true}).click();
  const fixture=await page.evaluate(async()=>{
    const m=await import('/src/modules/nonstandard-presales.js');
    let p=m.addEquipment(m.createPresalesPackage('合成母线浏览器QA'),{category:'busway',label:'TEST-BUS',quantity:2,unit:'区域包'},'合成故意未明确区域口径');
    p=m.addEquipment(p,{category:'pdu',label:'TEST-PDU',quantity:3},'合成其他品类');
    for(const quote of ['暂按两排母线槽吊装，含悬挂件、连接件和末端组件，母线为三相五线制。','规格表相数：三相四线制；主控箱集中监控，插接箱馈出断路器分励脱扣及分时下电，RS485通讯。']) {
      p=m.addPresalesSource(p,{type:'text',name:'合成要求.txt',text:quote,segments:[{start:0,end:quote.length}]},'合成来源');
      p=m.addRequirement(p,{equipmentId:p.equipment[0].id,field:'clause',candidates:[{value:quote,evidence:{sourceId:p.sources.at(-1).id,start:0,end:quote.length,quote}}]},'合成提取');
    }
    return JSON.stringify(m.createPresalesSnapshot(p));
  });
  const accept=d=>d.accept();page.on('dialog',accept);
  await page.locator('#ns-restore').setInputFiles({name:'合成母线.json',mimeType:'application/json',buffer:Buffer.from(fixture)});
  await page.locator('#ns-message').filter({hasText:'工作稿已恢复'}).waitFor();page.removeListener('dialog',accept);
  const catalog=await page.evaluate(()=>JSON.stringify(PRODUCTS)),busway=await page.evaluate(()=>JSON.stringify(dcPlatform.state.project?.busbars?.smartBuswayDesign??null));
  const table='用途\t名称\t功能规格\t区域数量\t单位\n主控箱\tTEST主控\t集中监控\t3\t套\n母线槽\tTEST轨道\t轨道式\t125.5\t米\n端口箱\tTEST端口\t输入计量\t12\t台\n插接箱\tTEST插接\t馈出监控\t64\t台';
  await page.locator('#ns-busway-assistant > summary').click();
  await page.locator('#ns-busway-table').fill(table);
  await page.locator('[data-ns-busway-source]').first().check();
  await page.locator('#ns-busway-generate').click();assert((await page.locator('#ns-message').textContent()).includes('区域包'),'明确口径/设备数');
  await page.locator('#ns-busway-basis').selectOption('region');await page.locator('#ns-busway-basis-note').fill('合成人工区域归属，非每通道');
  const row=page.locator('[data-ns-equipment-row]').first();
  await row.locator('[data-ns-quantity]').fill('1');await row.locator('[data-ns-quantity-reason]').fill('合成明确一个区域包');await row.locator('[data-ns-quantity-save]').click();
  assert(await page.locator('[data-ns-busway-source]').first().isChecked(),'外部提交保留选择');
  assert(await page.locator('#ns-busway-table').inputValue()===table,'外部提交保留区域表');
  await page.locator('#ns-scheme-save').click();assert((await page.locator('#ns-message').textContent()).includes('尚未生成'),'未生成不能保存旧稿');
  page.once('dialog',d=>d.dismiss());await page.locator('#ns-scheme-equipment').selectOption({label:'PDU · TEST-PDU'});
  assert(await page.locator('#ns-busway-table').inputValue()===table,'取消切换保留输入');
  await page.locator('[data-ns-busway-source]').nth(1).check();await page.locator('#ns-busway-generate').click();
  assert(await page.locator('[data-ns-config=controllerCount]').inputValue()==='3','主控独立数量');
  assert(await page.locator('[data-ns-config=endpointCount]').inputValue()==='12','端口独立数量');
  assert(await page.locator('[data-ns-config=terminalCount]').inputValue()==='','端口不当始端');
  assert(await page.locator('[data-ns-config=plugBoxOutputs]').inputValue()==='','插接箱数不推输出路数');
  assert(await page.locator('[data-ns-config=phase]').inputValue()==='','线制不默认');
  assert(await page.locator('.ns-component').count()===5,'四类组件加未知附件');
  assert((await page.locator('#ns-scheme-assumptions').inputValue()).includes('三相四线制'),'冲突保留');
  await page.locator('#ns-scheme-excel').click();assert((await page.locator('#ns-message').textContent()).includes('未保存'),'未保存不得输出');
  await page.locator('#ns-scheme-reason').fill('合成保存区域候选');await page.locator('#ns-scheme-save').click();
  assert((await page.locator('#ns-scheme-preview').textContent()).includes('长度125.5 m'),'说明当前值');
  await page.locator('#ns-scheme-reason').fill('合成未完成复核');await page.locator('#ns-scheme-confirm').click();
  assert((await page.locator('#ns-message').textContent()).includes('型号待核对'),'确认保留门槛');
  const download=async(id,name)=>{const p=page.waitForEvent('download');await page.locator(`#${id}`).click();await(await p).saveAs(`${out}/${name}`);};
  await download('ns-scheme-excel','busway-draft.xlsx');
  await page.locator('[data-ns-config=buswayLengthM]').fill('130.5');await page.locator('[data-ns-config=endpointCount]').fill('13');
  const component=role=>page.locator('.ns-component').filter({has:page.locator(`[data-ns-component-field=role] option:checked[value=${role}]`)});
  await component('busway').locator('[data-ns-component-field=quantity]').fill('130.5');
  await component('endpoint').locator('[data-ns-component-field=quantity]').fill('13');
  await page.locator('#ns-scheme-html').click();assert((await page.locator('#ns-message').textContent()).includes('未保存'),'变更不得导出旧稿');
  await page.locator('#ns-scheme-reason').fill('合成修改米数与端口数');await page.locator('#ns-scheme-save').click();
  assert((await page.locator('#ns-scheme-preview').textContent()).includes('长度130.5 m；主控箱3，端口箱13'),'动态同源说明');
  await download('ns-scheme-excel','busway-revised.xlsx');await download('ns-scheme-html','busway-revised.html');await download('ns-backup','busway-working.json');
  await row.locator('[data-ns-quantity]').fill('2');await row.locator('[data-ns-quantity-reason]').fill('合成误改设备数');await row.locator('[data-ns-quantity-save]').click();
  assert((await page.locator('#ns-scheme-preview').textContent()).includes('当前总数量不乘算'),'误改口径不重复乘');
  await download('ns-scheme-excel','busway-invalid-basis.xlsx');await download('ns-backup','busway-invalid-working.json');
  await row.locator('[data-ns-quantity]').fill('1');await row.locator('[data-ns-quantity-reason]').fill('合成恢复区域口径');await row.locator('[data-ns-quantity-save]').click();
  await page.locator('#ns-busway-assistant > summary').click();
  await page.locator('[data-ns-busway-source]').first().check();await page.locator('[data-ns-busway-source]').nth(1).check();
  await page.locator('#ns-busway-basis').selectOption('region');await page.locator('#ns-busway-basis-note').fill('合成重新生成，不覆盖旧方案');await page.locator('#ns-busway-table').fill(table);
  await page.locator('[data-ns-config=buswayLengthM]').fill('');await page.locator('[data-ns-config=endpointCount]').fill('');
  await page.locator('#ns-scheme-name').fill('TEST未保存名称');
  page.once('dialog',d=>d.dismiss());await page.locator('#ns-busway-generate').click();assert(await page.locator('#ns-scheme-name').inputValue()==='TEST未保存名称','取消生成保留编辑');
  page.once('dialog',d=>d.accept());await page.locator('#ns-busway-generate').click();assert(await page.locator('#ns-scheme-select option').count()===2,'已存方案未覆盖');
  for(const width of [1366,900]) {
    await page.setViewportSize({width,height:900});await page.waitForFunction(()=>innerWidth>900 || document.querySelector('.platform-sidebar').getBoundingClientRect().right<=0);
    await page.locator('#ns-busway-assistant').evaluate(el=>el.open=true);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'无横向溢出');
    await page.locator('#ns-busway-assistant').screenshot({path:`${out}/assistant-${width}.png`});
  }
  page.once('dialog',d=>d.accept());await page.locator('#ns-scheme-equipment').selectOption({label:'PDU · TEST-PDU'});
  assert(await page.locator('#ns-busway-assistant').count()===0 && await page.locator('#ns-pdu-assistant').count()===1,'品类入口隔离/PDU保留');
  assert(await page.evaluate(()=>JSON.stringify(PRODUCTS))===catalog,'目录未变');
  assert(await page.evaluate(()=>JSON.stringify(dcPlatform.state.project?.busbars?.smartBuswayDesign??null))===busway,'旧母线未改');
  assert(!errors.length && !writes.length,'无页面异常或外部写请求');
  const result={passed:true,synthetic:true,errors,externalWrites:writes,helperProtected:true,oldSchemePreserved:true,unknownsPreserved:true,modifiedNarrative:true,invalidBasisNoMultiply:true,testedAt:new Date().toISOString()};
  const p=page.waitForEvent('download');await page.evaluate(v=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(v,null,2)],{type:'application/json'}));a.download='browser-result.json';a.click();},result);await(await p).saveAs(`${out}/browser-result.json`);return result;
}
