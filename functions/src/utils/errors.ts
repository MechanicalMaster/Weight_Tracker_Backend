import { Response } from "express";
import { logger } from "firebase-functions/v2";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function handleError(error: unknown, res: Response): void {
  if (error instanceof ApiError) {
    logger.warn(`API Error: ${error.message}`, { code: error.code });
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
    });
    return;
  }

  if (error instanceof Error) {
    logger.error(`Unexpected error: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
    return;
  }

  logger.error("Unknown error type", { error });
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
}

// Common API error factories (lowercase to satisfy new-cap rule)
export const errors = {
  invalidRequest: (message: string) =>
    new ApiError(400, message, "INVALID_REQUEST"),
  deviceNotFound: () =>
    new ApiError(404, "Device not found", "DEVICE_NOT_FOUND"),
  imageTooLarge: (maxSize: number) =>
    new ApiError(
      413,
      `Image exceeds maximum size of ${maxSize / 1024 / 1024}MB`,
      "IMAGE_TOO_LARGE",
    ),
  unsupportedFormat: (formats: string[]) =>
    new ApiError(
      415,
      `Unsupported image format. Supported: ${formats.join(", ")}`,
      "UNSUPPORTED_FORMAT",
    ),
  analysisFailed: (reason: string) =>
    new ApiError(422, `Food analysis failed: ${reason}`, "ANALYSIS_FAILED"),
  notFood: (description?: string) =>
    new ApiError(
      422,
      description || "The image does not appear to contain food",
      "NOT_FOOD",
    ),
  imageTooBlurry: () =>
    new ApiError(
      422,
      "The image is too blurry or unclear to analyze",
      "IMAGE_TOO_BLURRY",
    ),
  multipleFoods: () =>
    new ApiError(
      422,
      "Multiple food items detected. Please capture one item at a time",
      "MULTIPLE_FOODS",
    ),
  lowConfidence: () =>
    new ApiError(
      422,
      "Could not confidently identify the food. Try a clearer photo",
      "LOW_CONFIDENCE",
    ),
  aiServiceError: () =>
    new ApiError(
      503,
      "AI service temporarily unavailable. Please try again",
      "AI_SERVICE_ERROR",
    ),
  aiConfigError: () =>
    new ApiError(
      500,
      "AI service configuration error",
      "AI_CONFIG_ERROR",
    ),
  parseError: () =>
    new ApiError(
      500,
      "Failed to parse AI response",
      "PARSE_ERROR",
    ),
  rateLimited: () =>
    new ApiError(429, "Too many requests", "RATE_LIMITED"),
  internalError: () =>
    new ApiError(500, "Internal server error", "INTERNAL_ERROR"),
};
