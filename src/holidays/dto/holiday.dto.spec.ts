import { validate } from 'class-validator';
import { CreateHolidayDto, UpdateHolidayDto } from './holiday.dto';

describe('Holiday DTO validation', () => {
  it('requires a non-empty name and valid date on create', async () => {
    const dto = Object.assign(new CreateHolidayDto(), { name: '', date: 'invalid' });
    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['name', 'date']));
  });

  it('rejects a missing create name', async () => {
    const dto = Object.assign(new CreateHolidayDto(), { date: '2026-01-01' });

    await expect(validate(dto)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'name' }),
    ]));
  });

  it('accepts valid create and update DTOs', async () => {
    const createDto = Object.assign(new CreateHolidayDto(), {
      name: 'Founders Day',
      date: '2026-08-15',
      description: 'Office closed',
      isOptional: true,
      location: 'HQ',
    });
    const updateDto = Object.assign(new UpdateHolidayDto(), {
      name: 'Updated Day',
      date: '2026-08-16',
      description: 'Updated description',
      isOptional: false,
      location: 'Remote',
    });

    await expect(validate(createDto)).resolves.toHaveLength(0);
    await expect(validate(updateDto)).resolves.toHaveLength(0);
  });

  it('validates optional field types and rejects unknown update fields with whitelist validation', async () => {
    const dto = Object.assign(new UpdateHolidayDto(), {
      isOptional: 'false',
      description: 7,
      location: 8,
      unknown: true,
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['isOptional', 'description', 'location', 'unknown']),
    );
  });
});