import { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import { getCredits, getOrCreateUser } from "../services/user";
import { handleError } from "../utils/errors";
import { AuthenticatedRequest, verifyAuth } from "../middleware/auth";

/**
 * GET /credits
 * Get current user's credit balance
 */
export async function getCreditsHandler(
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
    logger.info(`Getting credits for user: ${uid}`);

    const credits = await getCredits(uid);

    res.status(200).json({
      success: true,
      credits,
    });
  } catch (error) {
    handleError(error, res);
  }
}

/**
 * GET /user/me
 * Get current user profile including credits
 */
export async function getUserProfile(
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
    logger.info(`Getting profile for user: ${uid}`);

    const userData = await getOrCreateUser(uid);

    res.status(200).json({
      success: true,
      user: {
        uid,
        aiCredits: userData.aiCredits,
        totalGranted: userData.totalGranted,
        totalUsed: userData.totalUsed,
        createdAt: userData.createdAt.toDate().toISOString(),
        lastActiveAt: userData.lastActiveAt.toDate().toISOString(),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
}
