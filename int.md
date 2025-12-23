Backend Integration Guide
This document provides all necessary information to connect the frontend mobile app to the Platewise Firebase backend.

🔗 API Base URLs
Service	Live URL
Device Registration	https://registerdevicefunction-kxzhine25a-uc.a.run.app
Food Analysis	https://analyzefoodimagefunction-kxzhine25a-uc.a.run.app
🛠️ TypeScript Interfaces
Copy these interfaces into your frontend project to ensure type safety.

// Common Response Wrapper
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}
// Device Registration Request
interface RegisterDeviceRequest {
  deviceId: string;       // Unique ID (e.g., from Installation ID or UUID)
  fcmToken: string;       // Firebase Cloud Messaging Token
  platform: 'ios' | 'android';
}
// Food Analysis Request
interface AnalyzeFoodRequest {
  deviceId: string;
  image: string;          // Base64 encoded image string (no data:image/jpeg;base64 prefix needed, just the raw base64)
}
// Food Analysis Response Data
interface NutritionData {
  foodName: string;
  calories: number;       // Estimated calories
  protein: number;        // in grams
  carbohydrates: number;  // in grams
  fat: number;           // in grams
  fiber: number;         // in grams
  estimatedServingSize: string;
}
📡 Endpoints
1. Register Device
Goal: Registers the device to receive daily scheduled push notifications (9 AM UTC).

Method: POST
URL: https://registerdevicefunction-kxzhine25a-uc.a.run.app
Headers: Content-Type: application/json
Example Usage:

const registerDevice = async (data: RegisterDeviceRequest) => {
  const response = await fetch('https://registerdevicefunction-kxzhine25a-uc.a.run.app', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
};
2. Analyze Food Image
Goal: Sends a food image to GPT-4 Vision for nutrition analysis.

Method: POST
URL: https://analyzefoodimagefunction-kxzhine25a-uc.a.run.app
Headers: Content-Type: application/json
Example Usage:

const analyzeFood = async (deviceId: string, base64Image: string) => {
  const response = await fetch('https://analyzefoodimagefunction-kxzhine25a-uc.a.run.app', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId,
      image: base64Image
    }),
  });
  
  const result = await response.json();
  if (result.success) {
    return result.nutrition as NutritionData;
  } else {
    throw new Error(result.error);
  }
};
🚨 Error Handling
The API follows a standard error format. Always check success boolean.

Standard Error Response:

{
  "success": false,
  "error": "Detailed error message here",
  "code": "ERROR_CODE"  // e.g., 'INVALID_REQUEST', 'IMAGE_TOO_LARGE'
}
Common Error Codes:

INVALID_REQUEST: Missing fields or bad format.
IMAGE_TOO_LARGE: Image exceeds 5MB.
UNSUPPORTED_FORMAT: Image must be JPEG, PNG, or WebP.
ANALYSIS_FAILED: AI could not identify food.
