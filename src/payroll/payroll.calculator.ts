export class PayrollCalculator {
  static calculate(
    ctc: number,
    structure: any,
    workingDays: number,
    lopDays: number,
  ) {

    /* EARNINGS */

    const basic = (ctc * structure.basicPercent) / 100;

    const hra = (basic * structure.hraPercent) / 100;

    const specialAllowance = (ctc * structure.specialPercent) / 100;

    const otherAllowance = ctc - (basic + hra + specialAllowance);

    const gross = basic + hra + specialAllowance + otherAllowance;


    /* DEDUCTIONS */

    // ✅ PF like your image: (basic × 12%) → example: 15000 × 12% = 1800
    const pf = (basic * structure.pfPercent) / 100;

    const pt = structure.ptAmount;

    // Per day salary
    const perDaySalary = gross / workingDays;

    // Leave deduction
    const leaveDeduction = lopDays * perDaySalary;

    const deductions = pf + pt + leaveDeduction;

    const netSalary = gross - deductions;

    return {
      basic,
      hra,
      specialAllowance,
      otherAllowance,
      gross,

      pf, // <-- This now matches your image logic
      pt,
      lopDays,
      leaveDeduction,

      deductions,
      netSalary,
    };
  }
}