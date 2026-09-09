"""Untrusted document gateway. Detection is a filter, never an authorization boundary."""

import base64
import hashlib
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

RULES = [
    (
        "instruction_override",
        "MALICIOUS",
        r"\b(ignore|disregard|forget)\b.{0,50}\b(previous|prior|system|instructions|oxygen|saturation|readings|alerts)\b",
        "Attempts to override instructions or physiological evidence",
    ),
    (
        "suppress_escalation",
        "MALICIOUS",
        r"\b(do not|don't|never|suppress|disable|silence|cancel)\b.{0,45}\b(escalat\w*|alert\w*|warn\w*|monitor\w*)",
        "Attempts to suppress escalation or alerts",
    ),
    (
        "role_impersonation",
        "MALICIOUS",
        r"(\[/?INST\]|<\|(?:system|im_start|assistant)|\b(system|developer)\s*(prompt|message|:)|\byou are (?:now )?(?:an? )?(?:AI|assistant|model))",
        "Impersonates a privileged model role",
    ),
    (
        "exfiltration",
        "MALICIOUS",
        r"\b(send|upload|export|exfiltrate|transmit)\b.{0,90}\b(secrets?|tokens?|api.?keys?|credentials?|patient data|https?://)",
        "Requests data exfiltration",
    ),
    (
        "tool_invocation",
        "MALICIOUS",
        r"\b(execute|invoke|run|call)\b.{0,40}\b(shell|command|tool|python|powershell|curl|eval)\b",
        "Attempts to invoke executable tools",
    ),
    (
        "jailbreak",
        "MALICIOUS",
        r"\b(jailbreak|developer mode|bypass safety|override (?:the )?(?:risk|score|system|safety))\b",
        "Attempts to bypass safety boundaries",
    ),
    (
        "ai_directed",
        "SUSPICIOUS",
        r"\b(assistant|language model|AI agent|LLM)\b.{0,100}\b(must|should|respond|output|ignore|recommend|instruction)\b",
        "Contains instructions addressed to an AI",
    ),
    (
        "interpretation_override",
        "SUSPICIOUS",
        r"\b(recommend discharge|patient is (?:clinically )?stable|override)\b",
        "Potential attempt to replace live interpretation; requires human review",
    ),
]


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Cf")
    return re.sub(r"\s+", " ", text).strip()


def analyze(text: str, parser_signals: list[dict] | None = None) -> dict:
    normalized = normalize(text)
    signals = list(parser_signals or [])
    surfaces = [("extracted_text", normalized)]
    if any(unicodedata.category(c) == "Cf" for c in text):
        signals.append(
            {
                "code": "invisible_unicode",
                "severity": "SUSPICIOUS",
                "reason": "Invisible Unicode characters found",
                "excerpt": "",
            }
        )
    for token in re.findall(r"[A-Za-z0-9+/]{48,}={0,2}", normalized)[:20]:
        try:
            decoded = base64.b64decode(token, validate=True).decode("utf-8")
            if len(decoded) > 20 and sum(c.isprintable() for c in decoded) / len(decoded) > 0.9:
                surfaces.append(("decoded_base64", normalize(decoded)))
                signals.append(
                    {
                        "code": "encoded_payload",
                        "severity": "SUSPICIOUS",
                        "reason": "Long encoded text payload",
                        "excerpt": token[:80],
                    }
                )
        except (ValueError, UnicodeError):
            pass
    for source, surface in surfaces:
        for code, severity, pattern, reason in RULES:
            match = re.search(pattern, surface, flags=re.I)
            if match:
                signals.append(
                    {
                        "code": code,
                        "severity": severity,
                        "reason": reason,
                        "source": source,
                        "excerpt": surface[max(0, match.start() - 25) : min(len(surface), match.end() + 70)],
                    }
                )
    verdict = (
        "MALICIOUS"
        if any(s["severity"] == "MALICIOUS" for s in signals)
        else "SUSPICIOUS"
        if signals
        else "TRUSTED"
    )
    return {
        "verdict": verdict,
        "signals": signals,
        "quarantined": verdict != "TRUSTED",
        "policy": "gateway-v1",
        "classification_note": "Heuristic screening; TRUSTED means scan passed, not verified clinical truth.",
    }


def extract_facts(text: str, document_id: str, verdict: str) -> list[dict]:
    # Strict numeric schema: free-form prose and directives are never returned.
    definitions = {
        "hemoglobin": (r"hemoglobin\s*:\s*(\d+(?:\.\d+)?)\s*g/dL", 2, 25, "g/dL"),
        "potassium": (r"potassium\s*:\s*(\d+(?:\.\d+)?)\s*mmol/L", 1, 10, "mmol/L"),
        "creatinine": (r"creatinine\s*:\s*(\d+(?:\.\d+)?)\s*mg/dL", 0.1, 30, "mg/dL"),
    }
    facts = []
    for page_number, page in enumerate(text.split("\f"), 1):
        for line_number, line in enumerate(page.splitlines(), 1):
            for kind, (pattern, low, high, unit) in definitions.items():
                match = re.fullmatch(pattern, line.strip(), re.I)
                if match and low <= float(match[1]) <= high:
                    facts.append(
                        {
                            "fact_type": kind,
                            "value": float(match[1]),
                            "trust_status": "SCREENED" if verdict == "TRUSTED" else "QUARANTINED",
                            "provenance": {
                                "document_id": document_id,
                                "page": page_number,
                                "line": line_number,
                                "unit": unit,
                                "method": "anchored-numeric-v1",
                                "clinically_verified": False,
                            },
                        }
                    )
    return facts


def parse_file(path: Path, suffix: str) -> dict:
    """Separate process with a wall timeout; parser failures fail closed into quarantine."""
    try:
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("parse_worker.py")), str(path), suffix],
            capture_output=True,
            timeout=10,
            check=True,
            env={
                k: v
                for k, v in os.environ.items()
                if k.upper() in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "LANG")
            },
        )
        import json

        return json.loads(result.stdout)
    except (subprocess.SubprocessError, ValueError):
        return {
            "text": "",
            "signals": [
                {
                    "code": "parse_failed",
                    "severity": "SUSPICIOUS",
                    "reason": "Document could not be safely parsed within limits",
                    "excerpt": "",
                }
            ],
        }


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()
