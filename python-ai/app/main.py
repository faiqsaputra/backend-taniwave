from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.services.gemini_service import (
    generate_agriculture_answer,
    require_gemini,
)
from app.services.knowledge_service import (
    delete_source,
    ingest_document,
    list_sources,
    retrieve,
)


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

logger = logging.getLogger("taniwave.ai")


# ============================================================
# APPLICATION
# ============================================================

app = FastAPI(
    title="TANIWAVE AI Service",
    description=(
        "TANIWAVE AI service untuk multimodal agriculture analysis, "
        "RAG knowledge base, Google Search Grounding, citations, "
        "dan evidence verification."
    ),
    version="2.0.0",
)


# ============================================================
# CORS
# ============================================================

_frontends = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_URL",
        "http://localhost:5173",
    ).split(",")
    if origin.strip()
]

if not _frontends:
    _frontends = ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_frontends,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Accept",
        "Authorization",
        "x-admin-key",
    ],
)


# ============================================================
# CONSTANTS
# ============================================================

MAX_TEXT_LENGTH = 5000
MAX_HISTORY_ITEMS = 12
MAX_HISTORY_CONTENT_LENGTH = 1800

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}

ALLOWED_ROLES = {
    "user",
    "assistant",
}


# ============================================================
# HELPERS
# ============================================================

def _safe_string(
    value: Any,
    *,
    max_length: int,
    default: str = "",
) -> str:
    """
    Normalisasi string dari request agar tidak membawa
    whitespace berlebihan atau input yang terlalu panjang.
    """
    if value is None:
        return default

    value = str(value).strip()

    if not value:
        return default

    return value[:max_length]


def _parse_history(raw_history: str) -> list[dict[str, str]]:
    """
    Parse history dari multipart form.

    History dianggap sebagai konteks dialog saja,
    bukan sumber bukti ilmiah.
    """
    if not raw_history:
        return []

    try:
        parsed = json.loads(raw_history)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Invalid chat history received.")
        return []

    if not isinstance(parsed, list):
        return []

    safe_history: list[dict[str, str]] = []

    for item in parsed[-MAX_HISTORY_ITEMS:]:
        if not isinstance(item, dict):
            continue

        role = item.get("role")

        if role not in ALLOWED_ROLES:
            continue

        content = _safe_string(
            item.get("content"),
            max_length=MAX_HISTORY_CONTENT_LENGTH,
        )

        if not content:
            continue

        safe_history.append(
            {
                "role": role,
                "content": content,
            }
        )

    return safe_history


def _require_admin(supplied_key: str | None) -> None:
    """
    Protect knowledge-base mutation endpoints.

    Development:
        ADMIN_API_KEY boleh kosong.

    Production:
        ADMIN_API_KEY wajib tersedia.
    """
    expected_key = os.getenv("ADMIN_API_KEY", "").strip()
    environment = os.getenv("NODE_ENV", "development").strip().lower()

    if not expected_key:
        if environment != "production":
            logger.warning(
                "ADMIN_API_KEY is not configured. "
                "Admin protection is disabled because environment is not production."
            )
            return

        raise HTTPException(
            status_code=503,
            detail="ADMIN_API_KEY wajib dikonfigurasi di production.",
        )

    if not supplied_key:
        raise HTTPException(
            status_code=401,
            detail="Kunci admin diperlukan.",
        )

    if supplied_key != expected_key:
        logger.warning("Invalid admin API key attempt.")
        raise HTTPException(
            status_code=401,
            detail="Kunci admin tidak valid.",
        )


def _validate_image(
    image: UploadFile,
    image_bytes: bytes,
) -> str:
    """
    Validasi tipe dan ukuran gambar.
    """
    mime_type = (image.content_type or "").lower().strip()

    if mime_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                "Tipe foto belum didukung. "
                "Gunakan JPEG, PNG, atau WebP."
            ),
        )

    if len(image_bytes) > config.MAX_CHAT_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Foto melebihi "
                f"{config.MAX_CHAT_IMAGE_MB} MB."
            ),
        )

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="File gambar kosong.",
        )

    return mime_type


def _build_retrieval_query(
    *,
    text: str,
    crop: str,
    stage: str,
) -> str:
    """
    Membuat query retrieval yang lebih informatif
    daripada hanya menggunakan pertanyaan mentah.
    """
    user_text = (
        text
        if text
        else (
            "Analisis kondisi tanaman berdasarkan foto, "
            "gejala visual, kemungkinan penyebab, "
            "dan pemeriksaan lanjutan yang aman."
        )
    )

    return "\n".join(
        [
            f"Komoditas: {crop}",
            f"Tahap pertumbuhan: {stage}",
            f"Pertanyaan: {user_text}",
        ]
    )


# ============================================================
# STARTUP / SHUTDOWN
# ============================================================

@app.on_event("startup")
async def startup_event() -> None:
    logger.info("Starting TANIWAVE AI Service...")
    logger.info(
        "Gemini configured: %s",
        bool(config.GEMINI_API_KEY),
    )
    logger.info(
        "Gemini model: %s",
        config.GEMINI_MODEL,
    )
    logger.info(
        "Embedding model: %s",
        config.GEMINI_EMBEDDING_MODEL,
    )
    logger.info(
        "Google Search Grounding: %s",
        config.ENABLE_GOOGLE_SEARCH_GROUNDING,
    )
    logger.info(
        "CORS origins: %s",
        _frontends,
    )


@app.on_event("shutdown")
async def shutdown_event() -> None:
    logger.info("Stopping TANIWAVE AI Service...")


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "TANIWAVE AI Service",
        "version": "2.0.0",
        "status": "running",
        "docs": "/docs",
        "health": "/health",
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health() -> dict[str, Any]:
    """
    Health endpoint untuk monitoring dan deployment.

    Tidak memanggil Gemini API agar health check murah
    dan tidak menghabiskan quota.
    """
    chroma_ready = False
    chunk_count = 0
    chroma_error: str | None = None

    try:
        from app.services.knowledge_service import _collection_handle

        collection = _collection_handle()

        chunk_count = collection.count()
        chroma_ready = True

    except Exception as exc:
        chroma_error = exc.__class__.__name__

        logger.exception(
            "Chroma health check failed: %s",
            exc.__class__.__name__,
        )

    gemini_ready = bool(config.GEMINI_API_KEY)

    service_ready = gemini_ready and chroma_ready

    response: dict[str, Any] = {
        "status": "ok" if service_ready else "degraded",
        "service": "taniwave-python-ai",
        "version": "2.0.0",
        "gemini_configured": gemini_ready,
        "gemini_model": config.GEMINI_MODEL,
        "embedding_model": config.GEMINI_EMBEDDING_MODEL,
        "google_search_grounding": (
            config.ENABLE_GOOGLE_SEARCH_GROUNDING
        ),
        "knowledge_base_ready": chroma_ready,
        "knowledge_base_chunks": chunk_count,
    }

    if chroma_error:
        response["knowledge_base_error"] = chroma_error

    return response


# ============================================================
# CHAT
# ============================================================

@app.post("/v1/chat")
async def chat(
    text: str = Form(default=""),
    crop: str = Form(default="Belum ditentukan"),
    stage: str = Form(default="Belum diketahui"),
    history: str = Form(default="[]"),
    image: UploadFile | None = File(default=None),
):
    """
    Main agriculture AI endpoint.

    Pipeline:

        Request
           ↓
        Validation
           ↓
        Image processing
           ↓
        History sanitization
           ↓
        RAG retrieval
           ↓
        Gemini multimodal
           ↓
        Evidence verification
           ↓
        JSON response
    """

    started_at = time.perf_counter()

    require_gemini()

    # --------------------------------------------------------
    # Input normalization
    # --------------------------------------------------------

    text = _safe_string(
        text,
        max_length=MAX_TEXT_LENGTH,
    )

    crop = _safe_string(
        crop,
        max_length=100,
        default="Belum ditentukan",
    )

    stage = _safe_string(
        stage,
        max_length=100,
        default="Belum diketahui",
    )

    # --------------------------------------------------------
    # Request validation
    # --------------------------------------------------------

    if not text and image is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Tulis pertanyaan atau unggah "
                "foto tanaman."
            ),
        )

    # --------------------------------------------------------
    # Image handling
    # --------------------------------------------------------

    image_bytes: bytes | None = None
    image_mime_type: str | None = None

    if image is not None:
        try:
            image_bytes = await image.read()
        except Exception as exc:
            logger.exception(
                "Failed to read uploaded image."
            )
            raise HTTPException(
                status_code=400,
                detail="Gagal membaca file gambar.",
            ) from exc

        image_mime_type = _validate_image(
            image,
            image_bytes,
        )

    # --------------------------------------------------------
    # History
    # --------------------------------------------------------

    safe_history = _parse_history(history)

    # --------------------------------------------------------
    # Retrieval query
    # --------------------------------------------------------

    retrieval_query = _build_retrieval_query(
        text=text,
        crop=crop,
        stage=stage,
    )

    # --------------------------------------------------------
    # AI pipeline
    # --------------------------------------------------------

    def _run_pipeline():
        retrieved = retrieve(
            retrieval_query,
            top_k=config.RAG_TOP_K,
        )

        return generate_agriculture_answer(
            text=text,
            crop=crop,
            stage=stage,
            image_bytes=image_bytes,
            image_mime_type=image_mime_type,
            retrieved=retrieved,
            history=safe_history,
        )

    try:
        result = await run_in_threadpool(
            _run_pipeline
        )

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception(
            "Unexpected chat pipeline error."
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Terjadi kesalahan internal saat "
                "memproses pertanyaan."
            ),
        ) from exc

    # --------------------------------------------------------
    # Observability
    # --------------------------------------------------------

    elapsed_ms = round(
        (time.perf_counter() - started_at) * 1000,
        2,
    )

    if isinstance(result, dict):
        result.setdefault(
            "meta",
            {},
        )

        result["meta"].update(
            {
                "processingTimeMs": elapsed_ms,
                "hasImage": image_bytes is not None,
                "historyItems": len(safe_history),
                "ragTopK": config.RAG_TOP_K,
            }
        )

    logger.info(
        "Chat processed in %sms | image=%s | history=%s",
        elapsed_ms,
        image_bytes is not None,
        len(safe_history),
    )

    return result


# ============================================================
# KNOWLEDGE BASE
# ============================================================

@app.get("/v1/knowledge/sources")
def knowledge_sources() -> dict[str, Any]:
    """
    Mendapatkan daftar sumber yang tersimpan
    di knowledge base.
    """
    try:
        return list_sources()

    except Exception as exc:
        logger.exception(
            "Failed to list knowledge sources."
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Gagal mengambil daftar knowledge base."
            ),
        ) from exc


@app.post(
    "/v1/knowledge/ingest",
    status_code=201,
)
async def knowledge_ingest(
    document: UploadFile = File(...),
    title: str = Form(default=""),
    category: str = Form(default="Pertanian umum"),
    publisher: str = Form(
        default="Knowledge Base TANIWAVE"
    ),
    x_admin_key: str | None = Header(
        default=None,
    ),
):
    """
    Upload dan ingest dokumen ke RAG knowledge base.

    Endpoint ini membutuhkan admin key.
    """

    _require_admin(x_admin_key)

    filename = (
        document.filename or "document.txt"
    ).strip()

    if not filename:
        raise HTTPException(
            status_code=400,
            detail="Nama dokumen tidak valid.",
        )

    # --------------------------------------------------------
    # Read file
    # --------------------------------------------------------

    try:
        data = await document.read()

    except Exception as exc:
        logger.exception(
            "Failed to read knowledge document."
        )

        raise HTTPException(
            status_code=400,
            detail="Gagal membaca dokumen.",
        ) from exc

    # --------------------------------------------------------
    # Basic validation before entering threadpool
    # --------------------------------------------------------

    if not data:
        raise HTTPException(
            status_code=400,
            detail="Dokumen kosong.",
        )

    if len(data) > config.MAX_KNOWLEDGE_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Ukuran dokumen melebihi "
                f"{config.MAX_KNOWLEDGE_FILE_MB} MB."
            ),
        )

    safe_title = _safe_string(
        title,
        max_length=200,
    )

    safe_category = _safe_string(
        category,
        max_length=100,
        default="Pertanian umum",
    )

    safe_publisher = _safe_string(
        publisher,
        max_length=150,
        default="Knowledge Base TANIWAVE",
    )

    # --------------------------------------------------------
    # Ingest
    # --------------------------------------------------------

    try:
        result = await run_in_threadpool(
            ingest_document,
            filename=filename,
            data=data,
            title=safe_title,
            category=safe_category,
            publisher=safe_publisher,
        )

        return result

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception(
            "Knowledge ingestion failed."
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Gagal memasukkan dokumen "
                "ke knowledge base."
            ),
        ) from exc


@app.delete(
    "/v1/knowledge/sources/{source_id}"
)
def knowledge_delete(
    source_id: str,
    x_admin_key: str | None = Header(
        default=None,
    ),
):
    """
    Menghapus seluruh chunk dari satu source.
    """

    _require_admin(x_admin_key)

    source_id = source_id.strip()

    if not source_id:
        raise HTTPException(
            status_code=400,
            detail="ID sumber tidak boleh kosong.",
        )

    if len(source_id) > 120:
        raise HTTPException(
            status_code=400,
            detail="ID sumber tidak valid.",
        )

    try:
        return delete_source(source_id)

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception(
            "Failed to delete knowledge source."
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Gagal menghapus sumber "
                "dari knowledge base."
            ),
        ) from exc


# ============================================================
# ERROR HANDLER
# ============================================================

@app.exception_handler(Exception)
async def unhandled_exception_handler(
    request,
    exc: Exception,
):
    """
    Fallback agar exception internal tidak bocor
    sebagai detail response ke client.
    """

    logger.exception(
        "Unhandled exception on %s %s",
        request.method,
        request.url.path,
    )

    return HTTPException(
        status_code=500,
        detail="Internal server error.",
    )