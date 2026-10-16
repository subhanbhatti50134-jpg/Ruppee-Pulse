# ---------- Stage 1: build the React bundle ----------
FROM node:22-slim AS ui
WORKDIR /build
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# ---------- Stage 2: FastAPI backend + static bundle ----------
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /repo

COPY APis/requirements.txt /repo/APis/requirements.txt
RUN pip install --no-cache-dir -r /repo/APis/requirements.txt

COPY APis /repo/APis
# app.main resolves the bundle at <repo>/ui/dist (spa fallback + /assets)
COPY --from=ui /build/dist /repo/ui/dist

WORKDIR /repo/APis
RUN mkdir -p data
EXPOSE 8010
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
