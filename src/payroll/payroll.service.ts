import { Injectable, BadRequestException } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"
import { RunPayrollDto } from "./dto/run-payroll.dto"
import { PayrollCalculator } from "./payroll.calculator"

@Injectable()
export class PayrollService {

constructor(private prisma: PrismaService) {}

async runPayroll(data: RunPayrollDto) {

const employeeId = Number(data.employeeId)
const month = Number(data.month)
const year = Number(data.year)

if (!employeeId || !month || !year) {
throw new BadRequestException("Invalid payroll request data")
}

/* Salary configuration */

const salary = await this.prisma.employeeSalary.findFirst({
where: { employeeId },
include: { structure: true }
})

if (!salary) {
throw new BadRequestException("Salary not configured for this employee")
}

/* Month date range */

const startDate = new Date(year, month - 1, 1)
const endDate = new Date(year, month, 0)

if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
throw new BadRequestException("Invalid month or year")
}

/* Prevent duplicate payroll */

const existingPayroll = await this.prisma.payroll.findFirst({
where: {
employeeId,
month,
year
}
})

if (existingPayroll) {
throw new BadRequestException("Payroll already generated for this month")
}

/* Attendance calculation */

const workingDays = 22

const presentDays = await this.prisma.attendance.count({
where: {
employeeId,
status: "PRESENT",
date: {
gte: startDate,
lte: endDate
}
}
})

const absentDays = await this.prisma.attendance.count({
where: {
employeeId,
status: "ABSENT",
date: {
gte: startDate,
lte: endDate
}
}
})

/* Payroll calculation */

const calc = PayrollCalculator.calculate(
salary.monthlyCTC,
salary.structure,
workingDays,
presentDays
)

/* Save payroll */

return this.prisma.payroll.create({
data: {

employeeId,
salaryId: salary.id,

month,
year,

workingDays,
presentDays,
lopDays: absentDays,

/* Earnings */

basic: calc.basic,
hra: calc.hra,
specialAllowance: calc.specialAllowance,
otherAllowance: calc.otherAllowance,

/* Deductions */

pf: calc.pf,
pt: calc.pt,
leaveDeduction: calc.leaveDeduction,

/* Totals */

grossSalary: calc.gross,
deductions: calc.deductions,
netSalary: calc.netSalary

}
})

}

/* Manual adjustments */

async addOther(
payrollId: number,
name: string,
type: "ALLOWANCE" | "DEDUCTION",
amount: number
) {

if (!payrollId || !name || !amount) {
throw new BadRequestException("Invalid adjustment data")
}

return this.prisma.payrollAdjustment.create({
data: {
payrollId,
name,
type,
amount
}
})
}

/* Get payroll history */

async getPayroll(employeeId: number) {

return this.prisma.payroll.findMany({
where: { employeeId: Number(employeeId) },
include: {
others: true,
employee: true
},
orderBy: {
createdAt: "desc"
}
})
}

}