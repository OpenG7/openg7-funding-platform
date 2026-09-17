/** Deliberately excludes webhook payloads and payment/customer details. */
export interface AdminStripeEvent {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly receivedAt: string;
  readonly processedAt: string | null;
  /** A failed status is known; the underlying provider error is not persisted. */
  readonly error: 'processing_failed' | null;
}
export interface AdminStripeEventResponse {
  readonly available: boolean;
  readonly event: AdminStripeEvent | null;
}
