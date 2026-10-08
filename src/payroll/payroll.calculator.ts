export class PayrollCalculator {
  /* grossBasis = EmployeeSalary.monthlyGross, or monthlyCTC for legacy rows */
  static calculate(
    grossBasis: number,
    structure: any,
    workingDays: number,
    lopDays: number,
  ) {

    const round = (v: number) => Math.round(v);

    /* EARNINGS */

    const basic = (grossBasis * structure.basicPercent) / 100;

    const hra = (basic * structure.hraPercent) / 100;

    // Fixed amount when configured; legacy structures keep the percentage
    const conveyance = structure.conveyanceAmount !== null && structure.conveyanceAmount !== undefined
      ? Number(structure.conveyanceAmount)
      : (grossBasis * structure.conveyancePercent) / 100;

    const roundedBasic = round(basic);
    const roundedHra = round(hra);
    const roundedConveyance = round(conveyance);
    const gross = round(grossBasis);
    const specialAllowance = gross - roundedBasic - roundedHra - roundedConveyance;


    /* DEDUCTIONS */

    // ✅ PF = Basic × %
    const pf = (basic * structure.pfPercent) / 100;

    const pt = structure.ptAmount || 0;

    const perDaySalary = workingDays > 0 ? gross / workingDays : 0;

    const leaveDeduction = lopDays * perDaySalary;

    const roundedPf = round(pf);
    const roundedPt = round(pt);
    const roundedLeaveDeduction = round(leaveDeduction);
    const deductions = roundedPf + roundedPt + roundedLeaveDeduction;
    const netSalary = gross - deductions;


    return {
      basic: roundedBasic,
      hra: roundedHra,
      conveyance: roundedConveyance,
      specialAllowance,
      gross,

      pf: roundedPf,
      pt: roundedPt,
      lopDays,
      leaveDeduction: roundedLeaveDeduction,

      deductions: round(deductions),
      netSalary: round(netSalary),
    };
  }
}