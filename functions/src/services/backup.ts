import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import * as zlib from "zlib";
import { promisify } from "util";
import { errors } from "../utils/errors";
import { BACKUP_CONFIG } from "../config/constants";
import type { BackupPayload } from "../types";

const db = getFirestore();
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Increment only if backup format changes
const BACKUP_VERSION = 1;

/**
 * Firestore backup metadata (NO payload here)
 */
export interface BackupDocument {
  version: number;
  storagePath: string;
  sizeBytes: number;
  updatedAt: Timestamp;
}

/**
 * Resolve Cloud Storage bucket explicitly
 */
function getBucket() {
  const bucketName = BACKUP_CONFIG.STORAGE_BUCKET;
  if (!bucketName) {
    throw new Error("STORAGE_BUCKET environment variable is not set");
  }
  return getStorage().bucket(bucketName);
}

/**
 * Storage path for the current backup
 * Overwrites on each backup
 */
function getStoragePath(uid: string): string {
  return `${BACKUP_CONFIG.STORAGE_PATH_PREFIX}/${uid}/backups/${BACKUP_CONFIG.BACKUP_FILENAME}`;
}

/**
 * Save backup for a user
 * 1) Compress JSON
 * 2) Upload to Cloud Storage
 * 3) Store metadata in Firestore
 */
export async function saveBackup(
  uid: string,
  payload: BackupPayload,
): Promise<void> {
  const json = JSON.stringify(payload);
  const compressed = await gzip(Buffer.from(json, "utf-8"));

  const storagePath = getStoragePath(uid);
  const bucket = getBucket();
  const file = bucket.file(storagePath);

  // Upload blob FIRST (atomicity guarantee)
  // NOTE: Do NOT set contentEncoding: "gzip" - this causes Cloud Storage to auto-decompress on download
  await file.save(compressed, {
    contentType: "application/gzip",
  });

  logger.info("Backup uploaded to Cloud Storage", {
    uid,
    storagePath,
    sizeBytes: compressed.length,
  });

  // Write Firestore metadata ONLY
  const backupRef = db
    .collection("users")
    .doc(uid)
    .collection("backup")
    .doc("current");

  await backupRef.set({
    version: BACKUP_VERSION,
    storagePath,
    sizeBytes: compressed.length,
    updatedAt: Timestamp.now(),
  });

  logger.info("Backup metadata written", { uid });
}

/**
 * Load backup for a user
 * Reads metadata → downloads blob → decompresses
 */
export async function loadBackup(uid: string): Promise<BackupPayload> {
  const backupRef = db
    .collection("users")
    .doc(uid)
    .collection("backup")
    .doc("current");

  const snap = await backupRef.get();
  if (!snap.exists) {
    throw errors.backupNotFound();
  }

  const backup = snap.data() as BackupDocument;

  const bucket = getBucket();
  const file = bucket.file(backup.storagePath);

  const [contents] = await file.download();

  // Check if data is gzip compressed by looking for magic bytes (0x1f 0x8b)
  const isGzipped = contents.length >= 2 && contents[0] === 0x1f && contents[1] === 0x8b;

  let jsonString: string;
  if (isGzipped) {
    const decompressed = await gunzip(contents);
    jsonString = decompressed.toString("utf-8");
  } else {
    // Handle legacy uncompressed backups or auto-decompressed data
    jsonString = contents.toString("utf-8");
    logger.warn("Backup data was not gzip compressed", { uid });
  }

  logger.info("Backup loaded from Cloud Storage", {
    uid,
    version: backup.version,
  });

  return JSON.parse(jsonString);
}

/**
 * Get backup metadata only (no payload)
 */
export async function getBackupInfo(
  uid: string,
): Promise<{
  exists: boolean;
  version?: number;
  updatedAt?: Date;
  sizeBytes?: number;
}> {
  const backupRef = db
    .collection("users")
    .doc(uid)
    .collection("backup")
    .doc("current");

  const snap = await backupRef.get();
  if (!snap.exists) {
    return { exists: false };
  }

  const backup = snap.data() as BackupDocument;

  return {
    exists: true,
    version: backup.version,
    updatedAt: backup.updatedAt.toDate(),
    sizeBytes: backup.sizeBytes,
  };
}
