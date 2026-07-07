import type {
  FundTransparencyPublicResponse,
  PublicMonthlySummary
} from '@openg7/funding-core';
import type Stripe from 'stripe';

interface StripeTransparencyOptions {
  readonly projectId: string;
}

interface FinanceAccumulator {
  totalReceived: number;
  totalFees: number;
  totalNet: number;
  totalRefunded: number;
  totalPayouts: number;
  contributionsCount: number;
  currency: string;
}

interface StripeContribution {
  readonly amount: number;
  readonly fee: number;
  readonly net: number;
  readonly refunded: number;
  readonly currency: string;
  readonly created: number;
}

interface StripePayoutRecord {
  readonly amount: number;
  readonly currency: string;
  readonly created: number;
}

const centsToAmount = (value: number): number => Number((value / 100).toFixed(2));

const createAccumulator = (currency = 'cad'): FinanceAccumulator => ({
  totalReceived: 0,
  totalFees: 0,
  totalNet: 0,
  totalRefunded: 0,
  totalPayouts: 0,
  contributionsCount: 0,
  currency
});

const monthKeyFromUnix = (seconds: number): string => {
  const date = new Date(seconds * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const resolveBalanceTransaction = async (
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

const resolveCharge = async (
  stripe: Stripe,
  value: string | Stripe.Charge | null | undefined
): Promise<Stripe.Charge | null> => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return stripe.charges.retrieve(value, {
      expand: ['balance_transaction']
    });
  }

  return value;
};

const resolvePaymentIntent = async (
  stripe: Stripe,
  value: string | Stripe.PaymentIntent | null
): Promise<Stripe.PaymentIntent | null> => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return stripe.paymentIntents.retrieve(value, {
      expand: ['latest_charge.balance_transaction']
    });
  }

  return value;
};

const isProjectSession = (
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent | null,
  projectId: string
): boolean =>
  session.metadata?.projectId === projectId ||
  paymentIntent?.metadata?.projectId === projectId;

const toContribution = async (
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent
): Promise<StripeContribution | null> => {
  if (session.payment_status !== 'paid' && paymentIntent.status !== 'succeeded') {
    return null;
  }

  const charge = await resolveCharge(stripe, paymentIntent.latest_charge);
  const balanceTransaction = await resolveBalanceTransaction(
    stripe,
    charge?.balance_transaction
  );
  const amount =
    paymentIntent.amount_received || session.amount_total || paymentIntent.amount || 0;
  const fee = balanceTransaction?.fee ?? 0;
  const net = balanceTransaction?.net ?? amount - fee;
  const currency = balanceTransaction?.currency ?? paymentIntent.currency ?? session.currency ?? 'cad';

  return {
    amount,
    fee,
    net,
    refunded: charge?.amount_refunded ?? 0,
    currency,
    created: paymentIntent.created || session.created
  };
};

const applyContribution = (
  accumulator: FinanceAccumulator,
  contribution: StripeContribution
): void => {
  accumulator.totalReceived += contribution.amount;
  accumulator.totalFees += contribution.fee;
  accumulator.totalNet += contribution.net;
  accumulator.totalRefunded += contribution.refunded;
  accumulator.contributionsCount += 1;
  accumulator.currency = contribution.currency;
};

const applyPayout = (
  accumulator: FinanceAccumulator,
  payout: StripePayoutRecord
): void => {
  accumulator.totalPayouts += payout.amount;
  accumulator.currency = payout.currency;
};

const toMonthlySummary = (
  month: string,
  accumulator: FinanceAccumulator
): PublicMonthlySummary => ({
  month,
  total_received: centsToAmount(accumulator.totalReceived),
  total_fees: centsToAmount(accumulator.totalFees),
  total_net: centsToAmount(accumulator.totalNet),
  total_refunded: centsToAmount(accumulator.totalRefunded),
  total_payouts: centsToAmount(accumulator.totalPayouts),
  contributions_count: accumulator.contributionsCount,
  currency: accumulator.currency.toUpperCase()
});

export const getStripePublicTransparencySummary = async (
  stripe: Stripe,
  options: StripeTransparencyOptions
): Promise<FundTransparencyPublicResponse> => {
  const totals = createAccumulator();
  const monthly = new Map<string, FinanceAccumulator>();
  let lastUpdatedAt = new Date().toISOString();

  const sessions = await stripe.checkout.sessions.list({
    limit: 100,
    expand: ['data.payment_intent']
  });

  for (const session of sessions.data) {
    const paymentIntent = await resolvePaymentIntent(stripe, session.payment_intent);
    if (!paymentIntent || !isProjectSession(session, paymentIntent, options.projectId)) {
      continue;
    }

    const contribution = await toContribution(stripe, session, paymentIntent);
    if (!contribution) {
      continue;
    }

    applyContribution(totals, contribution);

    const month = monthKeyFromUnix(contribution.created);
    const monthAccumulator = monthly.get(month) ?? createAccumulator(contribution.currency);
    applyContribution(monthAccumulator, contribution);
    monthly.set(month, monthAccumulator);
    lastUpdatedAt = new Date(Math.max(new Date(lastUpdatedAt).getTime(), contribution.created * 1000)).toISOString();
  }

  const payouts = await stripe.payouts.list({ limit: 100 });
  for (const payout of payouts.data) {
    if (payout.status !== 'paid') {
      continue;
    }

    const payoutRecord: StripePayoutRecord = {
      amount: payout.amount,
      currency: payout.currency,
      created: payout.created
    };

    applyPayout(totals, payoutRecord);

    const month = monthKeyFromUnix(payoutRecord.created);
    const monthAccumulator = monthly.get(month) ?? createAccumulator(payoutRecord.currency);
    applyPayout(monthAccumulator, payoutRecord);
    monthly.set(month, monthAccumulator);
    lastUpdatedAt = new Date(Math.max(new Date(lastUpdatedAt).getTime(), payoutRecord.created * 1000)).toISOString();
  }

  const totalNet = centsToAmount(totals.totalNet);
  const totalRefunded = centsToAmount(totals.totalRefunded);
  const totalPayouts = centsToAmount(totals.totalPayouts);
  const currentAvailableEstimate = Number(
    (totalNet - totalRefunded - totalPayouts).toFixed(2)
  );

  return {
    data_source: 'stripe_direct',
    total_received: centsToAmount(totals.totalReceived),
    total_fees: centsToAmount(totals.totalFees),
    total_net: totalNet,
    total_refunded: totalRefunded,
    total_payouts: totalPayouts,
    current_available_estimate: currentAvailableEstimate,
    contributions_count: totals.contributionsCount,
    currency: totals.currency.toUpperCase(),
    monthly_summary: Array.from(monthly.entries())
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, 12)
      .map(([month, accumulator]) => toMonthlySummary(month, accumulator)),
    latest_public_allocations: [],
    public_builders: [],
    last_updated_at: lastUpdatedAt
  };
};
