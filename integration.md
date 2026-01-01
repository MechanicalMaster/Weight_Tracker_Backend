# Weigh Backend API Integration Guide

> **Version:** 2.0 (2-Pass Vision Inference)  
> **Model:** GPT-5.2  
> **Last Updated:** 2026-01-01

---

## Table of Contents

1. [Authentication](#authentication)
2. [Base URL & Region](#base-url--region)
3. [Common Response Structures](#common-response-structures)
4. [Endpoints](#endpoints)
   - [Food Image Analysis](#1-food-image-analysis)
   - [User Profile](#2-user-profile)
   - [Credits](#3-credits)
   - [Backup](#4-backup)
   - [Restore](#5-restore)
   - [Backup Status](#6-backup-status)
   - [Device Registration](#7-device-registration)
5. [Error Codes](#error-codes)
6. [Rate Limiting & Credits](#rate-limiting--credits)
7. [Internal Architecture](#internal-architecture-for-advanced-integrators)

---

## Authentication

All protected endpoints require a **Firebase ID Token** sent via the `Authorization` header.

```http
Authorization: Bearer <firebase_id_token>
```

### Authentication Flow

1. **Anonymous Auth**: Users start with anonymous Firebase Auth
2. **Link Account**: Later link to Google/Email for data persistence
3. **All data is keyed by `uid`** — survives reinstalls when signed in

### How to Obtain a Token

```typescript
// Firebase Web/React Native SDK
import { getAuth } from "firebase/auth";

const auth = getAuth();
const user = auth.currentUser;
const idToken = await user.getIdToken();

// Standard headers for all authenticated requests
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${await auth.currentUser?.getIdToken()}`
};
```

```swift
// Firebase iOS SDK
Auth.auth().currentUser?.getIDToken { token, error in
    // Use token
}
```

### Token Expiration

- Firebase ID tokens expire after **1 hour**
- Refresh automatically using `getIdToken(forceRefresh: true)`

---

## Base URL & Region

### Production URLs

| Endpoint | Live URL |
|----------|----------|
| Device Registration | `https://registerdevicefunction-kxzhine25a-uc.a.run.app` |
| Food Analysis | `https://analyzefoodimagefunction-kxzhine25a-uc.a.run.app` |
| Backup | `https://us-central1-platewise-b8995.cloudfunctions.net/backupFunction` |
| Restore | `https://us-central1-platewise-b8995.cloudfunctions.net/restoreFunction` |
| Backup Status | `https://us-central1-platewise-b8995.cloudfunctions.net/backupStatusFunction` |
| Credits | `https://us-central1-platewise-b8995.cloudfunctions.net/creditsFunction` |
| User Profile | `https://us-central1-platewise-b8995.cloudfunctions.net/userProfileFunction` |

### Generic Pattern

```
https://us-central1-<your-project-id>.cloudfunctions.net/<functionName>
```

---

## Common Response Structures

### Success Response

```json
{
  "success": true,
  // ... endpoint-specific fields
}
```

### Error Response

```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE"
}
```

---

## TypeScript Interfaces

Ready-to-use types for frontend integration:

```typescript
// Common Response Wrapper
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
  data?: T;
}

// Food Analysis Response
interface NutritionData {
  foodName: string;
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  fiber: number;
  estimatedServingSize: string;
}

interface FoodAnalysisResponse {
  success: boolean;
  nutrition: NutritionData;
  creditsRemaining: number;
}

// User Profile
interface UserProfile {
  uid: string;
  aiCredits: number;
  totalGranted: number;
  totalUsed: number;
  createdAt: string;      // ISO 8601
  lastActiveAt: string;   // ISO 8601
}

// Backup Data
interface BackupPayload {
  weightEntries?: unknown[];
  foodLogs?: unknown[];
  streaks?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// Backup Status
interface BackupStatus {
  exists: boolean;
  lastModified?: string;  // ISO 8601
  sizeBytes?: number;
}
```

---

## Endpoints

### 1. Food Image Analysis

Analyzes a food image and returns nutritional information.

> **Auth Required:** Yes  
> **Credits:** Deducts 1 credit per analysis  
> **Method:** `POST`

#### Request Options

**Option A: Multipart Form Data**

```http
POST /analyzeFoodImageFunction
Authorization: Bearer <token>
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="image"; filename="food.jpg"
Content-Type: image/jpeg

<binary image data>
--boundary--
```

**Option B: JSON with Base64**

```http
POST /analyzeFoodImageFunction
Authorization: Bearer <token>
Content-Type: application/json

{
  "image": "<base64_encoded_image>"
}
```

#### Image Constraints

| Constraint | Value |
|------------|-------|
| Max size | 5 MB |
| Supported formats | `image/jpeg`, `image/png`, `image/webp` |
| Recommended | JPEG, < 2MB for optimal speed |

#### Code Example

```typescript
const analyzeFood = async (base64Image: string) => {
  const response = await fetch(
    'https://analyzefoodimagefunction-kxzhine25a-uc.a.run.app',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getIdToken()}`
      },
      body: JSON.stringify({ image: base64Image }),
    }
  );
  return response.json(); // { success, nutrition, creditsRemaining }
};
```

#### Response

```json
{
  "success": true,
  "nutrition": {
    "foodName": "Grilled Chicken Salad",
    "calories": 350,
    "protein": 28.5,
    "carbohydrates": 15.2,
    "fat": 18.3,
    "fiber": 4.5,
    "estimatedServingSize": "285g"
  },
  "creditsRemaining": 14
}
```

**Nutrition Field Units:**

| Field | Unit |
|-------|------|
| `calories` | kcal |
| `protein` | grams |
| `carbohydrates` | grams |
| `fat` | grams |
| `fiber` | grams |

> All numeric nutrition values are rounded to 1 decimal place (integers for calories).

#### Latency Expectations

| Scenario | Typical Latency |
|----------|----------------|
| Single-pass (most common) | ~700–900 ms |
| Two-pass (rare) | ~1.2–1.5 s |

#### Multi-Item Behavior

When multiple food items are detected:

| Field | Behavior |
|-------|----------|
| `foodName` | Set to `"Mixed meal"` |
| `calories` | Sum of all items |
| `protein`, `carbohydrates`, `fat`, `fiber` | Sum of all items |
| `estimatedServingSize` | Total weight in grams (e.g., `"450g"`) |

#### Example: Multi-Item Response

```json
{
  "success": true,
  "nutrition": {
    "foodName": "Mixed meal",
    "calories": 720,
    "protein": 45.2,
    "carbohydrates": 65.8,
    "fat": 28.5,
    "fiber": 8.2,
    "estimatedServingSize": "520g"
  },
  "creditsRemaining": 13
}
```

---

### 2. User Profile

Returns the authenticated user's profile including credit information.

> **Auth Required:** Yes  
> **Method:** `GET`

```http
GET /userProfileFunction
Authorization: Bearer <token>
```

#### Response

```json
{
  "success": true,
  "user": {
    "uid": "abc123xyz",
    "aiCredits": 15,
    "totalGranted": 20,
    "totalUsed": 5,
    "createdAt": "2026-01-01T10:30:00.000Z",
    "lastActiveAt": "2026-01-01T12:15:00.000Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `uid` | string | Firebase user ID |
| `aiCredits` | number | Current available credits |
| `totalGranted` | number | Total credits ever granted (free + purchased) |
| `totalUsed` | number | Total credits consumed |
| `createdAt` | ISO 8601 | Account creation timestamp |
| `lastActiveAt` | ISO 8601 | Last API activity timestamp |

#### Code Example

```typescript
const getUserProfile = async () => {
  const res = await fetch(
    'https://us-central1-platewise-b8995.cloudfunctions.net/userProfileFunction',
    {
      headers: { 'Authorization': `Bearer ${await getIdToken()}` }
    }
  );
  return res.json(); // { success, user: UserProfile }
};
```

---

### 3. Credits

Returns only the credit balance (lightweight alternative to full profile).

> **Auth Required:** Yes  
> **Method:** `GET`

```http
GET /creditsFunction
Authorization: Bearer <token>
```

#### Response

```json
{
  "success": true,
  "credits": 15
}
```

#### Code Example

```typescript
const getCredits = async () => {
  const res = await fetch(
    'https://us-central1-platewise-b8995.cloudfunctions.net/creditsFunction',
    {
      headers: { 'Authorization': `Bearer ${await getIdToken()}` }
    }
  );
  return res.json(); // { success, credits: number }
};
```

---

### 4. Backup

Saves user data to cloud storage.

> **Auth Required:** Yes  
> **Method:** `POST`

```http
POST /backupFunction
Authorization: Bearer <token>
Content-Type: application/json
```

#### Request Body

```json
{
  "weightEntries": [
    { "date": "2026-01-01", "weight": 72.5, "unit": "kg" }
  ],
  "foodLogs": [
    { "date": "2026-01-01", "calories": 2100 }
  ],
  "streaks": {
    "currentStreak": 5,
    "longestStreak": 15
  },
  "metadata": {
    "appVersion": "2.1.0",
    "lastSyncedAt": "2026-01-01T12:00:00Z"
  }
}
```

All fields are optional. The payload is stored as-is.

#### Response

```json
{
  "success": true,
  "message": "Backup saved successfully"
}
```

#### Code Example

```typescript
const createBackup = async (data: BackupPayload) => {
  const res = await fetch(
    'https://us-central1-platewise-b8995.cloudfunctions.net/backupFunction',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getIdToken()}`
      },
      body: JSON.stringify(data),
    }
  );
  return res.json(); // { success, message }
};
```

---

### 5. Restore

Retrieves the most recent backup.

> **Auth Required:** Yes  
> **Method:** `POST`

```http
POST /restoreFunction
Authorization: Bearer <token>
```

#### Response

```json
{
  "success": true,
  "data": {
    "weightEntries": [...],
    "foodLogs": [...],
    "streaks": {...},
    "metadata": {...}
  }
}
```

#### Code Example

```typescript
const restoreBackup = async () => {
  const res = await fetch(
    'https://us-central1-platewise-b8995.cloudfunctions.net/restoreFunction',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${await getIdToken()}` }
    }
  );
  return res.json(); // { success, data: BackupPayload }
};
```

---

### 6. Backup Status

Check if a backup exists and get metadata.

> **Auth Required:** Yes  
> **Method:** `GET`

```http
GET /backupStatusFunction
Authorization: Bearer <token>
```

#### Response (Backup Exists)

```json
{
  "success": true,
  "exists": true,
  "lastModified": "2026-01-01T12:00:00Z",
  "sizeBytes": 4523
}
```

#### Response (No Backup)

```json
{
  "success": true,
  "exists": false
}
```

#### Code Example

```typescript
const getBackupStatus = async () => {
  const res = await fetch(
    'https://us-central1-platewise-b8995.cloudfunctions.net/backupStatusFunction',
    {
      headers: { 'Authorization': `Bearer ${await getIdToken()}` }
    }
  );
  return res.json(); // { success, exists, lastModified?, sizeBytes? }
};
```

---

### 7. Device Registration

Registers a device for push notifications.

> **Auth Required:** No  
> **Method:** `POST`

```http
POST /registerDeviceFunction
Content-Type: application/json
```

#### Request Body

```json
{
  "deviceId": "unique-device-identifier",
  "fcmToken": "firebase-cloud-messaging-token",
  "platform": "ios"
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `deviceId` | string | 1-256 characters |
| `fcmToken` | string | 1-4096 characters |
| `platform` | enum | `"ios"` or `"android"` |

#### Response

```json
{
  "success": true,
  "message": "Device registered successfully"
}
```

#### Code Example

```typescript
const registerDevice = async (data: {
  deviceId: string;
  fcmToken: string;
  platform: 'ios' | 'android';
}) => {
  const res = await fetch(
    'https://registerdevicefunction-kxzhine25a-uc.a.run.app',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  return res.json(); // { success, message }
};
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Missing, invalid, or expired token |
| `INSUFFICIENT_CREDITS` | 402 | No credits remaining |
| `INVALID_REQUEST` | 400 | Malformed request or missing required fields |
| `NOT_FOOD` | 422 | Image does not contain recognizable food |
| `IMAGE_TOO_BLURRY` | 422 | Image too blurry for analysis |
| `LOW_CONFIDENCE` | 422 | Cannot confidently identify the food. Returned when *any* detected item cannot be identified with sufficient confidence (in multi-item images, one ambiguous item triggers this). |
| `MULTIPLE_FOODS` | 422 | *Deprecated* — now handled automatically |
| `IMAGE_TOO_LARGE` | 413 | Image exceeds 5MB limit |
| `UNSUPPORTED_FORMAT` | 415 | Invalid image format |
| `PARSE_ERROR` | 500 | AI returned invalid response |
| `AI_SERVICE_ERROR` | 503 | OpenAI API temporarily unavailable |
| `AI_CONFIG_ERROR` | 500 | Server misconfiguration |
| `BACKUP_NOT_FOUND` | 404 | No backup exists for user |
| `STORAGE_ERROR` | 500 | Cloud storage operation failed |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Rate Limiting & Credits

### Credit System

| Event | Credits |
|-------|---------|
| New user registration | +20 (free) |
| Food image analysis | -1 |

When credits reach 0, `/analyzeFoodImageFunction` returns:

```json
{
  "success": false,
  "error": "Insufficient AI credits",
  "code": "INSUFFICIENT_CREDITS"
}
```

### Best Practices

1. **Check credits before analysis** — call `/creditsFunction` first
2. **Cache the profile** — avoid excessive `/userProfileFunction` calls
3. **Handle 402 gracefully** — show upgrade prompt in UI

---

## Internal Architecture (For Advanced Integrators)

> [!WARNING]
> The fields, thresholds, and behaviors in this section are **not part of the public API contract** and may change without notice. Do not build client-side logic that depends on internal implementation details.

### 2-Pass Vision Inference

The food analysis endpoint uses a sophisticated 2-pass system:

```
Image → Pass 1 → [Trigger Check] → Pass 2 (if needed) → Agreement Logic → Result
```

#### When Pass 2 Is Triggered

| Condition | Threshold |
|-----------|-----------|
| Any item confidence | < 0.8 |
| Multiple items detected | > 1 item |
| Total estimated weight | ≥ 200g |

#### Agreement Logic

If both passes run:

| Check | Threshold |
|-------|-----------|
| Calorie difference | ≤ 15% |
| Weight difference | ≤ 50g |
| Item matching | ≥ 70% name similarity |

- **Agreed:** Values are averaged
- **Diverged:** Lower calorie result is selected

### Data Persistence

All analyses are stored in Firestore (`food_analyses` collection):

```typescript
{
  imageHash: string,          // SHA-256 + byte length salt
  imageByteLength: number,
  model: "gpt-5.2",
  promptVersion: "vision_v3_canonical_2pass",
  pass1RawText: string,       // Raw LLM output
  pass1Parsed: VisionPassResult,
  pass2RawText?: string,      // If Pass 2 ran
  pass2Parsed?: VisionPassResult,
  status: "SINGLE_PASS" | "TWO_PASS_AGREED" | "TWO_PASS_DIVERGED",
  divergenceReason?: "CALORIES" | "WEIGHT" | "ITEM_MISMATCH",
  finalResult: VisionPassResult,
  createdAt: Timestamp,
  durationMs: number
}
```

This enables:
- Variance analysis
- Prompt tuning
- Confidence calibration
- Regression detection

---

## Quick Start Example (TypeScript)

```typescript
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";

const app = initializeApp({ /* your config */ });
const auth = getAuth(app);

async function analyzeFood(imageBase64: string) {
  const user = await signInAnonymously(auth);
  const token = await user.user.getIdToken();

  const response = await fetch(
    "https://us-central1-<project>.cloudfunctions.net/analyzeFoodImageFunction",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image: imageBase64 }),
    }
  );

  const result = await response.json();
  
  if (!result.success) {
    switch (result.code) {
      case "INSUFFICIENT_CREDITS":
        // Show upgrade prompt
        break;
      case "NOT_FOOD":
        // Show "please take a photo of food" message
        break;
      default:
        throw new Error(result.error);
    }
  }

  return result.nutrition;
}
```

---

## UI Copy Suggestions

Recommended user-facing messages for common errors:

| Error Code | Suggested UI Copy |
|------------|-------------------|
| `NOT_FOOD` | "We couldn't find any food in this photo. Try taking a picture of your meal." |
| `LOW_CONFIDENCE` | "We're not sure what this is. Try taking a clearer photo with better lighting." |
| `IMAGE_TOO_BLURRY` | "This photo is too blurry. Hold your phone steady and try again." |
| `INSUFFICIENT_CREDITS` | "You've used all your free analyses. Upgrade to continue tracking." |
| `AI_SERVICE_ERROR` | "Our servers are busy. Please try again in a moment." |

---

## Support

For issues or questions, contact the backend team or file an issue in the repository.
