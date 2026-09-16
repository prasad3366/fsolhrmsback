import { BadRequestException } from '@nestjs/common';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { WfhService } from './wfh.service';

describe('WfhService date and working-day rules', () => {
  const createService = (teamName: string | null, holidayDates: string[] = []) => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          team: teamName ? { name: teamName } : null,
        }),
      },
      wFHRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn(),
      },
      actionItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as any;
    prisma.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(prisma));
    const holidayService = {
      isHoliday: jest.fn(async (date: Date) =>
        holidayDates.includes(formatDate(date)) ? { id: 1, date } : null,
      ),
    } as any;
    const workingDaysService = new WorkingDaysService(prisma, holidayService);

    return {
      prisma,
      service: new WfhService(prisma, workingDaysService),
    };
  };

  const formatDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const expectRejected = async (
    service: WfhService,
    startDate: string,
    endDate = startDate,
  ) => {
    await expect(service.request(7, { startDate, endDate })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  };

  it('accepts a normal-team Monday-Friday request and preserves existing persistence behavior', async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.request(7, {
        startDate: '2026-09-04',
        endDate: '2026-09-04',
        reason: 'Home internet maintenance',
      }),
    ).resolves.toEqual({ id: 1 });

    expect(prisma.wFHRequest.create).toHaveBeenCalledWith({
      data: {
        employeeId: 7,
        startDate: new Date(2026, 8, 4),
        endDate: new Date(2026, 8, 4),
        reason: 'Home internet maintenance',
        status: 'PENDING',
      },
    });
  });

  it('rejects a normal-team Saturday-only request', async () => {
    const { service, prisma } = createService(null);

    await expectRejected(service, '2026-09-05');

    expect(prisma.wFHRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a normal-team Sunday-only request', async () => {
    const { service, prisma } = createService(null);

    await expectRejected(service, '2026-09-06');

    expect(prisma.wFHRequest.create).not.toHaveBeenCalled();
  });

  it('accepts a Sales Saturday request when Saturday is not a holiday', async () => {
    const { service } = createService('SALES');

    await expect(
      service.request(7, { startDate: '2026-09-05', endDate: '2026-09-05' }),
    ).resolves.toEqual({ id: 1 });
  });

  it('rejects a Sales Sunday request', async () => {
    const { service } = createService('SALES');

    await expectRejected(service, '2026-09-06');
  });

  it('rejects a holiday weekday when it is the only requested day', async () => {
    const { service } = createService(null, ['2026-09-04']);

    await expectRejected(service, '2026-09-04');
  });

  it('rejects a Sales holiday Saturday when it is the only requested day', async () => {
    const { service } = createService('SALES', ['2026-09-05']);

    await expectRejected(service, '2026-09-05');
  });

  it('accepts a range containing eligible and non-working dates', async () => {
    const { service } = createService(null);

    await expect(
      service.request(7, { startDate: '2026-09-04', endDate: '2026-09-06' }),
    ).resolves.toEqual({ id: 1 });
  });

  it('rejects a range containing zero eligible working days', async () => {
    const { service } = createService(null, ['2026-09-04']);

    await expectRejected(service, '2026-09-04', '2026-09-06');
  });

  it('keeps date-only values on their declared local business date', async () => {
    const { service, prisma } = createService(null);

    await service.request(7, { startDate: '2026-09-04', endDate: '2026-09-04' });

    const createData = prisma.wFHRequest.create.mock.calls[0][0].data;
    expect(formatDate(createData.startDate)).toBe('2026-09-04');
    expect(formatDate(createData.endDate)).toBe('2026-09-04');
  });

  it.each([
    ['startDate', { startDate: 'not-a-date', endDate: '2026-09-04' }],
    ['endDate', { startDate: '2026-09-04', endDate: 'not-a-date' }],
    ['invalid Date object', { startDate: new Date('invalid'), endDate: '2026-09-04' }],
  ])('rejects malformed %s before persistence', async (_label, dto) => {
    const { service, prisma } = createService(null);

    await expect(service.request(7, dto as any)).rejects.toThrow('Invalid date format');
    expect(prisma.wFHRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a start date after the end date at the service boundary', async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.request(7, { startDate: '2026-09-05', endDate: '2026-09-04' }),
    ).rejects.toThrow('Start date cannot be after end date');
    expect(prisma.wFHRequest.create).not.toHaveBeenCalled();
  });

  it('accepts an omitted reason and preserves valid reason text unchanged', async () => {
    const omitted = createService(null);
    await expect(
      omitted.service.request(7, { startDate: '2026-09-04', endDate: '2026-09-04' }),
    ).resolves.toEqual({ id: 1 });

    const valid = createService(null);
    await valid.service.request(7, {
      startDate: '2026-09-04',
      endDate: '2026-09-04',
      reason: '  valid reason  ',
    });
    expect(valid.prisma.wFHRequest.create.mock.calls[0][0].data.reason).toBe('  valid reason  ');
  });

  it.each(['', '   '])('rejects an empty or whitespace-only reason: %j', async (reason) => {
    const { service, prisma } = createService(null);

    await expect(
      service.request(7, { startDate: '2026-09-04', endDate: '2026-09-04', reason }),
    ).rejects.toThrow('Reason must be a non-empty string');
    expect(prisma.wFHRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a non-string reason at the service boundary', async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.request(7, {
        startDate: '2026-09-04',
        endDate: '2026-09-04',
        reason: 123,
      } as any),
    ).rejects.toThrow('Reason must be a non-empty string');
    expect(prisma.wFHRequest.create).not.toHaveBeenCalled();
  });

  it('rejects an overlapping pending or approved request for the same employee', async () => {
    const { service, prisma } = createService(null);
    prisma.wFHRequest.findFirst.mockResolvedValue({ id: 2, status: 'PENDING' });

    await expectRejected(service, '2026-09-04');

    expect(prisma.wFHRequest.create).not.toHaveBeenCalled();
  });

  it('allows overlapping requests for different employees', async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.request(8, { startDate: '2026-09-04', endDate: '2026-09-04' }),
    ).resolves.toEqual({ id: 1 });

    expect(prisma.wFHRequest.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ employeeId: 8 }),
    });
  });

  it('does not block a new request when the overlap query excludes rejected requests', async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.request(7, { startDate: '2026-09-04', endDate: '2026-09-04' }),
    ).resolves.toEqual({ id: 1 });

    expect(prisma.wFHRequest.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: { in: ['PENDING', 'APPROVED'] } }),
    });
  });

  it('allows a pending request to be approved without an approved overlap', async () => {
    const { service, prisma } = createService(null);
    const request = {
      id: 4,
      employeeId: 7,
      startDate: new Date(2026, 8, 4),
      endDate: new Date(2026, 8, 4),
      status: 'PENDING',
    };
    prisma.wFHRequest.findUnique.mockResolvedValue(request);
    prisma.wFHRequest.findFirst.mockResolvedValue(null);
    prisma.wFHRequest.update.mockResolvedValue({ ...request, status: 'APPROVED' });

    await expect(service.approve(4)).resolves.toEqual({ ...request, status: 'APPROVED' });

    expect(prisma.wFHRequest.findFirst).toHaveBeenCalledWith({
      where: {
        employeeId: 7,
        id: { not: 4 },
        status: 'APPROVED',
        startDate: { lte: request.endDate },
        endDate: { gte: request.startDate },
      },
    });
  });

  it('blocks approval when another approved request overlaps for the same employee', async () => {
    const { service, prisma } = createService(null);
    prisma.wFHRequest.findUnique.mockResolvedValue({
      id: 4,
      employeeId: 7,
      startDate: new Date(2026, 8, 4),
      endDate: new Date(2026, 8, 4),
      status: 'PENDING',
    });
    prisma.wFHRequest.findFirst.mockResolvedValue({ id: 5, status: 'APPROVED' });

    await expect(service.approve(4)).rejects.toThrow(
      'WFH already approved for this period',
    );
    expect(prisma.wFHRequest.update).not.toHaveBeenCalled();
  });

  it('allows approval when an approved overlap belongs to a different employee', async () => {
    const { service, prisma } = createService(null);
    const request = {
      id: 4,
      employeeId: 7,
      startDate: new Date(2026, 8, 4),
      endDate: new Date(2026, 8, 4),
      status: 'PENDING',
    };
    prisma.wFHRequest.findUnique.mockResolvedValue(request);
    prisma.wFHRequest.findFirst.mockResolvedValue(null);
    prisma.wFHRequest.update.mockResolvedValue({ ...request, status: 'APPROVED' });

    await expect(service.approve(4)).resolves.toEqual({ ...request, status: 'APPROVED' });
  });

  it.each(['APPROVED', 'REJECTED'])('does not approve an already %s request', async (status) => {
    const { service, prisma } = createService(null);
    prisma.wFHRequest.findUnique.mockResolvedValue({ id: 4, status });

    await expect(service.approve(4)).rejects.toThrow(`Cannot approve request with status ${status}`);
    expect(prisma.wFHRequest.findFirst).not.toHaveBeenCalled();
    expect(prisma.wFHRequest.update).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent overlapping creation attempts to commit', async () => {
    const { service, prisma } = createService(null);
    let transactionCount = 0;
    prisma.$transaction = jest.fn(async (callback: (tx: any) => unknown) => {
      transactionCount += 1;
      if (transactionCount === 2) {
        throw { code: 'P2034' };
      }
      return callback(prisma);
    });

    const results = await Promise.allSettled([
      service.request(7, { startDate: '2026-09-04', endDate: '2026-09-04' }),
      service.request(7, { startDate: '2026-09-04', endDate: '2026-09-04' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(prisma.wFHRequest.create).toHaveBeenCalledTimes(1);
    expect((results[1].status === 'rejected' ? results[1].reason : results[0]).message)
      .toBe('WFH request conflicts with another request');
  });

  it('allows only one of two concurrent overlapping approvals to commit', async () => {
    const { service, prisma } = createService(null);
    const requests = [1, 2].map((id) => ({
      id,
      employeeId: 7,
      startDate: new Date(2026, 8, 4),
      endDate: new Date(2026, 8, 4),
      status: 'PENDING',
    }));
    prisma.wFHRequest.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(requests.find((request) => request.id === where.id)),
    );
    prisma.wFHRequest.findFirst.mockResolvedValue(null);
    prisma.wFHRequest.update.mockImplementation(({ where, data }: any) =>
      Promise.resolve({ ...requests.find((request) => request.id === where.id), ...data }),
    );
    let transactionCount = 0;
    prisma.$transaction = jest.fn(async (callback: (tx: any) => unknown) => {
      transactionCount += 1;
      if (transactionCount === 2) {
        throw { code: 'P2034' };
      }
      return callback(prisma);
    });

    const results = await Promise.allSettled([service.approve(1), service.approve(2)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(prisma.wFHRequest.update).toHaveBeenCalledTimes(1);
    expect((results[1].status === 'rejected' ? results[1].reason : results[0]).message)
      .toBe('WFH approval conflicts with another request');
  });
});
