import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { HelpdeskController, PositiveIntPipe } from './helpdesk.controller';

describe('HelpdeskController management routes', () => {
  const pipe = new PositiveIntPipe();

  it('preserves PATCH routes and passes the authenticated actor to the service', async () => {
    const service = {
      approve: jest.fn().mockResolvedValue({ id: 12, status: 'APPROVED' }),
      resolve: jest.fn().mockResolvedValue({ id: 12, status: 'RESOLVED' }),
    } as any;
    const controller = new HelpdeskController(service, {} as any);
    const actor = { id: 1, role: 'HR' };
    const ticketId = await pipe.transform('12', {
      type: 'param',
      data: 'id',
      metatype: Number,
    });

    await expect(controller.approveTicket({ user: actor }, ticketId)).resolves.toEqual({
      id: 12,
      status: 'APPROVED',
    });
    await expect(controller.resolveTicket({ user: actor }, ticketId)).resolves.toEqual({
      id: 12,
      status: 'RESOLVED',
    });

    expect(service.approve).toHaveBeenCalledWith(12, actor);
    expect(service.resolve).toHaveBeenCalledWith(12, actor);
    expect(Reflect.getMetadata('path', HelpdeskController.prototype.approveTicket)).toBe(':id/approve');
    expect(Reflect.getMetadata('path', HelpdeskController.prototype.resolveTicket)).toBe(':id/resolve');
  });

  it.each(['0', '-1', '1.5', 'abc', '', 'NaN'])('rejects invalid ticket ID %j before service call', async (value) => {
    const service = {
      approve: jest.fn(),
      resolve: jest.fn(),
    } as any;
    const controller = new HelpdeskController(service, {} as any);

    await expect(
      pipe.transform(value, { type: 'param', data: 'id', metatype: Number }),
    ).rejects.toThrow(BadRequestException);

    expect(service.approve).not.toHaveBeenCalled();
    expect(service.resolve).not.toHaveBeenCalled();
    expect(controller).toBeDefined();
  });

  it('keeps PATCH metadata on both lifecycle routes', () => {
    expect(Reflect.getMetadata('method', HelpdeskController.prototype.approveTicket)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata('method', HelpdeskController.prototype.resolveTicket)).toBe(RequestMethod.PATCH);
  });
});