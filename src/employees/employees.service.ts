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
    dateOfJoining: dto.dateOfJoining ? new Date(dto.dateOfJoining) : undefined,

    currentExperience: dto.currentExperience != null ? Number(dto.currentExperience) : undefined,
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

await this.mailService.sendEmployeeCredentials(
  dto.email,
  rawPassword,
);

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
      },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    return employee;
  }
}

