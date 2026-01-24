import express, { Request, Response } from "express";
import cors from "cors";
import { latencyLogger } from "./middleware/latency";
import { analyzeFoodImage } from "./handlers/analyzeFoodImage";
import { createBackup, restoreBackup, getBackupStatus } from "./handlers/backup";
import { getCreditsHandler, getUserProfile } from "./handlers/credits";
import { registerDevice } from "./handlers/registerDevice";
import { quickScan } from "./handlers/quickScan";
import { logEvent } from "./handlers/events";

const app = express();

// Health check BEFORE heavy middleware (fast path)
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", version: "1.0.0" });
});

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: "6mb" })); // Matches 5MB image limit + overhead
app.use(latencyLogger);

/**
 * Route Map (v1 - stable)
 * -----------------------
 * POST /register-device  - Device registration (no auth)
 * POST /analyze-food     - Food image analysis (auth required)
 * POST /quick-scan       - Quick food scan (auth required)
 * POST /events           - Event tracking (auth required)
 * POST /backup           - Create backup (auth required)
 * POST /restore          - Restore backup (auth required)
 * GET  /backup-status    - Backup metadata (auth required)
 * GET  /credits          - Credit balance (auth required)
 * GET  /user/me          - User profile (auth required)
 *
 * Route paths are considered stable for v1 and will not change
 * without version bump.
 */

// Public routes
app.post("/register-device", registerDevice);

// Authenticated routes (auth enforced in handlers via verifyAuth)
app.post("/analyze-food", analyzeFoodImage);
app.post("/quick-scan", quickScan);
app.post("/backup", createBackup);
app.post("/restore", restoreBackup);
app.get("/backup-status", getBackupStatus);
app.get("/credits", getCreditsHandler);
app.get("/user/me", getUserProfile);
app.post("/events", logEvent);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    code: "NOT_FOUND",
  });
});

export { app };
