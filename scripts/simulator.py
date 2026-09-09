"""Standalone simulator clock. Uses the API's real deterministic stream generator."""

import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

if __name__ == "__main__":
    token = os.getenv("API_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    with httpx.Client(
        base_url=os.getenv("BACKEND_URL", "http://127.0.0.1:8000"), headers=headers, timeout=20
    ) as client:
        client.post("/api/demo", json={"action": "pause"}).raise_for_status()
        print("VITALIS external simulator clock active. Ctrl+C to stop. Use Start deterioration in the UI.")
        try:
            while True:
                client.post("/api/demo", json={"action": "advance", "steps": 1}).raise_for_status()
                time.sleep(float(os.getenv("SIMULATOR_INTERVAL_SECONDS", "2")))
        except KeyboardInterrupt:
            print("Simulator stopped.")
