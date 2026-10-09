import { BadRequestException } from '@nestjs/common';
import { PayrollStatus } from '@prisma/client';
import { getBusinessDateKey } from '../attendance/utils/business-date.util';

/* Payroll period for a month runs from the 29th of the previous month
   through the 28th of the month itself. */

export const PAYROLL_PERIOD_START_DAY = 29;

export type PayrollPeriod = { month: number; year: number };

export function getPayrollPeriodRange(month: number, year: number) {
  const startDate = new Date(Date.UTC(year, month - 2, PAYROLL_PERIOD_START_DAY));
  const endDateExclusive = new Date(Date.UTC(year, month - 1, PAYROLL_PERIOD_START_DAY));
  const endDate = new Date(endDateExclusive.getTime() - 1);

  return { startDate, endDateExclusive, endDate };
}

/* First and last business day of a payroll period, as YYYY-MM-DD */
export function getPayrollPeriodDates(month: number, year: number) {
  const { startDate, endDateExclusive } = getPayrollPeriodRange(month, year);
  return {
    startDate: getBusinessDateKey(startDate),
    endDate: getBusinessDateKey(new Date(endDateExclusive.getTime() - 24 * 60 * 60 * 1000)),
  };
}

/* Payrolls created before the component columns were populated round their
   stored totals and components separately, so a total can differ from the sum
   of its components by this much without any adjustment behind it */
export const LEGACY_ROUNDING_TOLERANCE = 2;

/* Payroll statuses an EMPLOYEE may see; DRAFT figures are not final */
export const EMPLOYEE_VISIBLE_PAYROLL_STATUSES: PayrollStatus[] = ['FINALIZED', 'PAID'];

export function getPayrollPeriodForDate(date: Date): PayrollPeriod {
  const [year, month, day] = getBusinessDateKey(date).split('-').map(Number);

  if (day >= PAYROLL_PERIOD_START_DAY) {
    return month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
  }

  return { month, year };
}

export function getPayrollPeriodsForDates(dates: Date[]): PayrollPeriod[] {
  const periods = new Map<string, PayrollPeriod>();
  for (const date of dates) {
    const period = getPayrollPeriodForDate(date);
    periods.set(`${period.year}-${period.month}`, period);
  }
  return [...periods.values()];
}

/* Every business date from start through end (inclusive) */
export function getBusinessDatesBetween(start: Date, end: Date): Date[] {
  const isValid = (value: Date) => value instanceof Date && !Number.isNaN(value.getTime());
  if (!isValid(start) || !isValid(end)) return [];

  const [startYear, startMonth, startDay] = getBusinessDateKey(start).split('-').map(Number);
  const [endYear, endMonth, endDay] = getBusinessDateKey(end).split('-').map(Number);
  const last = Date.UTC(endYear, endMonth - 1, endDay);
  const dates: Date[] = [];

  for (let time = Date.UTC(startYear, startMonth - 1, startDay); time <= last; time += 86400000) {
    dates.push(new Date(time));
  }

  return dates;
}

const periodFilter = (employeeId: number | null, periods: PayrollPeriod[]) => ({
  ...(employeeId === null ? {} : { employeeId }),
  OR: periods.map(({ month, year }) => ({ month, year })),
});

/* Fail closed: payroll protection must never be skipped silently */
const requirePayrollModel = (client: any) => {
  if (!client?.payroll) {
    throw new Error('Payroll protection unavailable: database client has no payroll model');
  }
  return client.payroll;
};

/* Rejects a change that would alter a FINALIZED or PAID payroll period.
   employeeId = null checks every employee (e.g. holidays). */
export async function assertPayrollPeriodOpen(
  client: any,
  employeeId: number | null,
  dates: Date[],
) {
  const periods = getPayrollPeriodsForDates(dates);
  if (!periods.length) return;

  const lockedPayroll = await requirePayrollModel(client).findFirst({
    where: { ...periodFilter(employeeId, periods), status: { in: ['FINALIZED', 'PAID'] } },
    select: { id: true, month: true, year: true },
  });

  if (lockedPayroll) {
    throw new BadRequestException(
      `Payroll for ${lockedPayroll.month}/${lockedPayroll.year} is finalized. Reopen the payroll before making this change.`,
    );
  }
}

/* Marks affected DRAFT payrolls as needing recalculation.
   employeeId = null marks every employee (e.g. holidays). */
export async function markPayrollStale(
  client: any,
  employeeId: number | null,
  dates: Date[],
) {
  const periods = getPayrollPeriodsForDates(dates);
  if (!periods.length) return;

  await requirePayrollModel(client).updateMany({
    where: { ...periodFilter(employeeId, periods), status: 'DRAFT' },
    data: { needsRecalculation: true },
  });
}
