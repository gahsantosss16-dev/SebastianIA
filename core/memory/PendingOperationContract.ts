export const OPERATION_EVENT_RECORD_KIND = 'sebastian.operation.event';
export const PENDING_OPERATION_TTL_MS = 30 * 60 * 1_000;

export type PendingOperationStatus =
  | 'proposed'
  | 'authorized'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

/** Exact, immutable scope proposed to the user and later authorized locally. */
export interface PendingOperationRecord {
  readonly memoryRecordKind: typeof OPERATION_EVENT_RECORD_KIND;
  readonly id: string;
  readonly objectiveId: string;
  readonly objective: string;
  readonly proposedAction: string;
  readonly toolId: string;
  readonly toolArguments: Readonly<Record<string, unknown>>;
  readonly validationToolId: string;
  readonly risk: string;
  readonly authorizationRequirement: 'explicitUserAuthorization';
  readonly status: PendingOperationStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
}
