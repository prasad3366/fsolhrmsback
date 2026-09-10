import { AttendanceService } from './attendance.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { HolidaysService } from '../holidays/holidays.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Attendance holiday and weekend punches', () => {
  const createService = (date: Date, holiday: boolean) => {
    const holidayService = {
      isHoliday: jest.fn().mockResolvedValue(holiday ? { date } : null),
    } as unknown as HolidaysService;

    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendanceUpsert = jest.fn().mockResolvedValue({
      id: 2,
      date,
      punchIn: new Date(),
    });

    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          userId: 70,
          status: 'ACTIVE',
          team: null,
          user: { email: 'test@example.com' },
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          userId: 70,
          status: 'ACTIVE',
          team: null,
          user: { email: 'test@example.com' },
        }),
      },
      attendanceRecord: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ id: 2, date, clockIn: new Date() }),
        update: jest.fn(),
      },
      attendancePolicy: {
        upsert: jest.fn().mockResolvedValue({
          shiftStartTime: '09:00',
          shiftEndTime: '18:00',
          gracePeriodMins: 15,
          earlyCheckoutMins: 30,
          halfDayHours: 4,
        }),
      },
      attendance: {
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValue({
          id: 2,
          employeeId: 7,
          clockIn: new Date(),
          clockOut: null,
        }),
        upsert: attendanceUpsert,
      },
      attendanceLog: { create: attendanceLogCreate },
      wFHRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      officeLocation: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(
        async (callback: (tx: PrismaService) => unknown) => {
          return await callback(prisma);
        },
      ),
    } as unknown as PrismaService;

    const workingDaysService = new WorkingDaysService(prisma, holidayService);
    const service = new AttendanceService(
      prisma,
      holidayService,
      undefined,
      workingDaysService,
    );

    return { service, prisma, workingDaysService };
  };

  it.each([
    ['normal-team Saturday', new Date(2026, 8, 5), false],
    ['configured holiday weekday', new Date(2026, 8, 8), true],
  ])(
    'accepts %s punch-in and preserves the punch record',
    async (_label, date, holiday) => {
      const { service, prisma } = createService(date, holiday);
      const dateMatcher = expect.any(Date) as unknown as Date;
      const attendanceRecordCreate = Reflect.get(
        prisma.attendanceRecord,
        'create',
      ) as jest.Mock;
      const objectContaining = <T extends Record<string, unknown>>(value: T) =>
        expect.objectContaining(value) as unknown as T;

      await expect(service.punchIn(7, 1, 2)).resolves.toEqual(
        objectContaining({ clockIn: dateMatcher }),
      );

      expect(attendanceRecordCreate).toHaveBeenCalledWith(
        objectContaining({
          data: objectContaining({ clockIn: dateMatcher }),
        }),
      );
    },
  );

  it('keeps a holiday excluded from shared working-day calculations', async () => {
    const holidayDate = new Date(2026, 8, 8);
    const { workingDaysService } = createService(holidayDate, true);

    await expect(
      workingDaysService.getWorkingDates(7, [holidayDate]),
    ).resolves.toEqual([]);
  });
});
