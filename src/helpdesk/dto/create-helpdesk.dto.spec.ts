import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateHelpdeskDto } from './create-helpdesk.dto';

describe('CreateHelpdeskDto', () => {
  const validateInput = (issue: unknown, reason: unknown) =>
    validate(Object.assign(new CreateHelpdeskDto(), { issue, reason }));

  it('accepts valid issue and reason text', async () => {
    await expect(validateInput('Laptop', 'Screen is broken')).resolves.toHaveLength(0);
  });

  it.each(['', '   ', '\t\n'])('rejects invalid issue text: %j', async (issue) => {
    await expect(validateInput(issue, 'Valid reason')).resolves.not.toHaveLength(0);
  });

  it.each(['', '   ', '\t\n'])('rejects invalid reason text: %j', async (reason) => {
    await expect(validateInput('Valid issue', reason)).resolves.not.toHaveLength(0);
  });
});