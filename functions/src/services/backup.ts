import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import * as zlib from "zlib";
import { promisify } from "util";
import { errors } from "../utils/errors";

const db = getFirestore();
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Current backup version
const BACKUP_VERSION = 1;

/**
 * Backup document structure
 */
export interface BackupDocument {
    version: number;
    data: string; // Compressed JSON
    updatedAt: Timestamp;
}

/**
 * Backup payload structure (what client sends)
 */
export interface BackupPayload {
    weightEntries?: unknown[];
    foodLogs?: unknown[];
    streaks?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

/**
 * Save backup for a user
 * Compresses the data and stores it in Firestore
 */
export async function saveBackup(
  uid: string,
  payload: BackupPayload,
): Promise<void> {
  const jsonData = JSON.stringify(payload);
  const compressed = await gzip(Buffer.from(jsonData, "utf-8"));
  const base64Data = compressed.toString("base64");

  const backupRef = db.collection("users").doc(uid).collection("backup").doc("current");

  const backupDoc: BackupDocument = {
    version: BACKUP_VERSION,
    data: base64Data,
    updatedAt: Timestamp.now(),
  };

  await backupRef.set(backupDoc);

  logger.info(`Saved backup for user ${uid}, size: ${base64Data.length} bytes`);
}

/**
 * Load backup for a user
 * Decompresses and returns the backup data
 */
export async function loadBackup(uid: string): Promise<BackupPayload> {
  const backupRef = db.collection("users").doc(uid).collection("backup").doc("current");
  const backupDoc = await backupRef.get();

  if (!backupDoc.exists) {
    throw errors.backupNotFound();
  }

  const backup = backupDoc.data() as BackupDocument;

  // Decompress the data
  const compressed = Buffer.from(backup.data, "base64");
  const decompressed = await gunzip(compressed);
  const jsonData = decompressed.toString("utf-8");

  const payload = JSON.parse(jsonData) as BackupPayload;

  logger.info(`Loaded backup for user ${uid}, version: ${backup.version}`);

  return payload;
}

/**
 * Check if backup exists for user
 */
export async function hasBackup(uid: string): Promise<boolean> {
  const backupRef = db.collection("users").doc(uid).collection("backup").doc("current");
  const backupDoc = await backupRef.get();
  return backupDoc.exists;
}

/**
 * Get backup metadata without loading full data
 */
export async function getBackupInfo(
  uid: string,
): Promise<{ exists: boolean; version?: number; updatedAt?: Date }> {
  const backupRef = db.collection("users").doc(uid).collection("backup").doc("current");
  const backupDoc = await backupRef.get();

  if (!backupDoc.exists) {
    return { exists: false };
  }

  const backup = backupDoc.data() as BackupDocument;
  return {
    exists: true,
    version: backup.version,
    updatedAt: backup.updatedAt.toDate(),
  };
}
