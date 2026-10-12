/** Safe public condition: an uncertain Checkout must be reviewed before retrying. */
export class CheckoutReconciliationRequiredError extends Error {
  readonly code = 'CHECKOUT_RECONCILIATION_REQUIRED';

  constructor() {
    super('Checkout requires verification before retrying.');
    this.name = 'CheckoutReconciliationRequiredError';
  }
}
/** Safe public failure: reread the active terms; never reuse a stale acceptance. */
export class CheckoutCharterChangedError extends Error {
  constructor(readonly code = 'CHARTER_VERSION_CHANGED') {
    super('The applicable sponsorship charter changed.');
    this.name = 'CheckoutCharterChangedError';
  }
}

/** Safe public failure before a new operation: reread and confirm the offered benefits. */
export class CheckoutRecoveryUnavailableError extends Error {
  readonly code = 'CHECKOUT_RECOVERY_UNAVAILABLE';
  constructor() {
    super('Checkout recovery cannot be retained in this browser.');
    this.name = 'CheckoutRecoveryUnavailableError';
  }
}

/** Safe public failure before a new operation: reread and confirm the offered benefits. */
export class CheckoutOfferChangedError extends Error {
  constructor(readonly code = 'SPONSORSHIP_OFFER_CHANGED') {
    super('The applicable sponsorship offer changed.');
    this.name = 'CheckoutOfferChangedError';
  }
}
