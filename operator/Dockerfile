# HF Spaces Docker SDK. Python 3.11 + Firefox deps for Camoufox.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# System deps for Firefox / Camoufox.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 libdbus-glib-1-2 libx11-xcb1 libxt6 libxcomposite1 \
    libxdamage1 libxrandr2 libpangocairo-1.0-0 libasound2 libatk1.0-0 \
    libatk-bridge2.0-0 libcups2 libnss3 libxss1 fonts-liberation \
    wget ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Fetch Camoufox's patched Firefox build.
RUN python -m camoufox fetch

COPY . .

# HF Spaces routes port 7860.
EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
