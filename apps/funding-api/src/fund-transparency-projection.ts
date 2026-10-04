export const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));
export const parseDbInt = (value: string): number => Number.parseInt(value, 10);
