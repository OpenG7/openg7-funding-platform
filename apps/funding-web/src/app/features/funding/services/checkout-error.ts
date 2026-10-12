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
  constructor() {
    super('The applicable sponsorship charter changed.');
    this.name = 'CheckoutCharterChangedError';
  }
}
