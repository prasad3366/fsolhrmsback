import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';

@Injectable()
export class SalaryService {
  constructor(
    private prisma: PrismaService,
    private employeesService: EmployeesService,
  ) {}

  async assignSalary(data: {
    employeeId?: number | string;
    employee?: number | string;
    empCode?: string;
    annualCTC?: number | string;
    annualCtc?: number | string;
    ctc?: number | string;
    structureId?: number | string;
    salaryStructureId?: number | string;
  }) {
    try {
      let employeeId = data.employeeId ?? data.employee;

      if (employeeId === undefined && data.empCode) {
        const employee = await this.employeesService.findByEmpCode(data.empCode);
        employeeId = employee.id;
      }

      const parsedEmployeeId = Number(employeeId);
      const annualCTC = Number(data.annualCTC ?? data.annualCtc ?? data.ctc);
      const requestedStructureId = Number(
        data.structureId ?? data.salaryStructureId,
      );

      if (!Number.isInteger(parsedEmployeeId) || parsedEmployeeId <= 0) {
        throw new BadRequestException('employeeId or empCode is required');
      }
      if (!Number.isFinite(annualCTC) || annualCTC <= 0) {
        throw new BadRequestException('annualCTC must be a positive number');
      }

      const employee = await this.prisma.employee.findUnique({
        where: { id: parsedEmployeeId },
        select: { id: true },
      });
      if (!employee) throw new NotFoundException('Employee not found');

      const requestedStructure = Number.isInteger(requestedStructureId) && requestedStructureId > 0
        ? await this.prisma.salaryStructure.findUnique({
            where: { id: requestedStructureId },
            select: { id: true },
          })
        : null;
      const structure = requestedStructure ?? await this.prisma.salaryStructure.findFirst({
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      if (!structure) {
        throw new NotFoundException('No salary structures are configured');
      }

      const existingAssignment = await this.prisma.employeeSalary.findFirst({
        where: { employeeId: parsedEmployeeId },
        select: { id: true },
      });
      if (existingAssignment) {
        throw new BadRequestException('Salary is already assigned to this employee');
      }

      return await this.prisma.employeeSalary.create({
        data: {
          employeeId: parsedEmployeeId,
          structureId: structure.id,
          annualCTC,
          monthlyCTC: annualCTC / 12,
          effectiveFrom: new Date(),
        },
        include: {
          employee: {
            select: {
              id: true,
              empCode: true,
              firstName: true,
              lastName: true,
            },
          },
          structure: true,
        },
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException('Unable to assign salary');
    }
  }

  async getEmployeeSalaries(employeeId?: number, empCode?: string) {
    let resolvedEmployeeId = employeeId;

    if (!resolvedEmployeeId && empCode) {
      const employee = await this.employeesService.findByEmpCode(empCode);
      resolvedEmployeeId = employee.id;
    }

    if (!resolvedEmployeeId) {
      throw new BadRequestException('employeeId or empCode is required');
    }

    return this.prisma.employeeSalary.findMany({
      where: { employeeId: resolvedEmployeeId },
      include: {
        structure: true,
        employee: {
          select: {
            id: true,
            empCode: true,
            firstName: true,
            lastName: true,
            department: true,
            designation: true,
          },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async getLatestEmployeeSalary(employeeId: number) {
    const parsedEmployeeId = Number(employeeId);
    if (!Number.isInteger(parsedEmployeeId) || parsedEmployeeId <= 0) {
      throw new BadRequestException('Invalid employee id');
    }

    const latest = await this.prisma.employeeSalary.findFirst({
      where: { employeeId: parsedEmployeeId },
      include: {
        structure: true,
        employee: {
          select: {
            id: true,
            empCode: true,
            firstName: true,
            lastName: true,
            department: true,
            designation: true,
          },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!latest) {
      throw new NotFoundException('Salary assignment not found');
    }
    return latest;
  }

  async getAllSalaries() {
    return this.prisma.employeeSalary.findMany({
      include: {
        structure: true,
        employee: {
          select: {
            id: true,
            empCode: true,
            firstName: true,
            lastName: true,
            department: true,
            designation: true,
          },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async getEmployeesWithoutSalary() {
    return this.prisma.employee.findMany({
      where: {
        status: 'ACTIVE',
        salaries: { none: {} },
      },
      select: {
        id: true,
        empCode: true,
        firstName: true,
        lastName: true,
        department: true,
        designation: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  getSalaryStructures() {
    return this.prisma.salaryStructure.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        basicPercent: true,
        hraPercent: true,
        pfPercent: true,
        conveyancePercent: true,
      },
    });
  }
}
