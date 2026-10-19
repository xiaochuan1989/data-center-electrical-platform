// Same-origin OCR assets and language models. Document pixels never leave the browser.
export function localOcrUrls(base = globalThis.document?.baseURI) {
  const root = new URL('vendor/ocr/', base);
  return { script: new URL('tesseract.min.js', root).href, workerPath: new URL('worker.min.js', root).href,
    corePath: new URL('core/', root).href, langPath: new URL('lang/', root).href };
}
export function checkReadSignal(signal) {
  if (signal?.aborted) throw new DOMException('已取消文件识别', 'AbortError');
}
function interruptible(promise, signal, milliseconds, cleanup = () => {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const end = (fn, value) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value); };
    const abort = () => { cleanup(); end(reject, new DOMException('已取消文件识别', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); end(reject, new Error('本机OCR超时，请拆分文件或降低扫描尺寸后重试')); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(value => { if (done) { cleanup(value); return; } end(resolve, value); }, error => end(reject, error));
    if (signal?.aborted) abort();
  });
}
async function loadEngine(libs, urls, signal) {
  if (libs.Tesseract?.createWorker) return libs.Tesseract;
  if (!libs.document) throw new Error('本机OCR引擎不可用，请在浏览器中打开网站');
  let script;
  const loaded = new Promise((resolve, reject) => {
    script = libs.document.createElement('script'); script.src = urls.script; script.async = true;
    script.onload = () => libs.Tesseract?.createWorker ? resolve(libs.Tesseract) : reject(new Error('本机OCR引擎初始化失败'));
    script.onerror = () => reject(new Error('本机OCR资源加载失败，请检查网站资源或网络后重试'));
    libs.document.head.appendChild(script);
  });
  try { return await interruptible(loaded, signal, 120000, () => script?.remove()); }
  finally { script?.remove(); }
}
export function createLocalOcrSession(libs, { signal, onProgress = () => {}, language = 'chi_sim' } = {}) {
  if (!['chi_sim','eng'].includes(language)) throw new Error('不支持的OCR语言');
  const urls = localOcrUrls(libs.document?.baseURI || globalThis.document?.baseURI);
  let worker, initializing, closed = false, currentPage = 0;
  const terminate = value => { const target = value?.terminate ? value : worker; target?.terminate().catch(() => {}); worker = undefined; };
  async function ready() {
    checkReadSignal(signal);
    if (!initializing) initializing = (async () => {
      const engine = await loadEngine(libs, urls, signal);
      const created = await interruptible(engine.createWorker(language === 'chi_sim' ? 'chi_sim+eng' : 'eng', 1, {
        ...urls, workerBlobURL: false, cacheMethod: 'none', gzip: true,
        logger: info => onProgress({ phase: 'ocr', page: currentPage, progress: Number(info.progress) || 0, status: info.status }),
        errorHandler: () => {} // SDK rejects the pending operation; no uncaught asynchronous throw.
      }), signal, 120000, terminate);
      if (closed || signal?.aborted) { terminate(created); checkReadSignal(signal); throw new Error('识别会话已结束'); }
      worker = created;
      await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', user_defined_dpi: '300' });
      return worker;
    })();
    return initializing;
  }
  return {
    async recognize(canvas, page) {
      currentPage = page;
      const engine = await ready(); checkReadSignal(signal);
      const { data } = await interruptible(engine.recognize(canvas), signal, 180000, terminate);
      checkReadSignal(signal);
      if (!data || typeof data.text !== 'string' || !data.text.trim()) throw new Error(`PDF第${page}页有图像内容，但OCR未识别到文字，未导入不完整资料`);
      return { text: data.text, confidence: Math.max(0, Math.min(100, Number(data.confidence) || 0)) };
    },
    async close() { closed = true; terminate(); }
  };
}
const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export async function hasLargePdfImage(page, pdfjs) {
  if (!page.getOperatorList || !pdfjs.OPS) return false;
  const ops = await page.getOperatorList(), { OPS } = pdfjs;
  let matrix = [1,0,0,1,0,0]; const stack = [];
  const viewport = page.getViewport({ scale: 1 });
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push([...matrix]);
    else if (fn === OPS.restore) matrix = stack.pop() || [1,0,0,1,0,0];
    else if (fn === OPS.transform) matrix = multiply(matrix, args);
    else if ([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat].filter(v => v != null).includes(fn)) {
      const area = Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]);
      if (area / (viewport.width * viewport.height) >= 0.25) return true;
    }
  }
  return false;
}
export async function renderPdfForOcr(page, libs, signal) {
  const base = page.getViewport({ scale: 1 });
  if (!Number.isFinite(base.width*base.height) || base.width <= 0 || base.height <= 0) throw new Error('PDF页面尺寸无效');
  // Preserve 300dpi for normal A4; bound large drawings to avoid exhausting browser memory.
  const scale = Math.min(300/72, 6000/Math.max(base.width,base.height), Math.sqrt(16000000/(base.width*base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = libs.document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器无法创建OCR图像，请更换浏览器');
  const render = page.render({ canvasContext: context, viewport, background: '#ffffff' });
  const abort = () => render.cancel(); signal?.addEventListener('abort',abort,{once:true});
  try { checkReadSignal(signal); await render.promise; checkReadSignal(signal); }
  catch (error) { canvas.width=canvas.height=0; checkReadSignal(signal); throw error; }
  finally { signal?.removeEventListener('abort',abort); }
  // Only a demonstrably white raster is classified as blank; any visible ink requires recognition.
  const pixels = context.getImageData(0,0,canvas.width,canvas.height).data;
  let ink = 0;
  for (let i=0;i<pixels.length;i+=4) if (pixels[i]<245 || pixels[i+1]<245 || pixels[i+2]<245) { if (++ink>=20) break; }
  return { canvas, blank: ink<20, dpi: Math.round(scale*72) };
}
