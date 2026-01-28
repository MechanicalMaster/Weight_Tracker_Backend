import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { errors } from "../utils/errors";

const db = getFirestore();

// Default free credits for new users
const DEFAULT_FREE_CREDITS = 20;

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
 * User document structure
 */
export interface UserDocument {
  aiCredits: number;
  totalGranted: number;
  totalUsed: number;
  displayName?: string;
  timezone?: string;
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
