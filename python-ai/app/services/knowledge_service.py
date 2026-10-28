from __future__ import annotations

import hashlib
import io
import re
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import chromadb
from docx import Document
from fastapi import HTTPException
from pypdf import PdfReader

from app import config
from app.services.gemini_service import embed_text, require_gemini


# ============================================================
# CONSTANTS
# ============================================================

_ALLOWED_EXTENSIONS = config.ALLOWED_KNOWLEDGE_EXTENSIONS

_client = None
_collection = None


# ============================================================
# CHROMA
# ============================================================

def _collection_handle():
    """
    Lazily initialize ChromaDB collection.

    PersistentClient dipakai agar knowledge base tetap tersedia
    setelah service restart.
    """
    global _client, _collection

    if _collection is None:
        config.CHROMA_PATH.mkdir(
            parents=True,
            exist_ok=True,
        )

        _client = chromadb.PersistentClient(
            path=str(config.CHROMA_PATH)
        )

        _collection = _client.get_or_create_collection(
            name=config.CHROMA_COLLECTION_NAME,
            metadata={
                "hnsw:space": "cosine",
            },
        )

    return _collection


# ============================================================
# TEXT NORMALIZATION
# ============================================================

def _normalize_text(text: str) -> str:
    """
    Membersihkan teks tanpa menghancurkan struktur paragraf.

    Penting untuk RAG:
    terlalu agresif melakukan whitespace normalization dapat
    menghilangkan batas paragraf dan membuat chunk kurang natural.
    """

    if not text:
        return ""

    # Normalize line endings.
    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")

    # Normalize non-breaking spaces.
    text = text.replace("\u00a0", " ")

    # Remove zero-width characters.
    text = re.sub(r"[\u200b-\u200d\ufeff]", "", text)

    # Normalize horizontal whitespace.
    text = re.sub(r"[ \t]+", " ", text)

    # Normalize excessive blank lines.
    text = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", text)

    # Trim each line.
    lines = [
        line.strip()
        for line in text.split("\n")
    ]

    text = "\n".join(lines).strip()

    return text


def _clean_filename(filename: str) -> str:
    """
    Hanya digunakan sebagai metadata.
    Tidak pernah digunakan untuk membangun filesystem path.
    """

    name = Path(filename or "document.txt").name

    # Remove control characters.
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)

    return name[:240] or "document.txt"


# ============================================================
# DOCUMENT EXTRACTION
# ============================================================

def _extract_pdf(data: bytes) -> list[tuple[int, str]]:
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"PDF tidak dapat dibaca: {exc.__class__.__name__}.",
        ) from exc

    if not reader.pages:
        raise HTTPException(
            status_code=422,
            detail="PDF tidak memiliki halaman.",
        )

    pages: list[tuple[int, str]] = []

    for index, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""

        text = _normalize_text(text)

        pages.append(
            (
                index + 1,
                text,
            )
        )

    return pages


def _extract_docx(data: bytes) -> list[tuple[int, str]]:
    try:
        document = Document(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"DOCX tidak dapat dibaca: {exc.__class__.__name__}.",
        ) from exc

    sections: list[str] = []

    # Paragraphs.
    for paragraph in document.paragraphs:
        text = _normalize_text(paragraph.text)

        if text:
            sections.append(text)

    # Tables.
    for table_index, table in enumerate(document.tables, start=1):
        rows: list[str] = []

        for row in table.rows:
            cells = [
                _normalize_text(cell.text)
                for cell in row.cells
            ]

            cells = [
                cell
                for cell in cells
                if cell
            ]

            if cells:
                rows.append(" | ".join(cells))

        if rows:
            sections.append(
                f"[Tabel {table_index}]\n"
                + "\n".join(rows)
            )

    text = _normalize_text(
        "\n\n".join(sections)
    )

    return [(1, text)]


def _extract_plain_text(
    data: bytes,
) -> list[tuple[int, str]]:
    try:
        text = data.decode(
            "utf-8-sig",
            errors="replace",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Dokumen teks tidak dapat dibaca: {exc.__class__.__name__}.",
        ) from exc

    return [
        (
            1,
            _normalize_text(text),
        )
    ]


def _extract_pages(
    filename: str,
    data: bytes,
) -> list[tuple[int, str]]:
    """
    Extract document menjadi pasangan:

        (page_number, text)

    Untuk format non-PDF, page_number = 1.
    """

    extension = Path(filename).suffix.lower()

    if extension not in _ALLOWED_EXTENSIONS:
        allowed = ", ".join(
            sorted(_ALLOWED_EXTENSIONS)
        )

        raise HTTPException(
            status_code=415,
            detail=(
                "Format dokumen tidak didukung. "
                f"Gunakan: {allowed}."
            ),
        )

    if not data:
        raise HTTPException(
            status_code=400,
            detail="Dokumen kosong.",
        )

    try:
        if extension == ".pdf":
            pages = _extract_pdf(data)

        elif extension == ".docx":
            pages = _extract_docx(data)

        else:
            pages = _extract_plain_text(data)

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=(
                "Dokumen tidak dapat diproses: "
                f"{exc.__class__.__name__}."
            ),
        ) from exc

    if not any(
        text.strip()
        for _, text in pages
    ):
        if extension == ".pdf":
            raise HTTPException(
                status_code=422,
                detail=(
                    "PDF tidak memiliki teks yang bisa diekstrak. "
                    "PDF hasil scan memerlukan OCR sebelum di-ingest."
                ),
            )

        raise HTTPException(
            status_code=422,
            detail="Tidak ditemukan teks di dokumen.",
        )

    return pages


# ============================================================
# CHUNKING
# ============================================================

def _find_boundary(
    text: str,
    start: int,
    end: int,
) -> int:
    """
    Cari batas chunk yang lebih natural.

    Prioritas:
    1. paragraph
    2. sentence
    3. whitespace
    """

    search_start = start + (
        config.KNOWLEDGE_CHUNK_SIZE // 2
    )

    candidates = [
        text.rfind("\n\n", search_start, end),
        text.rfind("\n", search_start, end),
        text.rfind(". ", search_start, end),
        text.rfind("? ", search_start, end),
        text.rfind("! ", search_start, end),
        text.rfind("; ", search_start, end),
        text.rfind(" ", search_start, end),
    ]

    valid = [
        position
        for position in candidates
        if position > start
    ]

    return max(valid) if valid else end


def _split_text(
    text: str,
    *,
    chunk_size: int | None = None,
    overlap: int | None = None,
) -> list[str]:
    """
    Split text menjadi chunk yang relatif semantic-aware.

    Chunk size dan overlap berasal dari config jika tidak diberikan.
    """

    normalized = _normalize_text(text)

    if not normalized:
        return []

    chunk_size = (
        chunk_size
        if chunk_size is not None
        else config.KNOWLEDGE_CHUNK_SIZE
    )

    overlap = (
        overlap
        if overlap is not None
        else config.KNOWLEDGE_CHUNK_OVERLAP
    )

    if overlap >= chunk_size:
        raise ValueError(
            "Chunk overlap harus lebih kecil dari chunk size."
        )

    chunks: list[str] = []

    start = 0
    length = len(normalized)

    while start < length:
        proposed_end = min(
            start + chunk_size,
            length,
        )

        if proposed_end < length:
            boundary = _find_boundary(
                normalized,
                start,
                proposed_end,
            )

            if boundary > start:
                # Keep punctuation/line break where possible.
                if normalized.startswith(
                    "\n\n",
                    boundary,
                ):
                    end = boundary + 2
                elif normalized.startswith(
                    ("\n", ". ", "? ", "! ", "; "),
                    boundary,
                ):
                    end = boundary + 1
                else:
                    end = boundary
            else:
                end = proposed_end
        else:
            end = proposed_end

        piece = normalized[start:end].strip()

        if (
            len(piece)
            >= config.KNOWLEDGE_MIN_CHUNK_LENGTH
        ):
            chunks.append(piece)

        if end >= length:
            break

        next_start = end - overlap

        # Safety guard against infinite loops.
        start = max(
            start + 1,
            next_start,
        )

    # Remove exact duplicates while preserving order.
    unique_chunks: list[str] = []
    seen: set[str] = set()

    for chunk in chunks:
        fingerprint = hashlib.sha256(
            chunk.encode("utf-8")
        ).hexdigest()

        if fingerprint in seen:
            continue

        seen.add(fingerprint)
        unique_chunks.append(chunk)

    return unique_chunks


# ============================================================
# HASHING / IDS
# ============================================================

def _content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _source_id(
    *,
    data: bytes,
    title: str,
    publisher: str,
) -> str:
    """
    Source identity berdasarkan konten + semantic metadata.

    Filename sengaja tidak dipakai sebagai identity utama.
    Rename file tidak seharusnya membuat dokumen dianggap
    sebagai knowledge source baru.
    """

    normalized_title = title.strip().lower()
    normalized_publisher = publisher.strip().lower()

    payload = (
        normalized_title
        + "\0"
        + normalized_publisher
        + "\0"
    ).encode("utf-8") + data

    return hashlib.sha256(
        payload
    ).hexdigest()[:24]


def _chunk_id(
    source_id: str,
    chunk_index: int,
    text: str,
) -> str:
    payload = (
        f"{source_id}:"
        f"{chunk_index}:"
        f"{text}"
    )

    return hashlib.sha256(
        payload.encode("utf-8")
    ).hexdigest()


# ============================================================
# INGEST
# ============================================================

def ingest_document(
    *,
    filename: str,
    data: bytes,
    title: str,
    category: str,
    publisher: str,
) -> dict[str, Any]:
    """
    Ingest document ke ChromaDB.

    Pipeline:

        file
          ↓
        validation
          ↓
        extraction
          ↓
        normalization
          ↓
        chunking
          ↓
        embedding
          ↓
        Chroma upsert
    """

    require_gemini()

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

    filename = _clean_filename(filename)

    safe_title = (
        title.strip()
        or Path(filename).stem
            .replace("_", " ")
            .replace("-", " ")
    )

    safe_title = safe_title[:200]

    safe_category = (
        category.strip()
        or "Pertanian umum"
    )[:100]

    safe_publisher = (
        publisher.strip()
        or "Knowledge Base TANIWAVE"
    )[:150]

    content_hash = _content_hash(data)

    source_id = _source_id(
        data=data,
        title=safe_title,
        publisher=safe_publisher,
    )

    extracted = _extract_pages(
        filename,
        data,
    )

    # ========================================================
    # BUILD CHUNKS
    # ========================================================

    all_chunks: list[dict[str, Any]] = []

    for page_number, page_text in extracted:
        chunks = _split_text(page_text)

        for chunk_index_on_page, chunk_text in enumerate(chunks):
            all_chunks.append(
                {
                    "text": chunk_text,
                    "page": page_number,
                    "chunk_index": len(all_chunks),
                    "page_chunk_index": chunk_index_on_page,
                }
            )

    if not all_chunks:
        raise HTTPException(
            status_code=422,
            detail=(
                "Teks terlalu pendek atau tidak cukup "
                "untuk membangun knowledge chunk."
            ),
        )

    if (
        len(all_chunks)
        > config.MAX_KNOWLEDGE_CHUNKS_PER_FILE
    ):
        raise HTTPException(
            status_code=413,
            detail=(
                f"Dokumen menghasilkan {len(all_chunks)} chunks. "
                f"Maksimum {config.MAX_KNOWLEDGE_CHUNKS_PER_FILE} "
                "chunks per file."
            ),
        )

    # ========================================================
    # PREPARE CHROMA DATA
    # ========================================================

    ids: list[str] = []
    documents: list[str] = []
    embeddings: list[list[float]] = []
    metadatas: list[dict[str, Any]] = []

    ingested_at = datetime.now(
        timezone.utc
    ).isoformat()

    for item in all_chunks:
        text = item["text"]

        vector = embed_text(
            text,
            is_query=False,
            title=safe_title,
        )

        chunk_id = _chunk_id(
            source_id,
            item["chunk_index"],
            text,
        )

        ids.append(chunk_id)
        documents.append(text)
        embeddings.append(vector)

        metadatas.append(
            {
                "source_id": source_id,
                "content_hash": content_hash,
                "title": safe_title,
                "category": safe_category,
                "publisher": safe_publisher,
                "filename": filename,
                "page": int(item["page"]),
                "chunk_index": int(item["chunk_index"]),
                "page_chunk_index": int(
                    item["page_chunk_index"]
                ),
                "source_type": "Knowledge Base TANIWAVE",
                "ingested_at": ingested_at,
            }
        )

    # ========================================================
    # UPSERT
    # ========================================================

    collection = _collection_handle()

    batch_size = (
        config.KNOWLEDGE_UPSERT_BATCH_SIZE
    )

    try:
        for start in range(
            0,
            len(ids),
            batch_size,
        ):
            end = start + batch_size

            collection.upsert(
                ids=ids[start:end],
                documents=documents[start:end],
                embeddings=embeddings[start:end],
                metadatas=metadatas[start:end],
            )

    except Exception as exc:
        print(
            "[CHROMA_INGEST_ERROR]",
            exc.__class__.__name__,
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "Gagal menyimpan knowledge base "
                "ke ChromaDB."
            ),
        ) from exc

    return {
        "ok": True,
        "source": {
            "id": source_id,
            "contentHash": content_hash,
            "title": safe_title,
            "filename": filename,
            "category": safe_category,
            "publisher": safe_publisher,
            "chunks": len(all_chunks),
            "pages": len(extracted),
        },
        "message": (
            "Dokumen berhasil diproses, "
            "dibuat embedding, dan disimpan "
            "ke knowledge base."
        ),
    }


# ============================================================
# RETRIEVAL
# ============================================================

def _cosine_similarity_from_distance(
    distance: float,
) -> float:
    """
    Chroma dengan hnsw:space=cosine mengembalikan cosine distance.

    Untuk kebutuhan ranking sederhana:
        similarity = 1 - distance

    Nilai dikunci ke [0, 1].
    """

    try:
        value = 1.0 - float(distance)
    except (
        TypeError,
        ValueError,
    ):
        return 0.0

    return max(
        0.0,
        min(1.0, value),
    )


def retrieve(
    query: str,
    top_k: int | None = None,
    *,
    category: str | None = None,
    source_id: str | None = None,
) -> list[dict[str, Any]]:
    """
    Semantic retrieval dari ChromaDB.

    Mendukung optional metadata filtering dan diversity
    antar source.
    """

    require_gemini()

    query = _normalize_text(query)

    if not query:
        return []

    collection = _collection_handle()

    if collection.count() == 0:
        return []

    requested_k = (
        top_k
        if top_k is not None
        else config.RAG_TOP_K
    )

    requested_k = max(
        1,
        min(
            int(requested_k),
            config.RAG_TOP_K,
        ),
    )

    # Ambil sedikit lebih banyak candidate agar kita bisa
    # mengurangi dominasi satu source.
    candidate_k = min(
        max(requested_k * 3, requested_k),
        50,
    )

    query_filter: dict[str, Any] | None = None

    if category:
        query_filter = {
            "category": category.strip()[:100]
        }

    if source_id:
        source_filter = {
            "source_id": source_id.strip()[:120]
        }

        if query_filter:
            query_filter = {
                "$and": [
                    query_filter,
                    source_filter,
                ]
            }
        else:
            query_filter = source_filter

    vector = embed_text(
        query,
        is_query=True,
    )

    try:
        result = collection.query(
            query_embeddings=[vector],
            n_results=candidate_k,
            where=query_filter,
            include=[
                "documents",
                "metadatas",
                "distances",
            ],
        )
    except Exception as exc:
        print(
            "[CHROMA_RETRIEVAL_ERROR]",
            exc.__class__.__name__,
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "Retrieval knowledge base gagal."
            ),
        ) from exc

    documents = (
        result.get("documents") or [[]]
    )[0]

    metadatas = (
        result.get("metadatas") or [[]]
    )[0]

    distances = (
        result.get("distances") or [[]]
    )[0]

    candidates: list[dict[str, Any]] = []

    for text, metadata, distance in zip(
        documents,
        metadatas,
        distances,
    ):
        if not text:
            continue

        metadata = metadata or {}

        score = _cosine_similarity_from_distance(
            distance
        )

        if score < config.RAG_MIN_SCORE:
            continue

        source = str(
            metadata.get("source_id")
            or "unknown"
        )

        candidates.append(
            {
                "text": str(text),
                "metadata": metadata,
                "score": round(score, 4),
                "_source_id": source,
            }
        )

    if not candidates:
        return []

    # ========================================================
    # SOURCE DIVERSITY
    # ========================================================

    # Jangan sampai top-5 seluruhnya berasal dari satu PDF
    # jika source lain juga relevan.
    selected: list[dict[str, Any]] = []

    source_references: OrderedDict[
        str, str
    ] = OrderedDict()

    max_per_source = max(
        1,
        min(
            3,
            requested_k,
        ),
    )

    source_counts: dict[str, int] = {}

    # Candidate sudah diurutkan Chroma berdasarkan distance.
    # Tetap sort ulang berdasarkan similarity agar eksplisit.
    candidates.sort(
        key=lambda item: item["score"],
        reverse=True,
    )

    for item in candidates:
        source_id_value = item["_source_id"]

        current_count = source_counts.get(
            source_id_value,
            0,
        )

        if current_count >= max_per_source:
            continue

        if source_id_value not in source_references:
            source_references[
                source_id_value
            ] = (
                f"S{len(source_references) + 1}"
            )

        item["reference"] = source_references[
            source_id_value
        ]

        source_counts[
            source_id_value
        ] = current_count + 1

        selected.append(item)

        if len(selected) >= requested_k:
            break

    # ========================================================
    # FALLBACK
    # ========================================================

    # Kalau diversity rule terlalu agresif, pastikan tetap
    # mengembalikan candidate relevan.
    if len(selected) < requested_k:
        selected_ids = {
            id(item)
            for item in selected
        }

        for item in candidates:
            if id(item) in selected_ids:
                continue

            source_id_value = item["_source_id"]

            if source_id_value not in source_references:
                source_references[
                    source_id_value
                ] = (
                    f"S{len(source_references) + 1}"
                )

            item["reference"] = source_references[
                source_id_value
            ]

            selected.append(item)

            if len(selected) >= requested_k:
                break

    # Internal helper tidak boleh bocor ke API.
    for item in selected:
        item.pop("_source_id", None)

    return selected


# ============================================================
# SOURCE LISTING
# ============================================================

def list_sources(
    *,
    limit: int = 100,
    offset: int = 0,
    category: str | None = None,
) -> dict[str, Any]:
    """
    Daftar logical sources, bukan daftar setiap chunk.
    """

    collection = _collection_handle()

    limit = max(
        1,
        min(int(limit), 500),
    )

    offset = max(
        0,
        int(offset),
    )

    try:
        stored = collection.get(
            include=["metadatas"]
        )
    except Exception as exc:
        print(
            "[CHROMA_SOURCE_LIST_ERROR]",
            exc.__class__.__name__,
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "Gagal membaca knowledge base."
            ),
        ) from exc

    metas = stored.get("metadatas") or []

    sources: OrderedDict[
        str, dict[str, Any]
    ] = OrderedDict()

    for metadata in metas:
        metadata = metadata or {}

        source_id = str(
            metadata.get("source_id")
            or "unknown"
        )

        if category:
            if str(
                metadata.get("category", "")
            ).lower() != category.strip().lower():
                continue

        if source_id not in sources:
            sources[source_id] = {
                "id": source_id,
                "contentHash": metadata.get(
                    "content_hash"
                ),
                "title": metadata.get(
                    "title",
                    "Dokumen tanpa judul",
                ),
                "filename": metadata.get(
                    "filename",
                    "",
                ),
                "category": metadata.get(
                    "category",
                    "Pertanian umum",
                ),
                "publisher": metadata.get(
                    "publisher",
                    "Knowledge Base TANIWAVE",
                ),
                "sourceType": metadata.get(
                    "source_type",
                    "Knowledge Base TANIWAVE",
                ),
                "ingestedAt": metadata.get(
                    "ingested_at"
                ),
                "pages": set(),
                "chunks": 0,
            }

        source = sources[source_id]

        source["chunks"] += 1

        page = metadata.get("page")

        if page is not None:
            try:
                source["pages"].add(
                    int(page)
                )
            except (
                TypeError,
                ValueError,
            ):
                pass

    source_list = list(
        sources.values()
    )

    # Convert set → list supaya JSON serializable.
    for source in source_list:
        pages = source.pop(
            "pages",
            set(),
        )

        source["pageCount"] = len(pages)

    total_sources = len(source_list)

    paginated = source_list[
        offset : offset + limit
    ]

    return {
        "sources": paginated,
        "totalSources": total_sources,
        "totalChunks": collection.count(),
        "limit": limit,
        "offset": offset,
    }


# ============================================================
# SOURCE DETAIL
# ============================================================

def get_source(
    source_id: str,
) -> dict[str, Any]:
    """
    Ambil metadata dan statistik satu source.
    """

    source_id = source_id.strip()

    if not source_id:
        raise HTTPException(
            status_code=400,
            detail="ID sumber wajib diisi.",
        )

    if len(source_id) > 120:
        raise HTTPException(
            status_code=400,
            detail="ID sumber tidak valid.",
        )

    collection = _collection_handle()

    try:
        result = collection.get(
            where={
                "source_id": source_id
            },
            include=[
                "documents",
                "metadatas",
            ],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Gagal membaca source "
                "dari knowledge base."
            ),
        ) from exc

    ids = result.get("ids") or []
    documents = result.get(
        "documents"
    ) or []
    metadatas = result.get(
        "metadatas"
    ) or []

    if not ids:
        raise HTTPException(
            status_code=404,
            detail=(
                "Sumber tidak ditemukan "
                "dalam knowledge base."
            ),
        )

    first_meta = (
        metadatas[0]
        if metadatas
        else {}
    ) or {}

    pages = sorted(
        {
            int(meta.get("page"))
            for meta in metadatas
            if meta
            and meta.get("page") is not None
            and str(
                meta.get("page")
            ).isdigit()
        }
    )

    return {
        "id": source_id,
        "contentHash": first_meta.get(
            "content_hash"
        ),
        "title": first_meta.get(
            "title",
            "Dokumen tanpa judul",
        ),
        "filename": first_meta.get(
            "filename",
            "",
        ),
        "category": first_meta.get(
            "category",
            "Pertanian umum",
        ),
        "publisher": first_meta.get(
            "publisher",
            "Knowledge Base TANIWAVE",
        ),
        "sourceType": first_meta.get(
            "source_type",
            "Knowledge Base TANIWAVE",
        ),
        "ingestedAt": first_meta.get(
            "ingested_at"
        ),
        "chunks": len(ids),
        "pages": pages,
        "pageCount": len(pages),
        "preview": [
            {
                "id": chunk_id,
                "page": metadata.get(
                    "page"
                ),
                "chunkIndex": metadata.get(
                    "chunk_index"
                ),
                "text": (
                    document[:500]
                    if document
                    else ""
                ),
            }
            for chunk_id, document, metadata
            in zip(
                ids[:5],
                documents[:5],
                metadatas[:5],
            )
        ],
    }


# ============================================================
# DELETE SOURCE
# ============================================================

def delete_source(
    source_id: str,
) -> dict[str, Any]:
    """
    Hapus seluruh chunk yang dimiliki satu source.
    """

    source_id = source_id.strip()

    if not source_id:
        raise HTTPException(
            status_code=400,
            detail="ID sumber wajib diisi.",
        )

    if len(source_id) > 120:
        raise HTTPException(
            status_code=400,
            detail="ID sumber tidak valid.",
        )

    # Source ID hasil generate SHA-256 hex.
    if not re.fullmatch(
        r"[a-fA-F0-9]{24}",
        source_id,
    ):
        raise HTTPException(
            status_code=400,
            detail="Format ID sumber tidak valid.",
        )

    collection = _collection_handle()

    try:
        result = collection.get(
            where={
                "source_id": source_id
            },
            include=["metadatas"],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Gagal mencari sumber "
                "dalam knowledge base."
            ),
        ) from exc

    ids = result.get("ids") or []

    if not ids:
        raise HTTPException(
            status_code=404,
            detail=(
                "Sumber tidak ditemukan "
                "dalam knowledge base."
            ),
        )

    try:
        collection.delete(
            ids=ids
        )
    except Exception as exc:
        print(
            "[CHROMA_DELETE_ERROR]",
            exc.__class__.__name__,
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "Gagal menghapus sumber "
                "dari knowledge base."
            ),
        ) from exc

    return {
        "ok": True,
        "sourceId": source_id,
        "deletedChunks": len(ids),
        "message": (
            "Sumber dan seluruh chunk terkait "
            "berhasil dihapus."
        ),
    }


# ============================================================
# KNOWLEDGE BASE STATS
# ============================================================

def get_knowledge_stats() -> dict[str, Any]:
    """
    Statistik ringan untuk dashboard admin / health check.
    """

    collection = _collection_handle()

    try:
        total_chunks = collection.count()

        if total_chunks == 0:
            return {
                "ready": True,
                "totalChunks": 0,
                "totalSources": 0,
                "categories": {},
            }

        stored = collection.get(
            include=["metadatas"]
        )

    except Exception as exc:
        print(
            "[CHROMA_STATS_ERROR]",
            exc.__class__.__name__,
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "Gagal membaca statistik "
                "knowledge base."
            ),
        ) from exc

    metadatas = (
        stored.get("metadatas") or []
    )

    sources: set[str] = set()
    categories: dict[str, int] = {}

    for metadata in metadatas:
        metadata = metadata or {}

        source_id = metadata.get(
            "source_id"
        )

        if source_id:
            sources.add(
                str(source_id)
            )

        category = str(
            metadata.get(
                "category",
                "Pertanian umum",
            )
        )

        categories[category] = (
            categories.get(category, 0) + 1
        )

    return {
        "ready": True,
        "totalChunks": total_chunks,
        "totalSources": len(sources),
        "categories": categories,
    }