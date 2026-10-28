import express from "express";
import multer from "multer";

const router = express.Router();

const PYTHON_AI_URL = (
  process.env.PYTHON_AI_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const PYTHON_AI_ADMIN_KEY = process.env.PYTHON_AI_ADMIN_KEY || "";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

async function parsePythonResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();

  return {
    detail: text || "Python AI mengembalikan respons kosong.",
  };
}

/**
 * GET /api/ai/health
 *
 * Cek koneksi Express -> Python AI
 */
router.get("/health", async (req, res, next) => {
  try {
    const response = await fetch(`${PYTHON_AI_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    const data = await parsePythonResponse(response);

    return res.status(response.status).json({
      success: response.ok,
      service: "taniwave-express",
      pythonAI: data,
    });
  } catch (error) {
    console.error("[PYTHON_AI_HEALTH_ERROR]", error);

    return res.status(503).json({
      success: false,
      service: "taniwave-express",
      pythonAI: {
        status: "offline",
        detail: "Python AI service tidak dapat dihubungi.",
      },
    });
  }
});

/**
 * POST /api/ai/chat
 *
 * Proxy:
 * Express -> FastAPI /v1/chat
 */
router.post("/chat", upload.single("image"), async (req, res, next) => {
  try {
    const form = new FormData();

    const text = String(req.body?.text || "");
    const crop = String(req.body?.crop || "Belum ditentukan");
    const stage = String(req.body?.stage || "Belum diketahui");
    const history = String(req.body?.history || "[]");

    form.append("text", text);
    form.append("crop", crop);
    form.append("stage", stage);
    form.append("history", history);

    if (req.file) {
      const blob = new Blob(
        [req.file.buffer],
        {
          type: req.file.mimetype,
        }
      );

      form.append(
        "image",
        blob,
        req.file.originalname || "plant-image"
      );
    }

    const response = await fetch(`${PYTHON_AI_URL}/v1/chat`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120000),
    });

    const data = await parsePythonResponse(response);

    return res.status(response.status).json(data);
  } catch (error) {
    console.error("[PYTHON_AI_CHAT_ERROR]", error);

    return res.status(502).json({
      success: false,
      detail: "Python AI service gagal memproses permintaan.",
    });
  }
});

/**
 * GET /api/ai/knowledge/sources
 */
router.get("/knowledge/sources", async (req, res) => {
  try {
    const response = await fetch(
      `${PYTHON_AI_URL}/v1/knowledge/sources`,
      {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      }
    );

    const data = await parsePythonResponse(response);

    return res.status(response.status).json(data);
  } catch (error) {
    console.error("[PYTHON_AI_SOURCES_ERROR]", error);

    return res.status(502).json({
      success: false,
      detail: "Knowledge Base Python AI tidak dapat dihubungi.",
    });
  }
});

/**
 * POST /api/ai/knowledge/ingest
 *
 * Hanya backend yang mengetahui ADMIN_API_KEY.
 */
router.post(
  "/knowledge/ingest",
  upload.single("document"),
  async (req, res) => {
    try {
      if (!PYTHON_AI_ADMIN_KEY) {
        return res.status(503).json({
          success: false,
          detail: "PYTHON_AI_ADMIN_KEY belum dikonfigurasi.",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          detail: "Dokumen wajib diunggah.",
        });
      }

      const form = new FormData();

      form.append(
        "document",
        new Blob([req.file.buffer], {
          type: req.file.mimetype,
        }),
        req.file.originalname || "document.pdf"
      );

      form.append(
        "title",
        String(req.body?.title || "")
      );

      form.append(
        "category",
        String(req.body?.category || "Pertanian umum")
      );

      form.append(
        "publisher",
        String(req.body?.publisher || "TANIWAVE")
      );

      const response = await fetch(
        `${PYTHON_AI_URL}/v1/knowledge/ingest`,
        {
          method: "POST",
          headers: {
            "x-admin-key": PYTHON_AI_ADMIN_KEY,
          },
          body: form,
          signal: AbortSignal.timeout(120000),
        }
      );

      const data = await parsePythonResponse(response);

      return res.status(response.status).json(data);
    } catch (error) {
      console.error("[PYTHON_AI_INGEST_ERROR]", error);

      return res.status(502).json({
        success: false,
        detail: "Python AI gagal melakukan ingest dokumen.",
      });
    }
  }
);

/**
 * DELETE /api/ai/knowledge/sources/:sourceId
 */
router.delete(
  "/knowledge/sources/:sourceId",
  async (req, res) => {
    try {
      if (!PYTHON_AI_ADMIN_KEY) {
        return res.status(503).json({
          success: false,
          detail: "PYTHON_AI_ADMIN_KEY belum dikonfigurasi.",
        });
      }

      const { sourceId } = req.params;

      const response = await fetch(
        `${PYTHON_AI_URL}/v1/knowledge/sources/${encodeURIComponent(sourceId)}`,
        {
          method: "DELETE",
          headers: {
            "x-admin-key": PYTHON_AI_ADMIN_KEY,
          },
          signal: AbortSignal.timeout(30000),
        }
      );

      const data = await parsePythonResponse(response);

      return res.status(response.status).json(data);
    } catch (error) {
      console.error("[PYTHON_AI_DELETE_SOURCE_ERROR]", error);

      return res.status(502).json({
        success: false,
        detail: "Python AI gagal menghapus sumber knowledge base.",
      });
    }
  }
);

export default router;