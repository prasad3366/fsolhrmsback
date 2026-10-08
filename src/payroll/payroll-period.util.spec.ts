import {
  assertPayrollPeriodOpen,
  getBusinessDatesBetween,
  getPayrollPeriodDates,
  getPayrollPeriodForDate,
  getPayrollPeriodRange,
  markPayrollStale,
} from './payroll-period.util';

describe('payroll period (29th previous month -> 28th current month)', () => {
  const utc = (key: string) => new Date(`${key}T00:00:00.000Z`);

  it.each([
    ['2026-09-28', { month: 9, year: 2026 }],
    ['2026-09-29', { month: 10, year: 2026 }],
    ['2026-09-30', { month: 10, year: 2026 }],
    ['2026-10-31', { month: 11, year: 2026 }],
    ['2026-10-01', { month: 10, year: 2026 }],
    ['2026-08-29', { month: 9, year: 2026 }],
    ['2026-12-29', { month: 1, year: 2027 }],
    ['2026-12-31', { month: 1, year: 2027 }],
    ['2027-01-01', { month: 1, year: 2027 }],
    ['2027-02-28', { month: 2, year: 2027 }],
    ['2027-03-01', { month: 3, year: 2027 }],
    ['2028-02-29', { month: 3, year: 2028 }],
  ])('maps %s to payroll %j', (key, period) => {
    expect(getPayrollPeriodForDate(utc(key))).toEqual(period);
  });

  it('maps by business date (Asia/Kolkata), not UTC date', () => {
    // 28 Sep 20:00 UTC is already 29 Sep in India
    expect(getPayrollPeriodForDate(new Date('2026-09-28T20:00:00.000Z'))).toEqual({ month: 10, year: 2026 });
    expect(getPayrollPeriodForDate(new Date('2026-09-28T18:00:00.000Z'))).toEqual({ month: 9, year: 2026 });
  });

  it.each([
    [9, 2026, '2026-08-29', '2026-09-29'],
    [1, 2027, '2026-12-29', '2027-01-29'],
    [3, 2027, '2027-03-01', '2027-03-29'], // non-leap: 29 Feb does not exist
    [3, 2028, '2028-02-29', '2028-03-29'],
  ])('range for %i/%i starts %s and ends before %s', (month, year, start, endExclusive) => {
    const range = getPayrollPeriodRange(month, year);
    expect(range.startDate).toEqual(utc(start));
    expect(range.endDateExclusive).toEqual(utc(endExclusive));
    expect(range.endDate.getTime()).toBe(utc(endExclusive).getTime() - 1);
  });

  it.each([
    [9, 2026, '2026-08-29', '2026-09-28'],
    [10, 2026, '2026-09-29', '2026-10-28'],
    [1, 2027, '2026-12-29', '2027-01-28'],
    [3, 2027, '2027-03-01', '2027-03-28'],
  ])('period dates for %i/%i are %s to %s', (month, year, startDate, endDate) => {
    expect(getPayrollPeriodDates(month, year)).toEqual({ startDate, endDate });
  });

  it('consecutive periods leave no gap and no overlap, including February', () => {
    for (const [month, year] of [[2, 2027], [3, 2027], [2, 2028], [3, 2028], [12, 2026], [1, 2027]]) {
      const next = month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
      expect(getPayrollPeriodRange(month, year).endDateExclusive).toEqual(
        getPayrollPeriodRange(next.month, next.year).startDate,
      );
    }
  });

  it('every date inside a range maps back to that payroll period', () => {
    for (const [month, year] of [[9, 2026], [3, 2027], [3, 2028], [1, 2027]]) {
      // endDate is 28th 23:59:59.999 UTC (already the 29th in IST), so the
      // last business day is derived from endDateExclusive, as production code does
      const { startDate, endDateExclusive } = getPayrollPeriodRange(month, year);
      const lastDay = new Date(endDateExclusive.getTime() - 24 * 60 * 60 * 1000);
      for (const date of getBusinessDatesBetween(startDate, lastDay)) {
        expect(getPayrollPeriodForDate(date)).toEqual({ month, year });
      }
    }
  });
});

describe('payroll lock / stale helpers', () => {
  const dates = [new Date('2026-09-28T00:00:00.000Z'), new Date('2026-09-29T00:00:00.000Z')];

  it('fail closed when the client has no payroll model', async () => {
    await expect(assertPayrollPeriodOpen({}, 7, dates)).rejects.toThrow('Payroll protection unavailable');
    await expect(markPayrollStale({}, 7, dates)).rejects.toThrow('Payroll protection unavailable');
  });

  it('do nothing only when no dates are affected', async () => {
    await expect(assertPayrollPeriodOpen({}, 7, [])).resolves.toBeUndefined();
    await expect(markPayrollStale({}, 7, [])).resolves.toBeUndefined();
  });

  it('only mark DRAFT rows stale', async () => {
    const client = { payroll: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    await markPayrollStale(client, 7, dates);
    expect(client.payroll.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 7, OR: [{ month: 9, year: 2026 }, { month: 10, year: 2026 }], status: 'DRAFT' },
      data: { needsRecalculation: true },
    });
  });

  it('lock both FINALIZED and PAID rows', async () => {
    const client = { payroll: { findFirst: jest.fn().mockResolvedValue({ id: 1, month: 9, year: 2026 }) } };
    await expect(assertPayrollPeriodOpen(client, null, dates)).rejects.toThrow('Payroll for 9/2026 is finalized');
    expect(client.payroll.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['FINALIZED', 'PAID'] } }),
    }));
  });
});
