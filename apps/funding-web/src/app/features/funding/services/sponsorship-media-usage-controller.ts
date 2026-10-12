import { signal } from '@angular/core';
import type {
  SponsorMediaAsset,
  SponsorMediaPreference,
  SponsorMediaUsageRights,
  SponsorMediaUsageRequest,
  SponsorMediaPreferenceRequest
} from '@openg7/funding-core';

import { SponsorshipFollowupError } from '../models/sponsorship-followup-ui.js';
import { sponsorMediaMutationRejection } from '../models/sponsor-media-mutation-outcome.js';

import type { FundingService } from './funding.service.js';

interface Ports {
  readonly service: Pick<
    FundingService,
    'updateSponsorshipMediaUsage' | 'requestSponsorshipMediaPreference'
  >;
  readonly token: () => string;
  readonly assets: () => readonly SponsorMediaAsset[];
  readonly preference: () => SponsorMediaPreference;
  readonly isBrowser: () => boolean;
  readonly refresh: () => Promise<void>;
  readonly busyChange: (busy: boolean) => void;
  readonly confirmWithdrawal: () => boolean;
}
type Pending =
  | {
      readonly token: string;
      readonly kind: 'usage';
      readonly payload: SponsorMediaUsageRequest;
    }
  | {
      readonly token: string;
      readonly kind: 'preference';
      readonly payload: SponsorMediaPreferenceRequest;
    };

/** A private image mutation retains its exact request after an uncertain response. */
export class SponsorshipMediaUsageController {
  readonly busy = signal(false);
  readonly notice = signal('');
  readonly pending = signal<Pending | null>(null);
  readonly correction = signal('');
  private generation = 0;
  private disposed = false;
  constructor(private readonly ports: Ports) {}
  async updateUsage(
    asset: SponsorMediaAsset,
    usage: SponsorMediaUsageRights
  ): Promise<void> {
    if (!this.currentAsset(asset) || !this.ports.isBrowser()) return;
    await this.submit({
      kind: 'usage',
      token: this.ports.token(),
      payload: {
        token: this.ports.token(),
        assetId: asset.id,
        expectedVersion: asset.version,
        requestId: globalThis.crypto.randomUUID(),
        confirmed: true,
        usage: structuredClone(usage)
      }
    });
  }
  async withdraw(asset: SponsorMediaAsset): Promise<void> {
    if (
      !this.currentAsset(asset) ||
      !this.ports.isBrowser() ||
      !this.ports.confirmWithdrawal()
    )
      return;
    await this.updateUsage(asset, {
      ...(asset.usage ?? {
        channels: [],
        targets: [],
        transformations: [],
        credit: null,
        restrictions: null
      }),
      state: 'withdrawn'
    });
  }
  async propose(asset: SponsorMediaAsset | null): Promise<void> {
    if (
      !this.ports.isBrowser() ||
      (asset &&
        (!this.currentAsset(asset) || asset.kind !== 'supporting_image'))
    )
      return;
    const correction = this.correction().trim() || null;
    if (correction && correction.length < 10) return;
    await this.submit({
      kind: 'preference',
      token: this.ports.token(),
      payload: {
        token: this.ports.token(),
        requestId: globalThis.crypto.randomUUID(),
        expectedRevision: this.ports.preference().revision,
        assetId: asset?.id ?? null,
        correction,
        confirmed: true
      }
    });
  }
  async retry(): Promise<void> {
    const pending = this.pending();
    if (pending) await this.send(pending);
  }
  reset(): void {
    this.generation++;
    this.pending.set(null);
    this.notice.set('');
    this.correction.set('');
    this.setBusy(false);
  }
  dispose(): void {
    this.disposed = true;
    this.reset();
  }
  private currentAsset(asset: SponsorMediaAsset): boolean {
    return (
      !this.disposed &&
      !this.busy() &&
      this.ports
        .assets()
        .some(
          (current) =>
            current.id === asset.id && current.version === asset.version
        )
    );
  }
  private async submit(candidate: Pending): Promise<void> {
    if (this.disposed || this.busy()) return;
    const pending = this.pending();
    if (pending) {
      const payload = {
        ...candidate.payload,
        requestId: pending.payload.requestId
      };
      if (
        pending.kind !== candidate.kind ||
        JSON.stringify(payload) !== JSON.stringify(pending.payload)
      ) {
        this.notice.set('verificationRequired');
        return;
      }
      await this.send(pending);
      return;
    }
    const captured = structuredClone(candidate);
    this.pending.set(captured);
    await this.send(captured);
  }
  private async send(pending: Pending): Promise<void> {
    if (this.disposed || this.busy() || pending.token !== this.ports.token())
      return;
    const generation = this.generation;
    this.setBusy(true);
    this.notice.set('');
    try {
      const result =
        pending.kind === 'usage'
          ? await this.ports.service.updateSponsorshipMediaUsage(
              pending.payload
            )
          : await this.ports.service.requestSponsorshipMediaPreference(
              pending.payload
            );
      if (
        generation !== this.generation ||
        this.disposed ||
        pending.token !== this.ports.token()
      )
        return;
      if (!result.updated) throw new Error('Image mutation is not confirmed.');
      this.pending.set(null);
      this.notice.set(pending.kind === 'usage' ? 'saved' : 'preferenceSent');
      if (pending.kind === 'preference') this.correction.set('');
      await this.ports.refresh();
    } catch (error) {
      if (
        generation === this.generation &&
        !this.disposed &&
        pending.token === this.ports.token()
      ) {
        const rejection =
          error instanceof SponsorshipFollowupError
            ? sponsorMediaMutationRejection(error.status, error.code)
            : null;
        if (rejection) {
          this.pending.set(null);
          this.notice.set(rejection);
          try {
            await this.ports.refresh();
          } catch {
            // A failed read does not make this confirmed refusal uncertain.
          }
        } else this.notice.set('mutationUnavailable');
      }
    } finally {
      if (generation === this.generation && !this.disposed) this.setBusy(false);
    }
  }
  private setBusy(busy: boolean): void {
    this.busy.set(busy);
    this.ports.busyChange(busy);
  }
}
