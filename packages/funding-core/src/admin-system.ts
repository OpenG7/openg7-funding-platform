export interface AdminSetupStatusResponse {
  readonly data_source: 'database' | 'stripe_direct' | 'empty';
  readonly environment: string;
  readonly public_base_url: string | null;
  readonly allowed_origins: readonly string[];
  readonly stripe: {
    readonly secret_key_configured: boolean;
    readonly webhook_secret_configured: boolean;
    readonly business_sponsorship_enabled: boolean;
    readonly dashboard_url: string;
    readonly webhook_endpoint: string;
  };
  readonly email: {
    readonly smtp_enabled: boolean;
    readonly smtp_configured: boolean;
    readonly smtp_host: string | null;
    readonly smtp_port: number;
    readonly smtp_secure: boolean;
    readonly smtp_user_configured: boolean;
    readonly smtp_password_configured: boolean;
    readonly from: string | null;
    readonly reply_to: string | null;
    readonly admin_notification_email: string | null;
    readonly admin_review_reminder_enabled: boolean;
    readonly admin_review_reminder_min_age_days: number;
    readonly admin_review_reminder_poll_interval_ms: number;
    readonly admin_review_reminder_max_items: number;
    readonly queue_available: boolean;
    readonly queue_poll_interval_ms: number;
    readonly queue_batch_size: number;
    readonly queued_count: number;
    readonly sending_count: number;
    readonly sent_count: number;
    readonly failed_count: number;
    readonly last_failed_at: string | null;
    readonly last_error: string | null;
  };
  readonly invoice: {
    readonly prefix: string;
    readonly issuer_name: string | null;
    readonly issuer_email: string | null;
    readonly issuer_address_configured: boolean;
    readonly issuer_tax_id_configured: boolean;
    readonly tax_label: string;
    readonly ready: boolean;
  };
  readonly database: {
    readonly configured: boolean;
    readonly reachable: boolean;
  };
  readonly last_updated_at: string;
}

export interface AdminEmailTestRequest {
  readonly requestId: string;
  readonly to?: string;
}

export interface AdminEmailTestResult {
  readonly requestId: string;
  readonly status: AdminEmailQueueMessageStatus;
  readonly to: string;
  readonly queued: boolean;
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly messageId: string | null;
  readonly error: string | null;
  readonly deliveryMode?: 'disabled' | 'smtp';
}

export type AdminEmailQueueMessageStatus =
  'queued' | 'sending' | 'sent' | 'failed';

export interface AdminEmailQueueMessageRecord {
  readonly id: string;
  readonly template_key: string;
  readonly recipient_email: string;
  readonly from_email: string;
  readonly reply_to_email: string | null;
  readonly subject: string;
  readonly status: AdminEmailQueueMessageStatus;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly next_attempt_at: string;
  readonly sent_at: string | null;
  readonly last_error: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AdminEmailQueueSummary {
  readonly queued_count: number;
  readonly sending_count: number;
  readonly sent_count: number;
  readonly failed_count: number;
  readonly retryable_count: number;
  readonly last_failed_at: string | null;
  readonly last_error: string | null;
}

export interface AdminEmailQueueResponse {
  readonly data_source: 'database';
  readonly messages: readonly AdminEmailQueueMessageRecord[];
  readonly summary: AdminEmailQueueSummary;
  readonly last_updated_at: string;
}

export interface AdminEmailQueueRetryRequest {
  readonly messageId: string;
}

export interface AdminEmailQueueRetryResult {
  readonly attempted: number;
  readonly sent: number;
  readonly failed: number;
  readonly messageIds: readonly string[];
  readonly sentMessageIds: readonly string[];
  readonly failedMessageIds: readonly string[];
  readonly message: AdminEmailQueueMessageRecord | null;
}

export interface AdminSessionCreateRequest {
  readonly token: string;
}

export interface AdminSessionResponse {
  readonly actor: string;
  readonly expiresAt: string;
  readonly sessionToken: string;
  readonly ttlSeconds: number;
}
