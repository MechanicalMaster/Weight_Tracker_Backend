// Workflow types for deferred deep linking
import { Timestamp } from "firebase-admin/firestore";

// Workflow ID validation regex (ULID with WF_ prefix)
export const WORKFLOW_ID_REGEX = /^WF_[0-9A-HJKMNP-TV-Z]{26}$/;

// TTL bounds
export const MIN_TTL_HOURS = 1;
export const MAX_TTL_HOURS = 72;

// Payload weight bounds
export const MIN_WEIGHT = 20;
export const MAX_WEIGHT = 300;

// Allowed workflow types
export const WORKFLOW_TYPES = ["LOG_WEIGHT"] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

// Workflow status
export type WorkflowStatus = "ACTIVE" | "COMPLETED" | "EXPIRED";

// Per-type payload schemas
export interface LogWeightPayload {
    suggestedWeight?: number; // Validated: 20-300
    source?: string;
}

// Workflow document stored in Firestore
export interface WorkflowDocument {
    id: string; // WF_{ULID}
    type: WorkflowType;
    status: WorkflowStatus;
    payload: LogWeightPayload;
    userId: string | null; // null = public workflow
    campaignId?: string;
    createdAt: Timestamp;
    expiresAt: Timestamp;
    completedAt?: Timestamp;
    maxResolves?: number; // Optional limit for campaign protection
    metadata: {
        clickCount: number;
        resolveCount: number;
        lastResolvedAt?: Timestamp;
    };
}

// Create workflow request
export interface CreateWorkflowRequest {
    type: WorkflowType;
    payload?: LogWeightPayload;
    expiresInHours?: number; // Default: 48, Min: 1, Max: 72
    campaignId?: string;
    maxResolves?: number;
}

// Create workflow response
export interface CreateWorkflowResponse {
    success: true;
    workflowId: string;
    deepLinkUrl: string;
}

// Resolve workflow response
export interface ResolveWorkflowResponse {
    success: true;
    type: WorkflowType;
    status: WorkflowStatus;
    payload: LogWeightPayload;
    expiresAt: string; // ISO 8601
}

// Complete workflow response
export interface CompleteWorkflowResponse {
    success: true;
    status: "COMPLETED";
}
