export class PayrollCalculator {
  static calculate(
    ctc: number,
    structure: any,
    workingDays: number,
    lopDays: number,
  ) {

    const round = (v: number) => Math.round(v);

    /* EARNINGS */

    const basic = (ctc * structure.basicPercent) / 100;

    const hra = (basic * structure.hraPercent) / 100;

    const conveyance = (ctc * structure.conveyancePercent) / 100;

    const specialAllowance = ctc - (basic + hra + conveyance);

    const gross = basic + hra + conveyance + specialAllowance;


    /* DEDUCTIONS */

    // ✅ PF = Basic × %
    const pf = (basic * structure.pfPercent) / 100;

    const pt = structure.ptAmount || 0;

    const perDaySalary = workingDays > 0 ? gross / workingDays : 0;

    const leaveDeduction = lopDays * perDaySalary;

    const deductions = pf + pt + leaveDeduction;

    const netSalary = gross - deductions;


    return {
      basic: round(basic),
      hra: round(hra),
      conveyance: round(conveyance),
      specialAllowance: round(specialAllowance),
      gross: round(gross),

      pf: round(pf),
      pt: round(pt),
      lopDays,
      leaveDeduction: round(leaveDeduction),

      deductions: round(deductions),
      netSalary: round(netSalary),
    };
  }
}