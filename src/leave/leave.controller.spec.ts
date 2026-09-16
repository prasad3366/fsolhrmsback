import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LeaveController } from './leave.controller';
import { RejectLeaveDto } from './dto/reject-leave.dto';

describe('LeaveController rejection validation', () => {
  it('accepts the existing remarks body shape and forwards the DTO field', async () => {
    const service = { rejectLeave: jest.fn().mockResolvedValue({ id: 15 }) } as any;
    const controller = new LeaveController(service, {} as any);

    await expect(controller.reject(
      { user: { id: 1, role: 'HR', employeeId: 10 } },
      '15',
      { remarks: 'Not approved' },
    )).resolves.toEqual({ id: 15 });

    expect(service.rejectLeave).toHaveBeenCalledWith(15, 'Not approved', 10, 'HR');
  });

  it('validates rejection DTO content and preserves whitelist behavior', async () => {
    const dto = plainToInstance(RejectLeaveDto, {
      remarks: 'Not approved',
      unexpected: 'removed',
    });
    const errors = await validate(dto, { whitelist: true });

    expect(errors).toHaveLength(0);
    expect(dto).toEqual({ remarks: 'Not approved' });
  });

  it('rejects invalid DTO remarks', async () => {
    const dto = plainToInstance(RejectLeaveDto, { remarks: '   ' });
    const errors = await validate(dto, { whitelist: true });

    expect(errors.length).toBeGreaterThan(0);
  });

  it.each(['CEO', 'FINANCE_MANAGER'])('allows %s to reach canonical Leave authorization', async (role) => {
    const service = { approveLeave: jest.fn().mockResolvedValue({ id: 15 }) } as any;
    const controller = new LeaveController(service, {} as any);

    await expect(controller.approve({ user: { id: 1, role, employeeId: 10 } }, '15'))
      .resolves.toEqual({ id: 15 });

    expect(service.approveLeave).toHaveBeenCalledWith(15, 10, role);
  });

  it('rejects EMPLOYEE before an approval service call', async () => {
    const service = { approveLeave: jest.fn() } as any;
    const controller = new LeaveController(service, {} as any);

    await expect(
      controller.approve({ user: { id: 1, role: 'EMPLOYEE', employeeId: 10 } }, '15'),
    ).rejects.toThrow('Access denied');
    expect(service.approveLeave).not.toHaveBeenCalled();
  });
});