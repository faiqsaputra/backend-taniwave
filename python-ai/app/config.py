from __future__ import annotations

import os
from pathlib import Path
from typing import Final

from dotenv import load_dotenv


# ============================================================
# ENVIRONMENT
# ============================================================

# Project root:
# python-ai/app/config.py
#        ↑
# parents[2] = root project
ROOT_DIR: Final[Path] = Path(__file__).resolve().parents[2]

# Gunakan satu .env bersama Node/Express.
ENV_FILE: Final[Path] = ROOT_DIR / ".env"
load_dotenv(ENV_FILE)


# ============================================================
# HELPERS
# ============================================================

def _env(name: str, default: str = "") -> str:
    """Ambil environment variable dan bersihkan whitespace."""
    return os.getenv(name, default).strip()


def _bool(name: str, default: bool = False) -> bool:
    """Parse boolean environment variable secara konsisten."""
    value = os.getenv(name)

    if value is None:
        return default

    return value.strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
        "y",
    }


def _int(
    name: str,
    default: int,
    *,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    """Parse integer environment variable dengan batas aman."""
    raw = os.getenv(name)

    if raw is None or not raw.strip():
        value = default
    else:
        try:
            value = int(raw.strip())
        except ValueError as exc:
            raise RuntimeError(
                f"{name} harus berupa integer. Nilai diterima: {raw!r}"
            ) from exc

    if minimum is not None and value < minimum:
        raise RuntimeError(
            f"{name} tidak boleh kurang dari {minimum}. Nilai: {value}"
        )

    if maximum is not None and value > maximum:
        raise RuntimeError(
            f"{name} tidak boleh lebih dari {maximum}. Nilai: {value}"
        )

    return value


def _float(
    name: str,
    default: float,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    """Parse float environment variable dengan batas aman."""
    raw = os.getenv(name)

    if raw is None or not raw.strip():
        value = default
    else:
        try:
            value = float(raw.strip())
        except ValueError as exc:
            raise RuntimeError(
                f"{name} harus berupa angka. Nilai diterima: {raw!r}"
            ) from exc

    if minimum is not None and value < minimum:
        raise RuntimeError(
            f"{name} tidak boleh kurang dari {minimum}. Nilai: {value}"
        )

    if maximum is not None and value > maximum:
        raise RuntimeError(
            f"{name} tidak boleh lebih dari {maximum}. Nilai: {value}"
        )

    return value


def _path(name: str, default: str) -> Path:
    """
    Resolve path relatif terhadap ROOT_DIR.

    Contoh:
    CHROMA_PATH=./python-ai/data/chroma
    menjadi:
    <project-root>/python-ai/data/chroma
    """
    raw = _env(name, default)

    path = Path(raw)

    if not path.is_absolute():
        path = ROOT_DIR / path

    return path.resolve()


def _csv(name: str, default: str = "") -> list[str]:
    """Parse comma-separated environment variable."""
    return [
        item.strip()
        for item in os.getenv(name, default).split(",")
        if item.strip()
    ]


# ============================================================
# APPLICATION
# ============================================================

APP_NAME: Final[str] = _env(
    "APP_NAME",
    "TANIWAVE AI Service",
)

APP_VERSION: Final[str] = _env(
    "APP_VERSION",
    "1.1.0",
)

APP_ENV: Final[str] = _env(
    "APP_ENV",
    _env("NODE_ENV", "development"),
).lower()

IS_PRODUCTION: Final[bool] = APP_ENV == "production"
IS_DEVELOPMENT: Final[bool] = APP_ENV == "development"
IS_TESTING: Final[bool] = APP_ENV == "testing"


# ============================================================
# SERVER
# ============================================================

HOST: Final[str] = _env(
    "AI_HOST",
    "0.0.0.0",
)

PORT: Final[int] = _int(
    "AI_PORT",
    8000,
    minimum=1,
    maximum=65535,
)

LOG_LEVEL: Final[str] = _env(
    "LOG_LEVEL",
    "INFO",
).upper()


# ============================================================
# GEMINI
# ============================================================

GEMINI_API_KEY: Final[str] = _env(
    "GEMINI_API_KEY",
)

GEMINI_MODEL: Final[str] = _env(
    "GEMINI_MODEL",
    "gemini-3.8-flash",
)

GEMINI_EMBEDDING_MODEL: Final[str] = _env(
    "GEMINI_EMBEDDING_MODEL",
    "gemini-embedding-2",
)

ENABLE_GOOGLE_SEARCH_GROUNDING: Final[bool] = _bool(
    "ENABLE_GOOGLE_SEARCH_GROUNDING",
    True,
)

# Model generation parameters.
GEMINI_TEMPERATURE: Final[float] = _float(
    "GEMINI_TEMPERATURE",
    0.25,
    minimum=0.0,
    maximum=2.0,
)

GEMINI_VERIFICATION_TEMPERATURE: Final[float] = _float(
    "GEMINI_VERIFICATION_TEMPERATURE",
    0.0,
    minimum=0.0,
    maximum=1.0,
)

# Waktu maksimal operasi AI.
GEMINI_TIMEOUT_SECONDS: Final[int] = _int(
    "GEMINI_TIMEOUT_SECONDS",
    60,
    minimum=5,
    maximum=300,
)


# ============================================================
# RAG / KNOWLEDGE BASE
# ============================================================

CHROMA_PATH: Final[Path] = _path(
    "CHROMA_PATH",
    "./python-ai/data/chroma",
)

CHROMA_COLLECTION_NAME: Final[str] = _env(
    "CHROMA_COLLECTION_NAME",
    "taniwave_agriculture_kb",
)

# Jumlah chunk yang dikembalikan oleh vector search.
RAG_TOP_K: Final[int] = _int(
    "RAG_TOP_K",
    5,
    minimum=1,
    maximum=10,
)

# Minimum similarity score.
#
# Chroma cosine distance dikonversi menjadi:
# score = 1 - distance
#
# Nilai lebih tinggi = lebih relevan.
RAG_MIN_SCORE: Final[float] = _float(
    "RAG_MIN_SCORE",
    0.20,
    minimum=0.0,
    maximum=1.0,
)

# Jumlah maksimal chunk yang digunakan ketika
# membangun evidence untuk verification.
RAG_VERIFICATION_TOP_K: Final[int] = _int(
    "RAG_VERIFICATION_TOP_K",
    5,
    minimum=1,
    maximum=10,
)

# Maksimum karakter evidence yang dikirim ke model verifier.
RAG_VERIFICATION_MAX_CHARS: Final[int] = _int(
    "RAG_VERIFICATION_MAX_CHARS",
    12000,
    minimum=1000,
    maximum=50000,
)


# ============================================================
# DOCUMENT INGESTION
# ============================================================

MAX_KNOWLEDGE_FILE_MB: Final[int] = _int(
    "MAX_KNOWLEDGE_FILE_MB",
    15,
    minimum=1,
    maximum=100,
)

MAX_KNOWLEDGE_FILE_BYTES: Final[int] = (
    MAX_KNOWLEDGE_FILE_MB * 1024 * 1024
)

# Maksimum chunk yang boleh dihasilkan oleh satu dokumen.
MAX_KNOWLEDGE_CHUNKS_PER_FILE: Final[int] = _int(
    "MAX_KNOWLEDGE_CHUNKS_PER_FILE",
    250,
    minimum=1,
    maximum=5000,
)

# Chunking.
KNOWLEDGE_CHUNK_SIZE: Final[int] = _int(
    "KNOWLEDGE_CHUNK_SIZE",
    1200,
    minimum=200,
    maximum=5000,
)

KNOWLEDGE_CHUNK_OVERLAP: Final[int] = _int(
    "KNOWLEDGE_CHUNK_OVERLAP",
    180,
    minimum=0,
    maximum=1000,
)

# Minimum panjang chunk yang dianggap valid.
KNOWLEDGE_MIN_CHUNK_LENGTH: Final[int] = _int(
    "KNOWLEDGE_MIN_CHUNK_LENGTH",
    40,
    minimum=10,
    maximum=1000,
)

# Jumlah chunk per batch Chroma.
KNOWLEDGE_UPSERT_BATCH_SIZE: Final[int] = _int(
    "KNOWLEDGE_UPSERT_BATCH_SIZE",
    50,
    minimum=1,
    maximum=500,
)


# ============================================================
# CHAT / MULTIMODAL
# ============================================================

MAX_CHAT_IMAGE_MB: Final[int] = _int(
    "MAX_CHAT_IMAGE_MB",
    5,
    minimum=1,
    maximum=20,
)

MAX_CHAT_IMAGE_BYTES: Final[int] = (
    MAX_CHAT_IMAGE_MB * 1024 * 1024
)

MAX_CHAT_TEXT_LENGTH: Final[int] = _int(
    "MAX_CHAT_TEXT_LENGTH",
    5000,
    minimum=100,
    maximum=50000,
)

# Maksimum history yang boleh digunakan model.
CHAT_HISTORY_LIMIT: Final[int] = _int(
    "CHAT_HISTORY_LIMIT",
    12,
    minimum=0,
    maximum=50,
)

# Maksimum karakter setiap message history.
CHAT_HISTORY_MESSAGE_LENGTH: Final[int] = _int(
    "CHAT_HISTORY_MESSAGE_LENGTH",
    1800,
    minimum=100,
    maximum=10000,
)

# Maksimum total karakter history.
CHAT_HISTORY_MAX_CHARS: Final[int] = _int(
    "CHAT_HISTORY_MAX_CHARS",
    12000,
    minimum=1000,
    maximum=50000,
)


# ============================================================
# IMAGE SECURITY
# ============================================================

ALLOWED_IMAGE_MIME_TYPES: Final[set[str]] = {
    "image/jpeg",
    "image/png",
    "image/webp",
}

ALLOWED_KNOWLEDGE_EXTENSIONS: Final[set[str]] = {
    ".pdf",
    ".txt",
    ".md",
    ".csv",
    ".docx",
}


# ============================================================
# ADMIN / INTERNAL API
# ============================================================

ADMIN_API_KEY: Final[str] = _env(
    "ADMIN_API_KEY",
)

# Jika true, endpoint knowledge base juga membutuhkan admin key.
PROTECT_KNOWLEDGE_READ: Final[bool] = _bool(
    "PROTECT_KNOWLEDGE_READ",
    IS_PRODUCTION,
)


# ============================================================
# CORS
# ============================================================

# Bisa diisi:
#
# FRONTEND_URL=http://localhost:5173
#
# atau:
#
# FRONTEND_URL=http://localhost:5173,https://taniwave.vercel.app
#
FRONTEND_URLS: Final[list[str]] = _csv(
    "FRONTEND_URL",
    "http://localhost:5173",
)

# Untuk production sebaiknya explicit allowlist.
if IS_PRODUCTION and not FRONTEND_URLS:
    raise RuntimeError(
        "FRONTEND_URL wajib dikonfigurasi di production."
    )


# ============================================================
# REQUEST / API LIMITS
# ============================================================

# Batas history JSON mentah sebelum diproses.
MAX_HISTORY_PAYLOAD_CHARS: Final[int] = _int(
    "MAX_HISTORY_PAYLOAD_CHARS",
    50000,
    minimum=1000,
    maximum=200000,
)

# Maksimum panjang crop/stage yang masuk ke prompt.
MAX_CROP_LENGTH: Final[int] = _int(
    "MAX_CROP_LENGTH",
    100,
    minimum=20,
    maximum=1000,
)

MAX_STAGE_LENGTH: Final[int] = _int(
    "MAX_STAGE_LENGTH",
    100,
    minimum=20,
    maximum=1000,
)


# ============================================================
# RATE LIMIT
# ============================================================

# Ini bukan pengganti rate limiter di Express/API gateway.
# Digunakan sebagai konfigurasi untuk limiter yang nanti
# dipasang di layer API.
RATE_LIMIT_ENABLED: Final[bool] = _bool(
    "RATE_LIMIT_ENABLED",
    IS_PRODUCTION,
)

RATE_LIMIT_REQUESTS: Final[int] = _int(
    "RATE_LIMIT_REQUESTS",
    30,
    minimum=1,
    maximum=10000,
)

RATE_LIMIT_WINDOW_SECONDS: Final[int] = _int(
    "RATE_LIMIT_WINDOW_SECONDS",
    60,
    minimum=1,
    maximum=3600,
)


# ============================================================
# OBSERVABILITY
# ============================================================

ENABLE_REQUEST_LOGGING: Final[bool] = _bool(
    "ENABLE_REQUEST_LOGGING",
    True,
)

ENABLE_AI_TIMING_LOG: Final[bool] = _bool(
    "ENABLE_AI_TIMING_LOG",
    True,
)

# Jangan pernah log API key, token, image bytes,
# atau isi percakapan penuh.


# ============================================================
# PRODUCTION VALIDATION
# ============================================================

def validate_production_config() -> None:
    """
    Validasi konfigurasi yang wajib benar sebelum service
    berjalan dalam mode production.
    """

    errors: list[str] = []

    if IS_PRODUCTION and not GEMINI_API_KEY:
        errors.append(
            "GEMINI_API_KEY wajib dikonfigurasi di production."
        )

    if IS_PRODUCTION and not ADMIN_API_KEY:
        errors.append(
            "ADMIN_API_KEY wajib dikonfigurasi di production."
        )

    if IS_PRODUCTION and "localhost" in ",".join(FRONTEND_URLS):
        errors.append(
            "FRONTEND_URL tidak boleh menggunakan localhost di production."
        )

    if KNOWLEDGE_CHUNK_OVERLAP >= KNOWLEDGE_CHUNK_SIZE:
        errors.append(
            "KNOWLEDGE_CHUNK_OVERLAP harus lebih kecil dari "
            "KNOWLEDGE_CHUNK_SIZE."
        )

    if RAG_VERIFICATION_TOP_K > RAG_TOP_K:
        errors.append(
            "RAG_VERIFICATION_TOP_K tidak boleh lebih besar dari RAG_TOP_K."
        )

    if errors:
        raise RuntimeError(
            "Konfigurasi production tidak valid:\n- "
            + "\n- ".join(errors)
        )


validate_production_config()


# ============================================================
# SAFE CONFIG SUMMARY
# ============================================================

def get_safe_config_summary() -> dict[str, object]:
    """
    Informasi konfigurasi yang aman ditampilkan pada health/debug
    tanpa membocorkan secret.
    """

    return {
        "app": {
            "name": APP_NAME,
            "version": APP_VERSION,
            "environment": APP_ENV,
        },
        "server": {
            "host": HOST,
            "port": PORT,
            "logLevel": LOG_LEVEL,
        },
        "gemini": {
            "configured": bool(GEMINI_API_KEY),
            "model": GEMINI_MODEL,
            "embeddingModel": GEMINI_EMBEDDING_MODEL,
            "googleSearchGrounding": ENABLE_GOOGLE_SEARCH_GROUNDING,
            "temperature": GEMINI_TEMPERATURE,
            "timeoutSeconds": GEMINI_TIMEOUT_SECONDS,
        },
        "rag": {
            "collection": CHROMA_COLLECTION_NAME,
            "topK": RAG_TOP_K,
            "minScore": RAG_MIN_SCORE,
            "verificationTopK": RAG_VERIFICATION_TOP_K,
        },
        "knowledge": {
            "maxFileMB": MAX_KNOWLEDGE_FILE_MB,
            "maxChunksPerFile": MAX_KNOWLEDGE_CHUNKS_PER_FILE,
            "chunkSize": KNOWLEDGE_CHUNK_SIZE,
            "chunkOverlap": KNOWLEDGE_CHUNK_OVERLAP,
        },
        "chat": {
            "maxTextLength": MAX_CHAT_TEXT_LENGTH,
            "maxImageMB": MAX_CHAT_IMAGE_MB,
            "historyLimit": CHAT_HISTORY_LIMIT,
        },
        "security": {
            "adminConfigured": bool(ADMIN_API_KEY),
            "protectKnowledgeRead": PROTECT_KNOWLEDGE_READ,
            "rateLimitEnabled": RATE_LIMIT_ENABLED,
        },
    }