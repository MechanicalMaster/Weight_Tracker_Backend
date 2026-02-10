import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { errors } from "../utils/errors";

const db = getFirestore();

// Default free credits for new users
const DEFAULT_FREE_CREDITS = 40;

/**
 * Safe string extraction with fallback.
 * Never throws, always returns a string.
 */
function safeString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

/**
 * Derives time of day from timezone.
 * Returns "morning", "afternoon", or "evening" based on local hour.
 */
function getTimeOfDay(timezone: string): "morning" | "afternoon" | "evening" {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);

    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    return "evening";
  } catch {
    // Invalid timezone, default to morning
    return "morning";
  }
}

/**
 * Personalization context for notification rendering.
 * Designed for Tier 1 variables now, extensible for Tier 2 (streaks, etc).
 */
export interface PersonalizationContext {
  displayName: string;
  timezone: string;
  timeOfDay: "morning" | "afternoon" | "evening";
  // Tier 2 (future): daysSinceLastLog, currentStreak, goalType
}

/**
 * Single notification type preference
 */
export interface NotificationPref {
  enabled: boolean;
  hour: number; // 0-23 (user's local time)
  minute: number; // 0,10,20,30,40,50
}

/**
 * User document structure
 */
export interface UserDocument {
  aiCredits: number;
  totalGranted: number;
  totalUsed: number;
  displayName?: string;
  timezone?: string;

  // Per-type notification preferences
  notificationPrefs?: {
    weight?: NotificationPref;
    breakfast?: NotificationPref;
    lunch?: NotificationPref;
    dinner?: NotificationPref;
    snacks?: NotificationPref;
  };

  // Unified scheduler: single next notification (the optimization)
  nextNotificationUTC?: Timestamp;
  nextNotificationTypes?: string[]; // Types sharing same time

  // Window-based idempotency (e.g., "2026-02-05T07:30")
  lastNotificationWindow?: string;

  createdAt: Timestamp;
  lastActiveAt: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * Initialize a new user with free credits
 * Called on first authentication
 */
export async function initializeUser(uid: string): Promise<UserDocument> {
  const userRef = db.collection("users").doc(uid);

  const existingUser = await userRef.get();
  if (existingUser.exists) {
    logger.info(`User ${uid} already exists, returning existing data`);
    return existingUser.data() as UserDocument;
  }

  const now = Timestamp.now();
  const userData: UserDocument = {
    aiCredits: DEFAULT_FREE_CREDITS,
    totalGranted: DEFAULT_FREE_CREDITS,
    totalUsed: 0,
    createdAt: now,
    lastActiveAt: now,
  };

  await userRef.set(userData);
  logger.info(`Initialized new user ${uid} with ${DEFAULT_FREE_CREDITS} credits`);

  return userData;
}

/**
 * Get or create user data
 */
export async function getOrCreateUser(uid: string): Promise<UserDocument> {
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return initializeUser(uid);
  }

  // Update last active timestamp
  await userRef.update({ lastActiveAt: FieldValue.serverTimestamp() });

  return userDoc.data() as UserDocument;
}

/**
 * Get current credit balance
 */
export async function getCredits(uid: string): Promise<number> {
  const user = await getOrCreateUser(uid);
  return user.aiCredits;
}

/**
 * Deduct one credit from user balance
 * Uses transaction to prevent race conditions
 * Throws INSUFFICIENT_CREDITS if balance is 0
 */
export async function deductCredit(uid: string): Promise<number> {
  const userRef = db.collection("users").doc(uid);

  const newBalance = await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);

    if (!userDoc.exists) {
      // Initialize user first
      const now = Timestamp.now();
      const userData: UserDocument = {
        aiCredits: DEFAULT_FREE_CREDITS,
        totalGranted: DEFAULT_FREE_CREDITS,
        totalUsed: 0,
        createdAt: now,
        lastActiveAt: now,
      };
      transaction.set(userRef, userData);
      // Deduct one credit
      transaction.update(userRef, {
        aiCredits: DEFAULT_FREE_CREDITS - 1,
        totalUsed: 1,
        lastActiveAt: FieldValue.serverTimestamp(),
      });
      return DEFAULT_FREE_CREDITS - 1;
    }

    const userData = userDoc.data() as UserDocument;

    if (userData.aiCredits <= 0) {
      throw errors.insufficientCredits();
    }

    const newCredits = userData.aiCredits - 1;
    transaction.update(userRef, {
      aiCredits: newCredits,
      totalUsed: FieldValue.increment(1),
      lastActiveAt: FieldValue.serverTimestamp(),
    });

    return newCredits;
  });

  logger.info(`Deducted credit for user ${uid}, remaining: ${newBalance}`);
  return newBalance;
}

/**
 * Add credits to user balance (for future admin/payment use)
 */
export async function addCredits(uid: string, amount: number): Promise<number> {
  const userRef = db.collection("users").doc(uid);

  await userRef.update({
    aiCredits: FieldValue.increment(amount),
    totalGranted: FieldValue.increment(amount),
    lastActiveAt: FieldValue.serverTimestamp(),
  });

  const updated = await userRef.get();
  const credits = (updated.data() as UserDocument).aiCredits;

  logger.info(`Added ${amount} credits to user ${uid}, new balance: ${credits}`);
  return credits;
}

// ============================================================================
// PERSONALIZATION FUNCTIONS
// ============================================================================

/**
 * Upsert user profile fields (displayName, timezone).
 * Only updates fields that are provided (undefined fields are ignored).
 * Never throws - profile is not critical to registration.
 */
export async function upsertUserProfile(
  uid: string,
  data: { displayName?: string; timezone?: string },
): Promise<void> {
  const userRef = db.collection("users").doc(uid);
  const now = Timestamp.now();

  const updateData: Record<string, unknown> = {
    updatedAt: now,
    lastActiveAt: now,
  };

  if (data.displayName !== undefined) {
    updateData.displayName = data.displayName;
  }
  if (data.timezone !== undefined) {
    updateData.timezone = data.timezone;
  }

  try {
    const doc = await userRef.get();
    if (doc.exists) {
      await userRef.update(updateData);
      logger.info(`Updated user profile: ${uid}`);
    } else {
      // Create new profile with defaults + credits
      const newProfile: UserDocument = {
        aiCredits: DEFAULT_FREE_CREDITS,
        totalGranted: DEFAULT_FREE_CREDITS,
        totalUsed: 0,
        displayName: safeString(data.displayName, ""),
        timezone: safeString(data.timezone, "UTC"),
        createdAt: now,
        lastActiveAt: now,
        updatedAt: now,
      };
      await userRef.set(newProfile);
      logger.info(`Created user profile: ${uid} with ${DEFAULT_FREE_CREDITS} credits`);
    }
  } catch (error) {
    logger.error(`Failed to upsert user profile: ${uid}`, { error });
    // Don't throw - user profile is not critical to registration
  }
}

/**
 * Resolves personalization context for a single user.
 * NEVER throws - always returns a valid context with safe defaults.
 */
export async function resolvePersonalizationContext(
  uid: string,
): Promise<PersonalizationContext> {
  try {
    const doc = await db.collection("users").doc(uid).get();
    const data = doc.data() as UserDocument | undefined;

    const displayName = safeString(data?.displayName, "Friend");
    const timezone = safeString(data?.timezone, "UTC");

    return {
      displayName,
      timezone,
      timeOfDay: getTimeOfDay(timezone),
    };
  } catch (error) {
    logger.warn(`Failed to resolve context for ${uid}, using defaults`, { error });
    return {
      displayName: "Friend",
      timezone: "UTC",
      timeOfDay: "morning",
    };
  }
}

/**
 * Batch resolve personalization context for multiple users.
 * Efficient for processing large numbers of users (uses Firestore getAll).
 *
 * @param uids Array of user IDs to resolve
 * @returns Map of uid -> PersonalizationContext
 */
export async function resolveContextBatch(
  uids: string[],
): Promise<Map<string, PersonalizationContext>> {
  const contextMap = new Map<string, PersonalizationContext>();

  if (uids.length === 0) {
    return contextMap;
  }

  try {
    // Get document references for all UIDs
    const refs = uids.map((uid) => db.collection("users").doc(uid));
    const snapshots = await db.getAll(...refs);

    for (let i = 0; i < uids.length; i++) {
      const uid = uids[i];
      const snapshot = snapshots[i];
      const data = snapshot.exists ? (snapshot.data() as UserDocument) : undefined;

      const displayName = safeString(data?.displayName, "Friend");
      const timezone = safeString(data?.timezone, "UTC");

      contextMap.set(uid, {
        displayName,
        timezone,
        timeOfDay: getTimeOfDay(timezone),
      });
    }
  } catch (error) {
    logger.warn("Failed to batch resolve contexts, using defaults", { error });
    // Return defaults for all uids
    for (const uid of uids) {
      contextMap.set(uid, {
        displayName: "Friend",
        timezone: "UTC",
        timeOfDay: "morning",
      });
    }
  }

  return contextMap;
}

// ============================================================================
// UNIFIED NOTIFICATION SCHEDULING ENGINE
// ============================================================================

import {
  NOTIFICATION_CONFIG,
  NotificationType,
} from "../config/constants";

/**
 * Converts local time to next UTC timestamp.
 * Finds the next occurrence of hour:minute in the given timezone.
 */
export function localTimeToNextUTC(
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const now = new Date();

  // Get current time in target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string): number =>
    parseInt(parts.find((p) => p.type === type)?.value || "0", 10);

  const localHour = getPart("hour");
  const localMinute = getPart("minute");

  // Calculate timezone offset
  const testDate = new Date();
  const utcHour = testDate.getUTCHours();
  const tzFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  });
  const tzHour = parseInt(tzFormatter.format(testDate), 10);
  const offsetHours = tzHour - utcHour;

  // Target UTC hour = local hour - offset
  let targetUTCHour = hour - offsetHours;
  if (targetUTCHour < 0) targetUTCHour += 24;
  if (targetUTCHour >= 24) targetUTCHour -= 24;

  // Build target date
  const targetDate = new Date();
  targetDate.setUTCHours(targetUTCHour, minute, 0, 0);

  // If this time has passed today, move to tomorrow
  const hasPassed =
    localHour > hour || (localHour === hour && localMinute >= minute);
  if (hasPassed) {
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
  }

  return targetDate;
}

/**
 * Computes the next notification across all enabled types.
 * Returns the minimum time and all types sharing that time.
 */
export function computeNextNotification(
  prefs: UserDocument["notificationPrefs"],
  timezone: string,
): { nextUTC: Date | null; types: NotificationType[] } {
  if (!prefs) {
    return { nextUTC: null, types: [] };
  }

  const candidates: Array<{ type: NotificationType; nextUTC: Date }> = [];

  for (const type of NOTIFICATION_CONFIG.TYPES) {
    const pref = prefs[type];
    if (!pref?.enabled) continue;

    const nextUTC = localTimeToNextUTC(pref.hour, pref.minute, timezone);
    candidates.push({ type, nextUTC });
  }

  if (candidates.length === 0) {
    return { nextUTC: null, types: [] };
  }

  // Find minimum time
  const minTime = Math.min(...candidates.map((c) => c.nextUTC.getTime()));
  const types = candidates
    .filter((c) => c.nextUTC.getTime() === minTime)
    .map((c) => c.type);

  return { nextUTC: new Date(minTime), types };
}

/**
 * Floor a date to the start of its 10-minute window.
 * Returns string like "2026-02-05T07:30"
 */
export function getWindowKey(date: Date): string {
  const d = new Date(date);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 10) * 10, 0, 0);
  return d.toISOString().slice(0, 16);
}

/**
 * Input for updating a single notification type preference.
 */
export interface NotificationPrefInput {
  type: NotificationType;
  enabled: boolean;
  hour?: number;
  minute?: number;
}

/**
 * Updates a single notification type preference.
 * Immediately recomputes nextNotificationUTC.
 */
export async function updateNotificationPref(
  uid: string,
  input: NotificationPrefInput,
  userTimezone?: string,
): Promise<void> {
  const userRef = db.collection("users").doc(uid);
  const now = Timestamp.now();

  // Get existing user data
  const userDoc = await userRef.get();
  const userData = userDoc.exists ? (userDoc.data() as UserDocument) : null;

  const timezone =
    userTimezone ||
    userData?.timezone ||
    NOTIFICATION_CONFIG.DEFAULT_TIMEZONE;

  // Build updated prefs
  const existingPrefs = userData?.notificationPrefs || {};

  // Get defaults for this type if not provided
  const defaults = NOTIFICATION_CONFIG.DEFAULTS[input.type];
  const newPref: NotificationPref = {
    enabled: input.enabled,
    hour: input.hour ?? defaults.hour,
    minute: input.minute ?? defaults.minute,
  };

  const updatedPrefs = {
    ...existingPrefs,
    [input.type]: newPref,
  };

  // Compute next notification
  const { nextUTC, types } = computeNextNotification(updatedPrefs, timezone);

  const updateData: Record<string, unknown> = {
    [`notificationPrefs.${input.type}`]: newPref,
    updatedAt: now,
    lastActiveAt: now,
  };

  if (userTimezone) {
    updateData.timezone = userTimezone;
  }

  if (nextUTC) {
    updateData.nextNotificationUTC = Timestamp.fromDate(nextUTC);
    updateData.nextNotificationTypes = types;
  } else {
    updateData.nextNotificationUTC = FieldValue.delete();
    updateData.nextNotificationTypes = FieldValue.delete();
  }

  await userRef.update(updateData);
  logger.info(`Updated notification pref for user ${uid}`, {
    type: input.type,
    enabled: input.enabled,
  });
}

/**
 * User eligible for notification.
 */
export interface EligibleUser {
  uid: string;
  timezone: string;
  notificationTypes: NotificationType[];
  notificationPrefs: UserDocument["notificationPrefs"];
  lastNotificationWindow?: string;
}

/**
 * Gets users eligible for notification at the current time.
 * Uses single indexed query: nextNotificationUTC <= now
 */
export async function getEligibleUsers(): Promise<EligibleUser[]> {
  const now = Timestamp.now();

  try {
    const snapshot = await db
      .collection("users")
      .where("nextNotificationUTC", "<=", now)
      .get();

    const eligibleUsers: EligibleUser[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data() as UserDocument;
      eligibleUsers.push({
        uid: doc.id,
        timezone: data.timezone || NOTIFICATION_CONFIG.DEFAULT_TIMEZONE,
        notificationTypes: (data.nextNotificationTypes || []) as NotificationType[],
        notificationPrefs: data.notificationPrefs,
        lastNotificationWindow: data.lastNotificationWindow,
      });
    }

    logger.info(`Found ${eligibleUsers.length} eligible users for notification`);
    return eligibleUsers;
  } catch (error) {
    logger.error("Failed to query eligible users", { error });
    return [];
  }
}

/**
 * Schedules next notification for a user.
 * Atomic update: sets nextNotificationUTC, nextNotificationTypes, lastNotificationWindow.
 * Call this BEFORE sending to ensure idempotency.
 */
export async function scheduleNextNotification(
  uid: string,
  windowKey: string,
): Promise<void> {
  const userRef = db.collection("users").doc(uid);
  const now = Timestamp.now();

  try {
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      logger.warn(`Cannot schedule next: user ${uid} not found`);
      return;
    }

    const userData = userDoc.data() as UserDocument;
    const timezone = userData.timezone || NOTIFICATION_CONFIG.DEFAULT_TIMEZONE;

    // Compute next notification (excluding types just sent)
    const { nextUTC, types } = computeNextNotification(
      userData.notificationPrefs,
      timezone,
    );

    const updateData: Record<string, unknown> = {
      lastNotificationWindow: windowKey,
      lastActiveAt: now,
    };

    if (nextUTC) {
      // Ensure next is in future (at least 23 hours from now to prevent same-day)
      const minNextTime = new Date(Date.now() + 23 * 60 * 60 * 1000);
      if (nextUTC < minNextTime) {
        nextUTC.setUTCDate(nextUTC.getUTCDate() + 1);
      }
      updateData.nextNotificationUTC = Timestamp.fromDate(nextUTC);
      updateData.nextNotificationTypes = types;
    } else {
      updateData.nextNotificationUTC = FieldValue.delete();
      updateData.nextNotificationTypes = FieldValue.delete();
    }

    await userRef.update(updateData);
    logger.info(`Scheduled next notification for user ${uid}`, {
      nextTypes: types,
      nextTime: nextUTC?.toISOString(),
    });
  } catch (error) {
    logger.error(`Failed to schedule next for user ${uid}`, { error });
  }
}

/**
 * Initializes default notification preferences for a user.
 * Used during migration or new user setup.
 */
export async function initializeNotificationPrefs(uid: string): Promise<void> {
  const userRef = db.collection("users").doc(uid);
  const now = Timestamp.now();

  const userDoc = await userRef.get();
  const userData = userDoc.exists ? (userDoc.data() as UserDocument) : null;

  // Skip if already has prefs
  if (userData?.notificationPrefs) {
    return;
  }

  const timezone = userData?.timezone || NOTIFICATION_CONFIG.DEFAULT_TIMEZONE;
  const defaultPrefs = { ...NOTIFICATION_CONFIG.DEFAULTS };

  // Compute next notification
  const { nextUTC, types } = computeNextNotification(defaultPrefs, timezone);

  const updateData: Record<string, unknown> = {
    notificationPrefs: defaultPrefs,
    updatedAt: now,
  };

  if (nextUTC) {
    updateData.nextNotificationUTC = Timestamp.fromDate(nextUTC);
    updateData.nextNotificationTypes = types;
  }

  await userRef.update(updateData);
  logger.info(`Initialized notification prefs for user ${uid}`);
}


