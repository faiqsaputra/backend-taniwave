import "./config/env.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { allowedOrigins } from "./config/env.js";
import apiRoutes from "./routes/api.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";

const app = express();

app.disable("x-powered-by");

app.use(helmet());

app.use(cors({
  origin(origin, callback) {
    // Requests without Origin are typical for health checks
    // and server-to-server calls.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    const error = new Error(`Origin ${origin} is not allowed by CORS.`);
    error.statusCode = 403;
    error.code = "CORS_ORIGIN_DENIED";

    return callback(error);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "TANIWAVE API is running",
    status: "online"
  });
});

// Semua API TANIWAVE
app.use("/api", apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;