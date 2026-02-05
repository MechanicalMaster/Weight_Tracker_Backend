import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp, getApps } from "firebase-admin/app";
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
 * - POST /quick-scan       (auth)
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
    invoker: "public",
  },
  app,
);

// =============================================================================
// Scheduled Push Notifications (IST times)
// =============================================================================

const SCHEDULE_CONFIG = {
  timeZone: "Asia/Kolkata",
  memory: FUNCTION_CONFIG.MEMORY,
} as const;

// =============================================================================
// UNIFIED NOTIFICATION ENGINE
// =============================================================================
//
// Single cron, single index, per-user scheduling.
// Replaces: weightReminder, breakfastReminder, lunchReminder, snacksReminder,
//           dinnerReminder, eveningCheckin, preferredTimeNudge
// =============================================================================

import { sendUnifiedNotifications } from "./handlers/unifiedCron";

/**
 * Unified Notification Cron - Every 10 minutes
 *
 * Sends notifications to users at their preferred local time per type.
 * Uses single nextNotificationUTC index for O(k) query.
 *
 * Architecture:
 * - Queries: WHERE nextNotificationUTC <= now
 * - Idempotency: Window-based (lastNotificationWindow)
 * - Atomicity: State updated BEFORE send
 */
export const unifiedNotificationCron = onSchedule(
  { schedule: "*/10 * * * *", ...SCHEDULE_CONFIG },
  sendUnifiedNotifications,
);

