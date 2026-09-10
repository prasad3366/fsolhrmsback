import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsDateString,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import {
  Role,
  EmploymentType,
  EmployeeStatus,
  Gender,
  MaritalStatus,
} from '@prisma/client';

export class CreateEmployeeDto {
  @IsEmail()
  declare email: string;

  @IsEnum(Role)
  declare role: Role;

  @IsString()
  declare empCode: string;

  @IsString()
  declare firstName: string;

  @IsString()
  declare lastName: string;

  @IsString()
  declare department: string;

  @IsString()
  designation!: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @IsOptional()
  @IsString()
  sourceOfHire?: string;

  @IsOptional()
  @IsDateString()
  dateOfJoining?: Date;

  @IsOptional()
  @IsNumber()
  currentExperience?: number;

  @IsOptional()
  @IsString()
  reportingManager?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: Date;

  @IsOptional()
  @IsNumber()
  age?: number;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  currentAddress?: string;

  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @IsOptional()
  @IsString()
  pincode?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  personalMobile?: string;

  @IsOptional()
  @IsString()
  panNumber?: string;

  @IsOptional()
  @IsString()
  aadharNumber?: string;

  @IsOptional()
  @IsString()
  pfNumber?: string;

  @IsOptional()
  @IsString()
  uanNumber?: string;

  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  ifscCode?: string;

  @IsOptional()
  @IsDateString()
  dateOfExit?: Date;

  @IsOptional()
  @IsBoolean()
  isExperienced?: boolean;
}

export class UpdateEmployeeDto extends CreateEmployeeDto {
  @IsOptional()
  @IsEmail()
  declare email: string;

  @IsOptional()
  declare role: Role;

  @IsOptional()
  declare empCode: string;

  @IsOptional()
  declare firstName: string;

  @IsOptional()
  declare lastName: string;

  @IsOptional()
  declare department: string;

  @IsOptional()
  declare designation: string;
}
