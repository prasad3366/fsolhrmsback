import { PayrollCalculator } from './payroll.calculator';

describe('PayrollCalculator gross-based structure', () => {
  const standardGrossStructure = { basicPercent: 35, hraPercent: 40, conveyancePercent: 0, conveyanceAmount: 2000, pfPercent: 12, ptAmount: 200 };

  it('splits ₹50,000 Gross into Basic, HRA, fixed Conveyance and a balancing Special Allowance', () => {
    const result = PayrollCalculator.calculate(50000, standardGrossStructure, 21, 0);

    expect(result).toEqual(expect.objectContaining({
      gross: 50000,
      basic: 17500,
      hra: 7000,
      conveyance: 2000,
      specialAllowance: 23500,
    }));
    expect(result.basic + result.hra + result.conveyance + result.specialAllowance).toBe(result.gross);
  });

  it('keeps PF and PT rules unchanged (PF on Basic, flat PT)', () => {
    expect(PayrollCalculator.calculate(50000, standardGrossStructure, 21, 0)).toEqual(
      expect.objectContaining({ pf: 2100, pt: 200, deductions: 2300, netSalary: 47700 }),
    );
  });

  it('uses Gross as the LOP basis', () => {
    // 1 LOP day: 50,000 / 21 = 2,380.95 -> 2,381
    expect(PayrollCalculator.calculate(50000, standardGrossStructure, 21, 1)).toEqual(
      expect.objectContaining({ leaveDeduction: 2381 }),
    );
  });

  it('keeps the legacy percentage conveyance for structures without a fixed amount', () => {
    const legacy = { basicPercent: 50, hraPercent: 40, conveyancePercent: 10, pfPercent: 12, ptAmount: 200 };
    expect(PayrollCalculator.calculate(60000, legacy, 26, 2)).toEqual(expect.objectContaining({
      basic: 30000, hra: 12000, conveyance: 6000, specialAllowance: 12000, gross: 60000, leaveDeduction: 4615,
    }));
    expect(PayrollCalculator.calculate(60000, { ...legacy, conveyanceAmount: null }, 26, 2).conveyance).toBe(6000);
  });

  it('reports a negative Special Allowance when components exceed Gross', () => {
    expect(PayrollCalculator.calculate(3000, standardGrossStructure, 21, 0).specialAllowance).toBeLessThan(0);
  });
});
