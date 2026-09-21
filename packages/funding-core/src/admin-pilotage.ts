import type {
  AdminAttentionSeverity,
  AdminExpenseRecord,
  PublicationDelivery,
  PublicationFeed
} from './index.js';

export type PilotDomain =
  | 'publications'
  | 'sponsors'
  | 'email'
  | 'invoices'
  | 'contributions'
  | 'projects'
  | 'operations';
export type PilotAction =
  | 'programme.apply'
  | 'editorial.preferences'
  | 'publication.repair'
  | 'publication.approve'
  | 'publication.reject'
  | 'publication.edit'
  | 'feed.pause'
  | 'feed.resume'
  | 'sponsor.approve'
  | 'sponsor.reject'
  | 'email.retry'
  | 'project.publish'
  | 'project.hide';
export interface PilotDecision {
  id: string;
  domain: PilotDomain;
  kind: string;
  targetId: string;
  version: string;
  title: string;
  severity: AdminAttentionSeverity;
  dueAt: string | null;
  detailsUrl: string;
  facts: { label: string; value: string }[];
  actions: { id: PilotAction; blocked: string | null }[];
  publication?: PublicationDelivery;
  project?: AdminExpenseRecord;
  sponsor?: {
    id: string;
    name: string;
    status: string;
    presentationId: string | null;
    presentationApproved: boolean;
  };
  email?: { subject: string; text: string; recipient: string };
  inspection?: {
    kind: 'stripe' | 'invoice';
    id: string;
    contributionId?: string;
  };
}
export interface PilotState {
  generatedAt: string;
  coverage: 'complete' | 'partial';
  missingSources: string[];
  total: number;
  page: number;
  pageSize: number;
  focusPage?: number;
  domains: Record<PilotDomain, number>;
  decisions: PilotDecision[];
  feeds: (PublicationFeed & { version: string })[];
  workerEnabled: boolean;
  writable: boolean;
}
export interface PilotCommand {
  requestId: string;
  action: PilotAction;
  targetId: string;
  version: string;
  confirmation: string;
  payload?: {
    message?: string;
    scheduledAt?: string;
    mediaId?: string | null;
    approveSponsors?: { id: string; version: string }[];
    reason?: string;
    editorialIntent?: import('./editorial-programme.js').EditorialIntent;
    preferences?: import('./editorial-programme.js').EditorialIntent[];
    moves?: import('./editorial-programme.js').ProgrammeMove[];
  };
}
export interface PilotReceipt {
  requestId: string;
  status: 'executing' | 'completed' | 'failed' | 'uncertain';
  action: PilotAction;
  targetId: string;
  code: string | null;
  reviewedAt?: string | null;
}
