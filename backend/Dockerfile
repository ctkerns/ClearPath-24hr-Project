FROM python:3.14-slim

# uv installs the exact package versions in uv.lock
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app

# Install dependencies first, so Docker reuses this layer until the lock file changes
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY . .
RUN uv sync --locked --no-dev

ENV PATH="/app/.venv/bin:$PATH"
# Only Caddy reaches this port, so trust its X-Forwarded-For: the API then sees the real client IP
# (the sign-in limits count failures per IP).
ENV FORWARDED_ALLOW_IPS="*"
EXPOSE 8000
# Bring the database up to the newest migration, create the demo data if it is missing, then start the API.
# "exec" makes the API the main process, so `docker compose stop` stops it cleanly.
# "::" listens on IPv6 and IPv4: Railway's private network uses IPv6.
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && exec fastapi run src/app/main.py --host :: --port 8000"]
