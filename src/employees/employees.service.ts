import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { MailService } from '../mail/mail.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
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
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        role: dto.role,
      },
    });

    // transform incoming DTO values to types Prisma expects
    await this.prisma.employee.create({
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

    await this.mailService.sendEmployeeCredentials(dto.email, rawPassword, dto.firstName);

    return {
      message: 'Employee created successfully',
      username: dto.email,
      password: rawPassword,
      role: dto.role,
    };
  }

  // ✅ HR / ADMIN / MANAGER → Get all employees
  async getAllEmployees() {
    return this.prisma.employee.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
      },
    });
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
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: true },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    if (dto.empCode && dto.empCode !== employee.empCode) {
      const existingByCode = await this.prisma.employee.findUnique({
        where: { empCode: dto.empCode },
      });
      if (existingByCode) {
        throw new BadRequestException('Employee code already exists');
      }
    }

    if (dto.email && dto.email !== employee.user.email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (existingEmail && existingEmail.id !== employee.userId) {
        throw new BadRequestException('Email already exists');
      }
    }

    // Check if employee is being set to INACTIVE or exit date is being set
    let shouldDeactivateCredentials = false;

    // If status is being changed to INACTIVE OR if already INACTIVE
    const newStatus = dto.status || employee.status;
    if (newStatus === 'INACTIVE') {
      shouldDeactivateCredentials = true;
    }

    // If dateOfExit is being set to today or in the past
    if (dto.dateOfExit) {
      const exitDate = new Date(dto.dateOfExit);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      exitDate.setHours(0, 0, 0, 0);

      if (exitDate <= today) {
        shouldDeactivateCredentials = true;
      }
    }

    // update linked user record where applicable
    const userUpdateData: any = {};
    if (dto.email !== undefined) userUpdateData.email = dto.email;
    if (dto.role !== undefined) userUpdateData.role = dto.role;

    // Deactivate credentials if needed
    if (shouldDeactivateCredentials) {
      userUpdateData.isActive = false;
    }

    // Update user if there are changes OR if credentials need to be deactivated
    if (Object.keys(userUpdateData).length > 0) {
      await this.prisma.user.update({
        where: { id: employee.userId },
        data: userUpdateData,
      });
    }

    const employeeUpdateData: any = {};
    const setIfDefined = (key: string, value: any) => {
      if (value !== undefined) {
        employeeUpdateData[key] = value;
      }
    };

    setIfDefined('empCode', dto.empCode);
    setIfDefined('firstName', dto.firstName);
    setIfDefined('lastName', dto.lastName);
    setIfDefined('department', dto.department);
    setIfDefined('designation', dto.designation);
    setIfDefined('isExperienced', dto.isExperienced);
    setIfDefined('employmentType', dto.employmentType);
    setIfDefined('status', dto.status);
    setIfDefined('sourceOfHire', dto.sourceOfHire);
    setIfDefined('reportingManager', dto.reportingManager);
    setIfDefined(
      'currentExperience',
      dto.currentExperience != null ? Number(dto.currentExperience) : undefined,
    );
    setIfDefined('age', dto.age != null ? Number(dto.age) : undefined);
    setIfDefined('gender', dto.gender);
    setIfDefined('currentAddress', dto.currentAddress);
    setIfDefined('permanentAddress', dto.permanentAddress);
    setIfDefined('pincode', dto.pincode);
    setIfDefined('city', dto.city);
    setIfDefined('maritalStatus', dto.maritalStatus);
    setIfDefined('phone', dto.phone);
    setIfDefined('personalMobile', dto.personalMobile);
    setIfDefined('panNumber', dto.panNumber);
    setIfDefined('aadharNumber', dto.aadharNumber);
    setIfDefined('pfNumber', dto.pfNumber);
    setIfDefined('uanNumber', dto.uanNumber);
    setIfDefined('bankAccountNumber', dto.bankAccountNumber);
    setIfDefined('bankName', dto.bankName);
    setIfDefined('ifscCode', dto.ifscCode);

    if (dto.dateOfJoining !== undefined) {
      setIfDefined(
        'dateOfJoining',
        dto.dateOfJoining ? new Date(dto.dateOfJoining) : null,
      );
    }
    if (dto.dateOfBirth !== undefined) {
      setIfDefined(
        'dateOfBirth',
        dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      );
    }
    if (dto.dateOfExit !== undefined) {
      setIfDefined(
        'dateOfExit',
        dto.dateOfExit ? new Date(dto.dateOfExit) : null,
      );
    }

    if (Object.keys(employeeUpdateData).length === 0) {
      return {
        message: 'No updates provided',
      };
    }

    const updatedEmployee = await this.prisma.employee.update({
      where: { id: employeeId },
      data: employeeUpdateData,
    });

    // if employee is set as experienced, ensure related document types are available
    if (dto.isExperienced === true) {
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
