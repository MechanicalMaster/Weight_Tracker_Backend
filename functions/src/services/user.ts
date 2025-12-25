import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { errors } from "../utils/errors";

const db = getFirestore();

// Default free credits for new users
const DEFAULT_FREE_CREDITS = 20;

/**
 * User document structure
 */
export interface UserDocument {
    aiCredits: number;
    totalGranted: number;
    totalUsed: number;
    createdAt: Timestamp;
    lastActiveAt: Timestamp;
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
