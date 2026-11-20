'use strict';

const {
  parseIntParam,
  parseLimit,
  parsePageParams,
  parsePagination,
  MAX_VERIFY_LIMIT,
} = require('../../lib/pagination');

describe('parseLimit (politica unica)', () => {
  const opts = { def: 50, max: 200 };

  it.each([
    [undefined, 50],
    [null, 50],
    ['', 50],
    ['abc', 50],
    [['1', '2'], 50],
    [{}, 50],
    ['NaN', 50],
    ['Infinity', 50],
    ['0', 50],
    ['-5', 1],
    ['0.5', 1],
    ['2.7', 2],
    [3.9, 3],
    ['10', 10],
    ['200', 200],
    ['201', 200],
    ['999999999', 200],
  ])('%j → %i', (raw, expected) => {
    expect(parseLimit(raw, opts)).toBe(expected);
  });

  it('belowMin=default: valori < min tornano al default', () => {
    expect(parseLimit('-5', { ...opts, belowMin: 'default' })).toBe(50);
    expect(parseLimit('0.5', { ...opts, belowMin: 'default' })).toBe(50);
  });

  it('def undefined: assente/non numerico → undefined (decide il chiamante)', () => {
    expect(parseLimit(undefined, { def: undefined, max: 10 })).toBeUndefined();
    expect(parseLimit('abc', { def: undefined, max: 10 })).toBeUndefined();
    expect(parseLimit('50', { def: undefined, max: 10 })).toBe(10);
  });

  it('usa default 100 / max 500 se non specificati', () => {
    expect(parseLimit(undefined)).toBe(100);
    expect(parseLimit('9999')).toBe(500);
  });
});

describe('parseIntParam', () => {
  it('senza max non applica tetto', () => {
    expect(parseIntParam('123456789', { def: 1 })).toBe(123456789);
  });
});

describe('parsePageParams', () => {
  it('default e clamp', () => {
    expect(parsePageParams({})).toEqual({ page: 1, pageSize: 50, offset: 0 });
    expect(parsePageParams({ page: '0', pageSize: '-1' })).toMatchObject({ page: 1, pageSize: 1 });
    expect(parsePageParams({ page: '3', pageSize: '999' })).toEqual({
      page: 3,
      pageSize: 200,
      offset: 400,
    });
    expect(parsePageParams({ page: '2.9', pageSize: '10.5' })).toMatchObject({
      page: 2,
      pageSize: 10,
    });
  });

  it('opzioni custom', () => {
    expect(
      parsePageParams({ pageSize: '99' }, { defaultPageSize: 20, maxPageSize: 30 }),
    ).toMatchObject({ pageSize: 30 });
    expect(parsePageParams(undefined, { defaultPageSize: 20 })).toMatchObject({ pageSize: 20 });
  });
});

describe('parsePagination (invariato)', () => {
  it('default, clamp, offset', () => {
    expect(parsePagination({})).toEqual({ limit: 100, offset: 0 });
    expect(parsePagination({ limit: '-3', offset: '-1' })).toEqual({ limit: 100, offset: 0 });
    expect(parsePagination({ limit: '0' })).toEqual({ limit: 100, offset: 0 });
    expect(parsePagination({ limit: '9999', offset: '999999' })).toEqual({
      limit: 500,
      offset: 100000,
    });
    expect(parsePagination({ limit: '12.9' })).toEqual({ limit: 12, offset: 0 });
    expect(parsePagination({ limit: '5' }, { defaultLimit: 10, maxLimit: 3 })).toEqual({
      limit: 3,
      offset: 0,
    });
  });
});

describe('MAX_VERIFY_LIMIT', () => {
  it('è un tetto generoso ma finito', () => {
    expect(MAX_VERIFY_LIMIT).toBe(1_000_000);
    expect(parseLimit('99999999', { def: undefined, max: MAX_VERIFY_LIMIT })).toBe(1_000_000);
  });
});
