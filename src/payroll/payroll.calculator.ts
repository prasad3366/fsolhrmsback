export class PayrollCalculator {

static calculate(
ctc:number,
structure:any,
workingDays:number,
presentDays:number
){

/* LEAVE CALCULATION */

const lopDays = workingDays - presentDays

/* EARNINGS */

// Basic Salary (ex: 40% of CTC)
const basic = (ctc * structure.basicPercent) / 100

// HRA (ex: 40% of Basic)
const hra = (basic * structure.hraPercent) / 100

// Special Allowance (ex: 20% of CTC)
const specialAllowance = (ctc * structure.specialPercent) / 100

// Other Allowance (remaining salary)
const otherAllowance =
ctc - (basic + hra + specialAllowance)

// Gross Salary
const gross =
basic +
hra +
specialAllowance +
otherAllowance


/* DEDUCTIONS */

// PF (12% of Basic)
const pf = (basic * structure.pfPercent) / 100

// Professional Tax
const pt = structure.ptAmount

// Per Day Salary
const perDaySalary = gross / workingDays

// Leave Deduction
const leaveDeduction = lopDays * perDaySalary

// Total Deductions
const deductions =
pf +
pt +
leaveDeduction


/* NET SALARY */

const netSalary = gross - deductions

return {

basic,
hra,
specialAllowance,
otherAllowance,

gross,

pf,
pt,
lopDays,
leaveDeduction,

deductions,
netSalary

}

}

}