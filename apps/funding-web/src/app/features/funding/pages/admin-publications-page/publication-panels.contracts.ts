export type PublicationLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface PublicationAutomationTarget {
  readonly batchId: string;
  readonly feedId: string;
}
