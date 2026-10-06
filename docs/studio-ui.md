# Studio UI

Studio uses the shared Tailwind v4 and shadcn/Radix components in `packages/ui`.
The application starts in the dark theme; the account menu switches themes and
persists the preference. Project and branch selection survives page reloads in
the current browser session.

## Navigation

- **Workspace:** project overview and quick actions.
- **Build:** database, schema visualizer, authentication, API, realtime and storage.
- **Manage:** backups, activity analytics and settings.
- Functions and AI & Vectors show their planned status and link to the roadmap.

Use Command/Ctrl + K to search pages or switch projects. Outside form controls,
`g` followed by `o`, `d`, `s`, `a`, `l` or `t` opens overview, database, schema,
authentication, logs or settings. On smaller screens, the navigation button opens
a keyboard-accessible Sheet.

Settings uses a left sidebar for General, Workspace, Members, Security and
Integrations, with left-label / right-control form rows in each panel. Account
supports platform avatar upload with a crop dialog (JPEG/PNG/WebP/GIF, max 3MB).
Security contains
administrator TOTP enrollment and passkey registration, rename and delete.
Passkeys can also be used on the sign-in screen.

## Styling and components

`packages/ui/src/theme.css` owns semantic colors, typography, focus and reduced
motion behavior. Tailwind scans both apps and the shared component sources.
Studio layouts use utility classes; avoid unlayered selectors that override
Tailwind classes such as `.flex`, `.grid` or `.hidden`.

Studio mounts the shared ShadCN `Toaster` (Sonner) at the root for success,
error, validation and alert feedback. Prefer `toast` / `notifyError` from
`@qb-flex/ui` over inline Notice banners for actionable failures.

The shared package keeps legacy Button, Modal, Drawer, Notice, Loading and Empty
signatures. New screens should compose Card, FieldGroup/Field, Tabs, Alert,
Dialog, Sheet and other primitives. Use `cn` for conditional utility classes.
`packages/ui/components.json` and its local TypeScript aliases allow the shadcn
CLI to resolve and inspect the existing component files.

Storage uses a file-browser layout: search, sortable table (name/date/size/owner),
row selection, pagination, and a details sidebar with object info when a file is
selected. Bucket choice lives in a compact toolbar above the browser.

Schema Visualizer uses the approvals-ui workflow canvas adaptation in the shared
package. Table cards include React Flow source/target handles for foreign-key
edges. Enter/Space opens table details; Escape closes the details Sheet. The
Sheet includes column access, constraints, indexes, foreign keys and row policies.
Canvas controls and the minimap follow the application theme and reduced motion.

## Verification

Run `bun run test:studio-ui` for an isolated fixture that checks all 12 routes at
375, 768, 1024 and 1440 pixels in both themes, automated WCAG A/AA rules, table
column visibility and filtering, database/settings tabs, schema edges and keyboard
interaction, mobile navigation and passkey CRUD/sign-in with a virtual authenticator.
It writes screenshots and machine-readable results under
`verification-artifacts/studio-revamp/`. The fixture owns its temporary database
and does not use the developer's project data.

`bun run test:browser` covers Docs navigation/search/theme/mobile behavior and the
Studio/React/Vanilla CRUD and file-transfer workflows. Also run `bun run check`,
Studio and Docs production builds, and the repository skill freshness checks.
Automated accessibility checks cover rendered fixture states; they do not replace
manual assistive-technology testing or validate every possible production dataset.
