// Playwright CLI function; synthetic only, no customer commitment.
async page => {
  const assert=(v,m)=>{ if(!v) throw new Error(m); };
  const out='D:/Claude 安装/UPS选型助手_开发包/output/playwright/pdu-assistant';
  const errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{ if(!['GET','HEAD'].includes(r.method()) && !r.url().startsWith('http://127.0.0.1:5193')) writes.push(r.url()); });
  await page.setViewportSize({width:1366,height:900});
  await page.getByRole('button',{name:'非标配电售前方案',exact:true}).click();
  const fixture=await page.evaluate(async()=>{
    const m=await import('/src/modules/nonstandard-presales.js');
    let p=m.addEquipment(m.createPresalesPackage('合成PDU浏览器QA'),{category:'pdu',label:'TEST-PDU',quantity:3},'合成登记');
    p=m.addEquipment(p,{category:'cabinet',label:'TEST-CAB'},'合成登记');
    for(const quote of ['采用输入AC230V 32A,输出12位国标三孔10A插座+2位国标三孔16A插座，后续设计联络最终确定。','PDU需插座级监控，支持远程上下电控制。']) {
      p=m.addPresalesSource(p,{type:'text',name:'合成要求.txt',text:quote,segments:[{start:0,end:quote.length}]},'合成来源');
      p=m.addRequirement(p,{equipmentId:p.equipment[0].id,field:'clause',candidates:[{value:quote,evidence:{sourceId:p.sources.at(-1).id,start:0,end:quote.length,quote}}]},'合成提取');
    }
    return JSON.stringify(m.createPresalesSnapshot(p));
  });
  const accept=d=>d.accept(); page.on('dialog',accept);
  await page.locator('#ns-restore').setInputFiles({name:'合成PDU.json',mimeType:'application/json',buffer:Buffer.from(fixture)});
  await page.locator('#ns-message').filter({hasText:'工作稿已恢复'}).waitFor(); page.removeListener('dialog',accept);
  const catalog=await page.evaluate(()=>JSON.stringify(PRODUCTS));
  const busway=await page.evaluate(()=>JSON.stringify(dcPlatform.state.project?.busbars?.smartBuswayDesign??null));
  await page.locator('#ns-pdu-assistant > summary').click();
  await page.locator('[data-ns-pdu-source]').first().check();
  await page.locator('#ns-pdu-generate').click();
  assert((await page.locator('#ns-message').textContent()).includes('机架PDU'),'类型必须显式选择');
  await page.locator('[data-ns-config=pduType]').selectOption('rack');
  await page.locator('#ns-scheme-save').click();
  assert((await page.locator('#ns-message').textContent()).includes('尚未生成'),'未生成选择不能保存旧方案');
  const row=page.locator('[data-ns-equipment-row]').first();
  await row.locator('[data-ns-quantity]').fill('3'); await row.locator('[data-ns-quantity-reason]').fill('合成外部提交');
  await row.locator('[data-ns-quantity-save]').click();
  assert(await page.locator('[data-ns-pdu-source]').first().isChecked(),'外部提交保留辅助选择');
  page.once('dialog',d=>d.dismiss()); await page.locator('#ns-scheme-equipment').selectOption({label:'配电柜 · TEST-CAB'});
  assert(await page.locator('[data-ns-pdu-source]').first().isChecked(),'取消切换保留选择');
  await page.locator('[data-ns-pdu-source]').nth(1).check();
  page.once('dialog',d=>d.accept()); await page.locator('#ns-pdu-generate').click();
  assert(await page.locator('[data-ns-config=outputCount]').inputValue()==='14','多规格合计14');
  assert(await page.locator('[data-ns-config=inputCount]').inputValue()==='','输入数不默认');
  assert(await page.locator('[data-ns-config=branchCount]').inputValue()==='','保护分路不推算');
  assert(await page.locator('.ns-component').count()===4,'输入/两种插座/监控功能四项');
  await page.locator('#ns-scheme-excel').click();
  assert((await page.locator('#ns-message').textContent()).includes('未保存'),'未保存不得输出');
  await page.locator('#ns-scheme-reason').fill('合成采用候选'); await page.locator('#ns-scheme-save').click();
  assert((await page.locator('#ns-scheme-preview').textContent()).includes('插座14位'),'同源说明');
  await page.locator('#ns-scheme-reason').fill('合成未完成复核'); await page.locator('#ns-scheme-confirm').click();
  assert((await page.locator('#ns-message').textContent()).includes('型号待核对'),'型号门禁保留');
  const download=async(id,name)=>{const p=page.waitForEvent('download');await page.locator(`#${id}`).click();await(await p).saveAs(`${out}/${name}`);};
  await download('ns-scheme-excel','pdu-draft.xlsx');
  await page.locator('[data-ns-config=outputCount]').fill('15');
  const outputs=page.locator('.ns-component').filter({has:page.locator('[data-ns-component-field=role] option:checked[value=output]')});
  await outputs.first().locator('[data-ns-component-field=quantity]').fill('13');
  await page.locator('#ns-scheme-html').click(); assert((await page.locator('#ns-message').textContent()).includes('未保存'),'修改后不能导出旧稿');
  await page.locator('#ns-scheme-reason').fill('合成插座变更'); await page.locator('#ns-scheme-save').click();
  assert((await page.locator('#ns-scheme-preview').textContent()).includes('插座15位'),'修改后说明同步');
  await download('ns-scheme-excel','pdu-revised.xlsx'); await download('ns-scheme-html','pdu-revised.html'); await download('ns-backup','pdu-working.json');
  await page.locator('#ns-pdu-assistant > summary').click();
  await page.locator('[data-ns-pdu-source]').first().check();
  await page.locator('[data-ns-config=outputCount]').fill('');
  await page.locator('#ns-scheme-name').fill('TEST-未保存名称');
  page.once('dialog',d=>d.dismiss()); await page.locator('#ns-pdu-generate').click();
  assert(await page.locator('#ns-scheme-name').inputValue()==='TEST-未保存名称','取消替换不丢编辑');
  page.once('dialog',d=>d.accept()); await page.locator('#ns-pdu-generate').click();
  assert(await page.locator('#ns-scheme-select option').count()===2,'旧已存方案保留');
  for(const width of [1366,900]) {
    await page.setViewportSize({width,height:900});
    await page.waitForFunction(()=>innerWidth>900 || document.querySelector('.platform-sidebar').getBoundingClientRect().right<=0);
    await page.locator('#ns-pdu-assistant').evaluate(el=>el.open=true);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'无横向溢出');
    await page.locator('#ns-pdu-assistant').screenshot({path:`${out}/assistant-${width}.png`});
  }
  page.once('dialog',d=>d.accept()); await page.locator('#ns-scheme-equipment').selectOption({label:'配电柜 · TEST-CAB'});
  assert(await page.locator('#ns-pdu-assistant').count()===0,'非PDU不显示助手');
  assert(await page.evaluate(()=>JSON.stringify(PRODUCTS))===catalog,'UPS目录未变');
  assert(await page.evaluate(()=>JSON.stringify(dcPlatform.state.project?.busbars?.smartBuswayDesign??null))===busway,'旧母线未变');
  assert(!errors.length && !writes.length,'无页面异常/外部写请求');
  const result={passed:true,synthetic:true,errors,externalWrites:writes,helperProtected:true,oldSchemePreserved:true,unknownsPreserved:true,modifiedNarrative:true,testedAt:new Date().toISOString()};
  const p=page.waitForEvent('download');await page.evaluate(v=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(v,null,2)],{type:'application/json'}));a.download='browser-result.json';a.click();},result);
  await(await p).saveAs(`${out}/browser-result.json`); return result;
}
