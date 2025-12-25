# Backend Integration Guide

This document provides all necessary information to connect the frontend mobile app to the Platewise Firebase backend.

## 🔗 API Base URLs

| Service | Live URL |
|---------|----------|
| Device Registration | https://registerdevicefunction-kxzhine25a-uc.a.run.app |
| Food Analysis | https://analyzefoodimagefunction-kxzhine25a-uc.a.run.app |
| Backup | https://us-central1-platewise-b8995.cloudfunctions.net/backupFunction |
| Restore | https://us-central1-platewise-b8995.cloudfunctions.net/restoreFunction |
| Backup Status | https://us-central1-platewise-b8995.cloudfunctions.net/backupStatusFunction |
| Credits | https://us-central1-platewise-b8995.cloudfunctions.net/creditsFunction |
| User Profile | https://us-central1-platewise-b8995.cloudfunctions.net/userProfileFunction |

---

## 🔐 Authentication

All authenticated endpoints require a Firebase ID token in the `Authorization` header:

```typescript
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${await auth().currentUser?.getIdToken()}`
};
```

### Authentication Flow
1. **Anonymous Auth**: Users start with anonymous Firebase Auth
2. **Link Account**: Later link to Google/Email for data persistence
3. **All data is keyed by `uid`** - survives reinstalls when signed in

---

## 🛠️ TypeScript Interfaces

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
  createdAt: string;
  lastActiveAt: string;
}

// Backup Data
interface BackupPayload {
  weightEntries?: unknown[];
  foodLogs?: unknown[];
  streaks?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
```

---

## 📡 Endpoints

### 1. Analyze Food Image (Authenticated)
**POST** `https://analyzefoodimagefunction-kxzhine25a-uc.a.run.app`

Analyzes food image using GPT-4 Vision. **Requires auth token. Deducts 1 credit.**

```typescript
const analyzeFood = async (base64Image: string) => {
  const response = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await getIdToken()}`
    },
    body: JSON.stringify({ image: base64Image }),
  });
  return response.json(); // { success, nutrition, creditsRemaining }
};
```

### 2. Get Credits
**GET** `https://us-central1-platewise-b8995.cloudfunctions.net/creditsFunction`

```typescript
const getCredits = async () => {
  const res = await fetch(URL, {
    headers: { 'Authorization': `Bearer ${await getIdToken()}` }
  });
  return res.json(); // { success, credits: number }
};
```

### 3. Get User Profile
**GET** `https://us-central1-platewise-b8995.cloudfunctions.net/userProfileFunction`

```typescript
const getUserProfile = async () => {
  const res = await fetch(URL, {
    headers: { 'Authorization': `Bearer ${await getIdToken()}` }
  });
  return res.json(); // { success, user: UserProfile }
};
```

### 4. Create Backup
**POST** `https://us-central1-platewise-b8995.cloudfunctions.net/backupFunction`

```typescript
const createBackup = async (data: BackupPayload) => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await getIdToken()}`
    },
    body: JSON.stringify(data),
  });
  return res.json(); // { success, message }
};
```

### 5. Restore Backup
**POST** `https://us-central1-platewise-b8995.cloudfunctions.net/restoreFunction`

```typescript
const restoreBackup = async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${await getIdToken()}` }
  });
  return res.json(); // { success, data: BackupPayload }
};
```

### 6. Get Backup Status
**GET** `https://us-central1-platewise-b8995.cloudfunctions.net/backupStatusFunction`

```typescript
const getBackupStatus = async () => {
  const res = await fetch(URL, {
    headers: { 'Authorization': `Bearer ${await getIdToken()}` }
  });
  return res.json(); // { success, exists: boolean, createdAt?: string, version?: number }
};
```

### 7. Register Device (No Auth)
**POST** `https://registerdevicefunction-kxzhine25a-uc.a.run.app`

```typescript
const registerDevice = async (data: {
  deviceId: string;
  fcmToken: string;
  platform: 'ios' | 'android';
}) => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
};
```

---

## 🚨 Error Codes

### Auth & Credits Errors
| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid Firebase ID token |
| `INSUFFICIENT_CREDITS` | 402 | No AI credits remaining |
| `BACKUP_NOT_FOUND` | 404 | No backup exists for this user |

### Input Validation Errors
| Code | HTTP | Description |
|------|------|-------------|
| `INVALID_REQUEST` | 400 | Missing or malformed fields |
| `IMAGE_TOO_LARGE` | 413 | Image exceeds 5MB |
| `UNSUPPORTED_FORMAT` | 415 | Must be JPEG, PNG, or WebP |

### Food Analysis Errors
| Code | HTTP | Description |
|------|------|-------------|
| `NOT_FOOD` | 422 | Image doesn't contain food |
| `IMAGE_TOO_BLURRY` | 422 | Image is blurry/unclear |
| `MULTIPLE_FOODS` | 422 | Multiple items detected |
| `LOW_CONFIDENCE` | 422 | AI can't identify the food |

### Server Errors
| Code | HTTP | Description |
|------|------|-------------|
| `AI_SERVICE_ERROR` | 503 | OpenAI temporarily unavailable |
| `STORAGE_ERROR` | 500 | Cloud Storage operation failed |

---

## 💰 Credits System

- New users receive **20 free AI credits**
- **1 credit** is deducted per food analysis
- `creditsRemaining` is returned in the food analysis response
- Check balance anytime via `/creditsFunction`
