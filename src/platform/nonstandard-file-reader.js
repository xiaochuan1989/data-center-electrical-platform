// 所有内容仅在本机解析，不执行工作簿公式、宏或文档指令。
import { localPdfOptions } from './local-pdf-options.js';
import { checkReadSignal, createLocalOcrSession, hasLargePdfImage, renderPdfForOcr } from './local-pdf-ocr.js';
const MAX_TEXT = 800000;
function checkText(value) {
  if (!value.trim()) throw new Error('未读取到有效文字，扫描件请另行识别或人工补录');
  if (value.length > MAX_TEXT) throw new Error('文字过多，请按设备拆分资料');
  return value;
}
function append(parts, value, metadata) {
  if (!String(value).trim()) return;
  const start = parts.text.length;
  parts.text += String(value);
  parts.segments.push({ start, end: parts.text.length, ...metadata });
  parts.text += '\n';
  if (parts.text.length > MAX_TEXT) throw new Error('文字过多，请拆分资料');
}
export function readPresalesWorkbook(workbook, XLSX) {
  const parts = { text: '', segments: [], warnings: [] }; let total = 0;
  for (const [sheetIndex, name] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[name];
    if (workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden) parts.warnings.push(`${name}为隐藏工作表，已读取，需人工核对适用范围`);
    if (sheet['!merges']?.length) parts.warnings.push(`${name}有合并单元格，仅读取主单元格，表头与适用行需人工核对`);
    const cells = Object.keys(sheet).filter(key => !key.startsWith('!'));
    total += cells.length; if (total > 12000) throw new Error('工作簿单元格过多，请拆分需求表');
    const forbiddenColumns = new Set(), requirementHeaders = [], titleColumns = new Set();
    for (const address of cells) {
      const value = String(sheet[address].w ?? sheet[address].v ?? '');
      if (!sheet[address].f && /^(?:是否)?(?:禁止偏离|不允许偏离)(?:项)?$/.test(value.replace(/\s/g, ''))) forbiddenColumns.add(XLSX.utils.decode_cell(address).c);
      const header = value.replace(/[（(].*[）)]/g, '').replace(/\s/g, '');
      if (!sheet[address].f && /^(?:要求|技术要求|招标要求|规范要求|技术参数要求|要求值)$/.test(header)) requirementHeaders.push(XLSX.utils.decode_cell(address));
      if (!sheet[address].f && /^(?:内容|参数名称|参数项|技术参数名称)$/.test(header)) titleColumns.add(XLSX.utils.decode_cell(address).c);
    }
    const columns = [...new Set(requirementHeaders.map(p => p.c))];
    const requirementColumn = columns.length === 1 ? columns[0] : null;
    const firstHeaderRow = Math.min(...requirementHeaders.map(p => p.r));
    if (requirementColumn == null) parts.warnings.push(`${name}未唯一识别要求列，保留全部单元格待人工分配；表头/厂家应答不可直接当作客户要求`);
    for (const address of cells.sort((a, b) => {
      const x = XLSX.utils.decode_cell(a), y = XLSX.utils.decode_cell(b); return x.r - y.r || x.c - y.c;
    })) {
      const cell = sheet[address], pos = XLSX.utils.decode_cell(address);
      const role = requirementColumn == null ? 'unclassified' : pos.c === requirementColumn && pos.r > firstHeaderRow
        && !requirementHeaders.some(p => p.r === pos.r && p.c === pos.c) ? 'requirement' : 'context';
      let contextTitle = '', contextCell = '';
      if (role === 'requirement' && titleColumns.size === 1) {
        contextCell = XLSX.utils.encode_cell({ r: pos.r, c: [...titleColumns][0] });
        const titleCell = sheet[contextCell];
        if (titleCell && !titleCell.f) contextTitle = String(titleCell.w ?? titleCell.v ?? '');
        if (!contextTitle.trim()) contextTitle = '';
      }
      let forbiddenDeviation = null;
      for (const column of forbiddenColumns) {
        const flag = sheet[XLSX.utils.encode_cell({ r: pos.r, c: column })];
        const marking = String(flag?.w ?? flag?.v ?? '').trim();
        if (flag?.f) continue; // 禁止偏离标记的公式缓存也不作为已验证值。
        if (/^(?:是|禁止偏离|不允许偏离|√|✓|●|☆|★|Y|YES|TRUE|1)$/i.test(marking)) forbiddenDeviation = true;
        else if (/^(?:否|允许偏离|N|NO|FALSE|0)$/i.test(marking)) forbiddenDeviation = false;
      }
      if (cell.f) parts.warnings.push(`${name}!${address}包含公式，仅保留原式，不作为已验证参数`);
      const value = cell.f ? `公式（未求值）：${cell.f}` : cell.w ?? cell.v ?? '';
      append(parts, value, { sheet: name, cell: address, forbiddenDeviation, role, ...(contextTitle ? { contextTitle, contextCell } : {}) });
    }
  }
  checkText(parts.text); return { ...parts, type: 'xlsx' };
}
// pdf.js 常把同一行连续文字拆成多个片段（如"再批量""生""产为""宜"首尾相接）。旧做法在片段间一律补空格，
// 原文与参数值里便出现"再批量 生 产为 宜"。同一行且间距不超过字高10%的片段视为连续文字直接拼接；
// 表格不同单元格间距大或另有空格片段，仍保留空格。片段缺少位置信息时沿用补空格。
export function joinPdfTextItems(items) {
  let out = '', prev = null;
  for (const item of items) {
    const str = item.str ?? '';
    if (prev && !prev.hasEOL) {
      const geo = x => Array.isArray(x?.transform) && Number.isFinite(x.width);
      const height = geo(prev) && geo(item) ? Math.max(Math.abs(prev.height || prev.transform[3]), Math.abs(item.height || item.transform[3]), 1) : 0;
      const touching = height && Math.abs(item.transform[5] - prev.transform[5]) < height * 0.5
        && item.transform[4] - (prev.transform[4] + prev.width) <= height * 0.1 && item.transform[4] >= prev.transform[4];
      if (!touching) out += ' ';
    }
    out += str + (item.hasEOL ? '\n' : '');
    prev = item;
  }
  return prev && !prev.hasEOL ? out + ' ' : out;
}
export async function readPresalesFile(file, libs = globalThis, options = {}) {
  const { signal, onProgress = () => {}, forceOcr = false, ocrLanguage = 'chi_sim' } = options;
  checkReadSignal(signal);
  if (!file || file.size > 20 * 1024 * 1024) throw new Error('文件不得超过20MB');
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['txt', 'md', 'docx', 'pdf', 'xlsx'].includes(extension)) throw new Error('仅支持TXT/MD/DOCX/文字PDF/XLSX；旧DOC请另存，宏工作簿不接受');
  const parts = { text: '', segments: [], warnings: [] };
  const buffer = await file.arrayBuffer();
  if (extension === 'txt' || extension === 'md') {
    try { parts.text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new Error('文本不是有效UTF-8，请另存UTF-8后重传'); }
    checkText(parts.text); parts.segments = [{ start: 0, end: parts.text.length }];
    return { ...parts, name: file.name, type: 'text' };
  }
  if (extension === 'xlsx') {
    // Browser entry must never fall back to the legacy styled writer if CE failed.
    // Explicit injected engines remain supported for pure tests/other callers.
    const reader=libs.XLSXReader || (libs === globalThis || libs.localParserReady ? null : libs.XLSX);
    if (!reader) throw new Error('Excel本机解析组件未加载，请刷新或检查本机资源');
    const signature = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4));
    if (signature.length < 4 || signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) {
      throw new Error('不是有效的XLSX压缩工作簿；损坏、加密或仅改后缀的文件请另存后重传');
    }
    return { ...readPresalesWorkbook(reader.read(buffer, { type: 'array', cellFormula: true }), reader), name: file.name };
  }
  if (extension === 'docx') {
    if (!libs.mammoth) throw new Error('Word解析组件未加载');
    const result = await libs.mammoth.convertToHtml({ arrayBuffer: buffer }, { externalFileAccess:false,
      convertImage: libs.mammoth.images.imgElement(() => Promise.resolve({ src: '' })) });
    const document = new DOMParser().parseFromString(result.value, 'text/html');
    let paragraph = 0, tableIndex = 0;
    for (const child of document.body.children) {
      if (child.tagName === 'TABLE') {
        tableIndex += 1;
        [...child.querySelectorAll('tr')].forEach((row, index) => append(parts, [...row.querySelectorAll('td,th')].map(cell => cell.textContent.trim()).join(' | '), { table: `${tableIndex}行${index + 1}` }));
      } else { paragraph += 1; append(parts, child.textContent, { paragraph }); }
    }
    parts.warnings.push('DOCX位置为解析段落/表格，不是Word页码；图片及复杂结构需另行核对');
    parts.warnings.push(...(result.messages || []).map(m=>`Word解析提示：${m.message}`));
    checkText(parts.text); return { ...parts, name: file.name, type: 'docx' };
  }
  if(libs.localParserReady?.pdfjsLib) {
    try {await libs.localParserReady.pdfjsLib;} catch {throw new Error('PDF本机解析组件加载失败，请刷新或检查本机资源');}
  }
  if (!libs.pdfjsLib) throw new Error('PDF本机解析组件未加载');
  const loadingTask = libs.pdfjsLib.getDocument({ data: buffer,
    ...localPdfOptions(libs.document?.baseURI || globalThis.document?.baseURI) });
  let ocr;
  const abortLoad = () => { loadingTask.destroy().catch(() => {}); };
  signal?.addEventListener('abort', abortLoad, { once: true });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > 150) throw new Error('PDF超过150页，请按设备拆分');
    parts.pageRecords = [];
    // 先读全部文字层，找出多数页重复的行（页眉/页脚/文字水印，页码数字归一）。大幅图片只在去掉这些行后正文仍不足时
    // 才触发OCR：既不让一行文字页眉掩盖扫描正文，也不因整页底纹/水印图片丢弃完整的文字层。
    const nativeTexts = [];
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
      checkReadSignal(signal);
      const content = await (await pdf.getPage(pageIndex)).getTextContent();
      nativeTexts.push(joinPdfTextItems(content.items));
    }
    const lineKey = line => line.replace(/\s/g, '').replace(/\d+/g, '#'), lineCounts = new Map();
    for (const text of nativeTexts) for (const key of new Set(text.split('\n').map(lineKey).filter(key => key.length >= 2))) lineCounts.set(key, (lineCounts.get(key) || 0) + 1);
    const repeatedLines = new Set(nativeTexts.length < 3 ? [] : [...lineCounts].filter(([, n]) => n >= Math.max(3, Math.ceil(nativeTexts.length / 2))).map(([key]) => key));
    const imageTextPages = [];
    const bodyLength = text => text.split('\n').filter(line => !repeatedLines.has(lineKey(line))).join('').replace(/\s/g, '').length;
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
      checkReadSignal(signal);
      onProgress({ phase: 'read', page: pageIndex, total: pdf.numPages });
      const page = await pdf.getPage(pageIndex);
      let canvas;
      try {
        let value = nativeTexts[pageIndex - 1];
        let metadata = { page: pageIndex, method: 'native' };
        const largeImage = !forceOcr && value.replace(/\s/g,'').length >= 40 && await hasLargePdfImage(page,libs.pdfjsLib);
        if (largeImage && bodyLength(value) >= 40) imageTextPages.push(pageIndex);
        if (forceOcr || value.replace(/\s/g,'').length < 40 || (largeImage && bodyLength(value) < 40)) {
          const rendered = await (libs.renderPdfForOcr || renderPdfForOcr)(page,libs,signal);
          canvas = rendered.canvas;
          if (rendered.blank && !value.trim()) {
            parts.pageRecords.push({ page: pageIndex, method: 'blank' });
            continue;
          }
          ocr ||= (libs.createLocalOcrSession || createLocalOcrSession)(libs,{ signal, language: ocrLanguage,
            onProgress: info => onProgress({ ...info, total: pdf.numPages }) });
          onProgress({ phase: 'ocr', page: pageIndex, total: pdf.numPages, progress: 0 });
          const recognized = await ocr.recognize(canvas,pageIndex);
          if (!recognized.text?.trim()) throw new Error(`PDF第${pageIndex}页OCR未识别到文字，未导入不完整资料`);
          value = recognized.text;
          metadata = { ...metadata, method: 'ocr', ocrEngine: 'tesseract.js-7.0.0', ocrConfidence: recognized.confidence, dpi: rendered.dpi };
          parts.warnings.push(`PDF第${pageIndex}页为OCR识别文字（置信度${Math.round(recognized.confidence)}%），数值、单位、符号及表格归属须对照原图复核`);
        }
        checkReadSignal(signal);
        append(parts,value,metadata); parts.pageRecords.push(metadata);
      } finally { if (canvas) canvas.width=canvas.height=0; page.cleanup(); }
    }
    if (imageTextPages.length) parts.warnings.push(`PDF第${imageTextPages.join("、")}页含大幅图片，已使用文字层；若图片中有文字层没有的内容（如扫描正文），请勾选“所有PDF页使用OCR”后重新选择文件`);
  } catch (error) { checkReadSignal(signal); throw error; }
  finally { signal?.removeEventListener('abort',abortLoad); await ocr?.close(); await loadingTask.destroy(); }
  checkText(parts.text); return { ...parts, name: file.name, type: 'pdf' };
}
