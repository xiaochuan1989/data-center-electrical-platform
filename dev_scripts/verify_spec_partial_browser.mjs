// Playwright CLI function; run only in an isolated local QA session, never the user's live page.
async page => {
  page.setDefaultTimeout(7000);
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const out='D:/Claude 安装/UPS选型助手_开发包/output/playwright/spec-partial-2141';
  const errors=[],external=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  let mode='valid',releaseReview,holdReview=true;
  const reviewGate=new Promise(resolve=>{releaseReview=resolve;});
  await page.context().route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.hostname==='synthetic.invalid') {
      const data=JSON.parse(request.postData()).messages[1].content,input=JSON.parse(data);
      calls.push(input.task);
      if(input.task==='review'&&holdReview)await reviewGate;
      if(input.task==='review'&&mode==='review-failure')return route.fulfill({status:503,contentType:'application/json',body:'{}'});
      let output;
      const detail=(name,value,original_text)=>({name,value,original_text,evidence_status:'VERIFIED',source_status:'DOCUMENT',risk:'LOW'});
      if(input.task==='discovery')output={complete:true,devices:['UPS-A','UPS-B'].map(device_name=>({device_type:'UPS主机',device_name,scope:'',original_text:device_name}))};
      else if(input.task==='review')output={complete:true,source_checked:true,checked_parameter_ids:input.review_parameters.map(p=>p.parameter_id),issues:[]};
      else output={complete:true,products:input.known_devices.map((p,i)=>({...p,params_detail:i===0
        ?[{...detail('额定功率','100kVA','UPS-A额定功率100kVA'),...(mode==='bad-condition'?{condition:'正常运行时<script>window.__partialXss=1</script>',condition_original_text:'UPS-A额定功率100kVA'}:{})},detail('额定电流','不低于630A','额定电流不低于630A')]
        :[detail('额定功率','200kVA','UPS-B额定功率200kVA')]}))};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]})});
    }
    if(/^https?:$/.test(url.protocol)&&url.origin!==new URL(page.url()).origin){external.push(request.url());return route.abort();}
    return route.continue();
  });
  await page.setViewportSize({width:1366,height:950});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('#provider').selectOption('custom');
  await page.locator('#baseurl-custom').fill('https://synthetic.invalid/v1');
  await page.locator('#model').fill('synthetic-local-qa');
  await page.locator('#apikey').fill('synthetic-not-a-real-key');
  await page.getByRole('button',{name:'保存并关闭',exact:true}).click();
  await page.locator('#ns-autosave').check();
  await page.locator('#ns-source-name').fill('合成部分结果验收.txt');
  await page.locator('#ns-source-text').fill('合成软件验收，不是客户资料。UPS-A额定功率100kVA，额定电流不低于630A。UPS-B额定功率200kVA。');
  await page.locator('#ns-add-source').click();
  await page.locator('#ns-ai-analyze').click();
  await page.waitForFunction(()=>document.querySelector('#ns-ai-results').textContent.includes('3项有原文依据的参数'));
  check(await page.locator('#ns-ai-analyze').isDisabled(),'复核完成前仍在处理');
  check((await page.locator('#ns-ai-results').innerText()).includes('未完成工作稿'),'复核前必须显示中间状态');
  holdReview=false;releaseReview();
  await page.waitForFunction(()=>!document.querySelector('#ns-ai-analyze').disabled);
  check((await page.locator('#ns-ai-progress').innerText()).includes('复核完成'),'完整调用未成功');
  const prior=await page.evaluate(()=>localStorage.getItem('spec_ai_extractions_v1'));
  mode='bad-condition';await page.locator('#ns-ai-analyze').click();
  await page.waitForFunction(()=>!document.querySelector('#ns-ai-analyze').disabled);
  let body=await page.locator('#ns-ai-results').innerText();
  check(body.includes('2项有原文依据的参数')&&body.includes('参数适用条件没有原文依据'),'失败条件未单独显示');
  check(body.includes('模型候选条件（未核验）')&&body.includes('查看上次完整工作稿'),'候选状态或旧完整工作稿缺失');
  check(await page.evaluate(()=>localStorage.getItem('spec_ai_extractions_v1'))===prior,'失败调用覆盖完整稿');
  check(await page.evaluate(()=>window.__partialXss)===undefined,'模型内容被执行');
  for(const [id,name]of [['ns-ai-json','partial.json'],['ns-ai-excel','partial.xlsx'],['ns-ai-html','partial.html']]) {
    const download=page.waitForEvent('download',{timeout:7000});await page.locator('#'+id).click();await(await download).saveAs(out+'/'+name);
  }
  for(const width of [1366,900]){
    await page.setViewportSize({width,height:950});await page.locator('#ns-ai-results').scrollIntoViewIfNeeded();
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'工作稿引起横向溢出');
    await page.screenshot({path:out+`/partial-${width}.png`});
  }
  await page.reload();await page.setViewportSize({width:1366,height:950});await page.getByRole('button',{name:'非标配电售前方案',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#ns-ai-results').textContent.includes('未完成工作稿'));
  check((await page.locator('#ns-ai-results').innerText()).includes('2项有原文依据的参数'),'刷新丢失中间稿');
  mode='review-failure';await page.locator('#ns-ai-analyze').click();await page.waitForFunction(()=>!document.querySelector('#ns-ai-analyze').disabled);
  body=await page.locator('#ns-ai-results').innerText();
  check(body.includes('3项有原文依据的参数')&&body.includes('HTTP 503')&&body.includes('本次语义复核尚未完成'),'复核失败丢弃了已提取参数');
  check(await page.evaluate(()=>localStorage.getItem('spec_ai_extractions_v1'))===prior,'复核失败覆盖旧完整稿');
  check(errors.length===0&&external.length===0,'页面错误或真实外网请求');
  const result={passed:true,testedAt:new Date().toISOString(),liveDraftBeforeReview:true,invalidConditionIsolated:true,previousCompletePreserved:true,partialRestored:true,reviewFailurePreservesParameters:true,downloads:['partial.json','partial.xlsx','partial.html'],widths:[1366,900],errors,external,calls,realModelAccuracy:'not tested; synthetic responses only'};
  const download=page.waitForEvent('download',{timeout:7000});
  await page.evaluate(value=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)]));a.download='browser-result.json';a.click();},result);
  await(await download).saveAs(out+'/browser-result.json');
  return result;
}
