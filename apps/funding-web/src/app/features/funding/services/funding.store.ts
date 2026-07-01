import {
  createFeature,
  createReducer,
  on,
  createActionGroup,
  props
} from '@ngrx/store';
import { ContributorRecord, FundingAllocation } from '@openg7/funding-models';

export interface FundingSharedState {
  readonly confirmedContributionTotal: number;
  readonly campaignTitle: string;
  readonly allocation: readonly FundingAllocation[];
  readonly contributors: readonly ContributorRecord[];
  readonly backendSyncState: 'idle' | 'syncing' | 'error' | 'success';
}

const initialState: FundingSharedState = {
  confirmedContributionTotal: 145,
  campaignTitle: 'Le Fonds des Bâtisseurs',
  allocation: [
    { category: 'Infrastructure ouverte', amount: 80 },
    { category: 'Outillage civique', amount: 40 },
    { category: 'Résilience interprovinciale', amount: 25 }
  ],
  contributors: [
    { id: '1', displayName: 'Montréal, QC', amount: 25, isAnonymous: false },
    { id: '2', displayName: 'Anonyme', amount: 10, isAnonymous: true }
  ],
  backendSyncState: 'idle'
};

export const fundingActions = createActionGroup({
  source: 'Funding',
  events: {
    'Set Sync State': props<{
      state: FundingSharedState['backendSyncState'];
    }>(),
    'Set Confirmed Total': props<{ amount: number }>()
  }
});

export const fundingFeature = createFeature({
  name: 'funding',
  reducer: createReducer(
    initialState,
    on(fundingActions.setSyncState, (state, payload) => ({
      ...state,
      backendSyncState: payload.state
    })),
    on(fundingActions.setConfirmedTotal, (state, payload) => ({
      ...state,
      confirmedContributionTotal: payload.amount
    }))
  )
});
