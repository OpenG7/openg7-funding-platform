import type {
  AdminAccessAccount,
  AdminAccessResponse
} from '../../services/funding-admin.service.js';

export type AdminAccessSession = AdminAccessResponse['sessions'][number];

type EditableAccessFields = Pick<
  AdminAccessAccount,
  'subject' | 'displayName' | 'role' | 'disabled'
>;

/** Presentation emits changes; the page owns the draft and its confirmation. */
export type AdminAccessFieldChange = {
  [K in keyof EditableAccessFields]: {
    readonly field: K;
    readonly value: EditableAccessFields[K];
  };
}[keyof EditableAccessFields];

export interface AdminAccessSessionSelection {
  readonly sessionId: string;
  readonly trigger: HTMLButtonElement;
}
