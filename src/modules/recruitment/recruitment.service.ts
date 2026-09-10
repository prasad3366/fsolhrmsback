import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';

@Injectable()
export class RecruitmentService {
  constructor(private readonly prisma: PrismaService) {}

  createJob(dto: CreateJobDto, userId: number) {
    return this.prisma.jobPosting.create({
      data: {
        title: dto.title,
        department: dto.department,
        teamId: dto.teamId,
        description: dto.description ?? '',
        requirements: dto.requirements ?? '',
        openings: dto.openings ?? 1,
        createdById: userId,
      },
    });
  }

  findCandidates() {
    return this.prisma.candidate.findMany({
      include: {
        jobPosting: true,
        interviews: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findJobs() {
    return this.prisma.jobPosting.findMany({
      include: { candidates: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteJob(jobId: number) {
    const candidates = await this.prisma.candidate.findMany({
      where: { jobPostingId: jobId },
      select: { id: true },
      take: 1,
    });

    if (candidates.length > 0) {
      throw new ConflictException('Candidates must be processed before deleting this job posting');
    }

    return this.prisma.jobPosting.delete({ where: { id: jobId } });
  }

  updateJob(jobId: number, dto: UpdateJobDto) {
    return this.prisma.jobPosting.update({
      where: { id: jobId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.department !== undefined && { department: dto.department }),
        ...(dto.requirements !== undefined && { requirements: dto.requirements }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.openings !== undefined && { openings: dto.openings }),
      },
    });
  }

  deleteCandidate(candidateId: number) {
    return this.prisma.candidate.delete({ where: { id: candidateId } });
  }
}
