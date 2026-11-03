from datetime import timedelta
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings. Each field reads the environment variable with the same name (in upper case)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Default matches a Postgres on the host, for running the backend outside Docker.
    # compose.yaml sets this to the "postgres" service.
    database_url: str = "postgresql+psycopg://clearpath:clearpath@localhost:5432/clearpath"

    @field_validator("database_url")
    @classmethod
    def use_psycopg(cls, url: str) -> str:
        """Hosts such as Railway give "postgresql://" or "postgres://". SQLAlchemy needs the driver name in it."""
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url.removeprefix(prefix)
        return url

    # Secure cookies go only over HTTPS. True by default; compose.yaml sets false for http://localhost.
    cookie_secure: bool = True
    # A session ends this long after sign-in. Then the user signs in again.
    session_lifetime: timedelta = timedelta(hours=12)
    # Uploaded material files (PRD F3). The default is backend/uploads, which git ignores.
    upload_dir: Path = Path(__file__).parents[2] / "uploads"
    # The largest file one upload may have
    upload_max_bytes: int = 20 * 1024 * 1024

    # The address people open in the browser. Links in emails start with it.
    app_url: str = "http://localhost:8080"
    # "console" writes each email to the log, for local use. TODO: "smtp" for real delivery (see app/mail.py).
    mail_backend: Literal["console", "smtp"] = "console"
    # An invite link works this long. A resend makes a new link (PRD F16).
    invite_lifetime: timedelta = timedelta(days=7)
    password_min_length: int = 12

    # Failed sign-ins allowed in each window, per email and per client IP (PRD F1). Then sign-in returns 429.
    sign_in_window: timedelta = timedelta(minutes=15)
    sign_in_max_failures_per_email: int = 5
    sign_in_max_failures_per_ip: int = 20

    # AI review, PRD F4 layer 2 (app.ai_review). Without a key the review runs code checks only and says so.
    # SecretStr: the key never shows in repr, logs or API responses. Locally, backend/scripts/dev.sh reads it
    # from the macOS Keychain into the process environment only.
    anthropic_api_key: SecretStr | None = None
    ai_review_model: str = "claude-opus-5-5"
    ai_review_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    # Seconds for the whole AI review of one version, retries included (PRD section 11: under 60 seconds)
    ai_review_timeout: float = 60.0
    # Calls per version: the first, plus retries when the output is invalid (PRD section 11)
    ai_review_attempts: int = 2

    @field_validator("anthropic_api_key", mode="before")
    @classmethod
    def empty_is_none(cls, value: object) -> object:
        """compose.yaml passes ANTHROPIC_API_KEY as an empty string when it is not set."""
        return None if isinstance(value, str) and not value.strip() else value


settings = Settings()
