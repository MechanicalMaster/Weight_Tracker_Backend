import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { BACKUP_CONFIG } from "../config/constants";

/**
 * Upload a raw food image to Cloud Storage for eval/audit purposes.
 * Fire-and-forget: errors are logged but never thrown.
 *
 * @param imageBase64 - Base64-encoded image data
 * @param uid - User ID (for path partitioning)
 * @param imageHash - SHA-256 hash of the image (used as filename)
 * @param mimeType - Original MIME type (image/jpeg, image/png, image/webp)
 * @returns GCS path string, or undefined on failure
 */
export async function uploadFoodImage(
  imageBase64: string,
  uid: string,
  imageHash: string,
  mimeType: string,
): Promise<string | undefined> {
  try {
    const bucketName = BACKUP_CONFIG.STORAGE_BUCKET;
    if (!bucketName) {
      logger.warn("STORAGE_BUCKET not set, skipping image upload");
      return undefined;
    }

    // Derive file extension from MIME type
    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const ext = extMap[mimeType] || "jpg";

    // Path: food-images/{uid}/{timestamp}_{imageHash}.{ext}
    const timestamp = Date.now();
    const storagePath = `food-images/${uid}/${timestamp}_${imageHash}.${ext}`;

    const bucket = getStorage().bucket(bucketName);
    const file = bucket.file(storagePath);
    const buffer = Buffer.from(imageBase64, "base64");

    await file.save(buffer, {
      contentType: mimeType,
      metadata: {
        uid,
        imageHash,
        uploadedAt: new Date().toISOString(),
      },
    });

    logger.info("Food image uploaded to Cloud Storage", {
      uid,
      storagePath,
      sizeBytes: buffer.length,
    });

    return storagePath;
  } catch (err) {
    logger.error("Failed to upload food image", { error: err, uid });
    // Never throw — image upload failure should not block analysis
    return undefined;
  }
}
