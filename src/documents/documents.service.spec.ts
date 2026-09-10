import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { DocumentsService } from './documents.service';

describe('DocumentsService', () => {
  let prisma: any;
  let service: DocumentsService;

  beforeEach(() => {
    prisma = {
      employee: {
        findUnique: jest.fn(),
      },
      documentType: {
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
      employeeDocument: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new DocumentsService({ ...prisma }, {
      canAccessEmployee: jest.fn(),
      canAccessOrganizationWide: jest.fn(),
    } as any);
  });

  it.each([false, true])('returns all standard document types for %s experienced employees', async (isExperienced) => {
    prisma.employee.findUnique.mockResolvedValue({ id: 1, isExperienced });
    prisma.documentType.upsert.mockResolvedValue({});
    prisma.documentType.findMany.mockResolvedValue([
      { id: 1, name: 'Experience Letter' },
      { id: 2, name: 'Payslip' },
      { id: 3, name: 'Relieving Letter' },
    ]);

    await expect(service.getRequiredDocuments(1)).resolves.toEqual([
      { id: 1, name: 'Experience Letter' },
      { id: 2, name: 'Payslip' },
      { id: 3, name: 'Relieving Letter' },
    ]);

    expect(prisma.documentType.upsert).toHaveBeenCalledTimes(3);
    for (const [name, call] of prisma.documentType.upsert.mock.calls.map((entry: any[]) => [entry[0].where.name, entry[0]])) {
      expect(call.update).toEqual({ isMandatory: true, forExperienced: true, forFresher: true });
      expect(call.create).toEqual({ name, isMandatory: true, forExperienced: true, forFresher: true });
    }
    expect(prisma.documentType.findMany).toHaveBeenCalledWith({
      where: { name: { in: ['Experience Letter', 'Payslip', 'Relieving Letter'] } },
      orderBy: { name: 'asc' },
    });
  });

  it('rejects mismatched files and documentTypeIds', async () => {
    await expect(
      service.uploadMultiple(1, ['1', '2'], [{ originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('a') } as any]),
    ).rejects.toThrow(BadRequestException);
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('returns all statuses for %s management visibility', async (role) => {
    prisma.employeeDocument.findMany.mockResolvedValue([]);

    await service.getDocuments(undefined, role);

    expect(prisma.employeeDocument.findMany).toHaveBeenCalledWith({
      where: {},
      include: { employee: true, documentType: true },
    });
  });

  it('keeps management visibility scoped by selected employee without status filtering', async () => {
    prisma.employeeDocument.findMany.mockResolvedValue([]);

    await service.getDocuments(42, 'HR');

    expect(prisma.employeeDocument.findMany).toHaveBeenCalledWith({
      where: { employeeId: 42 },
      include: { employee: true, documentType: true },
    });
  });

  it('returns only approved documents for employees', async () => {
    prisma.employeeDocument.findMany.mockResolvedValue([]);

    await service.getDocuments(42, 'EMPLOYEE');

    expect(prisma.employeeDocument.findMany).toHaveBeenCalledWith({
      where: { employeeId: 42, status: DocumentStatus.APPROVED },
      include: { employee: true, documentType: true },
    });
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER', 'UNKNOWN'])('denies %s document list visibility', async (role) => {
    await expect(service.getDocuments(42, role)).rejects.toThrow('Document access denied');
    expect(prisma.employeeDocument.findMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate documentTypeIds in one upload request', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 1 });

    const files = [
      { originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('a') },
      { originalname: 'b.pdf', mimetype: 'application/pdf', buffer: Buffer.from('b') },
    ] as any[];

    await expect(service.uploadMultiple(1, ['1', '1'], files)).rejects.toThrow(BadRequestException);
  });

  it('upserts valid documents and resets status to pending', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 1 });
    prisma.employeeDocument.upsert.mockResolvedValue({ id: 10 });

    const files = [
      { originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('a') },
      { originalname: 'b.png', mimetype: 'image/png', buffer: Buffer.from('b') },
    ] as any[];

    await expect(service.uploadMultiple(1, ['1', '2'], files)).resolves.toHaveLength(2);
    expect(prisma.employeeDocument.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.employeeDocument.upsert.mock.calls[0][0].update.status).toBe(DocumentStatus.PENDING);
    expect(prisma.employeeDocument.upsert.mock.calls[0][0].where.employeeId_documentTypeId).toEqual({ employeeId: 1, documentTypeId: 1 });
    expect(prisma.employeeDocument.upsert.mock.calls[1][0].where.employeeId_documentTypeId).toEqual({ employeeId: 1, documentTypeId: 2 });
  });

  it('keeps duplicate filenames associated with their distinct document types', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 1 });
    prisma.employeeDocument.upsert.mockResolvedValue({ id: 10 });
    const files = [
      { originalname: 'document.pdf', mimetype: 'application/pdf', buffer: Buffer.from('experience') },
      { originalname: 'document.pdf', mimetype: 'application/pdf', buffer: Buffer.from('payslip') },
    ] as any[];

    await service.uploadMultiple(1, ['11', '12'], files);

    expect(prisma.employeeDocument.upsert.mock.calls.map((call: any[]) => ({
      key: call[0].where.employeeId_documentTypeId,
      fileName: call[0].create.fileName,
      fileData: call[0].create.fileData.toString(),
    }))).toEqual([
      { key: { employeeId: 1, documentTypeId: 11 }, fileName: 'document.pdf', fileData: 'experience' },
      { key: { employeeId: 1, documentTypeId: 12 }, fileName: 'document.pdf', fileData: 'payslip' },
    ]);
  });

  it('requires a rejection reason when status is REJECTED', async () => {
    prisma.employeeDocument.update.mockResolvedValue({ id: 5 });

    await expect(service.updateDocumentStatus(5, DocumentStatus.REJECTED, 'HR', '')).rejects.toThrow(BadRequestException);
    expect(prisma.employeeDocument.update).not.toHaveBeenCalled();
  });
});
