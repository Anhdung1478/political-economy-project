import { describe, expect, it } from 'vitest';
import { fmtCountdown, fmtMoney, fmtMoneySigned, fmtNumber, fmtPercent, fmtSeconds, secondsLeft } from './format';

describe('game formatters', () => {
  it('writes numbers Vietnamese style', () => {
    expect(fmtNumber(1250)).toBe('1.250');
    expect(fmtNumber(27.5)).toBe('27,5');
    expect(fmtNumber(-3)).toBe('−3');
    expect(fmtNumber(-0.01)).toBe('0');
    expect(fmtNumber(1234567.25, 2)).toBe('1.234.567,25');
  });

  it('writes money in thousand đồng', () => {
    expect(fmtMoney(30)).toBe('30k');
    expect(fmtMoney(27.5)).toBe('27,5k');
    expect(fmtMoney(-40)).toBe('−40k');
    expect(fmtMoney(1250)).toBe('1.250k');
    expect(fmtMoneySigned(12)).toBe('+12k');
    expect(fmtMoneySigned(-7.5)).toBe('−7,5k');
    expect(fmtMoneySigned(0)).toBe('0k');
  });

  it('writes percents', () => {
    expect(fmtPercent(0.45)).toBe('45%');
    expect(fmtPercent(0.125, 1)).toBe('12,5%');
  });

  it('writes the rush countdown', () => {
    expect(secondsLeft(900)).toBe(90);
    expect(secondsLeft(1)).toBe(1);
    expect(secondsLeft(0)).toBe(0);
    expect(secondsLeft(-5)).toBe(0);
    expect(fmtCountdown(90)).toBe('1:30');
    expect(fmtCountdown(5)).toBe('0:05');
    expect(fmtCountdown(4.2)).toBe('0:05');
    expect(fmtSeconds(25)).toBe('25 giây');
  });
});
