import { describe, it, expect } from 'vitest';
import { selectVariant, type ABTest, type ABTestVariant } from '../src/routing/ab-router.js';

describe('A/B Test Variant Selection', () => {
  it('returns null for empty variants', () => {
    const test: ABTest = { id: 't1', name: 'test', status: 'running', variants: [] };
    expect(selectVariant(test)).toBeNull();
  });

  it('returns the only variant when single', () => {
    const variant: ABTestVariant = {
      id: 'v1', testId: 't1', name: 'control', weight: 1.0,
    };
    const test: ABTest = { id: 't1', name: 'test', status: 'running', variants: [variant] };
    expect(selectVariant(test)).toEqual(variant);
  });

  it('returns one of the variants for multi-variant test', () => {
    const variants: ABTestVariant[] = [
      { id: 'v1', testId: 't1', name: 'A', weight: 0.5 },
      { id: 'v2', testId: 't1', name: 'B', weight: 0.5 },
    ];
    const test: ABTest = { id: 't1', name: 'test', status: 'running', variants };

    const selected = selectVariant(test);
    expect(selected).not.toBeNull();
    expect(['v1', 'v2']).toContain(selected!.id);
  });

  it('respects weights in distribution', () => {
    const variants: ABTestVariant[] = [
      { id: 'heavy', testId: 't1', name: 'Heavy', weight: 99 },
      { id: 'light', testId: 't1', name: 'Light', weight: 1 },
    ];
    const test: ABTest = { id: 't1', name: 'test', status: 'running', variants };

    // Run many iterations — heavy variant should win most
    let heavyCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (selectVariant(test)!.id === 'heavy') heavyCount++;
    }
    // Should be ~99% heavy, allow some margin
    expect(heavyCount).toBeGreaterThan(900);
  });
});
