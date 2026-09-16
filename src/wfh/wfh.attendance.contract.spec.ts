import { AttendanceService } from '../attendance/attendance.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { WfhService } from './wfh.service';

describe('WFH approval and canonical attendance contract', () => {
  const businessDate = new Date(2026, 7, 4);

  const approveWfh = async () => {
    const attendanceRecord = {
      create: jest.fn(),
      update: jest.fn(),
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        wFHRequest: {
          findUnique: jest.fn().mockResolvedValue({
            id: 7,
            employeeId: 11,
            status: 'PENDING',
            startDate: businessDate,
            endDate: businessDate,
          }),
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue({ id: 7, status: 'APPROVED' }),
        },
      })),
      wFHRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          employeeId: 11,
          status: 'APPROVED',
          employee: { userId: 42 },
        }),
      },
      attendanceRecord,
    } as any;
    const service = new WfhService(
      prisma,
      {} as any,
      {} as any,
      {
        resolveActionItemsForEntity: jest.fn(),
        createNotification: jest.fn(),
      } as any,
    );

    await expect(service.approve(7)).resolves.toEqual({ id: 7, status: 'APPROVED' });
    return { prisma, attendanceRecord };
  };

  const attendanceFor = async (hours?: number) => {
    const attendanceRecord = {
      findMany: jest.fn().mockResolvedValue(
        hours === undefined
          ? []
          : [{
              userId: 42,
              date: businessDate,
              clockIn: new Date(2026, 7, 4, 9),
              clockOut: new Date(2026, 7, 4, 9 + hours),
              status: 'PRESENT',
            }],
      ),
    };
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 11, userId: 42 }),
      },
      attendanceRecord,
      leave: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue([businessDate]),
    } as unknown as WorkingDaysService;
    const service = new AttendanceService(
      prisma,
      {} as any,
      undefined as any,
      workingDaysService,
    );

    const result = await service.getAttendanceHistory(42, 8, 2026);
    return Array.isArray(result) ? result[0]?.status : result.data[0]?.status;
  };

  it.each([
    [9, 'PRESENT'],
    [5, 'HALF_DAY'],
    [3, 'ABSENT'],
    [undefined, 'ABSENT'],
  ])('approved WFH does not override canonical attendance: %sh -> %s', async (hours, expected) => {
    const { attendanceRecord } = await approveWfh();

    await expect(attendanceFor(hours)).resolves.toBe(expected);
    expect(attendanceRecord.create).not.toHaveBeenCalled();
    expect(attendanceRecord.update).not.toHaveBeenCalled();
  });
});
