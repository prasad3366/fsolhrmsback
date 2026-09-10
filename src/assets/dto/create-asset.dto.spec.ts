import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateAssetDto } from './create-asset.dto';

describe('CreateAssetDto', () => {
  const validateName = (name: unknown) =>
    validate(Object.assign(new CreateAssetDto(), { name }));

  it('accepts a normal asset name', async () => {
    await expect(validateName('Laptop')).resolves.toHaveLength(0);
  });

  it.each(['', '   ', '\t\n'])('rejects an empty or whitespace-only name: %j', async (name) => {
    await expect(validateName(name)).resolves.not.toHaveLength(0);
  });

  it.each([null, 123, {}, []])('rejects a non-string name: %j', async (name) => {
    await expect(validateName(name)).resolves.not.toHaveLength(0);
  });
});