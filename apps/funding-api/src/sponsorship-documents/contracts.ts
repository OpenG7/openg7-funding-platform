export interface CreateSponsorshipInvoiceInput {
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly publicReference: string | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly paidAtIso: string | null;
  readonly customerEmail: string | null;
}

export interface CreateSponsorshipCreditNoteInput {
  readonly contributionId: string;
  readonly stripeRefundId: string;
  readonly refundAmountCents: number;
}
