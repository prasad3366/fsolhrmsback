import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentStatus } from '@prisma/client';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async createEmployee(data: any) {
    return this.prisma.employee.create({ data });
  }

  async getRequiredDocuments(employeeId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) throw new NotFoundException('Employee not found');

    const mandatoryCommonDocs = [];
    const mandatoryExperiencedDocs = ['Payslip', 'Experience Letter', 'Relieving Letter'];

    // ensure common doc type exists for all employees
    await Promise.all(
      mandatoryCommonDocs.map((name) =>
        this.prisma.documentType.upsert({
          where: { name },
          update: {
            isMandatory: true,
            forExperienced: true,
            forFresher: true,
          },
          create: {
            name,
            isMandatory: true,
            forExperienced: true,
            forFresher: true,
          },
        }),
      ),
    );

    if (employee.isExperienced) {
      // Ensure experienced-only doc types exist, and include them in required docs
      await Promise.all(
        mandatoryExperiencedDocs.map((name) =>
          this.prisma.documentType.upsert({
            where: { name },
            update: { forExperienced: true },
            create: {
              name,
              isMandatory: true,
              forExperienced: true,
              forFresher: false,
            },
          }),
        ),
      );

      return this.prisma.documentType.findMany({
        where: {
          OR: [
            { forExperienced: true },
            { name: { in: [...mandatoryCommonDocs, ...mandatoryExperiencedDocs] } },
          ],
        },
      });
    }

    return this.prisma.documentType.findMany({
      where: {
        OR: [
          { forFresher: true },
          { name: { in: mandatoryCommonDocs } },
        ],
      },
    });
  }

  async uploadMultiple(
    employeeId: number,
    documentTypeIds: string[],
    files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0)
      throw new BadRequestException('No files uploaded');

    if (files.length !== documentTypeIds.length)
      throw new BadRequestException(
        'Files count and documentTypeIds count must match',
      );

    const uploads: any[] = [];

    for (let i = 0; i < files.length; i++) {
      uploads.push(
        this.prisma.employeeDocument.upsert({
          where: {
            employeeId_documentTypeId: {
              employeeId,
              documentTypeId: Number(documentTypeIds[i]),
            },
          },
          update: {
            fileName: files[i].originalname,
            mimeType: files[i].mimetype,
            fileData: files[i].buffer,
            status: DocumentStatus.PENDING,
            uploadedAt: new Date(),
          },
          create: {
            employeeId,
            documentTypeId: Number(documentTypeIds[i]),
            fileName: files[i].originalname,
            mimeType: files[i].mimetype,
            fileData: files[i].buffer,
          },
        }),
      );
    }

    return Promise.all(uploads);
  }

  // ROLE BASED VIEW
  async getDocuments(employeeId: number, role: string) {
    if (role === 'EMPLOYEE') {
      return this.prisma.employeeDocument.findMany({
        where: { employeeId },
        include: { documentType: true },
      });
    }

    if (['HR', 'ADMIN', 'MANAGER'].includes(role)) {
      return this.prisma.employeeDocument.findMany({
        include: {
          employee: true,
          documentType: true,
        },
      });
    }

    throw new ForbiddenException('Access denied');
  }

  // SINGLE APPROVAL
  async updateDocumentStatus(
    documentId: number,
    status: DocumentStatus,
    role: string,
  ) {
    if (!['HR', 'ADMIN'].includes(role))
      throw new ForbiddenException('Only HR/Admin can approve');

    return this.prisma.employeeDocument.update({
      where: { id: documentId },
      data: { status },
    });
  }

  // APPROVE ALL
  async approveAllDocuments(employeeId: number, role: string) {
    if (!['HR', 'ADMIN'].includes(role))
      throw new ForbiddenException('Only HR/Admin can approve');

    return this.prisma.employeeDocument.updateMany({
      where: {
        employeeId,
        status: DocumentStatus.PENDING,
      },
      data: {
        status: DocumentStatus.APPROVED,
      },
    });
  }

  async getFile(documentId: number) {
    const doc = await this.prisma.employeeDocument.findUnique({
      where: { id: documentId },
    });

    if (!doc) throw new NotFoundException('Document not found');

    return doc;
  }
}
