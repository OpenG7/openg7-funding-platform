export interface AdminContributionsBrowser {
  selectContribution(contributionId: string): void;
  saveCsv(csv: string): void;
}

/** Browser resources are resolved only at an explicit action boundary. */
export function adminContributionsBrowser(): AdminContributionsBrowser | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  return {
    selectContribution: (contributionId) => {
      const url = new URL(window.location.href);
      url.searchParams.set('contributionId', contributionId);
      window.history.replaceState({}, '', url);
    },
    saveCsv: (csv) => {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'openg7-admin-contributions.csv';
        link.click();
      } finally {
        window.URL.revokeObjectURL(url);
      }
    }
  };
}
