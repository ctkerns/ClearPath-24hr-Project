from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings. Each field reads the environment variable with the same name (in upper case)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Default matches a Postgres on the host, for running the backend outside Docker.
    # compose.yaml sets this to the "postgres" service.
    database_url: str = "postgresql+psycopg://clearpath:clearpath@localhost:5432/clearpath"


settings = Settings()
