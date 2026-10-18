import {
  createActionGroup,
  createFeature,
  createReducer,
  createSelector,
  on,
  props,
  emptyProps
} from '@ngrx/store';
import type {
  AdminCampaignsQuery,
  AdminCampaignsResponse
} from '@openg7/funding-core';

export const DEFAULT_CAMPAIGNS_QUERY: AdminCampaignsQuery = {
  page: 1,
  pageSize: 25,
  sort: 'preparation',
  direction: 'desc'
};

export type AdminCampaignsStatus =
  'idle' | 'loading' | 'ready' | 'error' | 'forbidden' | 'unavailable';

export interface AdminCampaignsState {
  readonly query: AdminCampaignsQuery;
  readonly data: AdminCampaignsResponse | null;
  readonly status: AdminCampaignsStatus;
  readonly selectedId: string | null;
  readonly requestGeneration: number;
  /** Non-secret identity scope; never a credential or a browser-persisted value. */
  readonly sessionKey: string | null;
  readonly dataRevision: number;
}

export const initialAdminCampaignsState: AdminCampaignsState = {
  query: DEFAULT_CAMPAIGNS_QUERY,
  data: null,
  status: 'idle',
  selectedId: null,
  requestGeneration: 0,
  sessionKey: null,
  dataRevision: 0
};

export const adminCampaignsActions = createActionGroup({
  source: 'Admin Campaigns',
  events: {
    Synchronized: props<{ sessionKey: string | null; revision: number }>(),
    'Load Requested': props<{ query: AdminCampaignsQuery }>(),
    'Load Succeeded': props<{
      requestGeneration: number;
      sessionKey: string;
      response: AdminCampaignsResponse;
    }>(),
    'Load Failed': props<{
      requestGeneration: number;
      sessionKey: string;
      status: 'error' | 'forbidden' | 'unavailable';
    }>(),
    Selected: props<{ id: string }>(),
    'Selection Cleared': emptyProps(),
    Detached: emptyProps()
  }
});

const matchesRequest = (
  state: AdminCampaignsState,
  request: { requestGeneration: number; sessionKey: string }
) =>
  state.status === 'loading' &&
  state.requestGeneration === request.requestGeneration &&
  state.sessionKey === request.sessionKey;

export const adminCampaignsFeature = createFeature({
  name: 'adminCampaigns',
  reducer: createReducer(
    initialAdminCampaignsState,
    on(adminCampaignsActions.synchronized, (state, input) => {
      if (
        state.sessionKey !== input.sessionKey ||
        (input.sessionKey === null && state.status !== 'forbidden')
      )
        return {
          ...initialAdminCampaignsState,
          query: { ...DEFAULT_CAMPAIGNS_QUERY },
          sessionKey: input.sessionKey,
          dataRevision: input.revision,
          status: input.sessionKey ? ('idle' as const) : ('forbidden' as const),
          requestGeneration: state.requestGeneration + 1
        };
      if (state.dataRevision !== input.revision)
        return {
          ...state,
          data: null,
          status: input.sessionKey ? ('idle' as const) : ('forbidden' as const),
          dataRevision: input.revision,
          requestGeneration: state.requestGeneration + 1
        };
      return state;
    }),
    on(adminCampaignsActions.loadRequested, (state, { query }) =>
      state.sessionKey
        ? {
            ...state,
            query: { ...query },
            data: null,
            status: 'loading' as const,
            requestGeneration: state.requestGeneration + 1
          }
        : state
    ),
    on(adminCampaignsActions.loadSucceeded, (state, input) =>
      matchesRequest(state, input)
        ? {
            ...state,
            data: input.response,
            status: 'ready' as const,
            selectedId: input.response.items.some(
              (item) => item.id === state.selectedId
            )
              ? state.selectedId
              : null
          }
        : state
    ),
    on(adminCampaignsActions.loadFailed, (state, input) =>
      matchesRequest(state, input)
        ? { ...state, data: null, selectedId: null, status: input.status }
        : state
    ),
    on(adminCampaignsActions.selected, (state, { id }) =>
      state.status === 'ready' &&
      state.data?.items.some((item) => item.id === id)
        ? { ...state, selectedId: id }
        : state
    ),
    on(adminCampaignsActions.selectionCleared, (state) => ({
      ...state,
      selectedId: null
    })),
    on(adminCampaignsActions.detached, (state) => ({
      ...state,
      status: state.status === 'loading' ? ('idle' as const) : state.status,
      requestGeneration: state.requestGeneration + 1
    }))
  )
});

export const selectAdminCampaignsSelected = createSelector(
  adminCampaignsFeature.selectData,
  adminCampaignsFeature.selectSelectedId,
  (data, selectedId) =>
    data?.items.find((item) => item.id === selectedId) ?? null
);
