import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateAttendancePolicyDto {
  @IsOptional() @IsString() workDays?: string;
  @IsOptional() @IsString() shiftStartTime?: string;
  @IsOptional() @IsString() shiftEndTime?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) gracePeriodMins?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) lateArrivalThreshold?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) earlyCheckoutMins?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) halfDayHours?: number;
  @IsOptional() @IsBoolean() autoCheckoutEnabled?: boolean;
  @IsOptional() @IsString() autoCheckoutTime?: string;
  @IsOptional() @IsBoolean() overtimeEnabled?: boolean;
}

export class UpsertLeavePolicyDto {
  @IsString() @IsNotEmpty() leaveTypeName!: string;
  @IsString() @IsNotEmpty() code!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) annualAllocation?: number;
  @IsOptional() @IsString() accrualFrequency?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) carryForwardMax?: number;
  @IsOptional() @IsBoolean() allowHalfDay?: boolean;
  @IsOptional() @IsBoolean() requiresDocument?: boolean;
  @IsOptional() @IsBoolean() isLossOfPay?: boolean;
}

export class CreateHolidayPolicyDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsDateString() date!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isOptional?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) branchId?: number;
}

export class UpdateSecurityPolicyDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) minPasswordLength?: number;
  @IsOptional() @IsBoolean() requireUppercase?: boolean;
  @IsOptional() @IsBoolean() requireNumbers?: boolean;
  @IsOptional() @IsBoolean() requireSymbols?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxFailedLogins?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) accountLockMins?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sessionTimeoutMins?: number;
  @IsOptional() @IsBoolean() enable2FA?: boolean;
}

export class UpdateWorkflowDto {
  @IsString() @IsNotEmpty() module!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) approvalLevels?: number;
  @IsOptional() @IsBoolean() requireComment?: boolean;
}

export class UpdateEmployeeSettingDto {
  @IsOptional() @IsString() empIdPrefix?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) empIdNextNumber?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) probationDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) noticePeriodDays?: number;
  @IsOptional() @IsBoolean() requireOnboarding?: boolean;
}

export class UpdateNotificationSettingDto {
  @IsOptional() @IsBoolean() notifyLeaveRequest?: boolean;
  @IsOptional() @IsBoolean() notifyLeaveApproval?: boolean;
  @IsOptional() @IsBoolean() notifyLateAttendance?: boolean;
  @IsOptional() @IsBoolean() notifyAnniversaries?: boolean;
  @IsOptional() @IsBoolean() notifyNewJoiner?: boolean;
  @IsOptional() @IsBoolean() emailChannelEnabled?: boolean;
  @IsOptional() @IsBoolean() inAppChannelEnabled?: boolean;
}
