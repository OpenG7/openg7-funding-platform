export interface SocialFixtureAccount {
  accountId: string;
  accessToken: string;
  expiresAt?: string;
}
export type SocialFixtureAccounts = Partial<
  Record<import('@openg7/funding-core').PublicationFeedId, SocialFixtureAccount>
>;
export interface SocialFixtureOptions {
  origin: string;
  accounts: SocialFixtureAccounts;
}
export function socialFixtureEnvironment(
  options: SocialFixtureOptions
): Record<string, string>;
export function startSocialProvider(): Promise<{
  origin: string;
  requests: {
    channel: string;
    phase: string;
    accountId: string | null;
    status: number;
  }[];
  posts: { id: string; channel: string; accountId: string; message: string }[];
  account(
    token: string,
    options: {
      id: string;
      channel: string;
      checkedId?: string;
      checkStatus?: number;
      sendStatus?: number;
    }
  ): void;
  stop(): Promise<void>;
}>;
