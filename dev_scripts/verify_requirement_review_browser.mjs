// Isolated Playwright CLI function. Uses synthetic data and the previous private 1196-clause backup.
async page => {
  await page.setViewportSize({width:1366,height:900});
  const check=(ok,label)=>{if(!ok) throw new Error(label);};
  const variant=new URL(page.url()).port==='5193'?'dev':'build-subpath';
  const origin=new URL(page.url()).origin,out=`D:/Claude 安装/UPS选型助手_开发包/output/playwright/requirement-review/${variant}`;
  const errors=[],external=[],writes=[],timings=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().route('**/*',async route=>{const req=route.request();if(/^https?:/.test(req.url())&&new URL(req.url()).origin!==origin){external.push(req.url());await route.abort();}else {if(!['GET','HEAD'].includes(req.method()))writes.push(req.url());await route.continue();}});
  await page.evaluate(()=>{sessionStorage.setItem('ups_auth','ok');localStorage.clear();});await page.reload();
  await page.getByRole('button',{name:'非标配电售前方案',exact:true}).click();await page.locator('#ns-autosave').check();
  const pack=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('nonstandard_presales_working_v1')).snapshot.package);
  const rowByQuote=quote=>page.locator('.ns-requirement').filter({has:page.locator('blockquote',{hasText:quote})});
  const addEquipment=async(category,label)=>{await page.locator('#ns-category').selectOption(category);await page.locator('#ns-equipment-label').fill(label);await page.locator('#ns-equipment-reason').fill('合成QA登记');await page.locator('#ns-add-equipment').click();};
  await addEquipment('cabinet','QA-柜');await addEquipment('pdu','QA-PDU');
  const addSource=async(name,text)=>{await page.locator('#ns-source-name').fill(name);await page.locator('#ns-source-text').fill(text);await page.locator('#ns-add-source').click();await page.locator('#ns-extract').click();};
  await addSource('合成资料A',Array.from({length:45},(_,i)=>`额定电流：${i+1}A`).join('\n')+'\n<script>window.__reviewXss=1</script>');
  const sourcesA=(await pack()).sources[0].id,equipment=(await pack()).equipment;
  check(await page.locator('.ns-requirement').count()===20,'默认卡片数不是20');
  check((await page.locator('#ns-page-info').textContent()).includes('筛选46条'),'资料A统计错误');
  let row=rowByQuote('额定电流：1A');
  await row.locator('[data-ns-equipment]').selectOption(equipment[0].id);await row.locator('[data-ns-value]').fill('123');await row.locator('[data-ns-forbidden]').selectOption('true');await row.locator('[data-ns-response]').selectOption('met');await row.locator('[data-ns-reason]').fill('未记录草稿A');
  const firstId=await row.getAttribute('data-ns-id'),beforeNav=JSON.stringify(await pack());
  await page.locator('#ns-page-next').click();await page.locator('#ns-page-prev').click();
  check(await row.locator('[data-ns-value]').inputValue()==='123'&&await row.locator('[data-ns-reason]').inputValue()==='未记录草稿A','跨页输入丢失');
  check(JSON.stringify(await pack())===beforeNav,'切页改变业务包');
  const backup=page.waitForEvent('download');await page.locator('#ns-backup').click();const backupPath=out+'/synthetic-backup.json';await(await backup).saveAs(backupPath);
  check((await page.locator('#ns-message').textContent()).includes('未写入文件'),'草稿输出缺提示');
  const pkg=await pack();check(pkg.requirements.find(r=>r.id===firstId).equipmentId===null&&pkg.requirements.find(r=>r.id===firstId).confirmedValue===null,'草稿成为采用值');
  row=rowByQuote('额定电流：2A');await row.locator('[data-ns-equipment]').selectOption(equipment[1].id);await row.locator('[data-ns-reason]').fill('QA映射另一条');await row.locator('[data-ns-action=map]').click();
  check(await rowByQuote('额定电流：1A').locator('[data-ns-value]').inputValue()==='123','保存另一条清掉草稿');
  await row.locator('[data-ns-forbidden]').selectOption('false');await row.locator('[data-ns-response]').selectOption('met');await row.locator('[data-ns-reason]').fill('QA确认2A');await row.locator('[data-ns-action=confirm]').click();
  check((await row.locator('[data-ns-status]').textContent()).includes('已确认'),'确认失败');
  await row.locator('[data-ns-value]').fill('3');check((await row.locator('[data-ns-status]').textContent()).includes('待复核'),'编辑未即时失效');
  await row.locator('[data-ns-response]').selectOption('met');await row.locator('[data-ns-forbidden]').selectOption('true');await row.locator('[data-ns-response]').selectOption('deviation');await row.locator('[data-ns-action=confirm]').click();
  check((await page.locator('#ns-message').textContent()).includes('禁止偏离'),'非法确认未阻断');check(await row.locator('[data-ns-value]').inputValue()==='3','失败抹掉输入');
  await addSource('合成资料B',Array.from({length:37},(_,i)=>`备用数量：${i}个`).join('\n'));
  const sourcesB=(await pack()).sources[1].id;
  check((await page.locator('#ns-page-info').textContent()).includes('筛选37条'),'新增资料未转到该资料');
  await page.locator('#ns-filter-source').selectOption(sourcesA);check(await rowByQuote('额定电流：1A').locator('[data-ns-value]').inputValue()==='123','跨资料/提取草稿丢失');
  await page.locator('#ns-filter-status').selectOption('confirmed');check(await page.locator('.ns-requirement').count()===0,'空筛选卡片未清空');check(await page.locator('#ns-page-next').isDisabled(),'空筛选仍可下一页');
  await page.locator('#ns-filter-status').selectOption('');await page.locator('#ns-filter-keyword').fill('额定电流：1A');await page.locator('#ns-filter-keyword').press('Enter');check(await page.locator('.ns-requirement').count()===1,'关键词不生效');
  await page.locator('#ns-filter-keyword').fill('');await page.locator('#ns-filter-keyword').press('Enter');
  await page.locator('#ns-page-number').fill('999');await page.locator('#ns-page-go').click();check((await page.locator('#ns-message').textContent()).includes('页码须为'),'越界跳转未拒绝');
  await page.locator('#ns-page-size').selectOption('50');check(await page.locator('.ns-requirement').count()===46,'50页大小丢条款');check(await page.evaluate(()=>window.__reviewXss)===undefined,'XSS执行');
  // Restore cancel must preserve all drafts, filters and package; success discards only after explicit QA approval.
  await page.evaluate(()=>{window.__confirmOriginal=window.confirm;window.__confirmAnswers=[true,false];window.confirm=()=>window.__confirmAnswers.shift()??true;});
  const beforeCancel=JSON.stringify(await pack()),filterBefore=await page.locator('#ns-filter-source').inputValue();
  await page.locator('#ns-restore').setInputFiles(backupPath);await page.locator('#ns-message').filter({hasText:'未记录条款编辑保持不变'}).waitFor();
  check(JSON.stringify(await pack())===beforeCancel&&await page.locator('#ns-filter-source').inputValue()===filterBefore,'取消恢复改变数据/筛选');
  check(await rowByQuote('额定电流：1A').locator('[data-ns-value]').inputValue()==='123','取消恢复丢输入');
  // Replacing A invalidates its drafts rather than silently applying them to changed evidence.
  await page.locator('#ns-source-select').selectOption(sourcesA);await page.locator('#ns-source-text').fill('额定电流：90A');await page.evaluate(()=>{window.__confirmAnswers=[true];});await page.locator('#ns-replace-source').click();
  check((await page.locator('#ns-message').textContent()).includes('编辑因证据/字段变化失效'),'替换未提示草稿失效');check(!(await page.locator('#ns-draft-status').textContent()).includes('条未记录'),'替换后沿用旧草稿');
  await page.locator('#ns-extract').click();check(await rowByQuote('额定电流：90A').count()===1,'替换重提取失败');
  await page.evaluate(()=>{window.__confirmAnswers=[true];});await page.locator('#ns-restore').setInputFiles(backupPath);await page.locator('#ns-message').filter({hasText:'工作稿已恢复'}).waitFor();
  check(await page.locator('#ns-filter-source').inputValue()===''&&await page.locator('#ns-page-number').inputValue()==='1','恢复未重置视图');
  // Now load the actual 1196-clause private baseline. No original client files are modified.
  await page.locator('#ns-page-size').selectOption('20');
  await page.evaluate(()=>{window.__confirmAnswers=[true];});
  const realLoadStart=Date.now();
  await page.locator('#ns-restore').setInputFiles('D:/Claude 安装/UPS选型助手_开发包/output/playwright/local-file-reading/dev/real-working.json');await page.locator('#ns-message').filter({hasText:'工作稿已恢复'}).waitFor();
  timings.push({label:'真实工作稿恢复首屏',ms:Date.now()-realLoadStart});check(timings.at(-1).ms<=5000,'真实工作稿首屏超过5秒');
  let real=await pack();check(real.requirements.length===1196&&real.sources.length===5,'真实工作稿规模错误');
  const realBefore=JSON.stringify(real);await page.locator('#ns-page-size').selectOption('20');
  const time=async(label,fn)=>{const start=Date.now();await fn();const ms=Date.now()-start;timings.push({label,ms});check(ms<=5000,`${label}耗时${ms}ms超过门槛`);};
  check(await page.locator('.ns-requirement').count()===20,'真实首屏不是20');check(await page.locator('#ns-clarifications li').count()<=20&&await page.locator('[data-ns-revision]').count()<=20,'辅助列表未限量');
  const seen=[];
  await page.locator('#ns-page-size').selectOption('50');
  for(let p=1;p<=24;p++) {
    const ids=await page.locator('.ns-requirement').evaluateAll(rows=>rows.map(r=>r.dataset.nsId));check(ids.length<=(p===24?46:50),'页大小越界');seen.push(...ids);
    if(p<24) await time(`真实50条切页${p+1}`,()=>page.locator('#ns-page-next').click());
  }
  check(seen.length===1196&&new Set(seen).size===1196,'真实分页重复/漏条款');check(await page.locator('#ns-page-next').isDisabled(),'末页仍可下一页');
  for(const source of real.sources) {
    await time(`资料筛选-${source.type}`,()=>page.locator('#ns-filter-source').selectOption(source.id));
    const count=real.requirements.filter(r=>r.candidates.some(c=>c.evidence.sourceId===source.id)).length;
    check((await page.locator('#ns-page-info').textContent()).includes(`筛选${count}条`),'真实按资料数量错误');
  }
  await page.locator('#ns-filter-source').selectOption('');await page.locator('#ns-page-size').selectOption('20');
  await time('真实跳到末页',async()=>{await page.locator('#ns-page-number').fill('60');await page.locator('#ns-page-go').click();});check(await page.locator('.ns-requirement').count()===16,'末页16条错误');
  await time('真实关键词筛选',async()=>{await page.locator('#ns-filter-keyword').fill('XX');await page.locator('#ns-filter-keyword').press('Enter');});
  check(await page.locator('.ns-requirement').count()>0,'XX未知条款丢失');
  await page.locator('#ns-filter-keyword').fill('');await page.locator('#ns-filter-keyword').press('Enter');await time('真实待处理筛选',()=>page.locator('#ns-review-todo').click());
  check(JSON.stringify(await pack())===realBefore,'真实导航改了业务数据');
  // A real row can be edited and mapped without losing the full dataset. Test-only review, not business adoption.
  await addEquipment('cabinet','QA真实复核设备');real=await pack();
  const realRow=page.locator('.ns-requirement').first(),raw=await realRow.locator('blockquote').first().textContent();
  await realRow.locator('[data-ns-equipment]').selectOption(real.equipment[0].id);await realRow.locator('[data-ns-reason]').fill('QA本机性能验收，不是业务采用');
  await time('真实单条分配',()=>realRow.locator('[data-ns-action=map]').click());
  const mapped=page.locator('.ns-requirement').filter({has:page.locator('blockquote',{hasText:raw})}).first();
  await mapped.locator('[data-ns-forbidden]').selectOption('false');await mapped.locator('[data-ns-response]').selectOption('met');await mapped.locator('[data-ns-reason]').fill('QA性能确认，非正式业务结论');
  await time('真实单条确认',()=>mapped.locator('[data-ns-action=confirm]').click());
  check((await page.locator('#ns-message').textContent()).includes('人工复核'),'真实单条提交失败');
  await page.locator('#ns-filter-status').selectOption('');await page.locator('#ns-filter-keyword').fill(raw);await page.locator('#ns-filter-keyword').press('Enter');
  const editing=page.locator('.ns-requirement').first();await editing.locator('[data-ns-value]').fill('QA未记录值不得进入导出');check((await editing.locator('[data-ns-status]').textContent()).includes('待复核'),'真实编辑未撤销确认');
  const excel=page.waitForEvent('download');await page.locator('#ns-export').click();await(await excel).saveAs(out+'/real-requirements.xlsx');
  const json=page.waitForEvent('download');await page.locator('#ns-backup').click();await(await json).saveAs(out+'/real-working-after-qa.json');
  const after=await pack();check(after.requirements.length===1196&&after.sources.length===5,'真实提交/输出丢失全量数据');check(!JSON.stringify(after).includes('QA未记录值不得进入导出'),'输出采用未记录草稿');
  await page.evaluate(()=>{window.__confirmAnswers=[true];});await page.locator('#ns-discard-drafts').click();
  await page.locator('#ns-filter-keyword').fill('');await page.locator('#ns-filter-keyword').press('Enter');
  for(const width of [1366,1920,900]) {await page.setViewportSize({width,height:900});await page.waitForFunction(()=>innerWidth>900||document.querySelector('.platform-sidebar').getBoundingClientRect().right<=0);check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'水平溢出');await page.locator('#ns-page-info').scrollIntoViewIfNeeded();await page.screenshot({path:out+`/review-${width}.png`});}
  await page.evaluate(()=>{window.confirm=window.__confirmOriginal;delete window.__confirmOriginal;delete window.__confirmAnswers;});
  check(errors.length===0&&external.length===0&&writes.length===0,'页面错误/外网/写请求');
  const sorted=timings.map(t=>t.ms).sort((a,b)=>a-b),result={passed:true,variant,testedAt:new Date().toISOString(),realSources:5,realRequirements:1196,paginationUnique:1196,maxCards:50,summaryLimit:20,draftsPreserved:true,draftNotExported:true,replaceInvalidatedDrafts:true,restoreCancelProtected:true,restoreReset:true,confirmedEditInvalidates:true,timings,medianMs:sorted[Math.floor(sorted.length/2)],maxMs:Math.max(...sorted),widths:[1366,1920,900],errors,external,writes,businessAcceptance:'pending'};
  const download=page.waitForEvent('download');await page.evaluate(value=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)]));a.download='browser-result.json';a.click();},result);await(await download).saveAs(out+'/browser-result.json');return {passed:true,variant,maxMs:result.maxMs,medianMs:result.medianMs,realRequirements:1196};
}
