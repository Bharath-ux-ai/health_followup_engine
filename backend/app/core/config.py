"""Application settings, loaded from environment variables (see .env.example)."""
from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "TEC THA Follow-Up Engine"
    ENVIRONMENT: str = Field("development", pattern="^(development|test|production)$")
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "sqlite:///./tectha-demo.db"

    # Security
    SECRET_KEY: str = Field(default="tectha-demo-secret-key-32-chars-long-min-len!!", min_length=32)
    ENCRYPTION_KEY: str = "bXl0ZXN0ZW5jcnlwdGlvbmtleWZvcmRlbW9wdXJwb3NlczE="
    ACCESS_TOKEN_MINUTES: int = 12 * 60
    SESSION_COOKIE_NAME: str = "tt_session"
    COOKIE_SECURE: bool = False
    LOGIN_MAX_FAILURES: int = 5
    LOGIN_LOCK_MINUTES: int = 15
    PASSWORD_RESET_MINUTES: int = 30
    CORS_ORIGINS: list[str] = []

    # Public URLs
    PUBLIC_APP_URL: str = "http://localhost:3000"  # used in booking links and password-reset emails

    # WhatsApp Business Platform (Cloud API)
    WHATSAPP_GRAPH_BASE_URL: str = "https://graph.facebook.com"
    WHATSAPP_API_VERSION: str = "v23.0"
    WHATSAPP_VERIFY_TOKEN: str = ""  # token you enter in Meta App > WhatsApp > Configuration > Webhook
    META_APP_SECRET: str = ""  # platform app secret, used to validate X-Hub-Signature-256
    WHATSAPP_HTTP_TIMEOUT_SECONDS: float = 15.0

    # Reminder engine
    REMINDER_MAX_ATTEMPTS: int = 3
    REMINDER_BATCH_SIZE: int = 50
    WORKER_INTERVAL_SECONDS: int = 30
    RUN_WORKER_IN_API: bool = False  # convenient for single-process dev; use the worker service in production
    QUIET_HOURS_START: int = 21  # local hour after which catch-up reminders are deferred
    QUIET_HOURS_END: int = 8
    FOLLOWUP_RED_DAYS: int = 2  # unconfirmed follow-ups this close to the due date turn red

    # Demo
    DEMO_MODE: bool = True  # enables the demo clock + simulation tools. Automatically disabled in production.

    # Email (password reset). If SMTP_HOST is empty, reset links are only written to the server log in development.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "no-reply@tectha.example"
    SMTP_STARTTLS: bool = True

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @model_validator(mode="after")
    def _production_guards(self):
        if self.ENVIRONMENT == "production":
            self.COOKIE_SECURE = True
            self.DEMO_MODE = False
        return self

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
