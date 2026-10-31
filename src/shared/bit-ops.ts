export function hasFlag(value: number, mask: number): boolean {
  return (value & mask) !== 0;
}

export function setFlag(value: number, mask: number): number {
  return value | mask;
}

export function clearFlag(value: number, mask: number): number {
  return value & ~mask;
}

export function toggleFlag(value: number, mask: number): number {
  return value ^ mask;
}
