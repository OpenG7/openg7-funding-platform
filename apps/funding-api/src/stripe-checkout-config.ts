/** Navigable Checkout is opt-in for the isolated local Stripe simulator only. */
export function simulatedCheckoutEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.STRIPE_SIMULATED_CHECKOUT_ENABLED ?? 'false';
  if (!['true', 'false'].includes(value))
    throw new Error('Invalid STRIPE_SIMULATED_CHECKOUT_ENABLED.');
  if (value === 'false') return false;
  if (
    !['development', 'test'].includes(env.FUNDING_PLATFORM_ENV ?? '') ||
    !['localhost', '127.0.0.1', 'stripe-stub'].includes(
      env.STRIPE_API_HOST ?? ''
    ) ||
    !env.STRIPE_SECRET_KEY?.startsWith('sk_test_')
  )
    throw new Error(
      'Simulated Checkout requires a local test Stripe configuration.'
    );
  return true;
}
