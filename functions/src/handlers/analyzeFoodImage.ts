import { Request, Response } from "express";
import { logger } from "firebase-functions/v2";
import Busboy from "busboy";
import { analyzeFood } from "../services/vision";
import { foodAnalysisSchema, validateInput } from "../utils/validation";
import { handleError, errors } from "../utils/errors";
import { LIMITS, VISION_CONFIG } from "../config/constants";

// Extend Express Request to include rawBody (added by Firebase Functions)
interface FirebaseRequest extends Request {
  rawBody?: Buffer;
}

interface ParsedRequest {
  deviceId: string;
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

    let deviceId = "";
    let imageBuffer: Buffer | null = null;
    let mimeType = "";
    let fileLimitExceeded = false;

    bb.on("field", (fieldname: string, val: string) => {
      if (fieldname === "deviceId") {
        deviceId = val;
      }
    });

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

      if (!deviceId) {
        reject(errors.invalidRequest("deviceId is required"));
        return;
      }

      resolve({
        deviceId,
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

  const { deviceId, image } = validation.data;

  if (!image) {
    throw errors.invalidRequest("image is required");
  }

  return {
    deviceId,
    imageBase64: image,
    mimeType: "image/jpeg", // Assume JPEG for base64
  };
}

// Create a mutable copy of supported formats for includes check
const supportedFormats: string[] = [...VISION_CONFIG.SUPPORTED_FORMATS];

export async function analyzeFoodImage(req: FirebaseRequest, res: Response): Promise<void> {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        error: "Method not allowed",
      });
      return;
    }

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

    logger.info(`Analyzing food image for device: ${parsed.deviceId}`);

    // Analyze the food image
    const nutrition = await analyzeFood(parsed.imageBase64);

    res.status(200).json({
      success: true,
      nutrition,
    });
  } catch (error) {
    handleError(error, res);
  }
}
