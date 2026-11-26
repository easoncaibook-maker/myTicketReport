import { describe, expect, it } from 'vitest';
import { verifySliderPosition } from '../src/auth/slider';

describe('自研滑块校验', () => {
  it('允许 ±8px 误差', () => {
    expect(verifySliderPosition(120, 120)).toBe(true);
    expect(verifySliderPosition(120, 128)).toBe(true);
    expect(verifySliderPosition(120, 112)).toBe(true);
    expect(verifySliderPosition(120, 129)).toBe(false);
    expect(verifySliderPosition(120, 111)).toBe(false);
  });

  it('拒绝越界与非法输入', () => {
    expect(verifySliderPosition(120, -1)).toBe(false);
    expect(verifySliderPosition(120, 999)).toBe(false);
    expect(verifySliderPosition(120, 'abc')).toBe(false);
    expect(verifySliderPosition(120, null)).toBe(false);
    expect(verifySliderPosition(120, undefined)).toBe(false);
  });
});
