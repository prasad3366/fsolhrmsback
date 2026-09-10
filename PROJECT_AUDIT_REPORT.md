# PROJECT AUDIT REPORT

Audit date: 2026-09-06  
Repository: `backend/fsolback/hrms`  
Scope: Current workspace contents, source code, Prisma schema and migrations, tests, build configuration, and available audit artifacts.

## 1. EXECUTIVE SUMMARY & TECH STACK

This workspace is an executable NestJS backend for a PostgreSQL-backed HRMS. It is not a complete full-stack workspace: no frontend source, pages, components, API clients, routing tree, or frontend state-management implementation exists under the current root. Earlier audit documents reference a separate frontend workspace, but that workspace is not available for direct verification.

The backend is modular and substantial. It includes authentication, employees, attendance, WFH, leave, holidays, documents, payroll, salary, assets, helpdesk, teams, dashboard, recruitment, training, announcements, reports, and settings. Newer modules are layered on top of older operational modules, creating overlapping data models and policy paths in several areas.

### Technology stack

- Runtime: Node.js with TypeScript.
- Framework: NestJS 11.
- HTTP platform: `@nestjs/platform-express`.
- Authentication: Passport/JWT, custom JWT guard, role guard, bcrypt password verification.
- Validation: `class-validator`, `class-transformer`, global NestJS `ValidationPipe` with `whitelist: true`.
- ORM/database client: Prisma 6 with PostgreSQL.
- Scheduling: `@nestjs/schedule` and cron-based schedulers.
- File/document support: Multer and database-backed document binary storage.
- Email: Nodemailer.
- Other notable libraries: PDFKit, Puppeteer, RxJS, `@nestjs/mapped-types`.
- Testing: Jest, ts-jest, Supertest, Nest testing utilities.
- Build: Nest CLI and TypeScript; scripts are defined in `package.json`.
- Configuration: dotenv / Nest `ConfigModule`, environment-backed `DATABASE_URL` and JWT secrets.
- State management/UI: not present in this workspace. Frontend state and API-layer claims in existing text audits are external evidence only.

### Verification result

The available Jest run executed 42 suites: 41 passed and 1 failed, with 518 passing tests and 1 failing test. Prisma schema validation was not completed in the audit terminal because the shell intermittently failed to resolve `npm.cmd`; the source diagnostics reported one existing leave-summary behavioral mismatch. The worktree is heavily modified and contains many untracked audit reports, migrations, generated files, and source changes, so this report does not treat the current state as a clean baseline.

## 2. COMPLETED MODULES (100% Functional)

A strict 100% end-to-end rating cannot be certified for any module from this workspace because the active UI is absent and the full suite is not green. The following are the strongest backend-complete areas: they have registered Nest modules/controllers, service implementations, Prisma-backed persistence, DTOs or validation surfaces, and meaningful tests or operational coverage.

### Authentication and authorization foundation

- Login, refresh, logout, and forgot-password routes exist in the auth module.
- JWT verification loads the database user and active employee state.
- Roles are enforced with `RolesGuard`; resource and manager-scope checks are also implemented in `AuthorizationService`.
- Refresh tokens are hashed in the database.
- Residual risk: database-driven `RolePermission` settings are not consulted by `RolesGuard`; authorization remains decorator and service policy driven.

### Employees

- Employee CRUD and self/profile paths exist with DTO validation and ownership/admin guards.
- Employee lifecycle fields, status, department, team, and extended profile data are persisted.
- Tests cover service and controller authorization surfaces.

### Leave

- Leave application, balance, approval/rejection, history, carry-forward, validation, and concurrency-related behavior exist.
- This is operationally broad and well tested, but the current suite contains one failing target-summary expectation and `LeavePolicy` is separate from the transactional `LeaveType` model.

### Documents

- Document types, uploads, approvals, employee scoping, and database-backed file data are implemented.
- Controller/service tests cover upload and authorization behavior.

### Payroll and salary

- Salary structures, employee salaries, payroll generation, adjustments, payslip support, and scheduler paths exist.
- Payroll has service and working-day tests.
- Residual risk: attendance/reporting policy sources are not unified with payroll calculation inputs.

### Assets

- Asset creation, assignment, return, assignment history, and authorization paths exist.
- Multiple asset service/controller/assignment tests are present.

### WFH and teams

- WFH request flows and team membership/manager scope are implemented with authorization tests.

### Holidays

- The original holidays module has create, update, delete, yearly lookup, optional holiday behavior, date normalization, duplicate handling, and payroll-period protection.
- A newer settings holiday service also exists, creating two ownership surfaces that need consolidation.

### Attendance legacy path

- Employee-based attendance, geolocation checks, office/WFH location status, punch logs, monthly summaries, working-day integration, and CSV dashboard export are implemented and tested.

### Newer platform modules

- Training: program CRUD, enrollment, employee detail inclusion, and enrollment status updates.
- Announcements: CRUD, department/expiry filtering, pinned ordering, and employee read tracking.
- Reports: executive summary and employee/attendance/training export data.
- Settings: organization settings, role-permission matrix, audit logs, policy configuration, lifecycle, security, workflow, notification, branch schema, and audit service.

These newer modules are backend foundations rather than proven full-stack features because no corresponding UI is present in this workspace.

## 3. IN-PROGRESS / PARTIAL MODULES (Requires Wiring or Refinement)

### Attendance

Attendance has two competing systems:

1. Legacy employee-based `Attendance`, `AttendanceLog`, and geolocation services.
2. New user-based `AttendanceRecord` and `AttendanceRegularization` services.

The new clock-in/out path consumes `AttendancePolicy`, but legacy attendance, reports, and payroll consume the older `Attendance` model. The same employee can therefore have divergent attendance records. Regularization records also have no Prisma foreign-key relations and do not automatically feed legacy attendance or payroll.

### Leave and leave policy

Transactions use `LeaveType`, `LeaveBalance`, and `Leave`; settings CRUD uses the separate `LeavePolicy` model. `LeavePolicy` values are not used to allocate balances, validate medical documents, or calculate carry-forward. This is a control-plane/data-plane split that can produce settings that appear saved but have no operational effect.

### Recruitment

Job postings have CRUD and candidate listing/deletion foundations. Missing or incomplete areas include candidate creation/status transitions and interview scheduling, feedback, ratings, and lifecycle operations. `createdById` and `interviewerId` are scalar IDs without relations.

### Training

Program CRUD and enrollment flows are present. Enrollment creation accepts employee IDs without an explicit existence check in the service, and enrollment authorization is mainly role/ownership based. Department or manager-scope rules are not fully enforced.

### Announcements

Announcement CRUD and read tracking are present. Notification settings are not used to dispatch email or in-app notifications. `createdById` is not related to `User`.

### Reports

The reports controller exposes organization-wide employee, attendance, and training exports for several management roles. The report implementation does not visibly apply manager team scope in the reports controller/service, so cross-organization exposure requires review before production use.

### Settings

Settings is broad but still a configuration repository rather than a fully integrated control plane. It persists attendance, leave, security, lifecycle, workflow, notification, permission, branch, and organization settings; only parts of attendance policy are consumed by the newer attendance path. Branch CRUD and branch-to-employee/holiday scope are not implemented.

### Audit logging

`AuditService` is centralized and policy mutations call it, but there is no global audit interceptor/middleware covering all sensitive mutations. Audit values are JSON-serialized into text, and some calls use placeholder/system email rather than a guaranteed request principal.

### Frontend integration

No frontend source is present here. Therefore settings, reports, announcements, training, attendance, and all other modules cannot be certified as wired to active pages, API clients, route guards, or frontend state from this repository alone.

## 4. UNBUILT / PLANNED MODULES

These areas are referenced by schema, navigation evidence in prior reports, or foundation code but are not complete end-to-end modules in the current workspace:

- Frontend application layer: pages, components, browser routing, API client, auth context, refresh wrapper, and state management are absent from this workspace.
- Recruitment candidate lifecycle and interview management beyond the foundation models.
- Branch/location management: `Branch` exists in Prisma, but there is no complete branch controller/service/DTO workflow and no employee/holiday branch relationship.
- Full settings administration UI and settings-driven enforcement across modules.
- Security policy enforcement: password complexity, failed-login lockout, session timeout, and 2FA behavior are not implemented in `AuthService`.
- Approval workflow engine: `ApprovalWorkflow` is stored, but leave/expense/regularization flows do not consistently resolve workflow levels from it.
- Notification delivery: `NotificationSetting` is stored, but no complete event dispatch, email, or in-app notification pipeline is connected.
- Audit interceptor coverage: no universal sensitive-operation interceptor is present.
- Attendance regularization integration with legacy attendance, monthly summaries, payroll, and reports.
- Expense module: approval workflow comments reference expense, but no expense domain is present.
- Dynamic RBAC enforcement from `RolePermission`: the model and settings API exist, but guards use hardcoded role decorators.

## 5. DATABASE & SCHEMA HEALTH

### Strengths

- Prisma schema is large and organized around domain models.
- Important transactional relations exist for employees, leave, payroll, assets, teams, documents, WFH, training enrollments, and announcement reads.
- Unique constraints exist for employee identity, attendance employee/date, leave balances, payroll employee/month/year, training enrollments, announcement reads, and role/module permissions.
- Forward-only migrations have been added for newer recruitment, training, announcements, settings, policy, and attendance-record features.

### High-risk schema findings

- Duplicate attendance models represent two different identity systems: `employeeId` in legacy attendance and `userId` in the new attendance records.
- `AttendanceRecord`, `AttendanceRegularization`, `AuditLog`, `Announcement.createdById`, `TrainingProgram.createdById`, `JobPosting.createdById`, `Interview.interviewerId`, and `Holiday.branchId` are scalar IDs without corresponding foreign keys or Prisma relations.
- `LeavePolicy` duplicates policy concepts already represented by `LeaveType`, `yearlyQuota`, `carryForward`, `maxCarryLimit`, and `requiresMedical`.
- `Branch` is not related to `Employee`, `Holiday`, or reporting scope.
- Several statuses are free-form `String` fields instead of enums, especially new attendance and regularization status values.
- The existing `Holiday` model was extended with `title` and `branchId` while retaining legacy `name` and `location`; this compatibility approach creates dual fields and ambiguity.
- `AuditLog.previousVal` and `newVal` are text rather than PostgreSQL JSON/JSONB, making structured querying and indexing harder.
- The migration history has known drift: migration `20260402070157_update_strcture` adds `SalaryStructure.pfBase`, while the current schema does not contain `pfBase`.
- Settings migrations evolve column names and models across multiple dated migrations; deployment ordering must be tested against a real database, not only Prisma schema validation.
- `tsconfig.json` maps `@prisma/client` to `./generated/prisma/client`, but no `generated` directory is present; the project relies on installed generated client behavior and this alias is fragile.

### Index and constraint gaps

- Add indexes for high-volume reporting filters: attendance record `(userId, date)`, regularization `(status, createdAt)`, audit log `(module, createdAt)`, holiday `(branchId, date)`, and event/status queries where production volume warrants them.
- Add foreign keys for user/employee ownership fields or explicitly document why they are intentionally denormalized.
- Add check/enum validation for time strings, statuses, approval levels, and policy ranges.
- Decide whether legacy and new holiday fields are transitional; backfill and remove one representation once consumers are migrated.

### Observed automated test issue

The full test run was not green: `src/leave/leave.service.summary.spec.ts` expects `currentLeaveStatus.status` to be `ON_LEAVE`, but the current implementation returned `NOT_ON_LEAVE` for the fixture. This is a functional contract mismatch, not a compile error.

## 6. INTEGRATION GAPS WITH SETTINGS CONTROL PLANE

The Settings module is currently a repository for configuration, not yet the authoritative policy engine. The following hardcoded or disconnected paths need wiring:

1. **Working days and shifts**
   - `WorkingDaysService` contains calendar/business-day logic and special Saturday behavior.
   - `AttendancePolicy.workDays` is not used to determine working dates.
   - Attendance policy shift fields are consumed only by the newer `AttendanceRecord` path, not the legacy employee attendance path.

2. **Late and early thresholds**
   - New attendance clock-in uses shift start plus `gracePeriodMins`.
   - The policy's `lateArrivalThreshold` is not used.
   - Legacy attendance status is derived from hardcoded hour thresholds.
   - Early checkout is not consistently propagated to legacy attendance, reports, or payroll.

3. **Half-day and overtime rules**
   - Legacy attendance contains hardcoded hour logic around absent/half-day/present.
   - `AttendancePolicy.halfDayHours`, `overtimeEnabled`, and related settings are not consistently applied across payroll and reports.

4. **Leave allocation and carry-forward**
   - Transactions use `LeaveType.yearlyQuota`, `carryForward`, and `maxCarryLimit`.
   - `LeavePolicy.annualAllocation`, `carryForwardMax`, `accrualFrequency`, and `isLossOfPay` are not used by leave balance creation or carry-forward calculations.

5. **Holiday and branch scope**
   - `Holiday.branchId` exists but branch relationships and branch-aware working-day filtering are absent.
   - Existing holiday logic uses legacy `location`, creating inconsistent targeting semantics.

6. **Employee lifecycle**
   - `EmployeeSetting` stores prefixes, probation, notice period, and onboarding requirements.
   - Employee creation, probation transitions, onboarding validation, and exit processing do not consistently fetch these settings.

7. **Security and sessions**
   - `SecurityPolicy` is not consumed by password validation, login failure tracking, account locking, refresh/session expiry, or 2FA.
   - Auth behavior remains hardcoded around JWT and active-user checks.

8. **Approval workflows**
   - `ApprovalWorkflow` is persisted but controller/service approval paths use hardcoded role and scope rules.
   - Regularization, leave, and any future expense approval should resolve configured approval levels and required comments.

9. **Notifications**
   - `NotificationSetting` is not connected to leave events, late attendance events, anniversaries, new joiners, or announcement creation.
   - Email and in-app channels have no shared notification abstraction.

10. **RBAC matrix**
    - `RolePermission` is seeded and editable, but `RolesGuard` does not query it.
    - Authorization therefore has two sources of truth: decorator role lists and database permission rows.

11. **Organization preferences**
    - `SystemSetting.timeZone`, `currency`, financial year, date format, and time format are stored but not broadly used by date formatting, payroll, reports, or notifications.

## 7. RECOMMENDED ACTION PLAN (Priority-ranked list of top 5 high-impact focus areas)

1. **Unify attendance into one canonical model and service.**
   Choose employee identity or user identity as the canonical key, migrate the other path, and make reports, payroll, regularization, and working-day calculations consume the same records. Add foreign keys, status enums, and reconciliation migration tests.

2. **Make Settings the authoritative policy control plane.**
   Wire attendance, leave, lifecycle, security, workflow, notification, organization, and RBAC settings into the services that enforce those rules. Remove hardcoded thresholds only after behavior is covered by focused tests.

3. **Close schema/migration drift and relational integrity gaps.**
   Reconcile the `pfBase` migration discrepancy, validate the complete migration chain against a disposable PostgreSQL database, add missing foreign keys/indexes, and remove transitional duplicate holiday/leave fields after consumers migrate.

4. **Finish authorization and audit coverage.**
   Decide whether `RolePermission` is authoritative, implement a permission-aware guard or keep the matrix explicitly informational, add manager/resource scope to reports and newer modules, and introduce a global audit interceptor for sensitive mutations.

5. **Restore a green contract-tested delivery pipeline and verify the frontend separately.**
   Fix the leave-summary mismatch, add integration tests for settings/attendance/report routes, add Prisma generate/migrate scripts, and audit the separate frontend workspace for route/API/state wiring. Do not label modules 100% complete until both backend contracts and active UI flows are verified.

## Audit conclusion

The repository is a capable, modular HRMS backend with meaningful test coverage and broad domain implementation. Its main production risk is not a lack of code; it is the coexistence of multiple representations and policy authorities. Attendance, leave policies, RBAC, holidays, audit coverage, and frontend integration need consolidation before the system can be considered enterprise-grade end to end.
