import {
  bootstrapApplication,
  type BootstrapContext
} from '@angular/platform-browser';

import { AppComponent } from './app/app.component.js';
import { appServerConfig } from './app/app.config.server.js';

const bootstrap = (context: BootstrapContext): Promise<unknown> =>
  bootstrapApplication(AppComponent, appServerConfig, context);

export default bootstrap;
