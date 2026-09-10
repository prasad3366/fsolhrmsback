import { BadRequestException } from '@nestjs/common';
import { PositiveIntPipe, TeamController } from './team.controller';

describe('TeamController route ID validation', () => {
  const pipe = new PositiveIntPipe();

  it.each(['abc', 'NaN'])('rejects non-numeric Team IDs: %s', async (value) => {
    await expect(pipe.transform(value, { type: 'param', data: 'id', metatype: Number })).rejects.toThrow(
      BadRequestException,
    );
  });

  it.each(['0', '-1'])('rejects invalid non-positive Team IDs: %s', async (value) => {
    await expect(pipe.transform(value, { type: 'param', data: 'id', metatype: Number })).rejects.toThrow(
      BadRequestException,
    );
  });

  it.each(['abc', '0', '-1'])('rejects invalid Employee IDs: %s', async (value) => {
    await expect(
      pipe.transform(value, { type: 'param', data: 'employeeId', metatype: Number }),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes a valid positive Team ID to the existing service behavior', async () => {
    const teamService = {
      deleteTeam: jest.fn().mockResolvedValue({ message: 'Team deleted successfully' }),
    };
    const controller = new TeamController(teamService as any);
    const teamId = await pipe.transform('12', { type: 'param', data: 'id', metatype: Number });

    await expect(controller.deleteTeam({ user: { role: 'CEO' } }, teamId)).resolves.toEqual({
      message: 'Team deleted successfully',
    });
    expect(teamService.deleteTeam).toHaveBeenCalledWith(12, { role: 'CEO' });
  });
});