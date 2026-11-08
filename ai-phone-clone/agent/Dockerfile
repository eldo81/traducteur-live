FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN useradd --create-home --uid 10001 agent
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY agent.py ./
COPY interprete ./interprete

USER agent
# 8081 : santé du worker (GET /) ; aucune entrée publique nécessaire, le worker se connecte à LiveKit
EXPOSE 8081
CMD ["python", "agent.py", "start"]
