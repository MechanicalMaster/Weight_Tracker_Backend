import * as admin from "firebase-admin";
import { logger } from "firebase-functions/v2";
import { COLLECTIONS, LIMITS } from "../config/constants";
import { DeviceDocument, NudgeDocument } from "../types";

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Device operations
export async function upsertDevice(
  uid: string,
  deviceId: string,
  fcmToken: string,
  platform: "ios" | "android",
): Promise<void> {
  const deviceRef = db.collection(COLLECTIONS.DEVICES).doc(deviceId);
  const now = admin.firestore.Timestamp.now();

  const deviceDoc = await deviceRef.get();

  if (deviceDoc.exists) {
    // Update existing device
    // We update the UID to ensure the device is 'claimed' by the current logged-in user
    await deviceRef.update({
      uid,
      fcmToken,
      platform,
      lastSeenAt: now,
    });
    logger.info(`Updated device: ${deviceId} for user: ${uid}`);
  } else {
    // Create new device
    const newDevice: DeviceDocument = {
      deviceId,
      uid,
      fcmToken,
      platform,
      createdAt: now,
      lastSeenAt: now,
    };
    await deviceRef.set(newDevice);
    logger.info(`Registered new device: ${deviceId} for user: ${uid}`);
  }
}

export async function getActiveDevices(): Promise<DeviceDocument[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LIMITS.DEVICE_ACTIVE_DAYS);
  const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffDate);

  const snapshot = await db
    .collection(COLLECTIONS.DEVICES)
    .where("lastSeenAt", ">=", cutoffTimestamp)
    .get();

  return snapshot.docs.map((doc) => doc.data() as DeviceDocument);
}

// Nudge operations
export async function logNudge(nudge: Omit<NudgeDocument, "sentAt">): Promise<void> {
  const nudgeData: NudgeDocument = {
    ...nudge,
    sentAt: admin.firestore.Timestamp.now(),
  };

  await db.collection(COLLECTIONS.NUDGES).add(nudgeData);
  logger.info(`Logged nudge for device: ${nudge.deviceId}`, {
    status: nudge.status,
  });
}

export { db, admin };
