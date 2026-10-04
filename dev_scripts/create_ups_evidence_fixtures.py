"""Generate synthetic browser QA documents; no customer files are used."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

out = Path(__file__).resolve().parents[1] / 'output' / 'playwright' / 'ups-evidence'
out.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
pdf = canvas.Canvas(str(out / 'multi-page.pdf'))
pdf.setFont('STSong-Light', 14)
pdf.drawString(50, 780, 'UPS容量200kVA 三进三出')
pdf.showPage()
pdf.showPage()
pdf.setFont('STSong-Light', 14)
pdf.drawString(50, 780, 'UPS容量300kVA 后备时间30分钟')
pdf.save()
empty = canvas.Canvas(str(out / 'empty.pdf'))
empty.showPage()
empty.save()
print(out)
