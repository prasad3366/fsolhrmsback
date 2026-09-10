import 'reflect-metadata';
import { validate } from 'class-validator';
import { MonthlyAttendanceReportQueryDto } from './monthly-attendance-report-query.dto';

const validQuery = (overrides: Partial<MonthlyAttendanceReportQueryDto> = {}) =>
  Object.assign(new MonthlyAttendanceReportQueryDto(), {
    month: '2026-09',
    ...overrides,
  });

describe('MonthlyAttendanceReportQueryDto', () => {
  it('accepts a valid month and positive pagination/filter IDs', async () => {
    await expect(validate(validQuery({ page: 2, pageSize: 50, teamId: 7, employeeId: 42 }))).resolves.toEqual([]);
  });

  it.each(['2026-00', '2026-13', '2026-9', '26-09', '0000-09', 'invalid'])(
    'rejects invalid month %s',
    async (month) => {
      expect(await validate(validQuery({ month }))).not.toEqual([]);
    },
  );

  it('rejects missing month, invalid pagination, and invalid IDs', async () => {
    const errors = await validate(validQuery({ month: undefined as any, page: 0, pageSize: 101, teamId: 0, employeeId: -1 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects statuses outside AttendanceStatus', async () => {
    expect((await validate(validQuery({ status: 'UNKNOWN' as any }))).length).toBeGreaterThan(0);
  });
});