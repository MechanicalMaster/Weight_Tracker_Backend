/**
 * Events Handler - POST /events endpoint
 *
 * Generic event ingestion with idempotency.
 */
import { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import { verifyAuth, AuthenticatedRequest } from "../middleware/auth";
import { trackEventTx } from "../services/events";
import { EventRequestSchema, EventPayloads, EventName } from "../types/behavioral";
import { handleError, errors } from "../utils/errors";

/**
 * POST /events
 *
 * Ingests behavioral events with:
 * - Zod schema validation
 * - Firebase Auth verification
 * - Idempotent writes (200 OK for duplicates)
 */
export async function logEvent(req: Request, res: Response): Promise<void> {
  try {
    // Verify auth first
    await new Promise<void>((resolve, reject) => {
      verifyAuth(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const authReq = req as AuthenticatedRequest;
    if (!authReq.uid) {
      throw errors.unauthorized();
    }

    // Validate request body
    const parseResult = EventRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      throw errors.invalidRequest(errorMsg);
    }

    const { eventId, eventName, timestamp, timezone, sessionId, platform, metadata } = parseResult.data;

    // Validate metadata against event-specific schema
    const metadataSchema = EventPayloads[eventName as EventName];
    if (metadataSchema) {
      const metaResult = metadataSchema.safeParse(metadata);
      if (!metaResult.success) {
        const errorMsg = metaResult.error.errors
          .map((e) => `metadata.${e.path.join(".")}: ${e.message}`)
          .join(", ");
        throw errors.invalidRequest(errorMsg);
      }
    }

    logger.info("Processing event", {
      eventId,
      eventName,
      userId: authReq.uid,
    });

    // Track event transactionally
    const result = await trackEventTx({
      eventId,
      eventName,
      userId: authReq.uid,
      timestamp,
      timezone,
      sessionId,
      platform,
      metadata,
    });

    // Return 200 OK for both new and duplicate events (idempotent success)
    res.status(200).json({
      success: true,
      status: result.status,
      eventId: result.eventId,
    });
  } catch (error) {
    handleError(error, res);
  }
}
