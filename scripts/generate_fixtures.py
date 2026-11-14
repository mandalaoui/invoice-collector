"""Generate fictional Israeli invoice fixtures and tests/fixtures/expected.json.

Nothing here is a real vendor, company number, or amount.
Regenerate from the repo root:

    pip install -r scripts/requirements.txt
    python scripts/generate_fixtures.py
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import fitz
from fpdf import FPDF
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures"

FONT_PAIRS = [
    (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\arialbd.ttf"),
    (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ),
]

DISCLAIMER_HE = "מסמך פיקטיבי לבדיקות תוכנה. שמות, מספרי עוסק וסכומים הומצאו."
DISCLAIMER_EN = "Fictional software-test document. Names, IDs, and amounts are made up."


def is_valid_israeli_id(num: str) -> bool:
    """Israeli ID / company-number check digit. Position 0 is multiplied by 1."""
    digits = num.zfill(9)
    if len(digits) != 9 or not digits.isdigit():
        return False
    total = 0
    for index, char in enumerate(digits):
        value = int(char) * (1 if index % 2 == 0 else 2)
        if value > 9:
            value -= 9
        total += value
    return total % 10 == 0


def israeli_id(first8: str) -> str:
    if len(first8) != 8 or not first8.isdigit():
        raise ValueError(first8)
    for digit in range(10):
        candidate = first8 + str(digit)
        if is_valid_israeli_id(candidate):
            return candidate
    raise RuntimeError("no check digit for " + first8)


# 9901000x is a made-up range. Check digits only make the shape look real.
COFFEE_ID = israeli_id("99010001")
FURNITURE_ID = israeli_id("99010002")
BAKERY_ID = israeli_id("99010003")
HARDWARE_ID = israeli_id("99010004")
HOSTING_ID = israeli_id("99010005")
SUPPLY_ID = israeli_id("99010006")
BUYER_ID = israeli_id("99010009")

BUYER_HE = 'סטודיו דמה לבדיקות בע"מ'
BUYER_EN = "Studio Dummy Ltd"


def money(amount: int) -> str:
    """Shekel/dollar display. Credits use a trailing minus, Israeli style."""
    text = f"{abs(amount):,.2f}"
    if amount < 0:
        return text + "-"
    return text


def find_fonts() -> tuple[str, str]:
    for regular, bold in FONT_PAIRS:
        if Path(regular).is_file() and Path(bold).is_file():
            return regular, bold
    raise FileNotFoundError(
        "No Hebrew-capable TTF pair found. Install Arial or DejaVu Sans."
    )


def new_pdf(page_size) -> FPDF:
    regular, bold = find_fonts()
    pdf = FPDF(format=page_size, unit="mm")
    pdf.set_auto_page_break(auto=False)
    pdf.add_font("Arial", fname=regular)
    pdf.add_font("Arial", style="B", fname=bold)
    pdf.set_text_shaping(True)
    pdf.add_page()
    pdf.set_margins(15, 15, 15)
    pdf.set_text_color(20, 20, 20)
    pdf.set_title("Fictional fixture")
    pdf.set_author("invoice-collector fixtures")
    pdf.set_creator("generate_fixtures.py")
    pdf.set_subject("Fictional test document. Not a real tax document.")
    return pdf


def write_line(pdf: FPDF, text: str, size: int = 12, bold: bool = False, align: str = "R", h: float = 7) -> None:
    pdf.set_font("Arial", "B" if bold else "", size)
    pdf.set_x(pdf.l_margin)
    pdf.cell(pdf.epw, h, text, align=align, new_x="LMARGIN", new_y="NEXT")


def hline(pdf: FPDF) -> None:
    y = pdf.get_y() + 1
    pdf.set_draw_color(180, 180, 180)
    pdf.line(pdf.l_margin, y, pdf.l_margin + pdf.epw, y)
    pdf.ln(4)


def item_row(pdf: FPDF, description: str, amount: str, align_desc: str = "R") -> None:
    pdf.set_font("Arial", "", 12)
    y = pdf.get_y()
    amount_w = 40
    pdf.set_xy(pdf.l_margin, y)
    pdf.cell(amount_w, 7, amount, align="L")
    pdf.set_xy(pdf.l_margin + amount_w, y)
    pdf.cell(pdf.epw - amount_w, 7, description, align=align_desc)
    pdf.set_xy(pdf.l_margin, y + 7)


def banner(pdf: FPDF, text: str) -> None:
    pdf.set_fill_color(24, 58, 92)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Arial", "B", 16)
    pdf.set_x(pdf.l_margin)
    pdf.cell(pdf.epw, 12, text, align="R", fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(20, 20, 20)
    pdf.ln(4)


def promo_bar(pdf: FPDF, text: str) -> None:
    pdf.set_fill_color(255, 236, 179)
    pdf.set_text_color(110, 60, 0)
    pdf.set_font("Arial", "B", 12)
    pdf.set_x(pdf.l_margin)
    pdf.cell(pdf.epw, 10, text, align="R", fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(20, 20, 20)
    pdf.ln(3)


def hebrew_party(pdf: FPDF, doc: dict, title: str) -> None:
    fields = doc["fields"]
    banner(pdf, title)
    write_line(pdf, fields["vendor_name"], 14, bold=True)
    write_line(pdf, "ח.פ " + fields["vendor_id"])
    write_line(pdf, doc["address"])
    write_line(pdf, doc["email_on_doc"], size=10)
    pdf.ln(2)
    hline(pdf)
    write_line(pdf, "מס' מסמך: " + fields["doc_number"], bold=True)
    write_line(pdf, "תאריך: " + fields["doc_date"])
    if fields["allocation_number"]:
        write_line(pdf, "מספר הקצאה: " + fields["allocation_number"], bold=True)
    pdf.ln(2)
    write_line(pdf, "לכבוד", bold=True)
    write_line(pdf, BUYER_HE)
    write_line(pdf, "ח.פ " + BUYER_ID)
    pdf.ln(2)
    hline(pdf)
    write_line(pdf, "פירוט", bold=True)
    for description, amount in doc["lines"]:
        item_row(pdf, description, money(amount))
    pdf.ln(2)
    hline(pdf)
    before = fields["amount_before_vat"]
    vat = fields["vat_amount"]
    total = fields["total"]
    write_line(pdf, 'סה"כ לפני מע"מ: ' + money(before))
    write_line(pdf, 'מע"מ 18%: ' + money(vat))
    label = 'סה"כ לזיכוי: ' if fields["doc_type"] == "credit_note" else 'סה"כ לתשלום: '
    write_line(pdf, label + money(total) + ' ש"ח', size=13, bold=True)
    pdf.ln(3)
    if doc.get("note"):
        write_line(pdf, doc["note"])
    pdf.set_text_color(120, 120, 120)
    pdf.ln(6)
    write_line(pdf, DISCLAIMER_HE, size=8)
    pdf.set_text_color(20, 20, 20)


def english_invoice(pdf: FPDF, doc: dict) -> None:
    fields = doc["fields"]
    write_line(pdf, fields["vendor_name"], 16, bold=True, align="L")
    write_line(pdf, doc["address"], align="L")
    write_line(pdf, doc["email_on_doc"], size=10, align="L")
    pdf.ln(3)
    hline(pdf)
    write_line(pdf, "Tax Invoice", 18, bold=True, align="L")
    pdf.ln(2)
    write_line(pdf, "Invoice No: " + fields["doc_number"], bold=True, align="L")
    write_line(pdf, "Invoice date: " + fields["doc_date"], align="L")
    write_line(pdf, "Currency: USD", align="L")
    pdf.ln(2)
    write_line(pdf, "Bill to", bold=True, align="L")
    write_line(pdf, BUYER_EN, align="L")
    pdf.ln(2)
    hline(pdf)
    for description, amount in doc["lines"]:
        item_row(pdf, description, money(amount), align_desc="L")
    pdf.ln(2)
    hline(pdf)
    write_line(pdf, "Subtotal: USD " + money(fields["amount_before_vat"]), align="L")
    write_line(pdf, "VAT: USD " + money(fields["vat_amount"]), align="L")
    write_line(pdf, "Total due: USD " + money(fields["total"]), size=14, bold=True, align="L")
    pdf.ln(4)
    write_line(pdf, doc["note"], align="L")
    pdf.set_text_color(120, 120, 120)
    pdf.ln(8)
    write_line(pdf, DISCLAIMER_EN, size=8, align="L")
    pdf.set_text_color(20, 20, 20)


def hebrew_receipt(pdf: FPDF, doc: dict) -> None:
    fields = doc["fields"]
    write_line(pdf, fields["vendor_name"], 13, bold=True, h=6)
    write_line(pdf, "קבלה", 16, bold=True, h=8)
    write_line(pdf, "עוסק מורשה", size=10, h=5)
    write_line(pdf, "ע.מ " + fields["vendor_id"], size=11, h=6)
    write_line(pdf, doc["address"], size=10, h=5)
    hline(pdf)
    write_line(pdf, "קבלה מספר: " + fields["doc_number"], bold=True, h=6)
    write_line(pdf, "תאריך: " + fields["doc_date"], h=6)
    hline(pdf)
    for description, amount in doc["lines"]:
        item_row(pdf, description, money(amount))
    pdf.ln(1)
    hline(pdf)
    if fields["amount_before_vat"] is None:
        write_line(pdf, 'סה"כ: ' + money(fields["total"]) + ' ש"ח', size=13, bold=True)
    else:
        write_line(pdf, 'סה"כ לפני מע"מ: ' + money(fields["amount_before_vat"]), size=10, h=5)
        write_line(pdf, 'מע"מ 18%: ' + money(fields["vat_amount"]), size=10, h=5)
        write_line(pdf, 'סה"כ לתשלום: ' + money(fields["total"]) + ' ש"ח', size=12, bold=True, h=6)
    pdf.set_text_color(90, 90, 90)
    pdf.ln(4)
    write_line(pdf, "מסמך פיקטיבי לבדיקות תוכנה.", size=8, h=5)
    pdf.set_text_color(20, 20, 20)


def render_pdf_image(pdf_bytes: bytes) -> Image.Image:
    opened = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        pix = opened[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    finally:
        opened.close()


def speckle(img: Image.Image, rng: random.Random, count: int, amp: int) -> None:
    pixels = img.load()
    width, height = img.size
    for _ in range(count):
        x = rng.randrange(width)
        y = rng.randrange(height)
        red, green, blue = pixels[x, y]
        delta = rng.randint(-amp, amp)
        pixels[x, y] = (
            max(0, min(255, red + delta)),
            max(0, min(255, green + delta)),
            max(0, min(255, blue + delta)),
        )


def to_scanned_page(receipt: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(receipt)
    gray = gray.filter(ImageFilter.GaussianBlur(radius=0.6))
    gray = gray.rotate(0.8, expand=True, fillcolor=255, resample=Image.Resampling.BICUBIC)
    gray = ImageOps.autocontrast(gray.convert("RGB"), cutoff=1)
    page = Image.new("RGB", (1240, 1754), (214, 214, 214))
    target_w = 640
    target_h = int(gray.height * target_w / gray.width)
    pasted = gray.resize((target_w, target_h), Image.Resampling.LANCZOS)
    page.paste(pasted, ((page.width - target_w) // 2, 160))
    return page


def to_photo(receipt: Image.Image, rng: random.Random) -> Image.Image:
    paper = Image.new("RGB", receipt.size, (236, 226, 206))
    warm = Image.blend(receipt, paper, 0.15)
    rotated = warm.rotate(3.4, expand=True, fillcolor=(214, 206, 190), resample=Image.Resampling.BICUBIC)
    rotated = rotated.filter(ImageFilter.GaussianBlur(radius=0.45))
    speckle(rotated, rng, count=18000, amp=26)
    return rotated


def html_invoice(doc: dict) -> str:
    fields = doc["fields"]
    rows = "\n".join(
        "<tr>"
        f"<td style=\"padding:6px 8px;border-bottom:1px solid #e5e5e5\">{money(amount)} ש\"ח</td>"
        f"<td style=\"padding:6px 8px;border-bottom:1px solid #e5e5e5\">{description}</td>"
        "</tr>"
        for description, amount in doc["lines"]
    )
    return f"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>חשבונית מס {fields["doc_number"]}</title>
</head>
<body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,'Segoe UI',sans-serif;color:#222;direction:rtl;text-align:right;">
  <div style="max-width:640px;margin:0 auto;background:#fff;padding:24px;border:1px solid #ddd;">
    <h1 style="margin:0 0 8px;font-size:22px;">חשבונית מס</h1>
    <p style="margin:0;font-size:18px;font-weight:bold;">{fields["vendor_name"]}</p>
    <p style="margin:4px 0;">ח.פ {fields["vendor_id"]}</p>
    <p style="margin:4px 0;">{doc["address"]}</p>
    <p style="margin:4px 0;">{doc["email_on_doc"]}</p>
    <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
    <p style="margin:4px 0;"><strong>מס' חשבונית:</strong> {fields["doc_number"]}</p>
    <p style="margin:4px 0;"><strong>תאריך:</strong> {fields["doc_date"]}</p>
    <p style="margin:12px 0 4px;"><strong>לכבוד</strong></p>
    <p style="margin:4px 0;">{BUYER_HE}</p>
    <p style="margin:4px 0;">ח.פ {BUYER_ID}</p>
    <table dir="rtl" style="width:100%;border-collapse:collapse;margin-top:16px;">
      <thead>
        <tr>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #333;">סכום</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #333;">פירוט</th>
        </tr>
      </thead>
      <tbody>
        {rows}
      </tbody>
    </table>
    <p style="margin:16px 0 4px;">סה"כ לפני מע"מ: {money(fields["amount_before_vat"])} ש"ח</p>
    <p style="margin:4px 0;">מע"מ 18%: {money(fields["vat_amount"])} ש"ח</p>
    <p style="margin:8px 0;font-size:18px;font-weight:bold;">סה"כ לתשלום: {money(fields["total"])} ש"ח</p>
    <p style="margin:16px 0 0;color:#777;font-size:12px;">{DISCLAIMER_HE}</p>
  </div>
</body>
</html>
"""


def documents() -> list[dict]:
    return [
        {
            "file": "01-tax-invoice-receipt-he.pdf",
            "kind": "pdf_text",
            "layout": "hebrew_a4",
            "title": "חשבונית מס קבלה",
            "address": "רחוב הבדיקה 12, חיפה",
            "email_on_doc": "billing@cafe-carmel.example",
            "note": "שולם בכרטיס אשראי",
            "lines": [
                ("פולי קפה 2 ק\"ג", 400),
                ("מגש עוגיות", 250),
                ("חלב שקדים", 200),
            ],
            "email": {
                "from_name": "קפה הכרמל",
                "reply_to": "billing@cafe-carmel.example",
                "subject": "חשבונית מס קבלה מספר 10482",
                "body": "שלום,\nמצורפת חשבונית מס קבלה עבור ההזמנה מנובמבר.\nתודה,\nקפה הכרמל",
            },
            "fields": {
                "vendor_name": 'קפה הכרמל בע"מ',
                "vendor_id": COFFEE_ID,
                "doc_type": "tax_invoice_receipt",
                "doc_number": "10482",
                "doc_date": "02/11/2026",
                "amount_before_vat": 850,
                "vat_amount": 153,
                "total": 1003,
                "currency": "ILS",
                "allocation_number": None,
                "buyer_name_ok": True,
            },
        },
        {
            "file": "02-saas-invoice-en.pdf",
            "kind": "pdf_text",
            "layout": "english_a4",
            "address": "100 Demo Street, Wilmington, DE 19801, United States",
            "email_on_doc": "billing@northwind-ledger.example",
            "note": "Foreign supplier. No Israeli VAT was charged.",
            "lines": [("Ledger Pro subscription, November 2026", 49)],
            "email": {
                "from_name": "Northwind Ledger",
                "reply_to": "billing@northwind-ledger.example",
                "subject": "Invoice INV-44190 from Northwind Ledger",
                "body": "Hello,\nYour November invoice is attached.\nTotal due: USD 49.00.\nNorthwind Ledger",
            },
            "fields": {
                "vendor_name": "Northwind Ledger Inc.",
                "vendor_id": None,
                "doc_type": "tax_invoice",
                "doc_number": "INV-44190",
                "doc_date": "2026-11-03",
                "amount_before_vat": 49,
                "vat_amount": 0,
                "total": 49,
                "currency": "USD",
                "allocation_number": None,
                "buyer_name_ok": True,
            },
        },
        {
            "file": "03-tax-invoice-allocation-he.pdf",
            "kind": "pdf_text",
            "layout": "hebrew_a4",
            "title": "חשבונית מס",
            "address": "אזור התעשייה דמה 4, נתניה",
            "email_on_doc": "accounts@alon-office.example",
            "note": "לתשלום בהעברה בתוך 30 יום",
            "lines": [
                ("שולחן עבודה", 5200),
                ("כסא משרדי", 3300),
            ],
            "email": {
                "from_name": "אלון ריהוט משרדי",
                "reply_to": "accounts@alon-office.example",
                "subject": "חשבונית מס 88341",
                "body": "שלום,\nמצורפת חשבונית מס עבור הריהוט.\nאלון ריהוט משרדי",
            },
            "fields": {
                "vendor_name": 'אלון ריהוט משרדי בע"מ',
                "vendor_id": FURNITURE_ID,
                "doc_type": "tax_invoice",
                "doc_number": "88341",
                "doc_date": "05/11/2026",
                "amount_before_vat": 8500,
                "vat_amount": 1530,
                "total": 10030,
                "currency": "ILS",
                "allocation_number": "20261105008831",
                "buyer_name_ok": True,
            },
        },
        {
            "file": "04-scanned-receipt-he.pdf",
            "kind": "pdf_scan",
            "layout": "hebrew_receipt",
            "address": "שוק הדמה 3, ירושלים",
            "email_on_doc": "shop@gefen-bakery.example",
            "lines": [
                ("לחם מחמצת", 22),
                ("עוגת גבינה", 48),
                ("מגש כיבוד", 116),
            ],
            "email": {
                "from_name": "מאפיית הגפן",
                "reply_to": "shop@gefen-bakery.example",
                "subject": "הקבלה שלך ממאפיית הגפן",
                "body": "תודה שקניתם אצלנו. הקבלה מצורפת.\nמאפיית הגפן",
            },
            "fields": {
                "vendor_name": "מאפיית הגפן",
                "vendor_id": BAKERY_ID,
                "doc_type": "receipt",
                "doc_number": "5521",
                "doc_date": "06/11/2026",
                "amount_before_vat": None,
                "vat_amount": None,
                "total": 186,
                "currency": "ILS",
                "allocation_number": None,
                "buyer_name_ok": False,
            },
        },
        {
            "file": "05-photo-receipt.jpg",
            "kind": "image",
            "layout": "hebrew_receipt",
            "address": "רחוב הדוגמה 8, באר שבע",
            "email_on_doc": "shop@dani-home.example",
            "lines": [("קומקום חשמלי", 100)],
            "email": {
                "from_name": "כלי הבית דני",
                "reply_to": "shop@dani-home.example",
                "subject": "קבלה 3188 — כלי הבית דני",
                "body": "שלום,\nמצורפת הקבלה על הקומקום.\nכלי הבית דני",
            },
            "fields": {
                "vendor_name": "חנות כלי הבית דני",
                "vendor_id": HARDWARE_ID,
                "doc_type": "receipt",
                "doc_number": "3188",
                "doc_date": "08/11/2026",
                "amount_before_vat": 100,
                "vat_amount": 18,
                "total": 118,
                "currency": "ILS",
                "allocation_number": None,
                "buyer_name_ok": False,
            },
        },
        {
            "file": "06-email-body-invoice.html",
            "kind": "html",
            "layout": "html",
            "address": "שדרות הבדיקה 21, תל אביב",
            "email_on_doc": "billing@net-gader.example",
            "lines": [
                ("אחסון אתר, נובמבר 2026", 900),
                ("גיבוי יומי", 600),
            ],
            "email": {
                "from_name": "נט-גדר שירותי ענן",
                "reply_to": "billing@net-gader.example",
                "subject": "חשבונית מס 7712 לחודש נובמבר 2026",
                "body": "שלום,\nלהלן חשבונית מס 7712 עבור נובמבר 2026.\nסה\"כ לתשלום: 1,770.00 ש\"ח.\nנט-גדר שירותי ענן",
            },
            "fields": {
                "vendor_name": 'נט-גדר שירותי ענן בע"מ',
                "vendor_id": HOSTING_ID,
                "doc_type": "tax_invoice",
                "doc_number": "7712",
                "doc_date": "01/11/2026",
                "amount_before_vat": 1500,
                "vat_amount": 270,
                "total": 1770,
                "currency": "ILS",
                "allocation_number": None,
                "buyer_name_ok": True,
            },
        },
        {
            "file": "07-credit-note-he.pdf",
            "kind": "pdf_text",
            "layout": "hebrew_a4",
            "title": "חשבונית זיכוי",
            "address": "רחוב הבדיקה 12, חיפה",
            "email_on_doc": "billing@cafe-carmel.example",
            "note": "זיכוי עבור חשבונית 10482",
            "lines": [("זיכוי מגש עוגיות", -250)],
            "email": {
                "from_name": "קפה הכרמל",
                "reply_to": "billing@cafe-carmel.example",
                "subject": "חשבונית זיכוי 2201",
                "body": "שלום,\nמצורפת חשבונית זיכוי עבור חשבונית 10482.\nקפה הכרמל",
            },
            "fields": {
                "vendor_name": 'קפה הכרמל בע"מ',
                "vendor_id": COFFEE_ID,
                "doc_type": "credit_note",
                "doc_number": "2201",
                "doc_date": "10/11/2026",
                "amount_before_vat": -250,
                "vat_amount": -45,
                "total": -295,
                "currency": "ILS",
                "allocation_number": None,
                "buyer_name_ok": True,
            },
        },
        {
            "file": "08-quote-not-invoice-he.pdf",
            "kind": "pdf_text",
            "layout": "quote",
            "title": "הצעת מחיר",
            "address": "האנגר דמה 2, ראשון לציון",
            "email_on_doc": "sales@dummy-supply.example",
            "note": "הצעת מחיר בלבד. בתוקף עד 30/11/2026.",
            "lines": [
                ("מדפסת דמה", 2400),
                ("ערכת נייר", 1200),
            ],
            "email": {
                "from_name": "ציוד דמה",
                "reply_to": "sales@dummy-supply.example",
                "subject": "הצעת מחיר Q-17 ומבצע נובמבר",
                "body": "שלום,\nמצורפת הצעת מחיר Q-17, כולל מבצע נובמבר.\nציוד דמה",
            },
            "fields": {
                "vendor_name": 'ציוד דמה בע"מ',
                "vendor_id": SUPPLY_ID,
                "doc_type": "not_invoice",
                "doc_number": "Q-17",
                "doc_date": "04/11/2026",
                "amount_before_vat": 3600,
                "vat_amount": 648,
                "total": 4248,
                "currency": "ILS",
                "allocation_number": None,
                "buyer_name_ok": True,
            },
        },
    ]


def check_documents(docs: list[dict]) -> None:
    if not is_valid_israeli_id("123456782"):
        raise RuntimeError("Israeli ID check-digit self-test failed")
    seen = set()
    for doc in docs:
        fields = doc["fields"]
        vendor_id = fields["vendor_id"]
        if vendor_id is not None:
            if not is_valid_israeli_id(vendor_id):
                raise RuntimeError("bad vendor id on " + doc["file"])
            if vendor_id == BUYER_ID:
                raise RuntimeError("vendor id collides with buyer on " + doc["file"])
            seen.add(vendor_id)
        before = fields["amount_before_vat"]
        vat = fields["vat_amount"]
        total = fields["total"]
        if before is not None and vat is not None and before + vat != total:
            raise RuntimeError("amounts do not add up on " + doc["file"])
        if doc["lines"] and before is not None:
            if sum(amount for _, amount in doc["lines"]) != before:
                raise RuntimeError("line items do not match subtotal on " + doc["file"])
        elif doc["lines"] and before is None:
            if sum(amount for _, amount in doc["lines"]) != total:
                raise RuntimeError("line items do not match total on " + doc["file"])
    if BUYER_ID in seen:
        raise RuntimeError("buyer id reused as a vendor")


def build_pdf(doc: dict) -> bytes:
    if doc["layout"] == "english_a4":
        pdf = new_pdf("A4")
        english_invoice(pdf, doc)
    elif doc["layout"] == "hebrew_receipt":
        pdf = new_pdf((90, 190))
        pdf.set_margins(6, 8, 6)
        hebrew_receipt(pdf, doc)
    elif doc["layout"] in ("hebrew_a4", "quote"):
        pdf = new_pdf("A4")
        if doc["layout"] == "quote":
            promo_bar(pdf, "מבצע נובמבר: 10% הנחה באישור עד 30/11/2026")
        hebrew_party(pdf, doc, doc["title"])
    else:
        raise ValueError(doc["layout"])
    return bytes(pdf.output())


def public_document(doc: dict) -> dict:
    return {
        "file": doc["file"],
        "kind": doc["kind"],
        "email": doc["email"],
        "fields": doc["fields"],
    }


def write_fixtures(out_dir: Path = OUT) -> None:
    docs = documents()
    check_documents(docs)
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(20261114)
    for doc in docs:
        target = out_dir / doc["file"]
        if doc["kind"] == "html":
            target.write_text(html_invoice(doc), encoding="utf-8")
            continue
        pdf_bytes = build_pdf(doc)
        if doc["kind"] == "pdf_text":
            target.write_bytes(pdf_bytes)
        elif doc["kind"] == "pdf_scan":
            page = to_scanned_page(render_pdf_image(pdf_bytes))
            page.save(target, "PDF", resolution=150.0)
        elif doc["kind"] == "image":
            photo = to_photo(render_pdf_image(pdf_bytes), rng)
            photo.save(target, "JPEG", quality=42, optimize=True)
        else:
            raise ValueError(doc["kind"])
    payload = {
        "description": "Fictional invoice fixtures for tests. Not real vendors, IDs, or amounts.",
        "month": "2026-11",
        "buyer": {
            "name_he": BUYER_HE,
            "name_en": BUYER_EN,
            "vendor_id": BUYER_ID,
        },
        "documents": [public_document(doc) for doc in docs],
    }
    (out_dir / "expected.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(docs)} fixtures and expected.json to {out_dir}")


if __name__ == "__main__":
    write_fixtures()
