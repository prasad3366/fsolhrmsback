import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { HolidaysController, HolidayYearPipe, PositiveHolidayIdPipe } from './holidays.controller';
import { RolesGuard } from '../common/guards/roles.guard';

describe('Holiday route parameter validation', () => {
  const idPipe = new PositiveHolidayIdPipe();
  const yearPipe = new HolidayYearPipe();

  it('accepts valid positive safe IDs and four-digit years', () => {
    expect(idPipe.transform('42')).toBe(42);
    expect(yearPipe.transform('2026')).toBe(2026);
  });

  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992'])('rejects invalid ID: %s', (value) => {
    expect(() => idPipe.transform(value)).toThrow(BadRequestException);
  });

  it.each(['999', '10000', '202.6', 'NaN', '0', '2200'])('rejects invalid year: %s', (value) => {
    expect(() => yearPipe.transform(value)).toThrow(BadRequestException);
  });

  it('restricts create, update, and delete to the existing Holiday admin roles', () => {
    for (const method of ['create', 'update', 'remove']) {
      expect(Reflect.getMetadata('roles', HolidaysController.prototype[method])).toEqual([
        Role.SUPER_ADMIN,
        Role.CEO,
        Role.HR,
      ]);
      expect(Reflect.getMetadata('__guards__', HolidaysController.prototype[method])).toContain(RolesGuard);
    }
  });

  it('keeps the Holiday routes and delegates valid requests', async () => {
    const service = {
      createHoliday: jest.fn().mockResolvedValue({ id: 1 }),
      getHolidaysByYear: jest.fn().mockResolvedValue([{ id: 1 }]),
      getHolidayById: jest.fn().mockResolvedValue({ id: 1 }),
      updateHoliday: jest.fn().mockResolvedValue({ id: 1 }),
      deleteHoliday: jest.fn().mockResolvedValue({ message: 'Holiday deleted successfully' }),
    };
    const controller = new HolidaysController(service as any);

    await expect(controller.create({ name: 'New Year', date: '2026-01-01' } as any)).resolves.toEqual({ id: 1 });
    await expect(controller.getByYear(2026)).resolves.toEqual([{ id: 1 }]);
    await expect(controller.getById(1)).resolves.toEqual({ id: 1 });
    await expect(controller.update(1, { name: 'Updated' } as any)).resolves.toEqual({ id: 1 });
    await expect(controller.remove(1)).resolves.toEqual({ message: 'Holiday deleted successfully' });

    expect(service.createHoliday).toHaveBeenCalledWith({ name: 'New Year', date: '2026-01-01' });
    expect(service.getHolidaysByYear).toHaveBeenCalledWith(2026);
    expect(service.getHolidayById).toHaveBeenCalledWith(1);
    expect(service.updateHoliday).toHaveBeenCalledWith(1, { name: 'Updated' });
    expect(service.deleteHoliday).toHaveBeenCalledWith(1);
  });
});