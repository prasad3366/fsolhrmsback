import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus } from '@prisma/client';
import { TrainingService } from './training.service';

describe('TrainingService authorization', () => {
  const makePrisma = () => ({
    team: { findMany: jest.fn() },
    trainingEnrollment: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    trainingProgram: { findMany: jest.fn() },
  });

  const makeService = (overrides: Partial<any> = {}) => {
    const prisma = makePrisma();
    const authorizationService = {
      canAccessEmployee: jest.fn(),
      ...overrides.authorizationService,
    };

    return {
      prisma,
      authorizationService,
      service: new TrainingService(prisma as any, authorizationService as any),
    };
  };

  it.each(['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'])(
    'allows %s to update an enrollment for an employee in their managed team',
    async (role) => {
      const { prisma, authorizationService, service } = makeService();
      prisma.team.findMany.mockResolvedValue([{ id: 7 }]);
      authorizationService.canAccessEmployee.mockResolvedValue(true);
      prisma.trainingEnrollment.findUnique.mockResolvedValue({
        id: 12,
        employeeId: 15,
      });
      prisma.trainingEnrollment.update.mockResolvedValue({
        id: 12,
        employeeId: 15,
        status: EnrollmentStatus.COMPLETED,
      });

      await expect(
        service.updateEnrollmentStatus(
          { role, employeeId: 10 },
          12,
          { status: EnrollmentStatus.COMPLETED, feedback: 'Great job' },
        ),
      ).resolves.toMatchObject({ id: 12, employeeId: 15, status: EnrollmentStatus.COMPLETED });

      expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(
        { role, employeeId: 10 },
        15,
      );
    },
  );

  it.each(['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'])(
    'rejects %s when the enrollment belongs to an employee outside their managed team',
    async (role) => {
      const { prisma, authorizationService, service } = makeService();
      prisma.team.findMany.mockResolvedValue([{ id: 7 }]);
      authorizationService.canAccessEmployee.mockResolvedValue(false);
      prisma.trainingEnrollment.findUnique.mockResolvedValue({
        id: 12,
        employeeId: 99,
      });

      await expect(
        service.updateEnrollmentStatus(
          { role, employeeId: 10 },
          12,
          { status: EnrollmentStatus.COMPLETED, feedback: 'No access' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('prevents an employee from updating another employee enrollment', async () => {
    const { prisma, service } = makeService();
    prisma.trainingEnrollment.findUnique.mockResolvedValue({
      id: 12,
      employeeId: 99,
    });

    await expect(
      service.updateEnrollmentStatus(
        { role: 'EMPLOYEE', employeeId: 10 },
        12,
        { status: EnrollmentStatus.COMPLETED, feedback: 'Not allowed' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['HR', 'CEO', 'SUPER_ADMIN'])(
    'retains organization-wide access for %s',
    async (role) => {
      const { prisma, service } = makeService();
      prisma.trainingEnrollment.findUnique.mockResolvedValue({
        id: 12,
        employeeId: 99,
      });
      prisma.trainingEnrollment.update.mockResolvedValue({
        id: 12,
        employeeId: 99,
        status: EnrollmentStatus.COMPLETED,
      });

      await expect(
        service.updateEnrollmentStatus(
          { role, employeeId: 10 },
          12,
          { status: EnrollmentStatus.COMPLETED, feedback: 'Allowed' },
        ),
      ).resolves.toMatchObject({ id: 12, employeeId: 99, status: EnrollmentStatus.COMPLETED });
    },
  );

  it('filters manager program visibility to their managed team employees', async () => {
    const { prisma, service } = makeService();
    prisma.team.findMany.mockResolvedValue([{ id: 7 }, { id: 9 }]);
    prisma.trainingProgram.findMany.mockResolvedValue([{ id: 11 }]);

    await service.getPrograms({ role: 'IT_MANAGER', employeeId: 10 });

    expect(prisma.team.findMany).toHaveBeenCalledWith({
      where: { managerId: 10 },
      select: { id: true },
    });
    expect(prisma.trainingProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          enrollments: {
            some: {
              employee: {
                teamId: { in: [7, 9] },
              },
            },
          },
        },
      }),
    );
  });
});
