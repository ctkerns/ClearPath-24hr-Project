from datetime import timedelta
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings. Each field reads the environment variable with the same name (in upper case)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Default matches a Postgres on the host, for running the backend outside Docker.
    # compose.yaml sets this to the "postgres" service.
    database_url: str = "postgresql+psycopg://clearpath:clearpath@localhost:5432/clearpath"

    # Secure cookies go only over HTTPS. True by default; compose.yaml sets false for http://localhost.
    cookie_secure: bool = True
    # A session ends this long after sign-in. Then the user signs in again.
    session_lifetime: timedelta = timedelta(hours=12)
    # Uploaded material files (PRD F3). The default is backend/uploads, which git ignores.
    upload_dir: Path = Path(__file__).parents[2] / "uploads"
    # The largest file one upload may have
    upload_max_bytes: int = 20 * 1024 * 1024


settings = Settings()
