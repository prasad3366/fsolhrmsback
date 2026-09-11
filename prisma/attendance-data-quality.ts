import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Finding = {
  category: string;
  detail: string;
};

function dbDateKey(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

function groupKeys<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function addGroupedFindings<T>(
  findings: Finding[],
  category: string,
  items: T[],
  keyOf: (item: T) => string,
) {
  for (const [key, group] of groupKeys(items, keyOf)) {
    if (group.length > 1) {
      findings.push({ category, detail: `${key}: ${group.length} rows` });
    }
  }
}

async function main() {
  const [legacyRows, recordRows, logRows] = await Promise.all([
    prisma.attendance.findMany({
      include: {
        employee: {
          select: {
            id: true,
            userId: true,
            status: true,
            dateOfJoining: true,
            dateOfExit: true,
          },
        },
      },
    }),
    prisma.attendanceRecord.findMany({
      include: {
        user: {
          select: {
            id: true,
            isActive: true,
            employee: {
              select: {
                id: true,
                status: true,
                dateOfJoining: true,
                dateOfExit: true,
              },
            },
          },
        },
      },
    }),
    prisma.attendanceLog.findMany({
      include: {
        employee: {
          select: {
            id: true,
            userId: true,
            status: true,
            dateOfJoining: true,
            dateOfExit: true,
          },
        },
      },
    }),
  ]);

  const findings: Finding[] = [];
  addGroupedFindings(findings, 'Duplicate legacy employee/date records', legacyRows, (row) => `${row.employeeId}/${dbDateKey(row.date)}`);
  addGroupedFindings(findings, 'Duplicate canonical user/date records', recordRows, (row) => `${row.userId}/${dbDateKey(row.date)}`);
  addGroupedFindings(findings, 'Duplicate IN logs', logRows.filter((row) => row.type === 'IN'), (row) => `${row.employeeId}/${row.time.toISOString().slice(0, 10)}`);
  addGroupedFindings(findings, 'Duplicate OUT logs', logRows.filter((row) => row.type === 'OUT'), (row) => `${row.employeeId}/${row.time.toISOString().slice(0, 10)}`);

  for (const row of legacyRows) {
    const key = `${row.employeeId}/${dbDateKey(row.date)}`;
    if (!row.punchIn && !row.punchOut && row.totalHours === 0 && row.status === 'PRESENT') {
      findings.push({ category: 'Legacy null/null/zero/PRESENT', detail: key });
    }
    if (row.status === 'PRESENT' && !row.punchIn) findings.push({ category: 'Legacy PRESENT without punch-in', detail: key });
    if (row.status === 'PRESENT' && !row.punchOut) findings.push({ category: 'Legacy PRESENT without punch-out', detail: key });
    if (row.totalHours === 0 && row.status === 'PRESENT') findings.push({ category: 'Legacy zero-hour PRESENT', detail: key });
    if (row.punchIn && row.punchOut && row.punchOut < row.punchIn) findings.push({ category: 'Legacy clock-out before clock-in', detail: key });
    if (row.punchIn && row.punchOut && row.totalHours <= 0) findings.push({ category: 'Legacy non-positive completed duration', detail: key });
    checkEmploymentDates(findings, 'Legacy', key, row.date, row.employee);
  }

  for (const row of recordRows) {
    const key = `${row.userId}/${dbDateKey(row.date)}`;
    if (!row.clockIn && row.status === 'PRESENT') findings.push({ category: 'Canonical PRESENT without clock-in', detail: key });
    if (row.status === 'PRESENT' && !row.clockOut) findings.push({ category: 'Canonical PRESENT without clock-out', detail: key });
    if (row.totalHours === 0 && row.status === 'PRESENT') findings.push({ category: 'Canonical zero-hour PRESENT', detail: key });
    if (row.clockIn && row.clockOut && row.clockOut < row.clockIn) findings.push({ category: 'Canonical clock-out before clock-in', detail: key });
    if (row.clockIn && row.clockOut && (row.totalHours === null || row.totalHours <= 0)) findings.push({ category: 'Canonical non-positive completed duration', detail: key });
    if (row.status === 'IN_PROGRESS' && row.clockOut) findings.push({ category: 'IN_PROGRESS with clock-out', detail: key });
    if (row.status !== 'IN_PROGRESS' && row.clockIn && !row.clockOut) findings.push({ category: 'Open canonical record with final status', detail: `${key}: ${row.status}` });
    if (!row.user || !row.user.employee) findings.push({ category: 'Canonical malformed identity reference', detail: key });
    if (row.user && !row.user.isActive) findings.push({ category: 'Canonical record for inactive user', detail: key });
    if (row.user?.employee) {
      if (row.user.employee.status !== 'ACTIVE') findings.push({ category: 'Canonical record for inactive employee', detail: key });
      checkEmploymentDates(findings, 'Canonical', key, row.date, row.user.employee);
    }
  }

  const legacyByEmployeeDate = new Map(legacyRows.map((row) => [`${row.employee.userId}/${dbDateKey(row.date)}`, row]));
  for (const row of recordRows) {
    const legacy = legacyByEmployeeDate.get(`${row.userId}/${dbDateKey(row.date)}`);
    if (legacy && (legacy.status !== row.status || Boolean(legacy.punchIn) !== Boolean(row.clockIn) || Boolean(legacy.punchOut) !== Boolean(row.clockOut))) {
      findings.push({ category: 'Legacy/canonical date-status or punch mismatch', detail: `${row.userId}/${dbDateKey(row.date)} legacy=${legacy.status} canonical=${row.status}` });
    }
  }

  for (const [employeeId, employeeLogs] of groupKeys(logRows, (row) => String(row.employeeId))) {
    let openIn = false;
    for (const log of employeeLogs.sort((left, right) => left.time.getTime() - right.time.getTime())) {
      if (log.type === 'OUT' && !openIn) findings.push({ category: 'AttendanceLog OUT without preceding IN', detail: `${employeeId}/${log.time.toISOString()}` });
      if (log.type === 'IN' && openIn) findings.push({ category: 'AttendanceLog duplicate/consecutive IN', detail: `${employeeId}/${log.time.toISOString()}` });
      openIn = log.type === 'IN';
      if (log.employee.status !== 'ACTIVE') findings.push({ category: 'AttendanceLog for inactive employee', detail: `${employeeId}/${log.time.toISOString()}` });
      checkEmploymentDates(findings, 'AttendanceLog', `${employeeId}/${log.time.toISOString()}`, log.time, log.employee);
    }
  }

  console.log('ATTENDANCE DATA-QUALITY ANALYSIS (READ-ONLY)');
  console.log(`Legacy Attendance rows: ${legacyRows.length}`);
  console.log(`AttendanceRecord rows: ${recordRows.length}`);
  console.log(`AttendanceLog rows: ${logRows.length}`);
  console.log(`Findings: ${findings.length}`);
  for (const finding of findings) console.log(`[${finding.category}] ${finding.detail}`);
  console.log('No attendance data was inserted, updated, upserted, or deleted.');
}

function checkEmploymentDates(
  findings: Finding[],
  source: string,
  key: string,
  date: Date,
  employee: { dateOfJoining: Date | null; dateOfExit: Date | null },
) {
  if (employee.dateOfJoining && date < employee.dateOfJoining) findings.push({ category: `${source} outside employment start`, detail: key });
  if (employee.dateOfExit && date > employee.dateOfExit) findings.push({ category: `${source} outside employment end`, detail: key });
}

main()
  .catch((error) => {
    console.error('Attendance data-quality analysis failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());