import { BadRequestException } from '@nestjs/common';
import { TrainingService } from './training.service';

describe('TrainingService program creation and enrollment', () => {
  const makeService = () => {
    const prisma: any = {
      employee: { findMany: jest.fn() },
      trainingProgram: { create: jest.fn() },
      trainingEnrollment: { createMany: jest.fn() },
      $transaction: jest.fn(async (callback: (transaction: any) => unknown) => callback(prisma)),
    };
    const service = new TrainingService(prisma, {} as any);
    return { prisma, service };
  };

  const createDto = (employeeIds?: number[]) => ({
    title: 'Leadership',
    description: 'Leadership fundamentals',
    trainer: 'Ada Lovelace',
    department: 'HR',
    startDate: new Date('2026-09-10'),
    endDate: new Date('2026-09-11'),
    ...(employeeIds === undefined ? {} : { employeeIds }),
  });

  it('creates a program without enrollment records when no employees are selected', async () => {
    const { prisma, service } = makeService();
    prisma.trainingProgram.create.mockResolvedValue({ id: 12, title: 'Leadership' });

    await expect(service.createProgram(createDto(), 5)).resolves.toEqual({ id: 12, title: 'Leadership' });

    expect(prisma.trainingProgram.create).toHaveBeenCalledTimes(1);
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
    expect(prisma.trainingEnrollment.createMany).not.toHaveBeenCalled();
  });

  it('creates selected enrollments in the same transaction using the existing enrollment behavior', async () => {
    const { prisma, service } = makeService();
    prisma.trainingProgram.create.mockResolvedValue({ id: 12, title: 'Leadership' });
    prisma.employee.findMany.mockResolvedValue([{ id: 7 }, { id: 8 }]);
    prisma.trainingEnrollment.createMany.mockResolvedValue({ count: 2 });

    await service.createProgram(createDto([7, 8]), 5);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: { id: { in: [7, 8] } },
      select: { id: true },
    });
    expect(prisma.trainingEnrollment.createMany).toHaveBeenCalledWith({
      data: [
        { trainingProgramId: 12, employeeId: 7 },
        { trainingProgramId: 12, employeeId: 8 },
      ],
      skipDuplicates: true,
    });
  });

  it('rejects invalid employee IDs before creating enrollment records', async () => {
    const { prisma, service } = makeService();
    prisma.trainingProgram.create.mockResolvedValue({ id: 12, title: 'Leadership' });
    prisma.employee.findMany.mockResolvedValue([{ id: 7 }]);

    await expect(service.createProgram(createDto([7, 999]), 5)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.trainingEnrollment.createMany).not.toHaveBeenCalled();
  });

  it('preserves duplicate-enrollment handling for the existing enrollment endpoint', async () => {
    const { prisma, service } = makeService();
    prisma.employee.findMany.mockResolvedValue([{ id: 7 }]);
    prisma.trainingEnrollment.createMany.mockResolvedValue({ count: 1 });

    await service.enrollEmployees({ trainingProgramId: 12, employeeIds: [7, 7] });

    expect(prisma.trainingEnrollment.createMany).toHaveBeenCalledWith({
      data: [{ trainingProgramId: 12, employeeId: 7 }],
      skipDuplicates: true,
    });
  });
});
