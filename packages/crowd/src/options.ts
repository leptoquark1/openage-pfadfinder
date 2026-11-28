/** Option validation shared by the strategies. */

export function positive(name: string, value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a positive number, got ${value}`);
  }
  return value;
}

export function nonNegative(name: string, value: number): number {
  if (!(value >= 0) || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a non-negative number, got ${value}`);
  }
  return value;
}
