/**
 * Backfill Script: Top-up existing users' AI credits to 40
 *
 * For each user:
 *   - If aiCredits < 40, sets aiCredits to 40 and adjusts totalGranted
 *   - If aiCredits >= 40, skips (no-op)
 *
 * Usage: npx ts-node scripts/backfillCreditsTo40.ts
 */

import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

// Initialize Firebase Admin
if (getApps().length === 0) {
    initializeApp({
        credential: applicationDefault(),
        projectId: "platewise-b8995",
    });
}

const db = getFirestore();
const NEW_CREDIT_LIMIT = 40;

async function backfillCredits(): Promise<void> {
    console.log(`Starting credit backfill → top-up to ${NEW_CREDIT_LIMIT}...`);

    const usersSnapshot = await db.collection("users").get();
    console.log(`Found ${usersSnapshot.size} total users`);

    let topped = 0;
    let skipped = 0;

    const batchSize = 500;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of usersSnapshot.docs) {
        const data = doc.data();
        const currentCredits: number = data.aiCredits ?? 0;

        if (currentCredits >= NEW_CREDIT_LIMIT) {
            skipped++;
            continue;
        }

        const creditsToAdd = NEW_CREDIT_LIMIT - currentCredits;

        batch.update(doc.ref, {
            aiCredits: NEW_CREDIT_LIMIT,
            totalGranted: FieldValue.increment(creditsToAdd),
            updatedAt: Timestamp.now(),
        });

        batchCount++;
        topped++;

        if (batchCount >= batchSize) {
            await batch.commit();
            console.log(`Committed batch of ${batchCount} users`);
            batch = db.batch();
            batchCount = 0;
        }
    }

    // Commit remaining
    if (batchCount > 0) {
        await batch.commit();
        console.log(`Committed final batch of ${batchCount} users`);
    }

    console.log(`\nBackfill complete!`);
    console.log(`  Topped up: ${topped} users`);
    console.log(`  Skipped (already ≥ ${NEW_CREDIT_LIMIT}): ${skipped} users`);
}

// Run
backfillCredits()
    .then(() => {
        console.log("Done!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Backfill failed:", error);
        process.exit(1);
    });
