export function startIdentityStripeProvider(): Promise<{
  origin: string;
  webhookSecret: string;
  setAccount(id: string): void;
  stop(): Promise<void>;
}>;
