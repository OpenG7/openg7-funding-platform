import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminIdentitySetupStatus } from '@openg7/funding-core';

import { IDENTITY_GUIDE_ENVIRONMENT_EXAMPLES } from './identity-setup-fields.js';
import {
  IDENTITY_GUIDE_STEPS,
  projectIdentityConfiguration,
  projectIdentityGuideObservations
} from './identity-setup-projections.js';

/** Guided admin setup organism; instructions and local navigation, no requests or mutations. */
@Component({
  selector: 'openg7-admin-identity-setup',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-identity-setup.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-identity-setup.component.css'
  ]
})
export class AdminIdentitySetupComponent {
  readonly status = input<AdminIdentitySetupStatus | null>(null);
  readonly databaseConfigured = input<boolean | null>(null);
  readonly databaseReachable = input<boolean | null>(null);
  readonly tourTarget = input(false);
  readonly steps = IDENTITY_GUIDE_STEPS;
  readonly environmentVariables = IDENTITY_GUIDE_ENVIRONMENT_EXAMPLES;
  readonly stepIndex = signal(0);
  readonly currentStep = computed(() => this.steps[this.stepIndex()]!);
  readonly configuration = computed(() =>
    projectIdentityConfiguration(this.status())
  );
  readonly observations = computed(() =>
    projectIdentityGuideObservations(
      this.status(),
      this.databaseConfigured(),
      this.databaseReachable()
    )
  );
  private readonly injector = inject(Injector);
  private readonly stepHeading =
    viewChild.required<ElementRef<HTMLHeadingElement>>('stepHeading');

  selectStep(index: number): void {
    if (index < 0 || index >= this.steps.length) return;
    this.stepIndex.set(index);
    afterNextRender(() => this.stepHeading().nativeElement.focus(), {
      injector: this.injector
    });
  }

  previousStep(): void {
    this.selectStep(this.stepIndex() - 1);
  }

  nextStep(): void {
    this.selectStep(this.stepIndex() + 1);
  }
}
