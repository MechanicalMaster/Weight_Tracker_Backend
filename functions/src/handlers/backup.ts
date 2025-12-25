import { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import { saveBackup, loadBackup, getBackupInfo } from "../services/backup";
import { backupSchema, validateInput } from "../utils/validation";
import { handleError, errors } from "../utils/errors";
import { AuthenticatedRequest, verifyAuth } from "../middleware/auth";

/**
 * POST /backup
 * Save user data backup
 */
export async function createBackup(
  req: Request & AuthenticatedRequest,
  res: Response,
): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    // Verify authentication
    await new Promise<void>((resolve, reject) => {
      verifyAuth(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (res.headersSent) return;

    const uid = req.uid!; // Safe: verifyAuth ensures uid exists
    logger.info(`Creating backup for user: ${uid}`);

    // Validate input
    const validation = validateInput(backupSchema, req.body);
    if (!validation.success) {
      throw errors.invalidRequest(validation.error);
    }

    await saveBackup(uid, validation.data);

    res.status(200).json({
      success: true,
      message: "Backup saved successfully",
    });
  } catch (error) {
    handleError(error, res);
  }
}

/**
 * POST /restore
 * Restore user data from backup
 */
export async function restoreBackup(
  req: Request & AuthenticatedRequest,
  res: Response,
): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    // Verify authentication
    await new Promise<void>((resolve, reject) => {
      verifyAuth(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (res.headersSent) return;

    const uid = req.uid!; // Safe: verifyAuth ensures uid exists
    logger.info(`Restoring backup for user: ${uid}`);

    const backup = await loadBackup(uid);

    res.status(200).json({
      success: true,
      data: backup,
    });
  } catch (error) {
    handleError(error, res);
  }
}

/**
 * GET /backup-status
 * Check if backup exists and get metadata
 */
export async function getBackupStatus(
  req: Request & AuthenticatedRequest,
  res: Response,
): Promise<void> {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    // Verify authentication
    await new Promise<void>((resolve, reject) => {
      verifyAuth(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (res.headersSent) return;

    const uid = req.uid!; // Safe: verifyAuth ensures uid exists
    const info = await getBackupInfo(uid);

    res.status(200).json({
      success: true,
      ...info,
    });
  } catch (error) {
    handleError(error, res);
  }
}
