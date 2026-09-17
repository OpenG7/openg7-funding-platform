export declare function resetStripeStub(): Promise<void>;
export declare function registerStripePaymentIntent(
  params: Record<string, unknown>
): Promise<void>;
export declare function registerStripeCheckoutSession(
  params: Record<string, unknown>
): Promise<void>;
export declare function registerStripePayout(
  params: Record<string, unknown>
): Promise<void>;
export declare function registerStripeDispute(
  params: Record<string, unknown>
): Promise<void>;
export declare function updateStripeBalanceTransaction(
  id: string,
  params: { amount?: number; fee?: number; net?: number; currency?: string }
): Promise<void>;
