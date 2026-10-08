-- Gross-based salary components. Both columns are nullable, so existing
-- salary rows and structures keep calculating exactly as before.
ALTER TABLE "EmployeeSalary" ADD COLUMN "monthlyGross" DOUBLE PRECISION;
ALTER TABLE "SalaryStructure" ADD COLUMN "conveyanceAmount" DOUBLE PRECISION;

-- New default structure (existing structures are not modified):
-- Basic 35% of Gross, HRA 40% of Basic, fixed Conveyance 2,000.
-- PF/PT keep the existing defaults.
INSERT INTO "SalaryStructure" ("name", "basicPercent", "hraPercent", "pfPercent", "ptAmount", "healthInsurance", "conveyancePercent", "pfBase", "conveyanceAmount")
SELECT 'Standard Gross Structure', 35, 40, 12, 200, 0, 0, 0, 2000
WHERE NOT EXISTS (SELECT 1 FROM "SalaryStructure" WHERE "name" = 'Standard Gross Structure');
