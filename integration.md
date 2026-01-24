# Weigh Backend API Integration Guide

> **Version:** 2.1 (Consolidated API)  
> **Model:** GPT-5.2  
> **Last Updated:** 2026-01-06

---

## Table of Contents

1. [Authentication](#authentication)
2. [Base URL & Region](#base-url--region)
3. [Common Response Structures](#common-response-structures)
4. [Endpoints](#endpoints)
   - [Food Image Analysis](#1-food-image-analysis)
   - [Quick Food Scan](#2-quick-food-scan)
   - [User Profile](#3-user-profile)
   - [Credits](#4-credits)
   - [Backup](#5-backup)
   - [Restore](#6-restore)
   - [Backup Status](#7-backup-status)
   - [Device Registration](#8-device-registration)
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

### Production Base URL

```
https://api-<deployment-hash>-uc.a.run.app
```

> [!IMPORTANT]
> All endpoints now use a **single consolidated API**. Replace the placeholder with your actual deployed URL.

### Route Map

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/health` | No | Health check |
| POST | `/register-device` | No | Device registration |
| POST | `/analyze-food` | Yes | Food image analysis |
| POST | `/quick-scan` | Yes | Quick food identification |
| POST | `/events` | Yes | Event tracking |
| POST | `/backup` | Yes | Create backup |
| POST | `/restore` | Yes | Restore backup |
| GET | `/backup-status` | Yes | Backup metadata |
| GET | `/credits` | Yes | Credit balance |
| GET | `/user/me` | Yes | User profile |

> Route paths are stable for v2.x and will not change without a major version bump.

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

// Event Tracking
type EventName = 
  | 'WEIGHT_LOGGED'
  | 'FOOD_ANALYZED'
  | 'DEVICE_REGISTERED'
  | 'NOTIFICATION_DELIVERED'
  | 'NOTIFICATION_RECEIVED'
  | 'NOTIFICATION_OPENED'
  | 'INTENT_CAPTURED'
  | 'INTENT_CLOSED';

interface EventRequest {
  eventId: string;        // UUID v4 (client-generated)
  eventName: EventName;
  timestamp: string;      // ISO 8601
  timezone: string;       // IANA timezone
  sessionId: string;      // UUID v4 (app-generated on launch)
  platform: 'ios' | 'android';
  metadata: Record<string, unknown>;
}

interface EventResponse {
  success: boolean;
  status: 'created' | 'duplicate';
  eventId: string;
}

// Weight Logged Event Metadata
interface WeightLoggedMetadata {
  weight_value: number;
  unit: 'kg' | 'lbs';
  source: 'manual' | 'auto';
}

// Intent Event Metadata
interface IntentCapturedMetadata {
  intent_type: string;
  expected_duration: number; // minutes
}

interface IntentClosedMetadata {
  intent_type: string;
  outcome: 'completed' | 'abandoned' | 'expired';
  actual_duration: number;   // minutes
  expected_duration: number; // minutes
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
const API_BASE = 'https://api-<deployment-hash>-uc.a.run.app';

const analyzeFood = async (base64Image: string) => {
  const response = await fetch(
    `${API_BASE}/analyze-food`,
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

### 2. Quick Food Scan

Lightweight food identification that returns simplified results for quick feedback.

> **Auth Required:** Yes  
> **Credits:** Deducts 1 credit per scan  
> **Method:** `POST`

#### Request Options

Same as [Food Image Analysis](#1-food-image-analysis) — supports both multipart and JSON with base64.

#### Response

```json
{
  "success": true,
  "foodName": "Grilled Chicken Sandwich",
  "confidence": "high",
  "calories": 450,
  "message": "That's 22% of a typical daily target",
  "creditsRemaining": 14
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `foodName` | string | Identified food name (or combined names if multiple items) |
| `confidence` | enum | `"high"`, `"medium"`, or `"low"` |
| `calories` | number | Rough calorie estimate based on portion size |
| `message` | string | Human-readable one-liner about calorie percentage |

#### Confidence Levels

| Level | Confidence Score | Meaning |
|-------|-----------------|---------|
| `high` | ≥ 80% | Clear identification |
| `medium` | 60–79% | Reasonable guess |
| `low` | < 60% | Uncertain identification |

#### Latency Expectations

| Scenario | Typical Latency |
|----------|----------------|
| Single item | ~500–700 ms |
| Multiple items | ~600–800 ms |

> [!NOTE]
> Quick scan is faster than full analysis because it only runs a single perception stage (no nutrition reasoning).

#### Code Example

```typescript
const quickScanFood = async (base64Image: string) => {
  const response = await fetch(
    `${API_BASE}/quick-scan`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getIdToken()}`
      },
      body: JSON.stringify({ image: base64Image }),
    }
  );
  return response.json();
  // { success, foodName, confidence, calories, message, creditsRemaining }
};
```

#### Use Cases

- **Quick calorie check** — Get a rough sense before deciding to eat
- **Food logging preview** — Show user what will be logged before committing
- **Gamification** — Quick feedback for streak-based features

---

### 3. User Profile

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
    `${API_BASE}/user/me`,
    {
      headers: { 'Authorization': `Bearer ${await getIdToken()}` }
    }
  );
  return res.json(); // { success, user: UserProfile }
};
```

---

### 4. Credits

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
    `${API_BASE}/credits`,
    {
      headers: { 'Authorization': `Bearer ${await getIdToken()}` }
    }
  );
  return res.json(); // { success, credits: number }
};
```

---

### 5. Backup

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
    `${API_BASE}/backup`,
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

### 6. Restore

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
    `${API_BASE}/restore`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${await getIdToken()}` }
    }
  );
  return res.json(); // { success, data: BackupPayload }
};
```

---

### 7. Backup Status

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
    `${API_BASE}/backup-status`,
    {
      headers: { 'Authorization': `Bearer ${await getIdToken()}` }
    }
  );
  return res.json(); // { success, exists, lastModified?, sizeBytes? }
};
```

---

### 8. Device Registration

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
    `${API_BASE}/register-device`,
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

### 9. Event Tracking

Tracks user behavioral events with idempotent writes and automatic streak computation.

> **Auth Required:** Yes  
> **Method:** `POST`

```http
POST /events
Authorization: Bearer <token>
Content-Type: application/json
```

#### Request Body

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventName": "WEIGHT_LOGGED",
  "timestamp": "2026-01-24T14:30:00.000Z",
  "timezone": "Asia/Kolkata",
  "sessionId": "660e8400-e29b-41d4-a716-446655440001",
  "platform": "ios",
  "metadata": {
    "weight_value": 72.5,
    "unit": "kg",
    "source": "manual"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `eventId` | UUID v4 | **Client-generated** unique ID for idempotency |
| `eventName` | enum | Event type (see below) |
| `timestamp` | ISO 8601 | When the user triggered the action |
| `timezone` | IANA string | User's timezone (e.g., `Asia/Kolkata`) |
| `sessionId` | UUID v4 | Session ID (generated on app launch) |
| `platform` | enum | `"ios"` or `"android"` |
| `metadata` | object | Event-specific data (varies by eventName) |

#### Event Types

| Event Name | Description | Metadata Fields |
|------------|-------------|-----------------|
| `WEIGHT_LOGGED` | User logged weight | `weight_value`, `unit`, `source` |
| `FOOD_ANALYZED` | Food image analyzed | `success`, `food_detected`, `credits_remaining`, `latency_ms` |
| `DEVICE_REGISTERED` | Device registered | `timezone`, `platform`, `app_version?` |
| `NOTIFICATION_DELIVERED` | Push notification sent (server) | `notification_id`, `notification_type`, `delivery_status` |
| `NOTIFICATION_RECEIVED` | Notification received on device | `notification_id`, `received_at` |
| `NOTIFICATION_OPENED` | User opened notification | `notification_id`, `opened_at` |
| `INTENT_CAPTURED` | User created an intent | `intent_type`, `expected_duration` |
| `INTENT_CLOSED` | Intent was closed | `intent_type`, `outcome`, `actual_duration`, `expected_duration` |

#### Metadata Schemas

**WEIGHT_LOGGED:**
```json
{
  "weight_value": 72.5,
  "unit": "kg",
  "source": "manual"
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `weight_value` | number | positive |
| `unit` | enum | `"kg"` or `"lbs"` (default: `"kg"`) |
| `source` | enum | `"manual"` or `"auto"` (default: `"manual"`) |

**INTENT_CAPTURED:**
```json
{
  "intent_type": "workout",
  "expected_duration": 30
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `intent_type` | string | min 1 char |
| `expected_duration` | number | minutes (int >= 0) |

**INTENT_CLOSED:**
```json
{
  "intent_type": "workout",
  "outcome": "completed",
  "actual_duration": 28,
  "expected_duration": 30
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `intent_type` | string | min 1 char |
| `outcome` | enum | `"completed"`, `"abandoned"`, `"expired"` |
| `actual_duration` | number | minutes (int >= 0) |
| `expected_duration` | number | minutes (int >= 0) |

#### Response

```json
{
  "success": true,
  "status": "created",
  "eventId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | enum | `"created"` (new event) or `"duplicate"` (already exists) |

> [!NOTE]
> Returns 200 OK for **both** new and duplicate events (idempotent success).

#### Streak Logic

When `WEIGHT_LOGGED` events are received, the backend automatically computes streaks:

| Condition | Action |
|-----------|--------|
| First log ever | `streak = 1` |
| Same day as last log | `streak` unchanged |
| Consecutive day | `streak++` |
| Gap > 1 day | `streak = 1` (reset) |

Streak state is stored on the user document and updated transactionally.

#### Code Example

```typescript
const trackEvent = async (
  eventName: string,
  metadata: Record<string, unknown>
) => {
  const response = await fetch(
    `${API_BASE}/events`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getIdToken()}`
      },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        eventName,
        timestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        sessionId: getSessionId(), // App-maintained session
        platform: Platform.OS, // 'ios' or 'android'
        metadata,
      }),
    }
  );
  return response.json();
};

// Example: Log weight
await trackEvent('WEIGHT_LOGGED', {
  weight_value: 72.5,
  unit: 'kg',
  source: 'manual',
});

// Example: Intent captured (in handleAddIntent)
await trackEvent('INTENT_CAPTURED', {
  intent_type: intent.type,
  expected_duration: intent.expected_duration,
});

// Example: Intent closed (on closure)
await trackEvent('INTENT_CLOSED', {
  intent_type: closedIntent.type,
  outcome: 'completed', // or 'abandoned' or 'expired'
  actual_duration: closedIntent.actual_duration,
  expected_duration: closedIntent.expected_duration,
});

// Example: Notification received (in push handler)
await trackEvent('NOTIFICATION_RECEIVED', {
  notification_id: notification.data.notification_id,
  received_at: new Date().toISOString(),
});
```

#### Client Requirements

1. **UUID Generation:** Client must generate `eventId` using UUID v4
2. **Session Management:**
   - Generate `sessionId` on App Launch
   - Persist in memory until app kill or >30min background
3. **Timezone:** Send `Intl.DateTimeFormat().resolvedOptions().timeZone`
4. **Offline Handling:** Queue events locally and retry on network restore

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

When credits reach 0, `/analyze-food` returns:

```json
{
  "success": false,
  "error": "Insufficient AI credits",
  "code": "INSUFFICIENT_CREDITS"
}
```

### Best Practices

1. **Check credits before analysis** — call `/credits` first
2. **Cache the profile** — avoid excessive `/user/me` calls
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

const API_BASE = 'https://api-<deployment-hash>-uc.a.run.app';

async function analyzeFood(imageBase64: string) {
  const user = await signInAnonymously(auth);
  const token = await user.user.getIdToken();

  const response = await fetch(
    `${API_BASE}/analyze-food`,
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
