// Playwright CLI function, isolated synthetic QA only; fixture paths contain no client files.
async page => {
  const check=(ok,label)=>{if(!ok) throw new Error(label);};
  const origin=new URL(page.url()).origin,denied=new Set(),external=[],errors=[];
  const out='D:/Claude 安装/UPS选型助手_开发包/output/playwright/local-file-reading';
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().route('**/*',async route=>{
    const u=route.request().url();
    if(/^https?:/.test(u)&&new URL(u).origin!==origin){external.push(u);await route.abort();}
    else if([...denied].some(p=>u.endsWith(p))) await route.abort();
    else await route.continue();
  });
  await page.evaluate(()=>{sessionStorage.setItem('ups_auth','ok');localStorage.clear();});await page.reload();
  await page.waitForFunction(()=>!!window.pdfjsLib);
  await page.getByRole('button',{name:'非标配电售前方案',exact:true}).click();
  await page.locator('#ns-autosave').check();
  const pack=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('nonstandard_presales_working_v1')).snapshot.package);
  const read=async file=>{const count=(await pack()).sources.length;await page.locator('#ns-file').setInputFiles(file);await page.waitForFunction(n=>JSON.parse(localStorage.getItem('nonstandard_presales_working_v1')).snapshot.package.sources.length===n,count+1);};
  await read(out+'/fixtures/external-image.docx');
  let source=(await pack()).sources.at(-1);
  check(source.text.includes('32A')&&source.text.includes('<script>')&&source.text.includes('上传原文'),'外链/指令DOCX原文未保留');
  check(await page.evaluate(()=>window.__documentInstruction)===undefined,'文档指令被执行');
  check(await page.locator('#platform-view-requirements img').count()===0,'外链图片进入页面');
  await page.locator('#ns-extract').click();
  check((await pack()).requirements.every(r=>!r.equipmentId&&r.reviewStatus!=='confirmed'),'文档指令自动确认');
  const bytes=await page.evaluate(()=>{
    const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([['技术要求'],['额定电流：40A']]);
    ws.A3={t:'n',f:'1+1',v:2};ws['!ref']='A1:A3';XLSX.utils.book_append_sheet(wb,ws,'隐藏需求');wb.Workbook={Sheets:[{Hidden:1}]};
    return [...new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'}))];
  });
  await read({name:'hidden-formula.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
  source=(await pack()).sources.at(-1);
  check(source.warnings.some(w=>w.includes('隐藏'))&&source.warnings.some(w=>w.includes('公式'))&&source.text.includes('公式（未求值）：1+1'),'隐藏/公式处理错误');
  const before=JSON.stringify(await pack());
  for(const file of [out+'/fixtures/empty.docx',out+'/../ups-evidence/empty.pdf',{name:'invalid-utf8.txt',mimeType:'text/plain',buffer:Buffer.from([255])}]) {
    await page.locator('#ns-file').setInputFiles(file);await page.locator('#ns-message.ns-error').waitFor();check(JSON.stringify(await pack())===before,'空/编码错误覆盖工作稿');
  }
  // Legacy catalog import uses CE but still requires human preview confirmation.
  const catalogBefore=await page.evaluate(()=>JSON.stringify(PRODUCTS));
  const catalogBytes=await page.evaluate(()=>{
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['型号','描述'],['QA-ONLY','合成测试，不是真实型号']]),'QA');
    window.__readCount=0;const read=XLSX.read;XLSX.read=(...args)=>{window.__readCount++;return read(...args);};
    return [...new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'}))];
  });
  await page.locator('#excel-upload').setInputFiles({name:'qa-catalog.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(catalogBytes)});
  await page.locator('#catalog-import-modal').waitFor({state:'visible'});
  check((await page.locator('#catalog-import-diff').textContent()).includes('QA-ONLY'),'旧目录读取未形成预览');
  check(await page.evaluate(()=>window.__readCount)===1,'旧目录未调用同源读取器');
  await page.locator('#catalog-import-modal').getByRole('button',{name:'取消',exact:true}).click();
  check(await page.evaluate(()=>JSON.stringify(PRODUCTS))===catalogBefore,'取消预览改变目录');
  denied.add('/vendor/pdfjs/pdf.worker.mjs');await page.reload();await page.waitForFunction(()=>!!window.pdfjsLib);
  await page.getByRole('button',{name:'非标配电售前方案',exact:true}).click();
  const workerBefore=JSON.stringify(await pack());
  await page.locator('#ns-file').setInputFiles(out+'/../ups-evidence/multi-page.pdf');
  await page.locator('#ns-message.ns-error').waitFor();check(JSON.stringify(await pack())===workerBefore,'缺worker覆盖工作稿');
  denied.clear();denied.add('/vendor/xlsx/reader.min.js');await page.reload();
  await page.getByRole('button',{name:'非标配电售前方案',exact:true}).click();
  const ceBefore=JSON.stringify(await pack());
  await page.locator('#ns-file').setInputFiles({name:'missing-ce.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
  await page.locator('#ns-message.ns-error').filter({hasText:'本机解析组件未加载'}).waitFor();
  check(JSON.stringify(await pack())===ceBefore,'缺CE退回旧读取器/覆盖工作稿');
  check(external.length===0,'请求外网');check(errors.length===0,`页面错误：${errors.join(';')}`);
  const result={passed:true,synthetic:true,testedAt:new Date().toISOString(),external,errors,externalImageBlocked:true,documentInstructionsNotExecuted:true,hiddenFormula:true,emptyAndInvalidEncodingRejected:true,legacyCatalogPreviewAndCancel:true,missingWorkerProtected:true,missingCEProtected:true};
  const download=page.waitForEvent('download');await page.evaluate(value=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)]));a.download='negative-result.json';a.click();},result);await(await download).saveAs(out+'/negative-result.json');return result;
}
