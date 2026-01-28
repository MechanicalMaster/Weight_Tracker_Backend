import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp, getApps } from "firebase-admin/app";
import { createNudgeHandler } from "./handlers/sendDailyNudge";
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

/**
 * Weight Reminder - 7:30 AM IST
 * Opens: platewise://entry
 */
export const weightReminder = onSchedule(
  { schedule: "30 7 * * *", ...SCHEDULE_CONFIG },
  createNudgeHandler("WEIGHT_REMINDER_V1"),
);

/**
 * Breakfast Reminder - 8:30 AM IST
 * Opens: platewise://food/capture
 */
export const breakfastReminder = onSchedule(
  { schedule: "30 8 * * *", ...SCHEDULE_CONFIG },
  createNudgeHandler("BREAKFAST_V1"),
);

/**
 * Lunch Reminder - 1:00 PM IST
 * Opens: platewise://food/capture
 */
export const lunchReminder = onSchedule(
  { schedule: "0 13 * * *", ...SCHEDULE_CONFIG },
  createNudgeHandler("LUNCH_V1"),
);

/**
 * Snacks Reminder - 5:00 PM IST
 * Opens: platewise://food/capture
 */
export const snacksReminder = onSchedule(
  { schedule: "0 17 * * *", ...SCHEDULE_CONFIG },
  createNudgeHandler("SNACKS_V1"),
);

/**
 * Dinner Reminder - 8:30 PM IST
 * Opens: platewise://food/capture
 */
export const dinnerReminder = onSchedule(
  { schedule: "30 20 * * *", ...SCHEDULE_CONFIG },
  createNudgeHandler("DINNER_V1"),
);

/**
 * Evening Check-in - 9:30 PM IST
 * Opens: platewise://dashboard
 */
export const eveningCheckin = onSchedule(
  { schedule: "30 21 * * *", ...SCHEDULE_CONFIG },
  createNudgeHandler("EVENING_CHECKIN_V1"),
);

