FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e . && \
    patchright install chromium

# Pre-fetch NudeNet ONNX weights for containerized vision scanner readiness (optional toggle)
ARG FETCH_NUDENET_MODEL=true
RUN if [ "$FETCH_NUDENET_MODEL" = "true" ]; then \
      mkdir -p /app/models && \
      curl -fsSL -L https://github.com/notAI-tech/NudeNet/releases/download/v3.4-weights/320n.onnx -o /app/models/nudenet-320n.onnx; \
    fi

COPY src ./src

ENV PYTHONPATH=/app
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8001"]
