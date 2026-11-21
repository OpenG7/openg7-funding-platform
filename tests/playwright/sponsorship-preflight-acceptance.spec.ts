import { sponsorshipPublicationJourney } from './support/sponsorship-publication-journey.js';
import { test } from './support/test.js';

test('15 CAD: real Funding relay and Preflight worker, explicit adoption, Web evidence and independent simulated Facebook/LinkedIn deliveries', async ({
  page,
  context,
  request,
  playwright,
  baseURL
}, info) => {
  test.skip(
    process.env.OPENG7_PREFLIGHT_ACCEPTANCE !== '1',
    'Requires the dedicated --preflight-root disposable overlay.'
  );
  await sponsorshipPublicationJourney(
    { page, context, request, playwright, baseURL },
    info,
    true
  );
});
