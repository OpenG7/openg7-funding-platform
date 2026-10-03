export type AdminTransparencyMoneyFormatter = (
  amount: number,
  currency: string
) => string;

export type AdminTransparencyDateFormatter = (value: string | null) => string;
