import { IsString, IsEmail, IsOptional, IsEnum, IsDateString, IsNumber } from 'class-validator';
import { Role, EmploymentType, EmployeeStatus, Gender, MaritalStatus } from '@prisma/client';

export class CreateEmployeeDto {

  @IsEmail()
  email: string;

  @IsEnum(Role)
  role: Role;

  @IsString()
  empCode: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  department: string;

  @IsString()
  designation: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @IsOptional()
  sourceOfHire?: string;

  @IsOptional()
  @IsDateString()
  dateOfJoining?: Date;

  @IsOptional()
  currentExperience?: number;

  @IsOptional()
  reportingManager?: string;

  @IsOptional()
  dateOfBirth?: Date;

  @IsOptional()
  age?: number;

  @IsOptional()
  @IsEnum(Gender)
  gender: Gender;

  @IsOptional()
  currentAddress: string;

  @IsOptional()
  permanentAddress: string;

  @IsOptional()
  pincode: string;

  @IsOptional()
  city: string;

  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus: MaritalStatus;

  @IsOptional()
  phone: string;

  @IsOptional()
  personalMobile: string;

  @IsOptional()
  panNumber: string;

  @IsOptional()
  aadharNumber: string;

  @IsOptional()
  pfNumber: string;

  @IsOptional()
  uanNumber: string;

  @IsOptional()
  bankAccountNumber: string;

  @IsOptional()
  bankName: string;

  @IsOptional()
  ifscCode: string;

  @IsOptional()
  dateOfExit: Date;

  @IsOptional()
  isExperienced: boolean;
}