import { DocumentsController } from './documents.controller';
import { ForbiddenException } from '@nestjs/common';

describe('DocumentsController', () => {
  it('does not expose the removed employee-creation route', () => {
    expect((DocumentsController.prototype as any).createEmployee).toBeUndefined();
  });

  describe('document access', () => {
    let controller: DocumentsController;
    let service: any;

    beforeEach(() => {
      service = {
        getDocuments: jest.fn().mockResolvedValue([]),
        uploadMultiple: jest.fn().mockResolvedValue([]),
      };
      controller = new DocumentsController(service, {} as any);
    });

    it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s to manage any employee', async (role) => {
      await controller.getDocuments({ user: { id: 1, role } }, '42');
      await controller.uploadMultiple([], { employeeId: '42', documentTypeIds: ['1'] }, { user: { id: 1, role } });

      expect(service.getDocuments).toHaveBeenCalledWith(42, role);
      expect(service.uploadMultiple).toHaveBeenCalledWith(42, ['1'], []);
    });

    it('allows EMPLOYEE to read only the authenticated employee', async () => {
      await controller.getDocuments({ user: { id: 1, role: 'EMPLOYEE', employeeId: 42 } }, '42');

      expect(service.getDocuments).toHaveBeenCalledWith(42, 'EMPLOYEE');
      await expect(
        controller.getDocuments({ user: { id: 1, role: 'EMPLOYEE', employeeId: 42 } }, '43'),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each(['FINANCE_MANAGER', 'IT_MANAGER', 'SALES_MANAGER', 'UNKNOWN'])('denies %s document access', async (role) => {
      await expect(
        controller.getDocuments({ user: { id: 1, role, employeeId: 42 } }, '42'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.uploadMultiple([], { employeeId: '42', documentTypeIds: ['1'] }, { user: { id: 1, role } }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies EMPLOYEE upload even for the authenticated employee', async () => {
      await expect(
        controller.uploadMultiple([], { employeeId: '42', documentTypeIds: ['1'] }, {
          user: { id: 1, role: 'EMPLOYEE', employeeId: 42 },
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(service.uploadMultiple).not.toHaveBeenCalled();
    });
  });
});