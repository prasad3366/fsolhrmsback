import { ForbiddenException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { DocumentsService } from './documents.service';

describe('DocumentsService Employee 360 document metadata', () => {
  const employeeDocumentFindMany = jest.fn();
  const prisma = { employeeDocument: { findMany: employeeDocumentFindMany } } as any;
  const authorizationService = {
    canAccessEmployee: jest.fn(),
    canAccessOrganizationWide: jest.fn(),
  } as any;
  const service = new DocumentsService(prisma, authorizationService);

  beforeEach(() => {
    jest.clearAllMocks();
    authorizationService.canAccessEmployee.mockResolvedValue(true);
    authorizationService.canAccessOrganizationWide.mockImplementation((user: any) =>
      ['SUPER_ADMIN', 'CEO', 'HR'].includes(user?.role),
    );
    employeeDocumentFindMany.mockResolvedValue([
      {
        id: 15,
        fileName: 'passport.pdf',
        mimeType: 'application/pdf',
        status: 'APPROVED',
        uploadedAt: new Date('2026-09-01'),
        verifiedAt: new Date('2026-09-02'),
        documentType: { id: 2, name: 'Identity Proof' },
      },
    ]);
  });

  it('returns metadata only for the authenticated employee target', async () => {
    const user = { id: 1, role: 'EMPLOYEE', employeeId: 7 };

    await expect(service.getEmployee360DocumentMetadata(user, 7)).resolves.toEqual([
      expect.objectContaining({ id: 15, fileName: 'passport.pdf', mimeType: 'application/pdf' }),
    ]);

    expect(authorizationService.canAccessOrganizationWide).toHaveBeenCalledWith(user, 'documents');
    expect(employeeDocumentFindMany).toHaveBeenCalledWith({
      where: { employeeId: 7, status: DocumentStatus.APPROVED },
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
    const query = employeeDocumentFindMany.mock.calls[0][0];
    expect(query.select).not.toHaveProperty('fileData');
    expect(query.select).not.toHaveProperty('employee');
    expect(query.select).not.toHaveProperty('remarks');
  });

  it('denies an EMPLOYEE another employee document metadata', async () => {
    authorizationService.canAccessEmployee.mockResolvedValue(false);

    await expect(
      service.getEmployee360DocumentMetadata({ id: 1, role: 'EMPLOYEE', employeeId: 7 }, 8),
    ).rejects.toThrow(ForbiddenException);
    expect(employeeDocumentFindMany).not.toHaveBeenCalled();
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'])('denies %s for employee document metadata', async (role) => {
    await expect(
      service.getEmployee360DocumentMetadata({ id: 1, role, employeeId: 4 }, 7),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s permitted organization-wide access', async (role) => {
    await expect(
      service.getEmployee360DocumentMetadata({ id: 1, role }, 7),
    ).resolves.toHaveLength(1);
  });

  it('denies FINANCE_MANAGER without relying on the broader employee policy', async () => {
    await expect(
      service.getEmployee360DocumentMetadata({ id: 1, role: 'FINANCE_MANAGER', employeeId: 10 }, 7),
    ).rejects.toThrow(ForbiddenException);
    expect(employeeDocumentFindMany).not.toHaveBeenCalled();
  });

  it('does not trust client-supplied team, manager, or employee identifiers', async () => {
    const user = {
      id: 1,
      role: 'HR',
      employeeId: 4,
      teamId: 999,
      managerId: 999,
      requestedEmployeeId: 999,
    } as any;

    await service.getEmployee360DocumentMetadata(user, 7);

    expect(employeeDocumentFindMany.mock.calls[0][0].where).toEqual({
      employeeId: 7,
      status: DocumentStatus.APPROVED,
    });
  });

  it('does not return binary or base64 content', async () => {
    const result = await service.getEmployee360DocumentMetadata(
      { id: 1, role: 'HR' },
      7,
    );

    expect(result[0]).not.toHaveProperty('fileData');
    expect(result[0]).not.toHaveProperty('data');
    expect(result[0]).not.toHaveProperty('url');
  });
});