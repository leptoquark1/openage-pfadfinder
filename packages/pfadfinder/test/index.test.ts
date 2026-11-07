import { describe, expect, it } from 'vitest';
import * as library from '../src/index.ts';

describe('library', () => {
  it('exposes a module entry point', () => {
    expect(library).toBeTypeOf('object');
  });
});
