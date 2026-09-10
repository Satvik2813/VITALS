FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/apps/api DATA_DIR=/app/data
WORKDIR /app
COPY apps/api/requirements.txt /app/apps/api/requirements.txt
RUN pip install --no-cache-dir -r apps/api/requirements.txt && useradd --create-home vitalis
COPY apps/api /app/apps/api
# The trained risk model and its inference module. app.ml.TrainedRiskPredictor
# resolves this as <repo root>/VITALIS_ENGINE, i.e. /app/VITALIS_ENGINE, and is
# the DEFAULT predictor -- without this the container has no model, and outside
# demo mode app.ml.get_predictor() raises rather than silently degrading.
COPY VITALIS_ENGINE /app/VITALIS_ENGINE
COPY scripts/generate_documents.py /app/scripts/generate_documents.py
RUN python scripts/generate_documents.py && mkdir -p /app/data && chown -R vitalis:vitalis /app
USER vitalis
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
