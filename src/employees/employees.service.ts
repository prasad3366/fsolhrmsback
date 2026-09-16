import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { MailService } from '../mail/mail.service';
import * as bcrypt from 'bcrypt';
import {
  AuthorizationService,
  AuthorizationUser,
} from '../common/authorization/authorization.service';
import { EmployeeDirectoryQueryDto } from './dto/employee-directory-query.dto';

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private authorizationService: AuthorizationService,
  ) {}

  private generatePassword(): string {
    return Math.random().toString(36).slice(-8);
  }

  async createEmployee(dto: CreateEmployeeDto, addedByRole: string) {
    const emailExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (emailExists) {
      throw new BadRequestException('Email already exists');
    }

    const empExists = await this.prisma.employee.findUnique({
      where: { empCode: dto.empCode },
    });

    if (empExists) {
      throw new BadRequestException('Employee Code already exists');
    }

    const rawPassword = this.generatePassword();
    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS) || 10;
    const hashedPassword = await bcrypt.hash(rawPassword, bcryptRounds);

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          role: dto.role,
          isActive: dto.status !== 'INACTIVE',
        },
      });

      // transform incoming DTO values to types Prisma expects
      await tx.employee.create({
        data: {
          userId: user.id,
          empCode: dto.empCode,
          firstName: dto.firstName,
          lastName: dto.lastName,
          department: dto.department,
          designation: dto.designation,
          isExperienced: dto.isExperienced,

          employmentType: dto.employmentType,
          status: dto.status,
          sourceOfHire: dto.sourceOfHire,

          // ensure ISO datetime (Prisma requires full timestamp)
          dateOfJoining: dto.dateOfJoining
            ? new Date(dto.dateOfJoining)
            : undefined,

          currentExperience:
            dto.currentExperience != null
              ? Number(dto.currentExperience)
              : undefined,
          reportingManager: dto.reportingManager,

          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          age: dto.age != null ? Number(dto.age) : undefined,
          gender: dto.gender,

          currentAddress: dto.currentAddress,
          permanentAddress: dto.permanentAddress,
          pincode: dto.pincode,
          city: dto.city,

          maritalStatus: dto.maritalStatus,

          phone: dto.phone,
          personalMobile: dto.personalMobile,

          dateOfExit: dto.dateOfExit ? new Date(dto.dateOfExit) : undefined,

          panNumber: dto.panNumber,
          aadharNumber: dto.aadharNumber,
          pfNumber: dto.pfNumber,
          uanNumber: dto.uanNumber,

          bankAccountNumber: dto.bankAccountNumber,
          bankName: dto.bankName,
          ifscCode: dto.ifscCode,

          addedBy: addedByRole,
        },
      });
    });

    await this.mailService.sendEmployeeCredentials(dto.email, rawPassword, dto.firstName);

    return {
      message: 'Employee created successfully',
      username: dto.email,
      role: dto.role,
    };
  }

  async getAllEmployees(
    user: AuthorizationUser,
    query: EmployeeDirectoryQueryDto = {},
  ) {
    const normalizedRole = String(user.role ?? '').toUpperCase();
    let where: Prisma.EmployeeWhereInput | undefined = { id: { in: [] } };

    if (this.authorizationService.canAccessOrganizationWide(user, 'employee')) {
      where = undefined;
    }

    const statisticsWhere = where;

    if (query.search?.trim()) {
      const search = query.search.trim();
      const numericEmployeeId = Number(search);
      const employeeIdSearch = Number.isInteger(numericEmployeeId) && numericEmployeeId > 0
        ? [{ id: numericEmployeeId }]
        : [];
      where = {
        AND: [where ?? {}, {
          OR: [
            ...employeeIdSearch,
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { empCode: { contains: search, mode: 'insensitive' } },
            { department: { contains: search, mode: 'insensitive' } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
          ],
        }],
      };
    }
    if (query.department) {
      where = { AND: [where ?? {}, { department: query.department }] };
    }
    if (query.status === 'ACTIVE' || query.status === 'INACTIVE') {
      where = { AND: [where ?? {}, { status: query.status }] };
    }

    const hasQuery = Object.keys(query).length > 0;
    const today = new Date();
    const directorySelect = {
      id: true,
      empCode: true,
      firstName: true,
      lastName: true,
      department: true,
      designation: true,
      employmentType: true,
      isExperienced: true,
      dateOfJoining: true,
      dateOfExit: true,
      status: true,
      teamId: true,
      user: { select: { id: true, email: true, role: true, isActive: true } },
    } as const;
    const currentLeave = {
      status: 'APPROVED' as const,
      startDate: { lte: today },
      endDate: { gte: today },
    };
    if (!hasQuery) {
      return this.prisma.employee.findMany({
        where,
        select: directorySelect,
      });
    }
    if (query.status === 'ON_LEAVE') {
      where = { AND: [where ?? {}, { leaves: { some: currentLeave } }] };
    }

    const sortDirection = query.sortDirection ?? 'asc';
    const orderBy = query.sortBy === 'name'
      ? [{ firstName: sortDirection }, { lastName: sortDirection }]
      : [{ [query.sortBy === 'empCode' ? 'empCode' : query.sortBy === 'department' ? 'department' : query.sortBy === 'dateOfJoining' ? 'dateOfJoining' : 'status']: sortDirection }];
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const select = {
      ...directorySelect,
      leaves: { where: currentLeave, select: { id: true }, take: 1 },
    };
    const [total, employees] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({ where, select, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const newJoinerStart = new Date(today);
    newJoinerStart.setDate(today.getDate() - 30);
    const probationStart = new Date(today);
    probationStart.setMonth(today.getMonth() - 6);
    const [active, newJoiners, onLeave, probation, noticePeriod] = await Promise.all([
      this.prisma.employee.count({ where: { AND: [statisticsWhere ?? {}, { status: 'ACTIVE' }] } }),
      this.prisma.employee.count({ where: { AND: [statisticsWhere ?? {}, { dateOfJoining: { gte: newJoinerStart } }] } }),
      this.prisma.employee.count({ where: { AND: [statisticsWhere ?? {}, { leaves: { some: currentLeave } }] } }),
      this.prisma.employee.count({ where: { AND: [statisticsWhere ?? {}, { isExperienced: false, dateOfJoining: { gte: probationStart } }] } }),
      this.prisma.employee.count({ where: { AND: [statisticsWhere ?? {}, { dateOfExit: { gt: today } }] } }),
    ]);
    return {
      data: employees.map((employee) => ({ ...employee, status: employee.leaves?.length ? 'ON_LEAVE' : employee.status })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      statistics: { total, active, newJoiners, onLeave, probation, noticePeriod },
    };
  }

  // ✅ Logged-in employee → Get own details
  async getMyDetails(userId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            email: true,
            role: true,
            isActive: true,
          },
        },
        attendances: true,
        leaves: true,
        leaveBalances: true,
        wfhRequests: true,
        salaries: true,
        payrolls: true,
      },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    return employee;
  }

  async findByEmpCode(empCode: string) {
    if (!empCode) {
      throw new BadRequestException('Employee code is required');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { empCode },
      include: { user: true },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    return employee;
  }

  async updateEmployee(employeeId: number, dto: Partial<CreateEmployeeDto>) {
    const { role: _ignoredRole, ...safeDto } = dto as Partial<CreateEmployeeDto> & {
      role?: unknown;
    };

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: true },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    if (safeDto.empCode && safeDto.empCode !== employee.empCode) {
      const existingByCode = await this.prisma.employee.findUnique({
        where: { empCode: safeDto.empCode },
      });
      if (existingByCode) {
        throw new BadRequestException('Employee code already exists');
      }
    }

    if (safeDto.email && safeDto.email !== employee.user.email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: safeDto.email },
      });
      if (existingEmail && existingEmail.id !== employee.userId) {
        throw new BadRequestException('Email already exists');
      }
    }

    // Check if employee is being set to INACTIVE or exit date is being set
    let shouldDeactivateCredentials = false;
    let shouldReactivateCredentials = false;

    // If status is being changed to INACTIVE OR if already INACTIVE
    const newStatus = safeDto.status || employee.status;

    // Effective exit date after this update (safeDto.dateOfExit may explicitly clear it with null)
    const effectiveDateOfExit =
      safeDto.dateOfExit !== undefined ? safeDto.dateOfExit : employee.dateOfExit;
    let exitInPastOrToday = false;
    if (effectiveDateOfExit) {
      const exitDate = new Date(effectiveDateOfExit);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      exitDate.setHours(0, 0, 0, 0);
      exitInPastOrToday = exitDate <= today;
    }

    if (newStatus === 'INACTIVE' || exitInPastOrToday) {
      shouldDeactivateCredentials = true;
    } else if (
      (safeDto.status !== undefined || safeDto.dateOfExit !== undefined) &&
      newStatus === 'ACTIVE'
    ) {
      // Employee is explicitly being (re)activated and has no past exit date
      shouldReactivateCredentials = true;
    }

    // update linked user record where applicable
    const userUpdateData: any = {};
    if (safeDto.email !== undefined) userUpdateData.email = safeDto.email;

    // Synchronize credentials with an explicitly supplied employee status.
    // Role changes are never accepted through the generic employee update flow.
    if (safeDto.status !== undefined) {
      userUpdateData.isActive = safeDto.status === 'ACTIVE';
    } else if (shouldDeactivateCredentials) {
      userUpdateData.isActive = false;
    } else if (shouldReactivateCredentials) {
      userUpdateData.isActive = true;
    }

    const employeeUpdateData: any = {};
    const setIfDefined = (key: string, value: any) => {
      if (value !== undefined) {
        employeeUpdateData[key] = value;
      }
    };

    setIfDefined('empCode', safeDto.empCode);
    setIfDefined('firstName', safeDto.firstName);
    setIfDefined('lastName', safeDto.lastName);
    setIfDefined('department', safeDto.department);
    setIfDefined('designation', safeDto.designation);
    setIfDefined('isExperienced', safeDto.isExperienced);
    setIfDefined('employmentType', safeDto.employmentType);
    setIfDefined('status', safeDto.status);
    setIfDefined('sourceOfHire', safeDto.sourceOfHire);
    setIfDefined('reportingManager', safeDto.reportingManager);
    setIfDefined(
      'currentExperience',
      safeDto.currentExperience != null ? Number(safeDto.currentExperience) : undefined,
    );
    setIfDefined('age', safeDto.age != null ? Number(safeDto.age) : undefined);
    setIfDefined('gender', safeDto.gender);
    setIfDefined('currentAddress', safeDto.currentAddress);
    setIfDefined('permanentAddress', safeDto.permanentAddress);
    setIfDefined('pincode', safeDto.pincode);
    setIfDefined('city', safeDto.city);
    setIfDefined('maritalStatus', safeDto.maritalStatus);
    setIfDefined('phone', safeDto.phone);
    setIfDefined('personalMobile', safeDto.personalMobile);
    setIfDefined('panNumber', safeDto.panNumber);
    setIfDefined('aadharNumber', safeDto.aadharNumber);
    setIfDefined('pfNumber', safeDto.pfNumber);
    setIfDefined('uanNumber', safeDto.uanNumber);
    setIfDefined('bankAccountNumber', safeDto.bankAccountNumber);
    setIfDefined('bankName', safeDto.bankName);
    setIfDefined('ifscCode', safeDto.ifscCode);

    if (safeDto.dateOfJoining !== undefined) {
      setIfDefined(
        'dateOfJoining',
        safeDto.dateOfJoining ? new Date(safeDto.dateOfJoining) : null,
      );
    }
    if (safeDto.dateOfBirth !== undefined) {
      setIfDefined(
        'dateOfBirth',
        safeDto.dateOfBirth ? new Date(safeDto.dateOfBirth) : null,
      );
    }
    if (safeDto.dateOfExit !== undefined) {
      setIfDefined(
        'dateOfExit',
        safeDto.dateOfExit ? new Date(safeDto.dateOfExit) : null,
      );
    }

    if (
      Object.keys(employeeUpdateData).length === 0 &&
      Object.keys(userUpdateData).length === 0
    ) {
      return {
        message: 'No updates provided',
      };
    }

    const updatedEmployee = await this.prisma.$transaction(async (tx) => {
      if (Object.keys(userUpdateData).length > 0) {
        await tx.user.update({
          where: { id: employee.userId },
          data: userUpdateData,
        });
      }

      if (Object.keys(employeeUpdateData).length === 0) {
        return null;
      }

      return tx.employee.update({
        where: { id: employeeId },
        data: employeeUpdateData,
      });
    });

    if (!updatedEmployee) {
      return {
        message: 'No updates provided',
      };
    }

    // if employee is set as experienced, ensure related document types are available
    if (safeDto.isExperienced === true) {
      const mandatoryExperiencedDocs = ['Payslip', 'Experience Letter', 'Relieving Letter'];

      await Promise.all(
        mandatoryExperiencedDocs.map((name) =>
          this.prisma.documentType.upsert({
            where: { name },
            update: { forExperienced: true },
            create: {
              name,
              isMandatory: true,
              forExperienced: true,
              forFresher: false,
            },
          }),
        ),
      );
    }

    let message = 'Employee details updated successfully';
    if (shouldDeactivateCredentials) {
      message += ' | Employee credentials have been deactivated (isActive: false).';
    } else if (shouldReactivateCredentials) {
      message += ' | Employee credentials have been reactivated (isActive: true).';
    }

    return {
      message,
      employee: {
        id: updatedEmployee.id,
        status: updatedEmployee.status,
      },
      credentialsDeactivated: shouldDeactivateCredentials,
    };
  }

  // ✅ HR / ADMIN / MANAGER → Get detailed employee info by ID
  async getEmployeeDetailsById(employeeId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
        attendances: true,
        leaves: true,
        leaveBalances: true,
        wfhRequests: true,
        documents: true,
        salaries: true,
        payrolls: true,
      },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    return employee;
  }

  async getEmployee360Profile(employeeId: number, role: string) {
    const normalizedRole = String(role ?? '').toUpperCase();
    const canViewDetailedContact = ['SUPER_ADMIN', 'CEO', 'HR', 'EMPLOYEE'].includes(
      normalizedRole,
    );
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        empCode: true,
        firstName: true,
        lastName: true,
        department: true,
        designation: true,
        employmentType: true,
        sourceOfHire: true,
        currentExperience: true,
        isExperienced: true,
        reportingManager: true,
        status: true,
        dateOfJoining: true,
        phone: true,
        city: true,
        ...(canViewDetailedContact
          ? {
              personalMobile: true,
              currentAddress: true,
              permanentAddress: true,
              pincode: true,
            }
          : {}),
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
            manager: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    return employee;
  }

  async getEmployee360Hierarchy(
    user: AuthorizationUser,
    employeeId: number,
  ) {
    const normalizedRole = String(user.role ?? '').toUpperCase();
    if (normalizedRole === 'FINANCE_MANAGER') {
      throw new ForbiddenException('Access denied for employee hierarchy');
    }

    const hasAccess = await this.authorizationService.canAccessEmployee(
      user,
      employeeId,
    );
    if (!hasAccess) {
      throw new ForbiddenException('Access denied for employee hierarchy');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        team: {
          select: {
            id: true,
            name: true,
            manager: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
              },
            },
          },
        },
      },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    const manager = employee.team?.manager ?? null;
    return {
      employeeId: employee.id,
      team: employee.team
        ? { id: employee.team.id, name: employee.team.name }
        : null,
      manager: manager
        ? {
            employeeId: manager.id,
            name: `${manager.firstName} ${manager.lastName}`.trim(),
            designation: manager.designation,
          }
        : null,
      reportingRelationship: manager
        ? { type: 'TEAM_MANAGER', managerEmployeeId: manager.id }
        : null,
    };
  }

  // ✅ Get employee ID by user ID (for logged-in user)
  async getEmployeeIdByUserId(userId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!employee) {
      throw new BadRequestException('Employee record not found for this user');
    }

    return { employeeId: employee.id };
  }
}
