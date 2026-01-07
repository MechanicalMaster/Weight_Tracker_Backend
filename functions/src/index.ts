import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp, getApps } from "firebase-admin/app";
import { sendDailyNudge } from "./handlers/sendDailyNudge";
import { app } from "./api";
import { FUNCTION_CONFIG } from "./config/constants";

// Initialize Firebase Admin SDK (only if not already initialized)
if (getApps().length === 0) {
  initializeApp();
}

// Set global options for all functions
setGlobalOptions({
  region: FUNCTION_CONFIG.REGION,
  timeoutSeconds: FUNCTION_CONFIG.TIMEOUT_SECONDS,
});

/**
 * Consolidated API Endpoint
 *
 * Single Express app serving all HTTP routes:
 * - POST /register-device  (public)
 * - POST /analyze-food     (auth)
 * - POST /backup           (auth)
 * - POST /restore          (auth)
 * - GET  /backup-status    (auth)
 * - GET  /credits          (auth)
 * - GET  /user/me          (auth)
 * - GET  /health           (public)
 *
 * invoker: 'public' is safe because all protected routes
 * enforce Firebase Auth via verifyAuth middleware.
 */
export const api = onRequest(
  {
    memory: FUNCTION_CONFIG.ANALYSIS_MEMORY, // 512MiB for vision workload
    timeoutSeconds: 60,
    minInstances: 1, // Eliminates cold starts (~$0.50/day)
    invoker: "public",
  },
  app,
);

/**
 * Daily Weight Reminder
 * Scheduled to run at 9:00 AM UTC every day
 *
 * Kept as separate function (scheduled, not HTTP).
 */
export const dailyNudge = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "UTC",
    memory: FUNCTION_CONFIG.MEMORY,
  },
  sendDailyNudge,
);
