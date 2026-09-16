import { AttendanceStatus } from '@prisma/client';
import { ReportsService } from './reports.service';

describe('ReportsService executive summary attendance source', () => {
  const employees = [
    { id: 1, userId: 11, department: 'Engineering' },
    { id: 2, userId: 12, department: 'Engineering' },
    { id: 3, userId: 13, department: 'Sales' },
    { id: 4, userId: 14, department: 'Sales' },
  ];

  const createService = (statuses: AttendanceStatus[]) => {
    const attendanceRecordCount = jest.fn(() => {
      throw new Error('Reports must not read persisted attendance status');
    });
    const prisma = {
      employee: {
        count: jest.fn()
          .mockResolvedValueOnce(employees.length)
          .mockResolvedValueOnce(employees.length),
        findMany: jest.fn().mockResolvedValue(employees),
      },
      attendanceRecord: { count: attendanceRecordCount },
      jobPosting: { count: jest.fn().mockResolvedValue(0) },
      trainingProgram: { count: jest.fn().mockResolvedValue(0) },
      trainingEnrollment: { count: jest.fn().mockResolvedValue(0) },
    } as any;
    const authorizationService = {
      canAccessOrganizationWide: jest.fn().mockReturnValue(true),
    } as any;
    const getTodayStatus = jest.fn((_: number, employeeId: number) =>
      Promise.resolve({ status: statuses[employeeId - 1] }),
    );
    const attendanceService = { getTodayStatus } as any;

    return {
      service: new ReportsService(
        prisma,
        authorizationService,
        {} as any,
        attendanceService,
      ),
      attendanceRecordCount,
      getTodayStatus,
    };
  };

  it('uses effective canonical statuses instead of persisted AttendanceRecord.status', async () => {
    const { service, attendanceRecordCount, getTodayStatus } = createService([
      AttendanceStatus.PRESENT,
      AttendanceStatus.LATE,
      AttendanceStatus.HALF_DAY,
      AttendanceStatus.ABSENT,
    ]);

    const result = await service.getExecutiveSummary({ id: 1, role: 'HR' });

    expect(result.todayAttendancePercentage).toBe(50);
    expect(getTodayStatus).toHaveBeenCalledTimes(4);
    expect(attendanceRecordCount).not.toHaveBeenCalled();
  });

  it('does not count canonical approved leave as present', async () => {
    const { service } = createService([
      AttendanceStatus.LEAVE,
      AttendanceStatus.IN_PROGRESS,
      AttendanceStatus.ABSENT,
      AttendanceStatus.HALF_DAY,
    ]);

    const result = await service.getExecutiveSummary({ id: 1, role: 'HR' });

    expect(result.todayAttendancePercentage).toBe(0);
  });

  it('preserves the existing executive-summary response shape', async () => {
    const { service } = createService([
      AttendanceStatus.PRESENT,
      AttendanceStatus.ABSENT,
      AttendanceStatus.HALF_DAY,
      AttendanceStatus.LEAVE,
    ]);

    await expect(service.getExecutiveSummary({ id: 1, role: 'HR' })).resolves.toEqual({
      totalEmployees: 4,
      activeEmployees: 4,
      todayAttendancePercentage: 25,
      trainingCompletionRate: 0,
      activeDepartments: 2,
      activeJobPostings: 0,
      activeTrainingPrograms: 0,
      departmentDistribution: [
        { department: 'Engineering', count: 2 },
        { department: 'Sales', count: 2 },
      ],
    });
  });
});