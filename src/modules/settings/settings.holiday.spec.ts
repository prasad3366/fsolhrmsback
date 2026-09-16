import { SettingsController } from './settings.controller';

describe('SettingsController holiday delegation', () => {
  const holidaysService = {
    getAllHolidays: jest.fn().mockResolvedValue([{ id: 1 }]),
    createHoliday: jest.fn().mockResolvedValue({ id: 2 }),
    deleteHoliday: jest.fn().mockResolvedValue({ id: 3 }),
  };

  const createController = () =>
    new SettingsController(
      {} as any,
      {} as any,
      {} as any,
      holidaysService as any,
      {} as any,
      {} as any,
    );

  beforeEach(() => jest.clearAllMocks());

  it('delegates Settings holiday listing to the canonical HolidaysService', async () => {
    await expect(createController().getHolidays()).resolves.toEqual([{ id: 1 }]);
    expect(holidaysService.getAllHolidays).toHaveBeenCalledTimes(1);
  });

  it('delegates Settings holiday creation to canonical validation and persistence', async () => {
    const dto = {
      title: 'New Year',
      date: '2026-01-01',
      description: 'Office closed',
      isOptional: false,
      branchId: 4,
    };

    await expect(createController().createHoliday(dto)).resolves.toEqual({ id: 2 });
    expect(holidaysService.createHoliday).toHaveBeenCalledWith({
      name: 'New Year',
      date: '2026-01-01',
      description: 'Office closed',
      isOptional: false,
    }, {
      title: 'New Year',
      branchId: 4,
    });
  });

  it('delegates Settings holiday deletion to the canonical protection path', async () => {
    await expect(createController().deleteHoliday(3)).resolves.toEqual({ id: 3 });
    expect(holidaysService.deleteHoliday).toHaveBeenCalledWith(3, true);
  });

  it('preserves the existing Settings holiday mutation roles', () => {
    for (const method of ['createHoliday', 'deleteHoliday']) {
      expect(Reflect.getMetadata('roles', SettingsController.prototype[method])).toEqual([
        'SUPER_ADMIN',
        'Super_admin',
        'CEO',
        'HR',
      ]);
    }
  });

  it('allows CEO on the organization-wide Settings routes', () => {
    expect(Reflect.getMetadata('roles', SettingsController)).toContain('CEO');

    const explicitlyProtectedRoutes = [
      'getAttendancePolicy',
      'updateAttendancePolicy',
      'getLeavePolicies',
      'upsertLeavePolicy',
      'deleteLeavePolicy',
      'getHolidays',
      'createHoliday',
      'deleteHoliday',
      'getEmployeeLifecycle',
      'updateEmployeeLifecycle',
      'getSecurityPolicy',
      'updateSecurityPolicy',
      'getWorkflows',
      'updateWorkflow',
      'getNotifications',
      'updateNotifications',
    ] as const;

    for (const method of explicitlyProtectedRoutes) {
      expect(Reflect.getMetadata('roles', SettingsController.prototype[method])).toContain('CEO');
    }
  });
});