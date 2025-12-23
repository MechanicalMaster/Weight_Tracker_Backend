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
  "code": "ERROR_CODE"
}

## Error Codes by Category

### Input Validation Errors (HTTP 4xx)
| Code | HTTP | Description | Frontend Action |
|------|------|-------------|-----------------|
| `INVALID_REQUEST` | 400 | Missing or malformed fields | Show form validation error |
| `IMAGE_TOO_LARGE` | 413 | Image exceeds 5MB | Compress image before upload |
| `UNSUPPORTED_FORMAT` | 415 | Must be JPEG, PNG, or WebP | Convert image format |

### Food Analysis Errors (HTTP 422)
| Code | HTTP | Description | Frontend Action |
|------|------|-------------|-----------------|
| `NOT_FOOD` | 422 | Image doesn't contain food | Show "Please take a photo of food" |
| `IMAGE_TOO_BLURRY` | 422 | Image is blurry/unclear | Show "Please take a clearer photo" |
| `MULTIPLE_FOODS` | 422 | Multiple items detected | Show "Please capture one item at a time" |
| `LOW_CONFIDENCE` | 422 | AI can't identify the food | Show "Could not identify. Try a different angle" |
| `ANALYSIS_FAILED` | 422 | Generic analysis failure | Show "Analysis failed. Please try again" |

### Server Errors (HTTP 5xx)
| Code | HTTP | Description | Frontend Action |
|------|------|-------------|-----------------|
| `AI_SERVICE_ERROR` | 503 | OpenAI temporarily unavailable | Show "Service busy. Please retry" |
| `AI_CONFIG_ERROR` | 500 | Server misconfigured | Contact support |
| `PARSE_ERROR` | 500 | AI response malformed | Retry, then contact support |
| `RATE_LIMITED` | 429 | Too many requests | Implement backoff, retry later |

## Frontend Error Handling Example

```typescript
const analyzeFood = async (deviceId: string, base64Image: string) => {
  const response = await fetch(FOOD_ANALYSIS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, image: base64Image }),
  });

  const result = await response.json();

  if (!result.success) {
    // Handle specific error codes
    switch (result.code) {
      case 'NOT_FOOD':
        showToast('Please take a photo of food');
        break;
      case 'IMAGE_TOO_BLURRY':
        showToast('Image is too blurry. Please try again');
        break;
      case 'IMAGE_TOO_LARGE':
        showToast('Image is too large. Please use a smaller image');
        break;
      case 'AI_SERVICE_ERROR':
        showToast('Service temporarily unavailable. Please retry');
        break;
      default:
        showToast(result.error || 'Something went wrong');
    }
    return null;
  }

  return result.nutrition as NutritionData;
};
```

