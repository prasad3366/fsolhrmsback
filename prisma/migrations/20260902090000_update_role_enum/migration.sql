-- Map legacy roles before replacing the PostgreSQL enum.
CREATE TYPE "Role_new" AS ENUM ('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER', 'IT_MANAGER', 'SALES_MANAGER', 'EMPLOYEE');

ALTER TABLE "User"
ALTER COLUMN "role" TYPE "Role_new"
USING (
  CASE "role"::text
    WHEN 'ADMIN' THEN 'SUPER_ADMIN'
    WHEN 'MANAGER' THEN 'SUPER_ADMIN'
    ELSE "role"::text
  END
)::"Role_new";

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
