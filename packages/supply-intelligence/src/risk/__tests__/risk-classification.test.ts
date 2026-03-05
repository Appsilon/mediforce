import { describe, it, expect } from 'vitest';
import { classifyRisk } from '../risk-classification.js';
import type { RiskConfig } from '../../schemas/risk-config.js';

/** Standard test config matching DEFAULT_RISK_CONFIG */
const CONFIG: RiskConfig = {
  id: 'test',
  expiryRedThresholdCents: 500_000,       // EUR 5,000
  expiryOrangeThresholdCents: 100_000,    // EUR 1,000
  stockoutRedThresholdCents: 1_000_000,   // EUR 10,000
  stockoutOrangeThresholdCents: 250_000,  // EUR 2,500
  urgentExpiryDays: 30,
  urgentStockoutWeeks: 1,
};

describe('classifyRisk', () => {
  it('red via expiry threshold', () => {
    const result = classifyRisk(600_000, 0, 90, null, CONFIG);
    expect(result).toBe('red');
  });

  it('red via stockout threshold', () => {
    const result = classifyRisk(0, 1_500_000, 90, null, CONFIG);
    expect(result).toBe('red');
  });

  it('red via urgent expiry — low risk but expiring soon', () => {
    // expiryRiskCents = 50,000 (below red threshold)
    // but nearestExpiryDays = 20 (< 30 urgent threshold) and risk > 0
    const result = classifyRisk(50_000, 0, 20, null, CONFIG);
    expect(result).toBe('red');
  });

  it('red via urgent stockout — low risk but stockout in week 1', () => {
    // stockoutRiskCents = 10,000 (below thresholds)
    // but firstStockoutWeek = 1 (<= urgentStockoutWeeks = 1)
    const result = classifyRisk(0, 10_000, 90, 1, CONFIG);
    expect(result).toBe('red');
  });

  it('orange via expiry threshold', () => {
    // expiryRiskCents = 150,000 (> 100,000 orange, < 500,000 red)
    const result = classifyRisk(150_000, 0, 90, null, CONFIG);
    expect(result).toBe('orange');
  });

  it('orange via stockout threshold', () => {
    // stockoutRiskCents = 500,000 (> 250,000 orange, < 1,000,000 red)
    const result = classifyRisk(0, 500_000, 90, null, CONFIG);
    expect(result).toBe('orange');
  });

  it('green — both risks below orange thresholds, no urgency', () => {
    const result = classifyRisk(50_000, 100_000, 90, null, CONFIG);
    expect(result).toBe('green');
  });

  it('custom config — different thresholds change classification', () => {
    const strictConfig: RiskConfig = {
      id: 'strict',
      expiryRedThresholdCents: 50_000,       // Much lower red
      expiryOrangeThresholdCents: 10_000,     // Much lower orange
      stockoutRedThresholdCents: 100_000,
      stockoutOrangeThresholdCents: 25_000,
      urgentExpiryDays: 60,                   // Wider urgency window
      urgentStockoutWeeks: 2,
    };

    // Same risk values that would be green with default config
    // are now red with strict config
    const result = classifyRisk(50_000, 0, 90, null, strictConfig);
    expect(result).toBe('red'); // 50,000 >= 50,000 red threshold

    // Values that are orange with strict config
    const result2 = classifyRisk(15_000, 0, 90, null, strictConfig);
    expect(result2).toBe('orange'); // 15,000 >= 10,000 orange

    // Urgency trigger with wider window
    const result3 = classifyRisk(5_000, 0, 45, null, strictConfig);
    expect(result3).toBe('red'); // 45 < 60 days urgent, risk > 0
  });

  it('urgent expiry with zero risk does NOT trigger red', () => {
    // nearestExpiryDays = 10 (urgent) but expiryRiskCents = 0
    // Zero risk means nothing at risk — urgency doesn't apply
    const result = classifyRisk(0, 0, 10, null, CONFIG);
    expect(result).toBe('green');
  });

  it('urgent stockout with zero stockout risk does NOT trigger red', () => {
    // firstStockoutWeek = 1 (urgent) but stockoutRiskCents = 0
    // This shouldn't happen in practice, but handle defensively
    const result = classifyRisk(0, 0, 90, 1, CONFIG);
    expect(result).toBe('green');
  });
});
