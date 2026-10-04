// Playwright CLI function. Real trial copy, never confirms or modifies engineering values.
async page => {
  const assert=(ok,label)=>{if(!ok)throw new Error(label);};
  const out='D:/Claude 安装/UPS选型助手_开发包/output/playwright/business-trial-20261004';
  const origin=new URL(page.url()).origin,errors=[],external=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().route('**/*',async route=>{const req=route.request();if(/^https?:/.test(req.url())&&new URL(req.url()).origin!==origin){external.push(req.url());await route.abort();}else{if(!['GET','HEAD'].includes(req.method()))writes.push(req.url());await route.continue();}});
  await page.setViewportSize({width:1366,height:900});
  await page.evaluate(()=>{sessionStorage.setItem('ups_auth','ok');localStorage.clear();});await page.reload();
  await page.getByRole('button',{name:'非标配电售前方案',exact:true}).click();
  page.once('dialog',d=>d.accept());
  await page.locator('#ns-restore').setInputFiles('D:/Claude 安装/UPS选型助手_开发包/output/business-trial/2026-10-04/prepared-working.json');
  await page.locator('#ns-message').filter({hasText:'工作稿已恢复'}).waitFor();
  assert(!await page.locator('#ns-autosave').isChecked(),'试用误开启客户原文自动保存');
  assert(await page.locator('.ns-requirement').count()===20,'恢复后未按20分页');
  const download=async(id,path)=>{const pending=page.waitForEvent('download');await page.locator('#'+id).click();await(await pending).saveAs(out+'/'+path);};
  await download('ns-backup','before.json');
  const entries=await page.locator('#ns-scheme-equipment option').evaluateAll(options=>options.map(o=>({id:o.value,label:o.textContent})).filter(o=>o.id));
  assert(entries.length===4,'真实设备项不为4');
  for(const [index,entry] of entries.entries()){
    await page.locator('#ns-filter-equipment').selectOption(entry.id);
    assert(await page.locator('.ns-requirement').count()>0,'设备要求无法查看');
    await page.locator('#ns-scheme-equipment').selectOption(entry.id);
    const schemes=await page.locator('#ns-scheme-select option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
    assert(schemes.length===1,'本设备保存方案数异常');await page.locator('#ns-scheme-select').selectOption(schemes[0]);
    assert((await page.locator('#ns-scheme-preview').textContent()).includes('讨论稿'),'缺少讨论稿边界');
    await download('ns-scheme-excel',`scheme-${index+1}.xlsx`);await download('ns-scheme-html',`scheme-${index+1}.html`);
  }
  await page.locator('#ns-filter-equipment').selectOption('');
  await download('ns-backup','after.json');
  await page.locator('#ns-scheme-section').screenshot({path:out+'/scheme-preview.png'});
  for(const width of [1366,900]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'横向溢出');}
  assert(!errors.length&&!external.length&&!writes.length,'浏览器异常或外部请求');
  const result={passed:true,testedAt:new Date().toISOString(),realSchemes:4,exportPairs:4,confirmedActions:0,autoSave:false,widths:[1366,900],errors,external,writes,businessAcceptance:'pending'};
  const pending=page.waitForEvent('download');await page.evaluate(value=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)]));a.download='browser-result.json';a.click();},result);await(await pending).saveAs(out+'/browser-result.json');return result;
}
