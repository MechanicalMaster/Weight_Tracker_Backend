// Type definitions for the weight-tracking backend

// Re-export vision schemas
export * from "./visionSchemas";
// Device registration types
export interface DeviceRegistrationRequest {
    deviceId: string;
    fcmToken: string;
    platform: "ios" | "android";
}

export interface DeviceDocument {
    deviceId: string;
    uid: string;
    fcmToken: string;
    platform: "ios" | "android";
    createdAt: FirebaseFirestore.Timestamp;
    lastSeenAt: FirebaseFirestore.Timestamp;
}

export interface DeviceRegistrationResponse {
    success: boolean;
    message: string;
}

// Nudge types
export interface NudgeDocument {
    deviceId: string;
    uid: string;
    sentAt: FirebaseFirestore.Timestamp;
    status: "success" | "failed";
    title: string;
    body: string;
    error?: string;
}

// Food analysis types
export interface FoodAnalysisRequest {
    deviceId: string;
    image?: string; // Base64 encoded image
}

export interface NutritionData {
    foodName: string;
    calories: number;
    protein: number;
    carbohydrates: number;
    fat: number;
    fiber: number;
    estimatedServingSize: string;
}

export interface FoodAnalysisResponse {
    success: boolean;
    nutrition?: NutritionData;
    error?: string;
}

// Quick scan response (lightweight food identification)
export interface QuickScanResponse {
    foodName: string;
    confidence: "high" | "medium" | "low";
    calories: number;
    message: string;
}

// API Error response
export interface ApiErrorResponse {
    success: false;
    error: string;
    code?: string;
}

// Backup payload types
// Matches backupSchema in utils/validation.ts
export interface BackupPayload {
    weightEntries?: unknown[];
    foodLogs?: unknown[];
    streaks?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}
