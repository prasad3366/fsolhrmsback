import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentStatus } from '@prisma/client';
import {
  AuthorizationService,
  AuthorizationUser,
} from '../common/authorization/authorization.service';

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);

const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
]);

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private authorizationService: AuthorizationService,
  ) {}

  private validateDocumentFile(file: Express.Multer.File, fileName?: string) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty');
    }

    const normalizedMime = String(file.mimetype || '').toLowerCase();
    const originalName = String(fileName || file.originalname || '').toLowerCase();
    const extension = originalName.includes('.')
      ? originalName.slice(originalName.lastIndexOf('.'))
      : '';

    const mimeAllowed = ALLOWED_DOCUMENT_MIME_TYPES.has(normalizedMime);
    const extAllowed = ALLOWED_DOCUMENT_EXTENSIONS.has(extension);

    if (!mimeAllowed && !extAllowed) {
      throw new BadRequestException(
        'Unsupported file type. Allowed formats: PDF, DOC, DOCX, PNG, JPG, JPEG',
      );
    }

    if (file.size && file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds the 5MB limit');
    }
  }

  private validateStoredDocumentFile(file: Express.Multer.File) {
    const normalizedMime = String(file.mimetype || '').toLowerCase();
    const originalName = String(file.originalname || '').toLowerCase();
    const extension = originalName.includes('.')
      ? originalName.slice(originalName.lastIndexOf('.'))
      : '';

    if (
      !ALLOWED_DOCUMENT_MIME_TYPES.has(normalizedMime) &&
      !ALLOWED_DOCUMENT_EXTENSIONS.has(extension)
    ) {
      throw new BadRequestException(
        'Unsupported file type. Allowed formats: PDF, DOC, DOCX, PNG, JPG, JPEG',
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds the 5MB limit');
    }
  }

  async getRequiredDocuments(employeeId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) throw new NotFoundException('Employee not found');

    const standardDocumentTypes = ['Experience Letter', 'Payslip', 'Relieving Letter'];

    await Promise.all(
      standardDocumentTypes.map((name) =>
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

    return this.prisma.documentType.findMany({
      where: { name: { in: standardDocumentTypes } },
      orderBy: { name: 'asc' },
    });
  }

  async uploadMultiple(
    employeeId: number,
    documentTypeIds: string[],
    files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0)
      throw new BadRequestException('No files uploaded');

    if (!documentTypeIds || documentTypeIds.length === 0)
      throw new BadRequestException('documentTypeIds are required');

    if (files.length !== documentTypeIds.length)
      throw new BadRequestException(
        'Files count and documentTypeIds count must match',
      );

    const normalizedDocumentTypeIds = documentTypeIds.map((id) => Number(id));

    if (normalizedDocumentTypeIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException('Each documentTypeId must be a valid positive integer');
    }

    if (new Set(normalizedDocumentTypeIds).size !== normalizedDocumentTypeIds.length) {
      throw new BadRequestException('Duplicate documentTypeIds are not allowed in the same upload');
    }

    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const uploads: any[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const documentTypeId = normalizedDocumentTypeIds[i];

      this.validateDocumentFile(file);

      uploads.push(
        this.prisma.employeeDocument.create({
          data: {
            employeeId,
            documentTypeId,
            fileName: file.originalname,
            mimeType: file.mimetype,
            fileData: file.buffer,
            status: DocumentStatus.PENDING,
          },
        }),
      );
    }

    return Promise.all(uploads);
  }

  // ROLE BASED VIEW
  async getDocuments(employeeId?: number, role?: string) {
    const normalizedRole = String(role ?? '').toUpperCase();
    const isManagementRole = ['SUPER_ADMIN', 'CEO', 'HR'].includes(normalizedRole);

    if (isManagementRole) {
      return this.prisma.employeeDocument.findMany({
        where: employeeId ? { employeeId } : {},
        include: {
          employee: true,
          documentType: true,
        },
      });
    }

    if (normalizedRole !== 'EMPLOYEE') {
      throw new ForbiddenException('Document access denied');
    }

    if (employeeId === undefined || !Number.isInteger(employeeId) || employeeId <= 0) {
      throw new ForbiddenException('Document access denied');
    }

    return this.prisma.employeeDocument.findMany({
      where: {
        employeeId,
        status: DocumentStatus.APPROVED,
      },
      include: {
        employee: true,
        documentType: true,
      },
    });
  }

  async getEmployee360DocumentMetadata(
    user: AuthorizationUser,
    employeeId: number,
  ) {
    const normalizedRole = String(user.role ?? '').toUpperCase();
    const hasAccess = this.authorizationService.canAccessOrganizationWide(user, 'documents')
      || (normalizedRole === 'EMPLOYEE' && Number(user.employeeId) === employeeId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied for employee documents');
    }

    return this.prisma.employeeDocument.findMany({
      where: {
        employeeId,
        status: DocumentStatus.APPROVED,
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        status: true,
        uploadedAt: true,
        verifiedAt: true,
        documentType: { select: { id: true, name: true } },
      },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  // SINGLE APPROVAL
  async updateDocumentStatus(
    documentId: number,
    status: DocumentStatus,
    role?: string,
    rejectionReason?: string,
  ) {
    if (status === DocumentStatus.REJECTED) {
      const normalizedReason = String(rejectionReason ?? '').trim();
      if (!normalizedReason) {
        throw new BadRequestException('Rejection reason is required');
      }
    }

    return this.prisma.employeeDocument.update({
      where: { id: documentId },
      data: {
        status,
        remarks: status === DocumentStatus.REJECTED ? rejectionReason : undefined,
      },
    });
  }

  // APPROVE ALL
  async approveAllDocuments(employeeId: number, role?: string) {
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new BadRequestException('Invalid employee id');
    }

    const targetEmployee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!targetEmployee) {
      throw new NotFoundException('Employee not found');
    }

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
