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
# HOST is the listen address. The default "::" is IPv6, for Railway's private network.
# Docker Compose sets HOST=0.0.0.0 (IPv4), because there "::" accepts IPv6 only and Caddy connects over IPv4.
ENV HOST="::"
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && exec fastapi run src/app/main.py --host \"$HOST\" --port 8000"]
