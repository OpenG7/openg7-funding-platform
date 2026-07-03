export const normalizeProgress = (value: number): number =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;

export const computeGlowIntensity = (progress: number): number => {
  const normalized = normalizeProgress(progress) / 100;
  return 0.22 + normalized * 0.56;
};

export const computeGlowSpread = (progress: number): number => {
  const normalized = normalizeProgress(progress) / 100;
  return 26 + normalized * 44;
};

export const isPresetSelected = (
  selectedAmount: number,
  amount: number
): boolean => selectedAmount === amount;
