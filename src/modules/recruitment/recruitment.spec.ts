import { ConflictException } from '@nestjs/common';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';

describe('Recruitment job and candidate mutations', () => {
  const createService = () => {
    const prisma = {
      jobPosting: { delete: jest.fn(), update: jest.fn() },
      candidate: { findMany: jest.fn(), delete: jest.fn() },
    } as any;
    return { prisma, service: new RecruitmentService(prisma) };
  };

  it('rejects deletion when candidates are attached', async () => {
    const { prisma, service } = createService();
    prisma.candidate.findMany.mockResolvedValue([{ id: 1 }]);

    await expect(service.deleteJob(7)).rejects.toThrow(ConflictException);
    expect(prisma.jobPosting.delete).not.toHaveBeenCalled();
  });

  it('deletes a job posting when no candidates are attached', async () => {
    const { prisma, service } = createService();
    prisma.candidate.findMany.mockResolvedValue([]);
    prisma.jobPosting.delete.mockResolvedValue({ id: 7 });

    await expect(service.deleteJob(7)).resolves.toEqual({ id: 7 });
    expect(prisma.jobPosting.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it('uses the management-only DELETE route and forwards the parsed ID', async () => {
    const service = {
      deleteJob: jest.fn().mockResolvedValue({ id: 7 }),
      updateJob: jest.fn().mockResolvedValue({ id: 7 }),
      deleteCandidate: jest.fn().mockResolvedValue({ id: 3 }),
    } as any;
    const controller = new RecruitmentController(service);

    await expect(controller.deleteJob(7)).resolves.toEqual({ id: 7 });
    expect(service.deleteJob).toHaveBeenCalledWith(7);
    expect(Reflect.getMetadata('roles', RecruitmentController.prototype.deleteJob)).toEqual([
      'SUPER_ADMIN',
      'Super_admin',
      'CEO',
      'HR',
    ]);

    await expect(controller.updateJob(7, { title: 'Updated' })).resolves.toEqual({ id: 7 });
    await expect(controller.deleteCandidate(3)).resolves.toEqual({ id: 3 });
    expect(service.updateJob).toHaveBeenCalledWith(7, { title: 'Updated' });
    expect(service.deleteCandidate).toHaveBeenCalledWith(3);
  });

  it('updates only the supported job posting fields', async () => {
    const { prisma, service } = createService();
    prisma.jobPosting.update.mockResolvedValue({ id: 7 });

    await expect(
      service.updateJob(7, {
        title: 'Backend Engineer',
        department: 'Engineering',
        requirements: 'Node.js',
        description: 'Build APIs',
        openings: 2,
      }),
    ).resolves.toEqual({ id: 7 });

    expect(prisma.jobPosting.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        title: 'Backend Engineer',
        department: 'Engineering',
        requirements: 'Node.js',
        description: 'Build APIs',
        openings: 2,
      },
    });
  });

  it('deletes a candidate cleanly', async () => {
    const { prisma, service } = createService();
    prisma.candidate.delete.mockResolvedValue({ id: 3 });

    await expect(service.deleteCandidate(3)).resolves.toEqual({ id: 3 });
    expect(prisma.candidate.delete).toHaveBeenCalledWith({ where: { id: 3 } });
  });
});
