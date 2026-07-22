export declare const ADMIN_TOKEN: string;

interface SponsorshipFixture {
  readonly publicReference: string;
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl: string;
  readonly followupToken: string;
  readonly amountCents: number;
  readonly reviewStatus: 'pending_review' | 'approved' | 'rejected';
  readonly stripePaymentIntentId?: string;
  readonly stripeSessionId?: string;
  readonly feedTarget?: 'openg7' | 'openg20';
  readonly feedChannels?: readonly ('facebook' | 'linkedin')[];
}

export declare const SPONSORSHIP_FIXTURES: {
  readonly approve: SponsorshipFixture;
  readonly reject: SponsorshipFixture;
  readonly directory: SponsorshipFixture;
  readonly refund: SponsorshipFixture;
  readonly partialRefund: SponsorshipFixture;
  readonly rejectRefund: SponsorshipFixture;
  readonly logo: SponsorshipFixture;
  readonly publicationBatch: SponsorshipFixture;
};

export declare const EMAIL_QUEUE_FIXTURE: {
  readonly idempotencyKey: string;
  readonly templateKey: string;
  readonly recipientEmail: string;
  readonly fromEmail: string;
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody: string;
};
