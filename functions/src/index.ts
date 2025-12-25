import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp, getApps } from "firebase-admin/app";
import { registerDevice } from "./handlers/registerDevice";
import { sendDailyNudge } from "./handlers/sendDailyNudge";
import { analyzeFoodImage } from "./handlers/analyzeFoodImage";
import { createBackup, restoreBackup, getBackupStatus } from "./handlers/backup";
import { getCreditsHandler, getUserProfile } from "./handlers/credits";
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
 * Device Registration Endpoint
 * POST /register-device
 *
 * Registers or updates a device for push notifications.
 * Uses deviceId as the primary identifier.
 */
export const registerDeviceFunction = onRequest(
  {
    memory: FUNCTION_CONFIG.MEMORY,
    cors: true,
    invoker: "public",
  },
  registerDevice,
);

/**
 * Daily Weight Reminder
 * Scheduled to run at 9:00 AM UTC every day
 */
export const dailyNudge = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "UTC",
    memory: FUNCTION_CONFIG.MEMORY,
  },
  sendDailyNudge,
);

/**
 * Food Image Analysis Endpoint
 * POST /analyze-food-image
 *
 * Requires authentication. Deducts 1 credit per analysis.
 */
export const analyzeFoodImageFunction = onRequest(
  {
    memory: FUNCTION_CONFIG.ANALYSIS_MEMORY,
    timeoutSeconds: 60,
    cors: true,
    invoker: "public",
  },
  analyzeFoodImage,
);

/**
 * Create Backup Endpoint
 * POST /backup
 *
 * Requires authentication. Saves user data backup.
 */
export const backupFunction = onRequest(
  {
    memory: FUNCTION_CONFIG.MEMORY,
    cors: true,
    invoker: "public",
  },
  createBackup,
);

/**
 * Restore Backup Endpoint
 * POST /restore
 *
 * Requires authentication. Returns saved backup data.
 */
export const restoreFunction = onRequest(
  {
    memory: FUNCTION_CONFIG.MEMORY,
    cors: true,
    invoker: "public",
  },
  restoreBackup,
);

/**
 * Backup Status Endpoint
 * GET /backup-status
 *
 * Requires authentication. Returns backup metadata.
 */
export const backupStatusFunction = onRequest(
  {
    memory: FUNCTION_CONFIG.MEMORY,
    cors: true,
    invoker: "public",
  },
  getBackupStatus,
);

/**
 * Credits Endpoint
 * GET /credits
 *
 * Requires authentication. Returns credit balance.
 */
export const creditsFunction = onRequest(
  {
    memory: FUNCTION_CONFIG.MEMORY,
    cors: true,
    invoker: "public",
  },
  getCreditsHandler,
);

/**
 * User Profile Endpoint
 * GET /user/me
 *
 * Requires authentication. Returns user profile with credits.
 */
export const userProfileFunction = onRequest(
  {
    memory: FUNCTION_CONFIG.MEMORY,
    cors: true,
    invoker: "public",
  },
  getUserProfile,
);

