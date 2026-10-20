import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component.js';
import { appConfig } from './app/app.config.js';

void bootstrapApplication(AppComponent, appConfig).then((app) =>
  import('./app/features/funding/components/app-update/app-update.bootstrap.js')
    .then(({ mountAppUpdate }) => mountAppUpdate(app))
    .catch(() => {
      // An unavailable notice bundle must not interrupt the current page.
    })
);
