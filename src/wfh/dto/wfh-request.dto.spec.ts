import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestWfhDto } from './wfh-request.dto';

describe('RequestWfhDto validation', () => {
  it('accepts valid date-only values with an omitted reason', async () => {
    const dto = plainToInstance(RequestWfhDto, {
      startDate: '2026-09-04',
      endDate: '2026-09-04',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts a valid non-empty reason', async () => {
    const dto = plainToInstance(RequestWfhDto, {
      startDate: '2026-09-04',
      endDate: '2026-09-04',
      reason: 'Work from home',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each(['', '   '])('rejects an empty reason: %j', async (reason) => {
    const dto = plainToInstance(RequestWfhDto, {
      startDate: '2026-09-04',
      endDate: '2026-09-04',
      reason,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-string reason', async () => {
    const dto = plainToInstance(RequestWfhDto, {
      startDate: '2026-09-04',
      endDate: '2026-09-04',
      reason: 123,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});