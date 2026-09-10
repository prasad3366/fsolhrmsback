import { BadRequestException } from '@nestjs/common';
import { AssetsController, PositiveIntPipe } from './assets.controller';

describe('AssetsController return route ID validation', () => {
  const pipe = new PositiveIntPipe();

  it('passes a valid positive asset ID to the service', async () => {
    const assetsService = {
      returnAsset: jest.fn().mockResolvedValue({ id: 12, status: 'RETURNED' }),
    };
    const controller = new AssetsController(assetsService as any, {} as any);
    const assetId = await pipe.transform('12', {
      type: 'param',
      data: 'id',
      metatype: Number,
    });

    await expect(
      controller.returnAsset({ user: { id: 1, role: 'HR' } } as any, assetId),
    ).resolves.toEqual({
      id: 12,
      status: 'RETURNED',
    });
    expect(assetsService.returnAsset).toHaveBeenCalledWith(12);
  });

  it.each(['abc', 'NaN', '0', '-1'])('rejects invalid asset ID %s', async (value) => {
    await expect(
      pipe.transform(value, { type: 'param', data: 'id', metatype: Number }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not call the service when the asset ID is invalid', async () => {
    const assetsService = { returnAsset: jest.fn() };
    const controller = new AssetsController(assetsService as any, {} as any);

    await expect(
      pipe.transform('-5', { type: 'param', data: 'id', metatype: Number }),
    ).rejects.toThrow(BadRequestException);

    expect(assetsService.returnAsset).not.toHaveBeenCalled();
    expect(controller).toBeDefined();
  });
});

describe('AssetsController authorization contracts', () => {
  it('preserves the POST /assets/assign employeeId contract', async () => {
    const assignAsset = jest.fn().mockResolvedValue({ id: 12, status: 'ASSIGNED' });
    const controller = new AssetsController({ assignAsset } as any, {} as any);
    const dto = { assetId: 12, employeeId: 7 };

    await expect(
      controller.assign({ user: { id: 1, role: 'HR' } } as any, dto),
    ).resolves.toEqual({ id: 12, status: 'ASSIGNED' });
    expect(assignAsset).toHaveBeenCalledWith(dto);
  });

  it('restricts organization-wide asset routes to SUPER_ADMIN, CEO, and HR', () => {
    expect(Reflect.getMetadata('roles', AssetsController.prototype.create)).toEqual([
      'SUPER_ADMIN',
      'CEO',
      'HR',
    ]);
    expect(Reflect.getMetadata('roles', AssetsController.prototype.findAll)).toEqual([
      'SUPER_ADMIN',
      'CEO',
      'HR',
    ]);
    expect(Reflect.getMetadata('roles', AssetsController.prototype.returnAsset)).toEqual([
      'SUPER_ADMIN',
      'CEO',
      'HR',
    ]);
    expect(Reflect.getMetadata('roles', AssetsController.prototype.assign)).toEqual([
      'SUPER_ADMIN',
      'CEO',
      'HR',
    ]);
    for (const role of ['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER', 'EMPLOYEE']) {
      expect(Reflect.getMetadata('roles', AssetsController.prototype.findAll)).not.toContain(role);
    }
  });

  it('uses the authenticated User.id for self-asset access', async () => {
    const findMyAssets = jest.fn().mockResolvedValue([]);
    const controller = new AssetsController(
      { findMyAssets } as any,
      {} as any,
    );
    const user = { id: 900, role: 'EMPLOYEE', employeeId: 7 };

    await controller.getMyAssetsFromToken({ user } as any);

    expect(findMyAssets).toHaveBeenCalledWith(900);
    expect(findMyAssets).not.toHaveBeenCalledWith(7);
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER', 'EMPLOYEE'])(
    'allows %s to use self-asset access without a client employee ID',
    async (role) => {
      const findMyAssets = jest.fn().mockResolvedValue([]);
      const controller = new AssetsController(
        { findMyAssets } as any,
        {} as any,
      );

      await expect(
        controller.getMyAssetsFromToken({ user: { id: 901, role } } as any),
      ).resolves.toEqual([]);

      expect(findMyAssets).toHaveBeenCalledWith(901);
    },
  );

  it('rejects self-asset access when the authenticated User.id is invalid', async () => {
    const findMyAssets = jest.fn();
    const controller = new AssetsController(
      { findMyAssets } as any,
      {} as any,
    );

    await expect(
      controller.getMyAssetsFromToken({ user: { id: 0, role: 'EMPLOYEE' } } as any),
    ).rejects.toThrow(BadRequestException);
    expect(findMyAssets).not.toHaveBeenCalled();
  });
});