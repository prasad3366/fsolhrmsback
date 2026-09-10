import { PayrollService } from './payroll.service';

describe('PayrollService working days', () => {
  const createService = (workingDates: Date[]) => {
    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue(workingDates),
    };
    const service = new PayrollService(
      {} as any,
      {} as any,
      {} as any,
      workingDaysService as any,
    );

    return { service, workingDaysService };
  };

  const date = (day: number) => new Date(2026, 8, day);

  it.each([
    ['normal team Saturday excluded', [date(4), date(6)], [date(4)]],
    ['Sales Saturday included', [date(5)], [date(5)]],
    ['Sunday excluded', [date(6)], []],
    ['holiday excluded', [date(4)], []],
  ])('%s', async (_name, dates, workingDates) => {
    const { service, workingDaysService } = createService(workingDates);

    await expect((service as any).calculateWorkingDays(7, dates[0], dates[dates.length - 1])).resolves.toBe(
      workingDates.length,
    );
    expect(workingDaysService.getWorkingDates).toHaveBeenCalledWith(7, expect.any(Array));
  });

  it('preserves the existing payroll calculation inputs and result', () => {
    const result = require('./payroll.calculator').PayrollCalculator.calculate(
      60000,
      {
        basicPercent: 50,
        hraPercent: 40,
        conveyancePercent: 10,
        pfPercent: 12,
        ptAmount: 200,
      },
      26,
      2,
    );

    expect(result).toEqual({
      basic: 30000,
      hra: 12000,
      conveyance: 6000,
      specialAllowance: 12000,
      gross: 60000,
      pf: 3600,
      pt: 200,
      lopDays: 2,
      leaveDeduction: 4615,
      deductions: 8415,
      netSalary: 51585,
    });
  });
});