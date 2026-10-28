import "./config/env.js";
import app from "./app.js";
import { env } from "./config/env.js";
import { disconnectDatabase } from "./config/database.js";

const server = app.listen(env.PORT, () => {
  console.log(`TANIWAVE API running on port ${env.PORT} (${env.NODE_ENV})`);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;
  console.log(`${signal} received. Closing TANIWAVE API...`);

  server.close(async () => {
    try {
      await disconnectDatabase();
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));