import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateTeamDto } from './create-team.dto';

describe('CreateTeamDto', () => {
  const validateInput = (name: any, managerId: any) => {
    const dto = Object.assign(new CreateTeamDto(), { name, managerId });
    return validate(dto);
  };

  it.each(['', '   ', '\t\n'])('rejects invalid team names: %j', async (name) => {
    await expect(validateInput(name, 'IT001')).resolves.not.toHaveLength(0);
  });

  it.each(['', '   ', '\t\n'])('rejects invalid manager IDs: %j', async (managerId) => {
    await expect(validateInput('IT Team', managerId)).resolves.not.toHaveLength(0);
  });

  it('accepts the existing valid team creation input', async () => {
    await expect(validateInput('IT Team', 'IT001')).resolves.toHaveLength(0);
  });
});