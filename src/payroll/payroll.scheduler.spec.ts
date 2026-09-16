import { PayrollScheduler } from './payroll.scheduler';
import { WorkingDaysService } from '../common/working-days/working-days.service';

describe('PayrollScheduler approved leave working-day calculation', () => {
  const date = (year: number, month: number, day: number) => new Date(year, month - 1, day);

  const createScheduler = (teamName: string | null, holidayDates: Date[] = []) => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          team: teamName ? { name: teamName } : null,
        }),
      },
    } as any;
    const holidayService = {
      isHoliday: jest.fn(async (value: Date) =>
        holidayDates.some((holiday) => holiday.getTime() === value.getTime())
          ? { date: value }
          : null,
      ),
    } as any;
    const workingDaysService = new WorkingDaysService(prisma, holidayService);
    const scheduler = new PayrollScheduler({} as any, workingDaysService);

    return { scheduler, workingDaysService };
  };

  it.each([
    ['Monday-Friday leave', null, [date(2026, 9, 1), date(2026, 9, 2)], 2],
    ['Sunday leave', null, [date(2026, 9, 6)], 0],
    ['non-Sales Saturday leave', null, [date(2026, 9, 5)], 0],
    ['Sales Saturday leave', 'SALES', [date(2026, 9, 5)], 1],
    ['holiday leave', null, [date(2026, 9, 1)], 0],
  ])('%s uses canonical eligible dates', async (_name, teamName, leaveDates, expected) => {
    const holidayDates = _name === 'holiday leave' ? leaveDates : [];
    const { scheduler } = createScheduler(teamName, holidayDates);

    await expect(
      (scheduler as any).calculateApprovedLeaveDays(
        7,
        [{ startDate: leaveDates[0], endDate: leaveDates[leaveDates.length - 1], status: 'APPROVED' }],
        date(2026, 9, 1),
        date(2026, 9, 30),
      ),
    ).resolves.toBe(expected);
  });

  it('does not use Leave.totalDays for approved leave totals', async () => {
    const { scheduler, workingDaysService } = createScheduler(null);
    const getWorkingDates = jest.spyOn(workingDaysService, 'getWorkingDates');

    await expect(
      (scheduler as any).calculateApprovedLeaveDays(
        7,
        [{ startDate: date(2026, 9, 5), endDate: date(2026, 9, 6), status: 'APPROVED', totalDays: 99 }],
        date(2026, 9, 1),
        date(2026, 9, 30),
      ),
    ).resolves.toBe(0);

    expect(getWorkingDates).toHaveBeenCalledWith(7, [expect.any(Date), expect.any(Date)]);
  });
});