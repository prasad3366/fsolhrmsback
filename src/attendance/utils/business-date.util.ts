export const ATTENDANCE_TIME_ZONE = 'Asia/Kolkata';

type BusinessDateParts = {
  year: number;
  month: number;
  day: number;
};

const businessDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ATTENDANCE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getBusinessDateParts(value: Date): BusinessDateParts {
  const values = Object.fromEntries(
    businessDateFormatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return { year: values.year, month: values.month, day: values.day };
}

export function toBusinessDate(value = new Date()): Date {
  const { year, month, day } = getBusinessDateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
}

export function getBusinessDateKey(value: Date): string {
  const { year, month, day } = getBusinessDateParts(value);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getMonthRange(year: number, month: number) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    nextStart: new Date(Date.UTC(year, month, 1)),
  };
}

export function getCurrentDayCutoff(value = new Date()): Date {
  const cutoff = toBusinessDate(value);
  cutoff.setUTCDate(cutoff.getUTCDate() + 1);
  return cutoff;
}