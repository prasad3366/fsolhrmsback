import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import {
  UpdateEmployeeSettingDto,
  UpdateNotificationSettingDto,
} from './dto/policy.dto';
import { AuditService } from './audit.service';

const DEFAULT_SETTINGS = {
  companyName: 'FooDeeZ',
  companyEmail: 'hr@foodeez.com',
  timeZone: 'Asia/Kolkata',
  currency: 'INR',
  financialYearStart: 'April',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '12H',
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getSettings() {
    try {
      return await this.prisma.systemSetting.upsert({
        where: { id: 1 },
        create: { id: 1, ...DEFAULT_SETTINGS },
        update: {},
      });
    } catch (error) {
      return { id: 1, ...DEFAULT_SETTINGS };
    }
  }

  getOrganization() {
    return this.getSettings();
  }

  updateSettings(dto: UpdateSystemSettingsDto) {
    return this.prisma.systemSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        ...DEFAULT_SETTINGS,
        ...dto,
      },
      update: {
        ...(dto.companyName !== undefined && { companyName: dto.companyName }),
        ...(dto.companyLogo !== undefined && { companyLogo: dto.companyLogo }),
        ...(dto.companyEmail !== undefined && { companyEmail: dto.companyEmail }),
        ...(dto.companyPhone !== undefined && { companyPhone: dto.companyPhone }),
        ...(dto.companyAddress !== undefined && { companyAddress: dto.companyAddress }),
        ...(dto.timeZone !== undefined && { timeZone: dto.timeZone }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.financialYearStart !== undefined && {
          financialYearStart: dto.financialYearStart,
        }),
        ...(dto.dateFormat !== undefined && { dateFormat: dto.dateFormat }),
        ...(dto.timeFormat !== undefined && { timeFormat: dto.timeFormat }),
      },
    });
  }

  async getPermissions() {
    try {
      const permissions = await this.prisma.rolePermission.findMany();

      if (!permissions || permissions.length === 0) {
        const defaultRoles = [
          'SUPER_ADMIN',
          'CEO',
          'HR',
          'FINANCE_MANAGER',
          'IT_MANAGER',
          'SALES_MANAGER',
          'EMPLOYEE',
        ];
        const defaultModules = [
          'Recruitment',
          'Training',
          'Announcements',
          'Reports',
          'Payroll',
        ];
        const seedData = defaultRoles.flatMap((roleName) =>
          defaultModules.map((moduleName) => ({
            roleName,
            moduleName,
            canView: true,
            canCreate: ['SUPER_ADMIN', 'CEO', 'HR'].includes(roleName),
            canEdit: ['SUPER_ADMIN', 'CEO', 'HR'].includes(roleName),
            canDelete: ['SUPER_ADMIN', 'CEO', 'HR'].includes(roleName),
            canApprove: ['SUPER_ADMIN', 'CEO', 'HR'].includes(roleName),
            canExport: ['SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER'].includes(roleName),
          })),
        );

        await this.prisma.rolePermission.createMany({
          data: seedData,
          skipDuplicates: true,
        });

        return await this.prisma.rolePermission.findMany();
      }

      return permissions;
    } catch (error) {
      return [];
    }
  }

  updatePermission(dto: UpdateRolePermissionDto, reqUser?: any) {
    const roleName = dto.roleName as string;
    const moduleName = dto.moduleName as string;

    return this.prisma.rolePermission.upsert({
      where: {
        roleName_moduleName: {
          roleName,
          moduleName,
        },
      },
      create: {
        roleName,
        moduleName,
        canView: dto.canView ?? true,
        canCreate: dto.canCreate ?? false,
        canEdit: dto.canEdit ?? false,
        canDelete: dto.canDelete ?? false,
        canApprove: dto.canApprove ?? false,
        canExport: dto.canExport ?? false,
      },
      update: {
        ...(dto.canView !== undefined && { canView: dto.canView }),
        ...(dto.canCreate !== undefined && { canCreate: dto.canCreate }),
        ...(dto.canEdit !== undefined && { canEdit: dto.canEdit }),
        ...(dto.canDelete !== undefined && { canDelete: dto.canDelete }),
        ...(dto.canApprove !== undefined && { canApprove: dto.canApprove }),
        ...(dto.canExport !== undefined && { canExport: dto.canExport }),
      },
    });
  }

  async getAuditLogs({
    page = 1,
    limit = 20,
    module,
  }: {
    page?: number;
    limit?: number;
    module?: string;
  }) {
    const currentPage = Number.isInteger(page) && page > 0 ? page : 1;
    const pageSize = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const where = module?.trim() ? { module: module.trim() } : undefined;

    try {
      const [data, total] = await Promise.all([
        this.prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (currentPage - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.auditLog.count({ where }),
      ]);

      return {
        data,
        pagination: {
          page: currentPage,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    } catch (error) {
      return {
        data: [],
        pagination: {
          page: currentPage,
          limit: pageSize,
          total: 0,
          totalPages: 0,
        },
      };
    }
  }

  getEmployeeLifecycle() {
    return this.prisma.employeeSetting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  }

  async updateEmployeeLifecycle(dto: UpdateEmployeeSettingDto, reqUser: any) {
    const previous = await this.getEmployeeLifecycle();
    const updated = await this.prisma.employeeSetting.update({ where: { id: 1 }, data: dto });
    await this.audit.logAction({ userId: reqUser?.id, userEmail: reqUser?.email ?? 'unknown', action: 'EMPLOYEE_LIFECYCLE_UPDATED', module: 'SETTINGS', previousVal: previous, newVal: updated });
    return updated;
  }

  getNotifications() {
    return this.prisma.notificationSetting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  }

  async updateNotifications(dto: UpdateNotificationSettingDto, reqUser: any) {
    const previous = await this.getNotifications();
    const updated = await this.prisma.notificationSetting.update({ where: { id: 1 }, data: dto });
    await this.audit.logAction({ userId: reqUser?.id, userEmail: reqUser?.email ?? 'unknown', action: 'NOTIFICATION_SETTINGS_UPDATED', module: 'SETTINGS', previousVal: previous, newVal: updated });
    return updated;
  }
}
