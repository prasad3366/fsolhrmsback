import { HolidaysService } from './holidays.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';

describe('Holiday optional flag working-day behavior', () => {
  const date = new Date(2026, 0, 1);

  const createWorkingDaysService = (isOptional: boolean) => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, team: null }),
      },
    } as any;
    const holidayService = {
      isHoliday: jest.fn().mockResolvedValue({ date, isOptional }),
    } as Pick<HolidaysService, 'isHoliday'>;

    return new WorkingDaysService(prisma, holidayService as HolidaysService);
  };

  it('excludes optional and mandatory Holidays identically', async () => {
    const mandatoryResult = await createWorkingDaysService(false).getWorkingDates(7, [date]);
    const optionalResult = await createWorkingDaysService(true).getWorkingDates(7, [date]);

    expect(mandatoryResult).toEqual([]);
    expect(optionalResult).toEqual(mandatoryResult);
  });
});