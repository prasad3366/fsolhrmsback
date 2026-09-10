import { HolidaysService } from './holidays.service';

describe('HolidaysService business dates', () => {
  const prisma = {
    employee: {
      findUnique: jest.fn(),
    },
    payroll: {
      findFirst: jest.fn(),
    },
    holiday: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as any;

  let service: HolidaysService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.holiday.create.mockReset();
    prisma.holiday.update.mockReset();
    prisma.holiday.findMany.mockReset();
    prisma.holiday.findUnique.mockReset();
    prisma.holiday.findFirst.mockReset();
    prisma.holiday.delete.mockReset();
    prisma.employee.findUnique.mockReset();
    prisma.payroll.findFirst.mockReset();
    prisma.payroll.findFirst.mockResolvedValue(null);
    prisma.holiday.findUnique.mockResolvedValue({ id: 1, date: new Date(2026, 7, 1) });
    service = new HolidaysService(prisma);
  });

  it('includes January 1 and December 31, but excludes January 1 of the next year', async () => {
    await service.getHolidaysByYear(2026);

    expect(prisma.holiday.findMany).toHaveBeenCalledWith({
      where: { date: { gte: new Date(2026, 0, 1), lt: new Date(2027, 0, 1) } },
      orderBy: { date: 'asc' },
    });
  });

  it('preserves the existing list response and its year boundary query', async () => {
    const holidays = [{ id: 1, date: new Date(2026, 0, 1) }, { id: 2, date: new Date(2026, 11, 31) }];
    prisma.holiday.findMany.mockResolvedValue(holidays);

    await expect(service.getHolidaysByYear(2026)).resolves.toBe(holidays);
    expect(prisma.holiday.findMany).toHaveBeenCalledWith({
      where: { date: { gte: new Date(2026, 0, 1), lt: new Date(2027, 0, 1) } },
      orderBy: { date: 'asc' },
    });
  });

  it.each([
    ['Pune', ['global', 'matching'], ['different']],
    [null, ['global'], ['matching', 'different']],
  ])('filters employee Holidays by canonical city: %s', async (city, visible, hidden) => {
    prisma.employee.findUnique.mockResolvedValue({ city });
    const holidays = [
      { name: 'global', location: null },
      { name: 'matching', location: city === 'Pune' ? ' pune ' : 'Pune' },
      { name: 'different', location: 'Mumbai' },
    ];
    prisma.holiday.findMany.mockResolvedValue(holidays);

    const result = await service.getEmployeeHolidayList(7);

    expect(result.map((holiday) => holiday.name)).toEqual(visible);
    expect(result.map((holiday) => holiday.name)).not.toEqual(expect.arrayContaining(hidden));
    expect(prisma.employee.findUnique).toHaveBeenCalledWith({ where: { userId: 7 } });
  });

  it('keeps management Holiday listing organization-wide and unfiltered by location', async () => {
    const holidays = [
      { name: 'global', location: null },
      { name: 'Pune', location: 'Pune' },
      { name: 'Mumbai', location: 'Mumbai' },
    ];
    prisma.holiday.findMany.mockResolvedValue(holidays);

    await expect(service.getHolidaysByYear(2026)).resolves.toBe(holidays);
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it.each([0, -1, 202.6, Number.NaN, 2200])('rejects invalid year before querying Prisma: %s', async (year) => {
    await expect(service.getHolidaysByYear(year)).rejects.toThrow();
    expect(prisma.holiday.findMany).not.toHaveBeenCalled();
  });

  it('normalizes date-only values consistently for create and update', async () => {
    await service.createHoliday({ name: 'New Year', date: '2026-01-01' });
    await service.updateHoliday(1, { date: '2026-12-31T23:30:00.000Z' });

    expect(prisma.holiday.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ date: new Date(2026, 0, 1) }),
    });
    expect(prisma.holiday.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ date: new Date(2026, 11, 31) }),
    });
  });

  it('returns NotFoundException when getting a missing Holiday', async () => {
    prisma.holiday.findUnique.mockResolvedValue(null);

    await expect(service.getHolidayById(999)).rejects.toThrow('Holiday not found');
    expect(prisma.holiday.findUnique).toHaveBeenCalledWith({ where: { id: 999 } });
  });

  it('normalizes P2025 for missing update and delete Holidays', async () => {
    prisma.holiday.update.mockRejectedValue({ code: 'P2025' });
    prisma.holiday.delete.mockRejectedValue({ code: 'P2025' });

    await expect(service.updateHoliday(999, { name: 'Updated' })).rejects.toThrow('Holiday not found');
    await expect(service.deleteHoliday(999)).rejects.toThrow('Holiday not found');
  });

  it('preserves successful get, update, and delete behavior', async () => {
    const holiday = { id: 1, name: 'New Year', date: new Date(2026, 7, 1) };
    prisma.holiday.findUnique.mockResolvedValue(holiday);
    prisma.holiday.update.mockResolvedValue(holiday);
    prisma.holiday.delete.mockResolvedValue(holiday);

    await expect(service.getHolidayById(1)).resolves.toBe(holiday);
    await expect(service.updateHoliday(1, { name: 'Updated' })).resolves.toBe(holiday);
    await expect(service.deleteHoliday(1)).resolves.toEqual({ message: 'Holiday deleted successfully' });
  });

  it.each([
    [{ name: '', date: '2026-01-01' }, 'name'],
    [{ name: 'New Year', date: 'not-a-date' }, 'date'],
    [{ name: 'New Year', date: '2026-01-01', isOptional: 'false' }, 'isOptional'],
    [{ name: 'New Year', date: '2026-01-01', description: 7 }, 'description'],
    [{ name: 'New Year', date: '2026-01-01', location: 7 }, 'location'],
  ])('rejects invalid create field: %s', async (data, _field) => {
    await expect(service.createHoliday(data as any)).rejects.toThrow();
    expect(prisma.holiday.create).not.toHaveBeenCalled();
  });

  it('rejects unknown update fields without sending them to Prisma', async () => {
    await expect(service.updateHoliday(1, { timezone: 'UTC' } as any)).rejects.toThrow();
    expect(prisma.holiday.update).not.toHaveBeenCalled();
  });

  it('accepts valid create and update payloads', async () => {
    await service.createHoliday({
      name: 'Founders Day',
      date: '2026-08-15',
      description: 'Office closed',
      isOptional: true,
      location: 'HQ',
    });
    await service.updateHoliday(1, {
      name: 'Updated Day',
      date: '2026-08-16',
      description: 'Updated description',
      isOptional: false,
      location: 'Remote',
    });

    expect(prisma.holiday.create).toHaveBeenCalled();
    expect(prisma.holiday.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        name: 'Updated Day',
        date: new Date(2026, 7, 16),
        description: 'Updated description',
        isOptional: false,
        location: 'Remote',
      },
    });
  });

  it('accepts a minimal valid create and partial update', async () => {
    await service.createHoliday({ name: 'New Year', date: '2026-01-01' });
    await service.updateHoliday(1, { isOptional: true });

    expect(prisma.holiday.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'New Year',
        date: new Date(2026, 0, 1),
        isOptional: false,
      }),
    });
    expect(prisma.holiday.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isOptional: true },
    });
  });

  it('persists isOptional for both mandatory and optional Holidays', async () => {
    await service.createHoliday({ name: 'Mandatory', date: '2026-01-01', isOptional: false });
    await service.createHoliday({ name: 'Optional', date: '2026-01-02', isOptional: true });
    await service.updateHoliday(1, { isOptional: true });

    expect(prisma.holiday.create.mock.calls.map(([call]) => call.data.isOptional)).toEqual([
      false,
      true,
    ]);
    expect(prisma.holiday.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isOptional: true },
    });
  });

  it('allows Holiday creation in an unlocked payroll period', async () => {
    await expect(
      service.createHoliday({ name: 'New Year', date: '2026-01-01' }),
    ).resolves.toBeUndefined();

    expect(prisma.payroll.findFirst).toHaveBeenCalledWith({
      where: {
        month: 1,
        year: 2026,
        status: { in: ['FINALIZED', 'PAID'] },
      },
      select: { id: true },
    });
  });

  it('rejects Holiday creation in a finalized payroll period', async () => {
    prisma.payroll.findFirst.mockResolvedValue({ id: 10 });

    await expect(
      service.createHoliday({ name: 'New Year', date: '2026-01-01' }),
    ).rejects.toThrow('finalized or paid payroll period');
    expect(prisma.holiday.create).not.toHaveBeenCalled();
  });

  it.each(['FINALIZED', 'PAID'])('rejects update and delete in a %s payroll period', async (status) => {
    prisma.payroll.findFirst.mockResolvedValue({ id: 10, status });

    await expect(service.updateHoliday(1, { name: 'Updated' })).rejects.toThrow(
      'finalized or paid payroll period',
    );
    await expect(service.deleteHoliday(1)).rejects.toThrow(
      'finalized or paid payroll period',
    );
    expect(prisma.holiday.update).not.toHaveBeenCalled();
    expect(prisma.holiday.delete).not.toHaveBeenCalled();
  });

  it('allows update and delete in a different unlocked payroll period', async () => {
    await expect(service.updateHoliday(1, { name: 'Updated' })).resolves.toBeUndefined();
    await expect(service.deleteHoliday(1)).resolves.toEqual({ message: 'Holiday deleted successfully' });

    expect(prisma.holiday.update).toHaveBeenCalled();
    expect(prisma.holiday.delete).toHaveBeenCalled();
  });

  it('rejects duplicate global and location-specific holidays from the database constraint', async () => {
    prisma.holiday.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.createHoliday({ name: 'Global', date: '2026-01-01' })).rejects.toThrow();
    await expect(
      service.createHoliday({ name: 'Regional', date: '2026-01-01', location: 'HQ' }),
    ).rejects.toThrow();
  });

  it('allows holidays on different dates', async () => {
    await service.createHoliday({ name: 'First', date: '2026-01-01' });
    await service.createHoliday({ name: 'Second', date: '2026-01-02' });

    expect(prisma.holiday.create).toHaveBeenCalledTimes(2);
  });

  it('cannot create two global rows from concurrent duplicate requests', async () => {
    let created = false;
    prisma.holiday.create.mockImplementation(async () => {
      if (created) throw { code: 'P2002' };
      created = true;
      return { id: 1 };
    });

    const results = await Promise.allSettled([
      service.createHoliday({ name: 'First', date: '2026-01-01' }),
      service.createHoliday({ name: 'Second', date: '2026-01-01' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});