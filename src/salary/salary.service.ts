import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { PayrollCalculator } from '../payroll/payroll.calculator';
import { getPayrollPeriodForDate } from '../payroll/payroll-period.util';

@Injectable()
export class SalaryService {
  constructor(
    private prisma: PrismaService,
    private employeesService: EmployeesService,
  ) {}

  private parseEffectiveFrom(value?: string | Date): Date {
    if (value === undefined || value === null || value === '') return new Date();

    const dateOnly = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
    const parsed = dateOnly
      ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
      : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('effectiveFrom must be a valid date');
    }
    return parsed;
  }

  /* Creates a new effective-dated salary row. Earlier rows are never changed;
     payroll picks the row effective at each period end. */
  async assignSalary(data: {
    employeeId?: number | string;
    employee?: number | string;
    empCode?: string;
    annualCTC?: number | string;
    annualCtc?: number | string;
    ctc?: number | string;
    monthlyGross?: number | string;
    effectiveFrom?: string;
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
      const hasMonthlyGross = data.monthlyGross !== undefined && data.monthlyGross !== null && data.monthlyGross !== '';
      const monthlyGross = hasMonthlyGross ? Number(data.monthlyGross) : null;
      const effectiveFrom = this.parseEffectiveFrom(data.effectiveFrom);
      const requestedStructureId = Number(
        data.structureId ?? data.salaryStructureId,
      );

      if (!Number.isInteger(parsedEmployeeId) || parsedEmployeeId <= 0) {
        throw new BadRequestException('employeeId or empCode is required');
      }
      if (!Number.isFinite(annualCTC) || annualCTC <= 0) {
        throw new BadRequestException('annualCTC must be a positive number');
      }
      if (monthlyGross !== null && (!Number.isFinite(monthlyGross) || monthlyGross <= 0)) {
        throw new BadRequestException('monthlyGross must be a positive number');
      }

      const employee = await this.prisma.employee.findUnique({
        where: { id: parsedEmployeeId },
        select: { id: true },
      });
      if (!employee) throw new NotFoundException('Employee not found');

      const rawStructureId = data.structureId ?? data.salaryStructureId;
      const structureSupplied = rawStructureId !== undefined && rawStructureId !== null && rawStructureId !== '';
      if (structureSupplied && (!Number.isInteger(requestedStructureId) || requestedStructureId <= 0)) {
        throw new BadRequestException('structureId must be a positive integer');
      }

      // An explicitly selected structure is always used; only when none is
      // supplied does the newest (current default) structure apply.
      const structure = structureSupplied
        ? await this.prisma.salaryStructure.findUnique({ where: { id: requestedStructureId } })
        : await this.prisma.salaryStructure.findFirst({ orderBy: { id: 'desc' } });
      if (!structure) {
        throw new NotFoundException(
          structureSupplied ? 'Salary structure not found' : 'No salary structures are configured',
        );
      }

      const monthlyCTC = annualCTC / 12;
      if (monthlyGross !== null && monthlyGross > monthlyCTC) {
        throw new BadRequestException('Monthly Gross cannot exceed Monthly CTC (Annual CTC / 12)');
      }
      // Same calculation payroll uses; Special Allowance must not go negative
      const components = PayrollCalculator.calculate(monthlyGross ?? monthlyCTC, structure, 0, 0);
      if (components.specialAllowance < 0) {
        throw new BadRequestException(
          'Basic + HRA + Conveyance cannot exceed Gross salary for this salary structure',
        );
      }

      return await this.prisma.$transaction(async (tx: any) => {
        const sameDayAssignment = await tx.employeeSalary.findFirst({
          where: { employeeId: parsedEmployeeId, effectiveFrom },
          select: { id: true },
        });
        if (sameDayAssignment) {
          throw new BadRequestException('A salary is already effective from this date for this employee');
        }

        // The new row affects every payroll period from its effective date
        const { month, year } = getPayrollPeriodForDate(effectiveFrom);
        const affectedPeriods = {
          employeeId: parsedEmployeeId,
          OR: [{ year: { gt: year } }, { year, month: { gte: month } }],
        };
        const lockedPayroll = await tx.payroll.findFirst({
          where: { ...affectedPeriods, status: { in: ['FINALIZED', 'PAID'] } },
          select: { month: true, year: true },
        });
        if (lockedPayroll) {
          throw new BadRequestException(
            `Payroll for ${lockedPayroll.month}/${lockedPayroll.year} is finalized. Reopen the payroll before making this change.`,
          );
        }

        const created = await tx.employeeSalary.create({
          data: {
            employeeId: parsedEmployeeId,
            structureId: structure.id,
            annualCTC,
            monthlyCTC,
            monthlyGross,
            effectiveFrom,
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

        await tx.payroll.updateMany({
          where: { ...affectedPeriods, status: 'DRAFT' },
          data: { needsRecalculation: true },
        });

        return created;
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException('Unable to assign salary');
    }
  }

  /* New structures only; existing structures are never edited in place.
     PF/PT keep their existing defaults. */
  async createSalaryStructure(data: {
    name?: string;
    basicPercent?: number | string;
    hraPercent?: number | string;
    conveyanceAmount?: number | string;
  }) {
    const name = String(data.name ?? '').trim();
    const basicPercent = Number(data.basicPercent ?? 35);
    const hraPercent = Number(data.hraPercent ?? 40);
    const conveyanceAmount = Number(data.conveyanceAmount ?? 0);

    if (!name) throw new BadRequestException('Structure name is required');
    const isPercent = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100;
    if (!isPercent(basicPercent) || !isPercent(hraPercent)) {
      throw new BadRequestException('basicPercent and hraPercent must be between 0 and 100');
    }
    if (!Number.isFinite(conveyanceAmount) || conveyanceAmount < 0) {
      throw new BadRequestException('conveyanceAmount must be zero or a positive number');
    }

    return this.prisma.salaryStructure.create({
      data: { name, basicPercent, hraPercent, conveyancePercent: 0, conveyanceAmount },
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
        conveyanceAmount: true,
      },
    });
  }
}
