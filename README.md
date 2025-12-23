# Weigh Backend

A minimal Firebase Cloud Functions backend for a mobile weight-tracking app. Built with **TypeScript** and **Node.js 20**.

## Features

- **Device Registration**: Register devices for push notifications using `deviceId` as the identifier
- **Daily Push Notifications**: Scheduled Cloud Function sends weight logging reminders
- **AI Food Analysis**: Analyze food images for nutritional information using GPT-4 Vision

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────┐
│   Mobile App    │────▶│           Firebase Cloud Functions        │
└─────────────────┘     │  ┌─────────────┐  ┌───────────────────┐  │
                        │  │  register-  │  │   analyze-food-   │  │
                        │  │   device    │  │      image        │  │
                        │  └──────┬──────┘  └─────────┬─────────┘  │
                        │         │                   │            │
                        │         ▼                   ▼            │
                        │  ┌─────────────┐     ┌───────────┐       │
                        │  │  Firestore  │     │  OpenAI   │       │
                        │  │  (devices)  │     │  GPT-4V   │       │
                        │  └─────────────┘     └───────────┘       │
                        │         ▲                                │
                        │         │                                │
                        │  ┌──────┴──────┐                         │
                        │  │ dailyNudge  │◀── Cloud Scheduler      │
                        │  │ (scheduled) │    (9:00 AM UTC)        │
                        │  └──────┬──────┘                         │
                        │         │                                │
                        │         ▼                                │
                        │  ┌─────────────┐                         │
                        │  │     FCM     │────▶ Push Notifications │
                        │  └─────────────┘                         │
                        └──────────────────────────────────────────┘
```

## Prerequisites

- [Node.js 20](https://nodejs.org/)
- [Firebase CLI](https://firebase.google.com/docs/cli)
- An existing Firebase project with:
  - Cloud Functions enabled (Blaze plan required)
  - Firestore database created
  - Cloud Messaging (FCM) enabled
- [OpenAI API key](https://platform.openai.com/) with GPT-4 Vision access

## Project Structure

```
Weigh_Backend/
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions CI/CD
├── functions/
│   ├── src/
│   │   ├── index.ts        # Function exports
│   │   ├── config/         # Configuration constants
│   │   ├── handlers/       # HTTP and scheduled handlers
│   │   ├── services/       # Firestore, FCM, Vision services
│   │   ├── types/          # TypeScript interfaces
│   │   └── utils/          # Validation and error handling
│   ├── package.json
│   └── tsconfig.json
├── firebase.json           # Firebase configuration
├── firestore.rules         # Security rules
└── README.md
```

## Setup Instructions

### 1. Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/Weigh_Backend.git
cd Weigh_Backend
cd functions && npm install
```

### 2. Configure Firebase

Update `.firebaserc` with your Firebase project ID:

```json
{
  "projects": {
    "default": "your-firebase-project-id"
  }
}
```

Login to Firebase CLI:

```bash
firebase login
```

### 3. Set Environment Variables

For local development, set the OpenAI API key:

```bash
firebase functions:secrets:set OPENAI_API_KEY
```

When prompted, enter your OpenAI API key.

### 4. Local Development

Start the Firebase emulators:

```bash
firebase emulators:start --only functions,firestore
```

The emulator will be available at `http://localhost:5001`.

### 5. Deploy to Firebase

Manual deployment:

```bash
firebase deploy --only functions,firestore:rules
```

## GitHub Actions Setup (CI/CD)

### Required Secrets

Add these secrets to your GitHub repository (`Settings > Secrets and variables > Actions`):

| Secret | Description |
|--------|-------------|
| `FIREBASE_PROJECT_ID` | Your Firebase project ID |
| `FIREBASE_SERVICE_ACCOUNT` | Service account JSON key (see below) |

### Generate Service Account Key

1. Go to [Firebase Console](https://console.firebase.google.com/) > Project Settings > Service accounts
2. Click "Generate new private key"
3. Copy the entire JSON content
4. Add it as `FIREBASE_SERVICE_ACCOUNT` secret in GitHub

### Trigger Deployment

Push to `main` branch to trigger automatic deployment, or use "Run workflow" in GitHub Actions.

## API Reference

### POST /register-device

Register or update a device for push notifications.

**Request:**
```json
{
  "deviceId": "unique-device-id",
  "fcmToken": "firebase-cloud-messaging-token",
  "platform": "ios" | "android"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Device registered successfully"
}
```

### POST /analyze-food-image

Analyze a food image and get nutritional estimates.

**Request (JSON):**
```json
{
  "deviceId": "unique-device-id",
  "image": "base64-encoded-image-data"
}
```

**Request (Multipart):**
```
Content-Type: multipart/form-data

deviceId: unique-device-id
image: [file upload]
```

**Response:**
```json
{
  "success": true,
  "nutrition": {
    "foodName": "Grilled Chicken Salad",
    "calories": 350,
    "protein": 35,
    "carbohydrates": 15,
    "fat": 18,
    "fiber": 5,
    "estimatedServingSize": "1 bowl (approximately 300g)"
  }
}
```

**Limits:**
- Max image size: 5MB
- Supported formats: JPEG, PNG, WebP
- Timeout: 60 seconds

## Firestore Schema

### Collection: `devices`

| Field | Type | Description |
|-------|------|-------------|
| `deviceId` | string | Document ID |
| `fcmToken` | string | FCM token |
| `platform` | string | "ios" or "android" |
| `createdAt` | timestamp | First registration |
| `lastSeenAt` | timestamp | Updated on each registration |

### Collection: `nudges`

| Field | Type | Description |
|-------|------|-------------|
| `deviceId` | string | Target device |
| `sentAt` | timestamp | When sent |
| `status` | string | "success" or "failed" |
| `title` | string | Notification title |
| `body` | string | Notification body |
| `error` | string | Error message (if failed) |

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

| HTTP Code | Error Code | Description |
|-----------|------------|-------------|
| 400 | `INVALID_REQUEST` | Missing or invalid input |
| 405 | - | Method not allowed |
| 413 | `IMAGE_TOO_LARGE` | Image exceeds 5MB |
| 415 | `UNSUPPORTED_FORMAT` | Invalid image format |
| 422 | `ANALYSIS_FAILED` | Vision API couldn't analyze |
| 500 | `INTERNAL_ERROR` | Server error |

## Development

### Build

```bash
cd functions
npm run build
```

### Lint

```bash
cd functions
npm run lint
```

### Watch Mode

```bash
cd functions
npm run build:watch
```

## Security Notes

- No Firebase Auth is used; `deviceId` is the only identifier
- All Firestore access is denied to clients (backend-only)
- OpenAI API key is stored as a Firebase secret
- Images are not stored server-side

## License

MIT
