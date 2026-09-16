import { WorkingDaysService } from './working-days.service';

describe('WorkingDaysService', () => {
  const date = (year: number, month: number, day: number) =>
    new Date(year, month - 1, day);

  const createService = (teamName: string | null, holidays: Date[] = []) => {
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
        holidays.some((holiday) => holiday.getTime() === value.getTime())
          ? { date: value }
          : null,
      ),
    } as any;

    return {
      service: new WorkingDaysService(prisma, holidayService),
      holidayService,
    };
  };

  it('treats normal Monday-Friday as working and Saturday/Sunday as non-working', async () => {
    const { service } = createService(null);

    await expect(
      service.getWorkingDates(7, [
        date(2026, 9, 4),
        date(2026, 9, 5),
        date(2026, 9, 6),
      ]),
    ).resolves.toEqual([date(2026, 9, 4)]);
  });

  it('treats Sales Saturday as working but Sunday as non-working', async () => {
    const { service } = createService('SALES');

    await expect(
      service.getWorkingDates(7, [date(2026, 9, 5), date(2026, 9, 6)]),
    ).resolves.toEqual([date(2026, 9, 5)]);
  });

  it('excludes holidays for normal weekdays and Sales Saturdays', async () => {
    const normal = date(2026, 9, 4);
    const salesSaturday = date(2026, 9, 5);
    const normalService = createService(null, [normal]);
    const salesService = createService('SALES', [salesSaturday]);

    await expect(normalService.service.getWorkingDates(7, [normal])).resolves.toEqual([]);
    await expect(salesService.service.getWorkingDates(7, [salesSaturday])).resolves.toEqual([]);
  });

  it('excludes a holiday regardless of its stored location', async () => {
    const holidayDate = date(2026, 9, 4);
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          city: 'Pune',
          team: null,
        }),
      },
    } as any;
    const holidayService = {
      isHoliday: jest.fn().mockResolvedValue({
        date: holidayDate,
        location: 'Mumbai',
      }),
    } as any;
    const service = new WorkingDaysService(prisma, holidayService);

    await expect(service.getWorkingDates(7, [holidayDate])).resolves.toEqual([]);
    expect(holidayService.isHoliday).toHaveBeenCalledWith(holidayDate);
  });

  it('uses the Asia/Kolkata weekday at a UTC date boundary', async () => {
    const { service } = createService(null);

    await expect(
      service.getWorkingDates(7, [
        new Date('2026-09-05T18:30:00.000Z'),
        new Date('2026-09-06T18:30:00.000Z'),
      ]),
    ).resolves.toEqual([new Date('2026-09-06T18:30:00.000Z')]);
  });
});