import { Injectable } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { PrismaService } from "../prisma/prisma.service"
import { PayrollCalculator } from "./payroll.calculator"

@Injectable()
export class PayrollScheduler {

constructor(private prisma: PrismaService) {}

@Cron("0 0 1 * *") // Runs on 1st day of every month
async autoGeneratePayroll() {

const now = new Date()

const month = now.getMonth() + 1
const year = now.getFullYear()

const startDate = new Date(year, month - 1, 1)
const endDate = new Date(year, month, 0)

const employees = await this.prisma.employee.findMany({
include:{
salaries:{
include:{ structure:true }
}
}
})

for(const emp of employees){

const salary = emp.salaries[0]

if(!salary) continue

/* Prevent duplicate payroll */

const existing = await this.prisma.payroll.findFirst({
where:{
employeeId: emp.id,
month,
year
}
})

if(existing) continue

/* Attendance calculation */

const presentDays = await this.prisma.attendance.count({
where:{
employeeId: emp.id,
status: "PRESENT",
date:{
gte:startDate,
lte:endDate
}
}
})

const absentDays = await this.prisma.attendance.count({
where:{
employeeId: emp.id,
status:"ABSENT",
date:{
gte:startDate,
lte:endDate
}
}
})

const workingDays = 22

/* Payroll calculation */

const calc = PayrollCalculator.calculate(
salary.monthlyCTC,
salary.structure,
workingDays,
presentDays
)

/* Save payroll */

await this.prisma.payroll.create({
data:{

employeeId: emp.id,
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

}

}