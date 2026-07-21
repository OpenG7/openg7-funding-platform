export declare const ADMIN_TOKEN: string;

interface SponsorshipFixture {
  readonly publicReference: string;
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl: string;
  readonly followupToken: string;
  readonly amountCents: number;
}

export declare const SPONSORSHIP_FIXTURES: {
  readonly approve: SponsorshipFixture;
  readonly reject: SponsorshipFixture;
};
