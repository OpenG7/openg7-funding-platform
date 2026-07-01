import { InjectionToken, Provider } from '@angular/core';
import { FundingProjectConfig } from '@openg7/funding-models';

export const FUNDING_PROJECT_CONFIG = new InjectionToken<FundingProjectConfig>(
  'FUNDING_PROJECT_CONFIG'
);

export const provideFundingProjectConfig = (
  config: FundingProjectConfig
): Provider => ({
  provide: FUNDING_PROJECT_CONFIG,
  useValue: config
});
