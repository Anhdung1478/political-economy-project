import { describe, expect, it } from 'vitest';
import { makeShopName } from './names';
import { mulberry32 } from './random';

describe('makeShopName', () => {
  it('always includes the nickname', () => {
    const r = mulberry32(5);
    for (let i = 0; i < 50; i++) expect(makeShopName('Dũng', r)).toContain('Dũng');
  });
});
