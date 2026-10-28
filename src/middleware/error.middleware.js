import { ZodError } from "zod";

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: "ROUTE_NOT_FOUND", message: `Route ${req.method} ${req.originalUrl} tidak ditemukan.` }
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  let status = Number(error.statusCode) || 500;
  let code = error.code || "INTERNAL_SERVER_ERROR";
  let message = error.message || "Terjadi kesalahan pada server.";
  let details;

  if (error instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Data yang dikirim tidak valid.";
    details = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  } else if (error.code === "P2002") {
    status = 409;
    code = "DUPLICATE_RECORD";
    message = "Data dengan nilai unik tersebut sudah terdaftar.";
  } else if (error.code === "P2025") {
    status = 404;
    code = "RECORD_NOT_FOUND";
    message = "Data tidak ditemukan atau tidak lagi tersedia.";
  }

  if (status >= 500) {
    console.error(`[API ERROR] ${req.method} ${req.originalUrl}`, error);
    if (process.env.NODE_ENV === "production") message = "Terjadi kesalahan internal. Silakan coba lagi.";
  }

  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) }
  });
}
