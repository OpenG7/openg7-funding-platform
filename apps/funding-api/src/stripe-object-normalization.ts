import type Stripe from 'stripe';

export const resolvePaymentIntentId = (
  value: string | Stripe.PaymentIntent | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  return typeof value === 'string' ? value : value.id;
};

export const resolveBalanceTransaction = async (
  stripe: Stripe,
  value: string | Stripe.BalanceTransaction | null | undefined
): Promise<Stripe.BalanceTransaction | null> => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return stripe.balanceTransactions.retrieve(value);
  }

  return value;
};

export const buildBalanceData = (
  balanceTransaction: Stripe.BalanceTransaction | null,
  fallbackAmount: number,
  fallbackCurrency: string
): {
  readonly stripeBalanceTransactionId: string | null;
  readonly amount: number;
  readonly fee: number;
  readonly net: number;
  readonly currency: string;
} => {
  if (!balanceTransaction) {
    return {
      stripeBalanceTransactionId: null,
      amount: fallbackAmount,
      fee: 0,
      net: fallbackAmount,
      currency: fallbackCurrency
    };
  }

  return {
    stripeBalanceTransactionId: balanceTransaction.id,
    amount: balanceTransaction.amount,
    fee: balanceTransaction.fee,
    net: balanceTransaction.net,
    currency: balanceTransaction.currency
  };
};
