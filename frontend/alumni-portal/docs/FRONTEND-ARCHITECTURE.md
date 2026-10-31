# Frontend architecture

Pages and supporting modules are grouped by feature under src/features. Existing URLs, authentication, API contracts, component names and CSS selectors are preserved.

- app/: App route tree and ProtectedRoute. main.jsx remains the Vite entry point.
- features/dashboard/: alumni, employer, admin-alumni, admin-employer and registrar dashboards.
- features/messaging/: embedded and routed chat pages, attachments, conversation controls, chat hook, styles and utilities.
- features/alumni-records/: graduate tracking, Alumni Profile Drawer, registrar records, import/table components and registrar data hook.
- features/jobs/: listings, posting, applications, applicant documents and supporting helpers.
- features/resumes/: Resume Builder, editor sections, templates, document export/pagination and draft helpers.
- features/auth/ and features/registration/: login, reset, account setup, registration forms, OTP and privacy controls.
- features/verification/, features/membership/, features/profiles/: review workflows and profile UI.
- features/notifications/, features/announcements/, features/settings/, features/activity-logs/: their existing pages and supporting styles.
- features/public-site/: landing, about and contact UI/styles.
- components/: shared layout, UI, forms, confirmation modal and file-preview controls.
- hooks/, contexts/, services/, utils/, assets/, styles/: genuinely shared infrastructure and resources.

## Retained external dependencies

Keep assets/alumni-logo.jpg, utils/registrationEmail.js, utils/graduationYear.js and utils/academicPrograms.js at their current paths. Backend PDF generation/tests and the shared academic-program configuration depend on these paths. services/api.js remains the shared authenticated API service.

## Styles and tests

Stylesheets were moved intact; import order is preserved. AdminEmployerPage.css, EmployerPage.css and AuthPage.css are shared sheets under styles/. Cross-feature style imports remain explicit. No stylesheet consolidation or component extraction was performed.

Tests remain in tests/. Use npm run build and npm run lint. Node tests run with node --test; browser suites use the existing Puppeteer fixtures and an installed Chrome/Chromium. Existing baseline test/lint failures are recorded in the organization execution report.

Some legacy or dormant modules remain intentionally: no file deletions were approved.
