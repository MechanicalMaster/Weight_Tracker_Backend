import { Request, Response, NextFunction } from "express";
import { logger } from "firebase-functions/v2";
import { randomUUID } from "crypto";

/**
 * Extended request with latency tracking
 */
export interface TrackedRequest extends Request {
    requestId: string;
    startTime: number;
}

/**
 * Per-request latency logging with correlation IDs.
 * Logs total request duration on response finish.
 *
 * For stage-level timing within handlers, use:
 *   logger.info('Stage: description', { requestId: req.requestId });
 */
export function latencyLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID().slice(0, 8);
  const start = Date.now();

  // Attach to request for downstream logging
  (req as TrackedRequest).requestId = requestId;
  (req as TrackedRequest).startTime = start;

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info("Request completed", {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
    });
  });

  next();
}

/**
 * Helper to log stage timing within handlers.
 * Usage: logStage(req, 'OpenAI call start');
 */
export function logStage(req: Request, stage: string, extra?: object): void {
  const tracked = req as TrackedRequest;
  const elapsed = Date.now() - tracked.startTime;
  logger.info(`Stage: ${stage}`, {
    requestId: tracked.requestId,
    elapsedMs: elapsed,
    ...extra,
  });
}
