import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';

@Injectable()
export class SalaryService {
  constructor(
    private prisma: PrismaService,
    private employeesService: EmployeesService,
  ) {}

  async assignSalary(data: {
    employeeId?: number;
    empCode?: string;
    annualCTC: number;
    structureId: number;
  }) {
    let employeeId = data.employeeId;

    if (!employeeId && data.empCode) {
      const employee = await this.employeesService.findByEmpCode(data.empCode);
      employeeId = employee.id;
    }

    if (!employeeId) {
      throw new BadRequestException('employeeId or empCode is required');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    const monthlyCTC = data.annualCTC / 12;

    return this.prisma.employeeSalary.create({
      data: {
        employeeId: employeeId,
        structureId: data.structureId,
        annualCTC: data.annualCTC,
        monthlyCTC: monthlyCTC,
        effectiveFrom: new Date(),
      },
    });
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
}
