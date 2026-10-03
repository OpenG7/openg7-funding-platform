import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { FundTransparencyPublicResponse } from '@openg7/funding-core';

@Component({
  selector: 'openg7-funding-transparency-allocations',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-transparency-allocations.component.html',
  styleUrl: './funding-transparency-allocations.component.css'
})
export class FundingTransparencyAllocationsComponent {
  readonly allocations =
    input.required<
      readonly FundTransparencyPublicResponse['latest_public_allocations'][number][]
    >();
  readonly hasSnapshot = input.required<boolean>();
  readonly aboutPath = input.required<string>();
  readonly formatMoney =
    input.required<(value: number, currency: string) => string>();
  readonly formatDate =
    input.required<(value: string | null | undefined) => string>();
}
