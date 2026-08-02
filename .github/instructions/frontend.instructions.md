---
description: "Use when changing Worthboard pages, layouts, React components, forms, charts, responsive behavior, styling, accessibility, loading states, or privacy-sensitive financial displays."
name: "Worthboard Frontend"
applyTo: "app/**/*.tsx, components/**/*.tsx, app/globals.css"
---
# Frontend implementation

- Preserve the established compact, dark financial-dashboard language in `app/globals.css` and existing components. Build the working product interface, not a marketing page or explanatory landing page.
- Distinguish an application user from a financial account in labels, variable names, and help text. Signup and login use a username; portfolio pages use “account” only for tracked financial holdings.
- Prefer Server Components. Add `"use client"` only for browser APIs, local interaction state, React Hook Form, or client-only chart behavior; keep database and session access out of client modules.
- Reuse `components/ui` primitives, `components/forms` patterns, Lucide icons, semantic CSS tokens, and existing page shells before creating a new component abstraction or visual treatment.
- Use React Hook Form with `zodResolver` and the shared schemas in `lib/validation.ts`. Follow the existing action-state, pending-state, field-error, and idempotency-key patterns for financial forms.
- Format money and dates with project helpers and user settings. Never perform authoritative financial arithmetic in a component. Convert safe display values for Recharts only at the chart boundary.
- Route every sensitive amount through the existing privacy-value behavior. New summaries, labels, chart tooltips, tables, and mobile views must respect hidden-value mode.
- Never send or persist an owner `userId` merely to authorize a client action. Show the current identity and logout affordance where appropriate, while ownership remains a server-session concern.
- Clear user-specific client state on logout and account changes. Do not service-worker cache authenticated financial responses or allow one user to see the previous user's stale data on a shared device.
- Keep interactions keyboard accessible, controls labelled, focus states visible, and destructive actions explicit. Use semantic elements and familiar icons with accessible names.
- Provide useful loading, empty, validation, error, offline, and disabled states without exposing sensitive details.
- Check layouts at the project’s supported widths: 360, 390, 768, 1024, and 1440 px. Prevent text clipping, horizontal overflow, overlapping controls, and chart containers with unstable dimensions.
- Add a component test for isolated interaction logic and a Playwright test when a change affects navigation, signup, persistence, authentication, user switching, privacy, or a complete user workflow.