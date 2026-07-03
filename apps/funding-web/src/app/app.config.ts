import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import {
  provideTranslateLoader,
  provideTranslateService
} from '@ngx-translate/core';

import { FundingTranslateLoader } from './features/funding/services/funding-translate.loader.js';
import { appRoutes } from './app.routes.js';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideClientHydration(),
    provideRouter(
      appRoutes,
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled'
      })
    ),
    ...provideTranslateService({
      loader: provideTranslateLoader(FundingTranslateLoader)
    })
  ]
};
