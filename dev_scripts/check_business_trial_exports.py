"""Read-only independent trial export verification; all actual values remain ignored."""
import json
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from openpyxl import load_workbook
root = Path(__file__).resolve().parents[1] / 'output'
sheets = {'header':'方案概览','bom':'配置清单','config':'采用配置','requirements':'技术要求与应答','notes':'澄清与边界','revisions':'修订记录'}
def verify(directory, outputs):
    for index, data in enumerate(outputs, 1):
        path = directory / f'scheme-{index}.xlsx'
        with ZipFile(path) as archive:
            assert archive.testzip() is None
            assert not any('vba' in name.lower() or 'externalLink' in name for name in archive.namelist())
            for name in archive.namelist():
                if name.endswith(('.xml','.rels')): ET.fromstring(archive.read(name))
        book = load_workbook(path)
        assert set(book.sheetnames) == set(sheets.values())
        for key, name in sheets.items():
            rows = list(book[name].values)
            # XLSX blank strings read as None; otherwise type and value must match the core tables.
            actual = [[v if v is not None else '' for v in row] for row in rows]
            expected = data['tables'][key]
            assert actual == expected, f'{directory.name}/{index}/{name}: wrong quantity/text/revision'
            assert not any(c.data_type == 'f' for row in book[name] for c in row)
        assert data['output']['status'] == 'discussion-draft'
        assert all(r['reviewStatus'] != 'confirmed' and r['response'] == 'pending' for r in data['output']['requirements'])
prepared = root / 'business-trial' / '2026-10-04'
verify(prepared, [json.loads((prepared / f'scheme-{i}.json').read_text(encoding='utf-8')) for i in range(1,5)])
browser = root / 'playwright' / 'business-trial-20261004'
verify(browser, json.loads((browser / 'expected-outputs.json').read_text(encoding='utf-8')))
print('PASS: 8 real trial XLSX / 48 sheets match saved quantities, unknowns, evidence and all revisions; no formulas/macros/external links')
