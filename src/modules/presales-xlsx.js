// 售前静态工作稿专用XLSX写出器：本机运行，无宏/公式/外链/依赖下载。
// SpreadsheetML + ZIP stored（CRC32），不用于读取或改写客户工作簿。
const encoder = new TextEncoder();
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const xml = value => String(value ?? '').replace(/_x[0-9A-Fa-f]{4}_/g, v => `_x005F_${v.slice(1)}`)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, c => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]).replace(/\r/g, '&#13;');
const column = index => { let name = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; };
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => { let n = i; for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
const crc = bytes => { let n = 0xffffffff; for (const value of bytes) n = crcTable[(n ^ value) & 255] ^ n >>> 8; return (n ^ 0xffffffff) >>> 0; };
const join = arrays => { const result = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0)); let offset = 0; for (const a of arrays) { result.set(a, offset); offset += a.length; } return result; };
function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of files) {
    const path = encoder.encode(name), bytes = encoder.encode(content), checksum = crc(bytes);
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, checksum, true); h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true); h.setUint16(26, path.length, true);
    const directory = new Uint8Array(46), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 0x21, true);
    d.setUint32(16, checksum, true); d.setUint32(20, bytes.length, true); d.setUint32(24, bytes.length, true); d.setUint16(28, path.length, true); d.setUint32(42, offset, true);
    local.push(header, path, bytes); central.push(directory, path); offset += header.length + path.length + bytes.length;
    assert(offset <= 20 * 1024 * 1024, '方案Excel超过20MB，请拆分设备方案后导出');
  }
  const directory = join(central), end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
  view.setUint32(12, directory.length, true); view.setUint32(16, offset, true);
  return join([...local, directory, end]);
}
const mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const prefix = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
// 样式：0 正文（细框线、顶端对齐、自动换行）、1 表头（深底白字、框线）、2 数值（右对齐、框线）、3 说明行（浅黄底、加粗、框线）。
const styles = `${prefix}<styleSheet xmlns="${mainNs}"><fonts count="3"><font><sz val="11"/><name val="等线"/><family val="2"/><color rgb="FF243449"/></font><font><b/><sz val="11"/><name val="等线"/><family val="2"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="11"/><name val="等线"/><family val="2"/><color rgb="FF7A4B00"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF24476D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF4D6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB7C2D0"/></left><right style="thin"><color rgb="FFB7C2D0"/></right><top style="thin"><color rgb="FFB7C2D0"/></top><bottom style="thin"><color rgb="FFB7C2D0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
// 列宽单位约等于一个西文字符；中文按两个计。行高按换行后的行数估算（等线 11pt 约 15pt/行；中文按 2.2 个单位估算，宁可略高不截字）。
const textUnits = text => [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2.2 : 1), 0);
const lineCount = (text, width) => text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(textUnits(line) / Math.max(1, width - 2))), 0);
const rowHeight = lines => Math.min(409, Math.max(20, lines * 15 + 5));
const quoteSheet = name => `'${name.replace(/'/g, "''")}'`;
export function writePresalesXlsx(sheets) {
  assert(Array.isArray(sheets) && sheets.length > 0 && sheets.length <= 20, '工作表数量非法');
  const names = new Set(); let cells = 0;
  const files = [['xl/styles.xml', styles]];
  const filters = [];
  // header：列标题所在行（默认第 1 行）。其上的行是说明行：单格说明合并到整表宽度并以说明样式显示，不参与列宽计算。
  sheets.forEach(({ name, rows, header = 0 }, index) => {
    assert(typeof name === 'string' && name.length > 0 && name.length <= 31 && !/[\\/:?*\[\]]/.test(name) && !names.has(name.toLowerCase()), '工作表名称非法或重复'); names.add(name.toLowerCase());
    assert(Array.isArray(rows) && rows.length > 0 && rows.length <= 1048576 && rows.every(row => Array.isArray(row) && row.length <= 16384), '工作表行列非法');
    assert(Number.isInteger(header) && header >= 0 && header < rows.length, '表头行非法');
    cells += rows.reduce((sum, row) => sum + row.length, 0); assert(cells <= 200000, '方案Excel超过200000单元格，请拆分导出');
    const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 1);
    const widths = Array.from({ length: maxColumns }, (_, c) => Math.ceil(Math.max(8, textUnits(String(rows[header][c] ?? '')) + 4)));
    for (const row of rows.slice(header + 1)) row.forEach((value, col) => {
      const longest = String(value ?? '').split('\n').reduce((max, line) => Math.max(max, textUnits(line)), 0);
      widths[col] = Math.min(50, Math.ceil(Math.max(widths[col], longest + 2)));
    });
    const tableWidth = widths.reduce((sum, w) => sum + w, 0), merges = [];
    let textBudget = 0;
    const body = rows.map((row, r) => {
      const note = r < header, merged = note && row.length === 1 && maxColumns > 1;
      if (merged) merges.push(`A${r + 1}:${column(maxColumns - 1)}${r + 1}`);
      let lines = 1;
      const data = row.map((value, c) => {
        const reference = `${column(c)}${r + 1}`, style = note ? 3 : r === header ? 1 : null;
        if (typeof value === 'number') { assert(Number.isFinite(value), 'Excel数值不是有限数'); return `<c r="${reference}" s="${style ?? 2}" t="n"><v>${value}</v></c>`; }
        assert(value == null || ['string', 'boolean'].includes(typeof value), 'Excel单元格类型非法');
        const text = String(value ?? ''); assert(text.length <= 32767, `Excel${name}!${reference}文字超过32767字符，请拆分条款，不会截断原文`);
        const escaped = xml(text); textBudget += encoder.encode(escaped).length;
        assert(textBudget <= 20 * 1024 * 1024, '方案Excel超过20MB，请拆分设备方案后导出');
        lines = Math.max(lines, lineCount(text, merged ? tableWidth : widths[c]));
        return `<c r="${reference}" s="${style ?? 0}" t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`;
      });
      // 说明行合并区其余单元格补同样式空格，使框线与底色完整。
      if (merged) for (let c = 1; c < maxColumns; c++) data.push(`<c r="${column(c)}${r + 1}" s="3"/>`);
      return row.length ? `<row r="${r + 1}" ht="${rowHeight(lines)}" customHeight="1">${data.join('')}</row>` : `<row r="${r + 1}"/>`;
    }).join('');
    const last = rows.length, ref = `A${header + 1}:${column(maxColumns - 1)}${last}`;
    const hasData = last > header + 1 && rows[header].length > 1;
    if (hasData) filters.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${xml(quoteSheet(name))}!$A$${header + 1}:$${column(maxColumns - 1)}$${last}</definedName>`);
    files.push([`xl/worksheets/sheet${index + 1}.xml`, `${prefix}<worksheet xmlns="${mainNs}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${header + 1}" topLeftCell="A${header + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${widths.map((width, c) => `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData>${hasData ? `<autoFilter ref="${ref}"/>` : ''}${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape"/></worksheet>`]);
  });
  files.push(['[Content_Types].xml', `${prefix}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `${prefix}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${prefix}<workbook xmlns="${mainNs}" xmlns:r="${relNs}"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${filters.length ? `<definedNames>${filters.join('')}</definedNames>` : ''}</workbook>`],
    ['xl/_rels/workbook.xml.rels', `${prefix}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${relNs}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdStyle" Type="${relNs}/styles" Target="styles.xml"/></Relationships>`]);
  const result = zip(files); assert(result.length <= 20 * 1024 * 1024, '方案Excel超过20MB，请拆分设备方案后导出'); return result;
}
