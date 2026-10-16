# Mobile responsiveness audit — 2026-10-16

## Scope and verification status

This is a source audit and implementation report. Rendered-page acceptance testing is still pending. The Browser skill runtime failed twice during initialization with `Cannot redefine property: process`; its troubleshooting API was also unavailable because initialization did not create `agent`.

No rendered viewport sizes were tested. The required matrix remains **320, 375, 390, 430, 768, 1024px and desktop above 1024px**. CSS inspection, compilation, and workflow tests do not establish visual correctness or physical keyboard behavior.

## Pages and shared UI inspected

| Portal | Pages and views inspected in source |
| --- | --- |
| Admin Employer | Dashboard; Verification History including pending/approved/rejected lists and permit preview; Manage Posted Jobs and applicant details; Messages; Post Job/moderation; System Logs; Profile/settings |
| Admin Alumni | Dashboard and metric detail lists; Alumni Records including employment tracking, profile drawer, and Request Profile Update; Membership Applications and review preview; Messages/forum; Post Announcement/moderation; System Logs; Profile/settings |
| Employer | Dashboard; job posting and preview; posted-job management and recruitment actions; applicant lists/details and document previews; Messages; notifications; company profile/settings, as implemented in EmployerPage |
| Alumni | Dashboard and application-history/job/announcement views; Jobs and application form; Feed and comments/profile previews; Messages; Notifications/interview details; Profile including edit forms; Resume Builder; membership onboarding/application/review modal |

Shared review included Sidebar.module.css, DashboardLayout, AdminShell, Navbar header measurement, drawer effects, message attachments/options, record-table wrappers, job posting/application controls, Bootstrap modal styling, profile preview/drawer styles, resume editor/preview styles, membership forms/review, CSV import, and applicant document previews. Public landing/authentication pages and backend logic were outside the change scope.

## Findings and changes

| Finding | Change |
| --- | --- |
| A 300px sidebar consumes much of a tablet's available width | Shared drawer CSS and its behavior now use the same `max-width: 1024px` breakpoint. Desktop retains the approved flush-left, full-height sidebar. |
| Both admin message pages displayed list and chat together on phones and had no Back control | Added presentation-only list/chat state, conversation click handling, and a Back button to each admin page. Thread selection/identity, API calls, and deletion ownership checks are unchanged. |
| Alumni chat reset to the conversation list on every window resize | Subscribe to the media-query breakpoint change instead; keyboard-height changes no longer trigger the reset. |
| Chat used hardcoded viewport deductions and Employer chat imposed a 420px minimum height | All four selected-chat views fill the viewport below the navbar on compact screens, using VisualViewport height when available. Header/composer do not shrink; message history scrolls independently. |
| Mobile chat stream height caps could leave unnecessary empty space or push the composer out of view | A shared selected-chat rule removes those caps and flexes the stream to available height. Attachments remain constrained; the existing menu positioning logic is retained. |
| Verification rows require more width than their container at intermediate sizes while horizontal overflow was hidden | Enable internal horizontal scrolling. Existing single-column record layout at 700px and below remains. |
| Long drawer names and fixed header sections could shrink/clash | Allow person text to shrink/wrap, keep close/actions/tabs from shrinking, use dynamic viewport height, and allow whole-drawer scrolling on short landscape screens. |
| Settings grid has a 240px track minimum; nested dashboard/card text can force overflow | Constrain the settings track minimum to available width and add scoped shrinking/wrapping rules to the affected portal containers. |
| Nested Alumni page padding reduces useful phone width | Remove redundant inner horizontal padding at 600px and below; use compact shared content padding. Preserve the existing swipeable dashboard metrics. |
| Modal bodies can outgrow the available viewport | Portal-scoped dynamic height limits, independent body scrolling, nonshrinking header/footer, wrapping footer buttons, and constrained form controls. |
| Resume document-name controls remain in a horizontal row on phones | Stack that row and allow editor action groups to wrap. The existing measured A4 scaling, templates, pagination, stored data, and PDF generation are unchanged. |
| Existing record tables already have scrolling wrappers and membership education already has a mobile layout | Reuse those implementations and constrain wrapper sizing rather than replacing tables or actions. |

The new cross-page rules are in `src/portal-responsive.css`, scoped to portal roots or modals belonging to an open portal, and limited to widths at or below 1024px. No global horizontal-overflow hiding was added. Green palette values were not changed. Dashboard data/calculations were not changed.

## Files changed for this task

- `src/portal-responsive.css` — shared compact portal and modal layout rules (new).
- `src/main.jsx` — import shared responsive CSS.
- `src/components/Sidebar.module.css` — tablet drawer breakpoint and compact content padding.
- `src/components/DashboardLayout.css` — align Alumni compact breakpoint.
- `src/hooks/usePortalDrawer.js` — match the tablet drawer breakpoint.
- `src/hooks/useChatViewport.js` — keyboard viewport sizing subscription with cleanup (new).
- `src/pages/AdminAlumniMessagesPage.jsx` — mobile list/chat state and Back control; viewport subscription.
- `src/pages/AdminEmployerMessagesPage.jsx` — mobile list/chat state and Back control; viewport subscription.
- `src/pages/EmployerMessagesPage.jsx` — viewport subscription.
- `src/pages/MessagesPage.jsx` — viewport subscription and breakpoint-only view reset.
- `src/pages/MessagesPage.css` — tablet single-panel behavior, selected-chat sizing, scroll containment, wrapping and tap sizing.
- `src/pages/EmployerPage.jsx` — align drawer resize behavior with 1024px breakpoint.
- `src/pages/ResumeBuilderPage.css` — compact editor controls.
- `src/pages/admin/AdminAlumniRecordsPage.css` — drawer/header/action sizing.
- `src/pages/admin/AdminVerificationPage.css` — internally scroll wide verification rows.
- `tests/portalDrawer.test.js` — update the expected media query to the intentional tablet breakpoint.

The earlier sidebar task also changed `src/pages/EmployerPage.css`; this task leaves those changes intact. Pre-existing backend, profile-upload, API-service, deployment/configuration, and other working-tree changes were preserved.

## Checks

- Production frontend build: passed (Vite reports an empty `react` chunk warning).
- `node --test tests/*.test.js`: **134 passed, 0 failed**, including all six drawer behavior checks.
- `git diff --check`: passed.
- Targeted ESLint: **20 errors and 5 warnings** in the four existing messaging page files. Compared each file against `HEAD` using the same ESLint configuration: the same rule findings exist before these edits. The new viewport hook, drawer hook, and main entry have no lint findings. Unrelated messaging refactors were not included.

## Remaining acceptance work

Run every listed page/view at the viewport matrix above with representative long names, emails, filenames, many records, and attachments. Check open/close/overlay/navigation and active states; table scrolling and actions; form validation and uploads; profile tabs and update requests; chat Back, message history, menus, images and keyboard behavior; resume preview aspect ratio; and desktop appearance. Real iOS/Android keyboard and landscape testing is particularly important for the VisualViewport behavior. These checks remain unverified, rather than being reported as passed.
