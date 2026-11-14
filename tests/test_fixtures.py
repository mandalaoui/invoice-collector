"""Check generated fixtures against tests/fixtures/expected.json.

    python tests/test_fixtures.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import generate_fixtures as fixtures  # noqa: E402

OUT = ROOT / "tests" / "fixtures"
EXPECTED = json.loads((OUT / "expected.json").read_text(encoding="utf-8"))


def text_of(path: Path) -> str:
    opened = fitz.open(path)
    try:
        return "\n".join(page.get_text() for page in opened)
    finally:
        opened.close()


def words_of(path: Path) -> list:
    opened = fitz.open(path)
    try:
        return opened[0].get_text("words")
    finally:
        opened.close()


def must_contain(text: str, snippet: str, label: str) -> None:
    if snippet not in text:
        raise AssertionError(f"{label} is missing {snippet!r}")


def main() -> None:
    docs = EXPECTED["documents"]
    assert len(docs) == 8
    assert EXPECTED["buyer"]["vendor_id"] == fixtures.BUYER_ID
    assert fixtures.is_valid_israeli_id("123456782")
    files = [doc["file"] for doc in docs]
    assert len(files) == len(set(files))

    for doc in docs:
        path = OUT / doc["file"]
        assert path.is_file(), path
        fields = doc["fields"]
        before = fields["amount_before_vat"]
        vat = fields["vat_amount"]
        total = fields["total"]
        if before is not None and vat is not None:
            assert before + vat == total, doc["file"]
        if fields["vendor_id"] is not None:
            assert fixtures.is_valid_israeli_id(fields["vendor_id"])
            assert fields["vendor_id"] != EXPECTED["buyer"]["vendor_id"]
        if fields["total"] is not None and abs(fields["total"]) > 5000:
            assert fields["allocation_number"], doc["file"]
        else:
            assert fields["allocation_number"] is None

        if doc["kind"] == "pdf_text":
            text = text_of(path)
            assert any("\u0590" <= char <= "\u05ff" for char in text) or doc["file"].endswith("-en.pdf")
            must_contain(text, fields["doc_number"], doc["file"])
            must_contain(text, fixtures.money(total).rstrip("-"), doc["file"])
            if fields["vendor_id"]:
                must_contain(text, fields["vendor_id"], doc["file"])
            if fields["allocation_number"]:
                must_contain(text, fields["allocation_number"], doc["file"])
                must_contain(text, "מספר הקצאה", doc["file"])
        elif doc["kind"] == "pdf_scan":
            assert text_of(path).strip() == "", doc["file"]
            assert words_of(path) == [], doc["file"]
        elif doc["kind"] == "image":
            blob = path.read_bytes()
            assert blob[:3] == b"\xff\xd8\xff"
            assert len(blob) > 8000
        elif doc["kind"] == "html":
            html = path.read_text(encoding="utf-8")
            assert 'dir="rtl"' in html
            must_contain(html, "חשבונית מס", doc["file"])
            must_contain(html, fields["vendor_id"], doc["file"])
            must_contain(html, fixtures.money(total), doc["file"])
            must_contain(html, 'סה"כ לתשלום', doc["file"])
        else:
            raise AssertionError(doc["kind"])

    by_file = {doc["file"]: doc for doc in docs}
    receipt = by_file["01-tax-invoice-receipt-he.pdf"]
    assert receipt["fields"]["doc_type"] == "tax_invoice_receipt"
    text = text_of(OUT / receipt["file"])
    must_contain(text, "חשבונית מס קבלה", receipt["file"])
    must_contain(text, 'סה"כ לפני מע"מ', receipt["file"])
    must_contain(text, 'מע"מ', receipt["file"])
    must_contain(text, 'סה"כ לתשלום', receipt["file"])

    english = text_of(OUT / "02-saas-invoice-en.pdf")
    must_contain(english, "Tax Invoice", "02")
    must_contain(english, "Total due", "02")
    must_contain(english, "USD", "02")
    assert "\u05d0" not in english

    allocation = text_of(OUT / "03-tax-invoice-allocation-he.pdf")
    assert "חשבונית מס קבלה" not in allocation
    assert "קבלה" not in allocation

    credit = text_of(OUT / "07-credit-note-he.pdf")
    must_contain(credit, "חשבונית זיכוי", "07")
    must_contain(credit, "10482", "07")

    quote = text_of(OUT / "08-quote-not-invoice-he.pdf")
    must_contain(quote, "הצעת מחיר", "08")
    must_contain(quote, "מבצע", "08")
    assert "חשבונית" not in quote

    assert by_file["04-scanned-receipt-he.pdf"]["fields"]["doc_type"] == "receipt"
    assert by_file["05-photo-receipt.jpg"]["fields"]["amount_before_vat"] == 100
    assert by_file["07-credit-note-he.pdf"]["fields"]["vendor_id"] == receipt["fields"]["vendor_id"]
    assert by_file["08-quote-not-invoice-he.pdf"]["fields"]["doc_type"] == "not_invoice"
    print("fixture checks passed")


if __name__ == "__main__":
    main()
