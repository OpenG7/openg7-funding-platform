import { provideHttpClient } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { AppComponent } from './app/app.component.js';
import { appRoutes } from './app/app.routes.js';

void bootstrapApplication(AppComponent, {
	providers: [
		provideHttpClient(),
		provideRouter(appRoutes),
		...provideTranslateService({
			loader: provideTranslateHttpLoader({
				prefix: 'assets/i18n/',
				suffix: '.json'
			})
		})
	]
});
