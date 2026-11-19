import { sponsorshipPublicationJourney } from './support/sponsorship-publication-journey.js';
import { test } from './support/test.js';

test('company pays 500 CAD: private preparation, reviewed media, exact approvals and two simulated worker deliveries', async ({
  page,
  context,
  request,
  playwright,
  baseURL
}, info) => {
  await sponsorshipPublicationJourney(
    { page, context, request, playwright, baseURL },
    info
  );
});
