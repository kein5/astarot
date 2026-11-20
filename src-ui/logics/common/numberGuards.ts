// Number.isInteger and Number.isSafeInteger as type guards. TypeScript declares both as
// (number: unknown) => boolean, so after a check the code still sees the value as possibly missing;
// these answer the same and say that the value is a number.
export const isInteger = (value: unknown): value is number => Number.isInteger(value);
export const isSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value);
