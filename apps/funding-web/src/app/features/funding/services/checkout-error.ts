/** Safe public condition: an uncertain Checkout must be reviewed before retrying. */
export class CheckoutReconciliationRequiredError extends Error {
  readonly code = 'CHECKOUT_RECONCILIATION_REQUIRED';

  constructor() {
    super('Checkout requires verification before retrying.');
    this.name = 'CheckoutReconciliationRequiredError';
  }
}
