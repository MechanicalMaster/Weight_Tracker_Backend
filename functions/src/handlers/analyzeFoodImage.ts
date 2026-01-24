import { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import Busboy from "busboy";
import { analyzeFood } from "../services/vision";
import { deductCredit } from "../services/user";
import { trackEventAsync } from "../services/events";
import { EventName } from "../types/behavioral";
import { foodAnalysisSchema, validateInput } from "../utils/validation";
import { handleError, errors } from "../utils/errors";
import { LIMITS, VISION_CONFIG } from "../config/constants";
import { AuthenticatedRequest, verifyAuth } from "../middleware/auth";

// Extend Express Request to include rawBody (added by Firebase Functions)
interface FirebaseRequest extends Request {
  rawBody?: Buffer;
}

interface ParsedRequest {
  imageBase64: string;
  mimeType: string;
}

function parseMultipartRequest(req: FirebaseRequest): Promise<ParsedRequest> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line new-cap
    const bb = Busboy({
      headers: req.headers,
      limits: {
        fileSize: LIMITS.MAX_IMAGE_SIZE_BYTES,
        files: 1,
      },
    });

    let imageBuffer: Buffer | null = null;
    let mimeType = "";
    let fileLimitExceeded = false;

    bb.on("file", (
      _fieldname: string,
      file: NodeJS.ReadableStream,
      info: { filename: string; encoding: string; mimeType: string },
    ) => {
      mimeType = info.mimeType;
      const chunks: Buffer[] = [];

      file.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      file.on("limit", () => {
        fileLimitExceeded = true;
      });

      file.on("end", () => {
        imageBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("finish", () => {
      if (fileLimitExceeded) {
        reject(errors.imageTooLarge(LIMITS.MAX_IMAGE_SIZE_BYTES));
        return;
      }

      if (!imageBuffer) {
        reject(errors.invalidRequest("No image provided"));
        return;
      }

      resolve({
        imageBase64: imageBuffer.toString("base64"),
        mimeType,
      });
    });

    bb.on("error", (error: Error) => {
      reject(error);
    });

    // Handle the case where body is already parsed (e.g., by Firebase Functions)
    if (req.rawBody) {
      bb.end(req.rawBody);
    } else {
      req.pipe(bb);
    }
  });
}

function parseJsonRequest(req: Request): ParsedRequest {
  const validation = validateInput(foodAnalysisSchema, req.body);
  if (!validation.success) {
    throw errors.invalidRequest(validation.error);
  }

  const { image } = validation.data;

  if (!image) {
    throw errors.invalidRequest("image is required");
  }

  return {
    imageBase64: image,
    mimeType: "image/jpeg", // Assume JPEG for base64
  };
}

// Create a mutable copy of supported formats for includes check
const supportedFormats: string[] = [...VISION_CONFIG.SUPPORTED_FORMATS];

/**
 * Food Image Analysis Handler
 * Requires authentication and deducts 1 credit per analysis
 */
export async function analyzeFoodImage(
  req: FirebaseRequest & AuthenticatedRequest,
  res: Response,
): Promise<void> {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        error: "Method not allowed",
      });
      return;
    }

    // Verify authentication
    await new Promise<void>((resolve, reject) => {
      verifyAuth(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // If verifyAuth responded with error, stop here
    if (res.headersSent) return;

    const uid = req.uid!; // Safe: verifyAuth ensures uid exists
    logger.info(`Analyzing food image for user: ${uid}`);

    // Deduct credit before analysis (throws if insufficient)
    const remainingCredits = await deductCredit(uid);
    logger.info(`Credit deducted, remaining: ${remainingCredits}`);

    let parsed: ParsedRequest;

    // Parse based on content type
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      parsed = await parseMultipartRequest(req);
    } else if (contentType.includes("application/json")) {
      parsed = parseJsonRequest(req);
    } else {
      throw errors.invalidRequest(
        "Content-Type must be multipart/form-data or application/json",
      );
    }

    // Validate image format
    if (!supportedFormats.includes(parsed.mimeType)) {
      throw errors.unsupportedFormat([...VISION_CONFIG.SUPPORTED_FORMATS]);
    }

    // Analyze the food image
    const analysisStart = Date.now();
    const nutrition = await analyzeFood(parsed.imageBase64);
    const latencyMs = Date.now() - analysisStart;

    // Track FOOD_ANALYZED event (fire-and-forget)
    trackEventAsync({
      eventName: EventName.FOOD_ANALYZED,
      userId: uid,
      timestamp: new Date().toISOString(),
      timezone: "UTC", // Server doesn't know user timezone here
      platform: "ios", // Default, client should send this
      metadata: {
        success: true,
        food_detected: true,
        credits_remaining: remainingCredits,
        latency_ms: latencyMs,
      },
    }).catch((err) => {
      logger.warn("Failed to track food analysis event", { error: err });
    });

    res.status(200).json({
      success: true,
      nutrition,
      creditsRemaining: remainingCredits,
    });
  } catch (error) {
    handleError(error, res);
  }
}

