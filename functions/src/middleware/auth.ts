import { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions/v2";
import { errors } from "../utils/errors";

/**
 * Extended request with authenticated user info
 * uid is optional in type definition because it's added at runtime
 */
export interface AuthenticatedRequest extends Request {
  uid?: string;
  rawBody?: Buffer;
}

/**
 * Middleware to verify Firebase ID token
 * Extracts uid from the token and attaches it to the request
 */
export async function verifyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const error = errors.unauthorized("Missing or invalid Authorization header");
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
    });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    (req as AuthenticatedRequest).uid = decodedToken.uid;
    next();
  } catch (err) {
    logger.warn("Failed to verify auth token", { error: err });
    const error = errors.unauthorized("Invalid or expired token");
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
}

/**
 * Optional auth middleware - attaches uid if token is valid, continues if not
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const idToken = authHeader.split("Bearer ")[1];
    try {
      const decodedToken = await getAuth().verifyIdToken(idToken);
      (req as AuthenticatedRequest).uid = decodedToken.uid;
    } catch {
      logger.debug("Optional auth failed, continuing without uid");
    }
  }

  next();
}
