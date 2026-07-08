FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY analyze.py main.py ./

# outbound pull 전용 — 인바운드 포트를 EXPOSE 하지 않는다 (CLAUDE.md 보안 규칙)
CMD ["python", "main.py"]
