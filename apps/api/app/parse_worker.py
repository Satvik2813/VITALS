"""Short-lived non-executing parser. No document links, actions or attachments are followed."""

import json
import sys
from pathlib import Path

import pymupdf


def parse(path: Path, suffix: str) -> dict:
    signals = []
    if suffix == ".txt":
        text = path.read_text(encoding="utf-8")
        if len(text) > 100_000:
            raise ValueError("Text limit")
        return {"text": text, "signals": []}
    with pymupdf.open(path) as doc:
        if doc.needs_pass or doc.page_count > 20:
            raise ValueError("Encrypted or too many pages")
        if doc.embfile_count():
            signals.append(
                {
                    "code": "embedded_files",
                    "severity": "SUSPICIOUS",
                    "reason": "PDF contains embedded attachments",
                    "excerpt": "",
                }
            )
        pages = []
        for page in doc:
            text = page.get_text("text")
            pages.append(text)
            if sum(len(t) for t in pages) > 100_000:
                raise ValueError("Extracted text limit")
            hidden = False
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        if span.get("text", "").strip() and (
                            span["size"] < 5 or not page.rect.contains(pymupdf.Rect(span["bbox"]))
                        ):
                            hidden = True
            if any(span.get("type") == 3 or span.get("opacity", 1) == 0 for span in page.get_texttrace()):
                hidden = True
            if hidden:
                signals.append(
                    {
                        "code": "hidden_text",
                        "severity": "SUSPICIOUS",
                        "reason": f"Hidden, tiny or off-page text on page {page.number + 1}",
                        "excerpt": "",
                    }
                )
            annotations = list(page.annots() or [])
            if annotations:
                signals.append(
                    {
                        "code": "annotations",
                        "severity": "SUSPICIOUS",
                        "reason": "PDF annotations require review",
                        "excerpt": "",
                    }
                )
                pages.extend(str(a.info.get("content", "")) for a in annotations)
        if doc.xref_length() > 20_000:
            raise ValueError("Object limit")
        if any(
            "/JavaScript" in doc.xref_object(i) or "/Launch" in doc.xref_object(i)
            for i in range(1, doc.xref_length())
        ):
            signals.append(
                {
                    "code": "active_content",
                    "severity": "MALICIOUS",
                    "reason": "PDF contains active actions (never executed)",
                    "excerpt": "",
                }
            )
        text = "\f".join(pages)
        if len(text.strip()) < 20:
            signals.append(
                {
                    "code": "no_text",
                    "severity": "SUSPICIOUS",
                    "reason": "Insufficient extractable text; OCR is not enabled",
                    "excerpt": "",
                }
            )
        return {"text": text, "signals": signals}


if __name__ == "__main__":
    if sys.platform != "win32":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
    print(json.dumps(parse(Path(sys.argv[1]), sys.argv[2])))
