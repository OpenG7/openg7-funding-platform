/** Scalar administrative summaries cannot represent more than one currency. */
export class AdminFinancialCurrencyConflictError extends Error {
  readonly status = 409;
  readonly code = 'ADMIN_FINANCIAL_CURRENCY_CONFLICT';

  constructor() {
    super('Amounts in different currencies cannot be combined.');
    this.name = 'AdminFinancialCurrencyConflictError';
  }
}

export const assertAdminFinancialCurrency = (
  row: { readonly currency_count?: string; readonly currency?: string | null },
  expected?: string
): void => {
  const count = Number(row.currency_count ?? 0);
  if (
    count > 1 ||
    (count > 0 &&
      expected &&
      row.currency?.toUpperCase() !== expected.toUpperCase())
  )
    throw new AdminFinancialCurrencyConflictError();
};
