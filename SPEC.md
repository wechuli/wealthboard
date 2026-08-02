# Wealthboard product specification

## Status and terminology

This document defines the implemented architecture for multiple independent
application users. Upgrading a singleton database discards its old credentials
and unowned portfolio records; every application user signs up normally and
starts with an empty portfolio.

To avoid ambiguity:

- **Application user** means a person who signs up and authenticates.
- **Financial account** means a bank account, investment, property, vehicle,
  liability, or other tracked holding owned by one application user.

Wealthboard is a polished, self-hosted, multi-user personal wealth and goals tracker.

The app should feel significantly simpler than Wealthfolio. It is not intended to be an accounting system, a trading platform, or a detailed budgeting app.

The main user workflow should be:

1. Sign up or sign in to a private portfolio.
2. Add a financial account or asset.
3. Enter its current value.
4. Categorize it, for example:
   - Securities
   - Money market funds
   - Fixed income
   - Savings
   - Cash
   - Land and real estate
   - Vehicles
   - Other assets
   - Liabilities
5. Periodically update the value or record a deposit, withdrawal, gain, or loss.
6. View total net worth and portfolio allocation through useful dashboards.
7. Create financial goals and track contributions toward them.

The product should be optimized for individuals manually tracking their own
wealth over time. Users share the deployment but never share portfolio data.

## Product name

Use the temporary name:

“Wealthboard”

Make it easy to rename later through a configuration file.

## Technology stack

Use:

- Next.js latest stable version
- App Router
- TypeScript with strict mode
- React
- SQLite
- Drizzle ORM
- Recharts
- Tailwind CSS
- shadcn/ui
- Zod
- React Hook Form
- Lucide icons
- date-fns
- Argon2 or bcrypt for password hashing
- Next.js server actions or route handlers
- Docker and Docker Compose
- PWA support

Do not create a separate backend application. The Next.js application should handle server-side operations and access SQLite directly.

Use a persistent SQLite database file mounted through Docker.

The application should be suitable for deployment to a home server or Kubernetes cluster.

## Important architectural principles

- Support multiple independent application users in one deployment.
- Enforce strict per-user data isolation in schema, services, actions, pages,
  route handlers, exports, imports, analytics, caches, and tests.
- Do not implement organizations, teams, households, roles, invitations,
  shared portfolios, or cross-user financial accounts in the initial
  multi-user release.
- No dependency on cloud authentication providers
- No mandatory external APIs
- Manual data entry should work without external financial integrations
- Prefer simple and reliable architecture over enterprise abstractions
- Keep business logic separate from UI components
- Use decimal-safe money handling
- Store monetary values as integer minor units where practical
- Do not use JavaScript floating-point arithmetic for financial calculations
- Use transactions when updating balances and financial records
- All dates should be stored in UTC and shown in the user’s configured timezone
- Default timezone: Africa/Nairobi
- Default base currency: KES

## Identity, signup, and authentication

Implement simple local authentication for independent application users. Do
not require email delivery, OAuth, or another identity provider.

Requirements:

- Authenticate with a unique, case-insensitive username and password. Keep the
  display name separate from the login identifier.
- Normalize usernames to lowercase and restrict them to 3-32 characters using
  letters, numbers, `.`, `_`, and `-`.
- Keep `/signup` publicly available at all times. Every application user,
  including the first user, must create their identity through the signup form.
- Do not support environment-created users, default credentials, setup users,
  invitation-only creation, or any other account bootstrap path.
- Hash passwords with bcrypt using the existing work factor. Never store or log
  plaintext passwords or sensitive form values.
- Require a password of at least 12 characters and confirm it during signup.
- Create each user, their settings, seeded categories, and initial exchange
  rates atomically. A failed signup must not leave partial user data.
- Signup must not create financial accounts or sample portfolio data. Each user
  adds their own financial accounts after authentication unless they explicitly
  run the optional demo seed against their own identity.
- After signup, create a session and redirect to the private dashboard.
- Put the immutable user ID in the signed session token subject. Never accept a
  user ID from form data, route parameters, headers, or query strings as proof
  of ownership.
- Use secure, HTTP-only, SameSite=Strict cookies. Sessions expire after the
  user's configured period and are rejected when the user is inactive or the
  session version no longer matches.
- Allow password changes from Settings. A password change increments that
  user's session version and invalidates their other sessions only.
- Include logout and clear user-specific client state when switching users.
- Protect every application route except login, signup, health checks, and
  public PWA assets.
- Rate-limit login by normalized username and client address, and rate-limit
  signup by client address. Login errors must not reveal whether a username
  exists.
- Do not implement email password reset. Provide a documented operator CLI that
  resets one user by username, reads the new password from an environment
  variable, and invalidates only that user's sessions.

## Core data model

Design a clean SQLite schema using Drizzle.

### Users

Authentication identity and credentials belong in a dedicated `users` table.

Fields should include:

- id, generated UUID
- username, normalized and unique case-insensitively
- passwordHash
- status: Active or Disabled
- sessionVersion
- lastLoginAt, optional
- createdAt
- updatedAt

### User settings

Fields should include:

- userId, unique foreign key to users
- displayName
- baseCurrency
- supportedCurrencies
- timezone
- preferredDateFormat
- appName
- defaultDashboardPeriod
- sessionTimeoutMinutes
- defaultGoalReturnBps
- createdAt
- updatedAt

### Ownership and data isolation

- Every user-owned table must have a non-null `userId` foreign key, including
  categories, financial accounts, transactions, valuations, exchange rates,
  goals, goal contribution plans, and idempotency keys.
- Derive `userId` exclusively from the verified session. Service functions
  should accept it explicitly as their first ownership argument.
- Read, update, archive, and delete resources by both `userId` and resource ID.
  A request for another user's resource should behave as not found and must not
  disclose that the resource exists.
- Validate that every relationship stays within one owner. A goal cannot link
  to another user's account, a transaction or valuation cannot target another
  user's account, and a transfer cannot cross users.
- Scope unique constraints by user where appropriate, including category slugs,
  linked goal accounts, transaction idempotency, and exchange-rate pair/date.
- Include `userId` in database indexes and any server cache key used for private
  data. Do not use a process-global cache for user-specific settings or results.
- Seed default categories and default exchange rates separately for each new
  user so one user's edits never change another user's portfolio.

### Asset categories

Seed these categories:

- Securities
- Money Market Fund
- Fixed Income
- Savings
- Cash
- Land and Real Estate
- Vehicle
- Retirement
- Business
- Other Asset
- Liability

Each category should include:

- id
- userId
- name
- slug
- icon
- displayOrder
- assetOrLiability
- optional description
- createdAt
- updatedAt

Allow each user to create, rename, reorder, archive, and assign icons to their
own categories. Category slugs are unique only within one user.

### Accounts and assets

Treat bank accounts, investments, vehicles, and land as trackable holdings under one flexible model.

Fields:

- id
- userId
- name
- description
- categoryId
- institution
- accountReference or optional masked account number
- currency
- currentValueMinor
- costBasisMinor, optional
- isLiability
- isIncludedInNetWorth
- goalId, optional
- notes
- openedAt, optional
- archivedAt, optional
- createdAt
- updatedAt

Examples:

- Zimele Fixed Income Fund
- Madison Money Market Fund
- KCB Car Fund
- Interactive Brokers VWRA
- Southern Bypass Land
- Honda Fit
- 2028 Car Fund
- Cash Savings

### Transactions

Transactions should describe changes to an account or asset.

Supported transaction types:

- Opening Balance
- Deposit
- Withdrawal
- Interest
- Dividend
- Capital Gain
- Capital Loss
- Fee
- Purchase
- Sale
- Manual Adjustment
- Liability Payment
- Liability Increase
- Transfer

Fields:

- id
- userId
- accountId
- type
- amountMinor
- currency
- transactionDate
- description
- notes
- transferGroupId, optional
- createdAt
- updatedAt

A deposit should increase the account balance.

A withdrawal should reduce the balance.

Interest and dividends should increase the balance and be counted as returns.

Fees should reduce the balance and be counted as expenses.

Transfers should move value between accounts without changing total net worth.

Allow transactions to be edited or deleted, with balances recalculated correctly.

### Valuation snapshots

Some assets, such as land, vehicles, private investments, and manually tracked funds, may be valued periodically without a normal transaction.

Fields:

- id
- userId
- accountId
- valueMinor
- currency
- valuationDate
- notes
- createdAt

A valuation update should not automatically be treated as a cash contribution.

The app must distinguish:

- Contributions
- Withdrawals
- Investment income
- Market or valuation changes

### Exchange rates

Support multiple currencies, especially KES and USD.

Fields:

- id
- userId
- baseCurrency
- quoteCurrency
- rate
- effectiveDate
- source
- createdAt

Initially, exchange rates can be entered manually. Rates are user-owned; an
update must affect only the current user's calculations.

Provide a settings area where the user can update the current USD/KES exchange rate.

All dashboard totals should be converted into the configured base currency.

Keep the design ready for an optional exchange-rate API later, but do not require one.

### Goals

Fields:

- id
- userId
- name
- description
- targetAmountMinor
- currentAmountMinor, preferably calculated
- currency
- targetDate
- linkedAccountId, optional
- icon
- status
- priority
- createdAt
- updatedAt

Goal statuses:

- Active
- Paused
- Completed
- Cancelled

Example goal:

- Name: 2028 Family Car
- Target: KES 3,250,000
- Target date: July 1, 2028
- Linked account: KCB Car Fund
- Planned monthly contribution: KES 120,000

Goal contributions may either:

1. Be recorded directly against the goal, or
2. Be calculated from deposits into a linked account.

Prefer linked-account tracking so balances are not duplicated.

### Goal contribution plan

Fields:

- id
- userId
- goalId
- plannedContributionMinor
- frequency
- startDate
- endDate
- createdAt
- updatedAt

Supported frequency:

- Weekly
- Monthly
- Quarterly
- Annually
- Custom

## Dashboard

The dashboard is the heart of the app.

It should be visually rich but easy to understand. Do not overload it with dozens of small widgets.

The dashboard should answer:

- What is my current net worth?
- How has my net worth changed?
- Where is my wealth allocated?
- How much have I contributed?
- How much has come from returns?
- How are my goals progressing?
- Am I on track for my goals?
- Which accounts changed recently?

### Primary dashboard cards

Show:

- Total net worth
- Total assets
- Total liabilities
- Net-worth change over:
  - One month
  - Three months
  - One year
  - All time
- Total contributions
- Total investment gains and income
- Current liquid assets
- Current investment assets

Each amount should support hiding or revealing sensitive values with an eye icon.

### Net-worth chart

Use Recharts to create an attractive responsive area chart.

Features:

- Time ranges:
  - One month
  - Three months
  - Six months
  - One year
  - All time
- Tooltip showing:
  - Date
  - Net worth
  - Assets
  - Liabilities
- Smooth but not overly decorative
- Gracefully handle sparse historical data
- Show a useful empty state when there is insufficient history

The chart should use daily or monthly historical snapshots derived from transactions and valuations.

### Asset allocation chart

Use a donut or radial chart showing allocation by category.

Examples:

- Securities
- Fixed income
- Money market funds
- Savings
- Land
- Vehicles

Show:

- Category value
- Percentage of net worth
- Clickable legend
- Ability to exclude non-investment assets such as a personal vehicle

Provide a toggle between:

- Total net worth allocation
- Investible assets allocation

### Assets versus liabilities

Create a clean stacked bar or comparison visualization.

### Contributions versus growth

Create a chart separating:

- User contributions
- Interest and dividends
- Capital or valuation growth
- Withdrawals
- Fees

This is important because the user should be able to see whether wealth increased through saving or investment performance.

### Goal cards

Show active goals with:

- Goal name
- Current amount
- Target amount
- Percentage completed
- Target date
- Required monthly contribution
- Current planned monthly contribution
- Whether the goal is:
  - Ahead
  - On track
  - Behind
- Estimated completion date
- Progress bar
- Linked account

### Recent activity

Show recent:

- Deposits
- Interest credits
- Valuation updates
- Withdrawals
- Transfers
- Goal updates

## Accounts and assets page

Create a page listing all accounts and assets.

Allow views by:

- Category
- Institution
- Currency
- Active or archived
- Asset or liability

Each card or row should show:

- Name
- Institution
- Category
- Current value
- Currency
- Value converted to base currency
- Month-over-month change
- Goal association
- Last updated date

Provide both:

- Card view
- Compact table view

Allow sorting by:

- Value
- Name
- Category
- Recent change
- Last updated

## Account detail page

Each account should have a dedicated page with:

- Current value
- Total contributions
- Total withdrawals
- Total interest and dividends
- Total fees
- Estimated gain or loss
- Historical value chart
- Transaction list
- Valuation history
- Linked goals
- Notes

Actions:

- Add deposit
- Add withdrawal
- Add interest
- Add dividend
- Add fee
- Update valuation
- Transfer money
- Edit account
- Archive account

For manually valued assets such as land or vehicles, emphasize valuation history instead of investment-return metrics.

## Goals page

Create a dashboard-focused goals page.

Show:

- Total target amount across active goals
- Total amount saved
- Monthly planned contributions
- Goals on track
- Goals behind schedule
- Progress timeline

Each goal detail page should contain:

- Target
- Current progress
- Contributions over time
- Forecast completion date
- Required contribution to finish by target date
- Contribution history
- Linked account history
- Ability to pause or modify the goal

Include a projection chart using a conservative linear or configurable annual-return assumption.

For example:

- Current balance: KES 119,617
- Monthly contribution: KES 120,000
- Assumed annual return: 8%
- Target: KES 3,250,000
- Target date: July 2028

The projection should clearly state that it is an estimate.

## Reports and analytics

Create a reports page with:

### Net-worth history

- Monthly net worth
- Year-over-year change
- Highest recorded net worth
- Total change since tracking began

### Portfolio allocation

- By category
- By institution
- By currency
- Liquid versus illiquid
- Investible versus lifestyle assets

### Income and returns

- Interest by account
- Dividends
- Capital growth
- Fees
- Contributions

### Account comparison

Allow comparison of accounts such as:

- KCB MMF
- Zimele Fixed Income Fund
- Madison MMF

Show:

- Starting balance
- Ending balance
- Deposits
- Withdrawals
- Net income
- Simple annualized return
- Effective annualized return, when enough data exists

Do not show misleading annualized performance for very short measurement periods without a warning.

## Import, export, and deployment backup

User-facing portability must be scoped to the authenticated user.

Support:

- Export the current user's complete portfolio as JSON without credentials,
  session data, login attempts, or another user's records.
- Export the current user's transactions as CSV.
- Export the current user's financial accounts as CSV.
- Import transactions only into a financial account owned by the current user.
- Restore a validated per-user JSON export by replacing only the current user's
  portfolio in one transaction.

Before a per-user restore:

- Validate the archive version and every record.
- Reject foreign user IDs and remap imported record IDs to the current user.
- Warn that only the current user's portfolio will be replaced.
- Create a current-user export that can be downloaded before replacement.
- Roll back the entire operation on any failure.

A raw SQLite backup contains credentials and every user's financial data. Do
not expose full-database backup or restore through an ordinary authenticated
route or user settings. Deployment operators, who are outside the application
role model, perform consistent full-database backup and offline restore through
documented CLI or container operations. Document the persistent backup
directory and require the app to be stopped for a raw-file restore.

## User interface and styling

The visual style should feel like a modern financial dashboard, not a generic admin template.

Use a dark-first design.

Design direction:

- Deep charcoal or near-black background
- Slightly lighter cards and panels
- Restrained green accents for positive values
- Amber for warnings
- Red for losses and liabilities
- Muted blue or cyan accents for informational elements
- High-quality typography
- Generous spacing
- Subtle borders
- Soft shadows
- Minimal gradients
- Avoid neon cyberpunk styling
- Avoid excessive glassmorphism
- Avoid clutter
- Avoid excessive animations
- Use animations only for meaningful transitions

The design should resemble a premium wealth-management dashboard.

Use:

- Tabular numbers for financial values
- Clear positive and negative indicators
- Consistent currency formatting
- Skeleton states
- Empty states
- Helpful tooltips
- Responsive charts
- Accessible contrast
- Keyboard-accessible controls

Do not hardcode chart colours throughout the application. Define a reusable financial chart palette using CSS variables.

## Navigation

Desktop layout:

- Collapsible left sidebar
- Top header
- Main dashboard content

Navigation items:

- Dashboard
- Accounts
- Transactions
- Goals
- Reports
- Categories
- Settings

Mobile layout:

- Compact header
- Bottom navigation for:
  - Dashboard
  - Accounts
  - Add
  - Goals
  - More
- Floating or central quick-add action
- Full-screen mobile forms
- Charts that remain readable on narrow screens
- No horizontal page scrolling

## Quick-add flow

The user should be able to record common actions in a few taps.

Quick-add options:

- Add deposit
- Add withdrawal
- Add interest
- Update asset value
- Transfer between accounts
- Add a new account
- Create a goal

Remember recently used account and transaction type where appropriate.

## PWA requirements

Make the app installable as a Progressive Web App.

Include:

- Web app manifest
- Application name and short name
- Theme colour
- Background colour
- Icons in all required sizes
- Apple touch icon
- Standalone display mode
- Mobile viewport configuration
- Service worker
- Offline shell for the main interface
- Graceful offline message
- Cached static assets
- Install prompt where supported
- Update-available notification

Because SQLite is server-side, do not pretend full offline transaction creation is supported.

When offline:

- Show previously cached dashboard shell where possible
- Clearly indicate that fresh account data requires a server connection
- Disable financial mutations
- Do not queue transactions unless a safe synchronization system is implemented
- Do not cache authenticated financial responses in the service worker.
- Clear user-specific in-memory state and caches on logout so a subsequent user
  on the same device cannot see the previous user's data.

The PWA should launch cleanly from an Android or iOS home screen.

## Responsive requirements

The app must be genuinely mobile-friendly, not merely shrink the desktop dashboard.

Test layouts at:

- 360px
- 390px
- 768px
- 1024px
- 1440px

On mobile:

- Prioritize total net worth, goal progress, and quick actions
- Collapse less important dashboard widgets
- Use horizontal scrolling only inside specific chart containers where unavoidable
- Ensure touch targets are at least 44px
- Use mobile-friendly date and amount inputs

## Calculations

Implement and test these calculations:

- Total assets
- Total liabilities
- Net worth
- Base-currency conversions
- Category allocation percentage
- Account performance
- Total contributions
- Total withdrawals
- Total interest
- Total dividends
- Total fees
- Goal progress
- Required monthly contribution
- Forecast goal completion
- Monthly and yearly net-worth change
- Liquid versus illiquid assets
- Investible versus non-investible assets

Net worth:

Net worth = total assets minus total liabilities

Goal required monthly contribution:

Required monthly contribution =
remaining target amount divided by remaining contribution periods

For projections with investment returns, use a proper future-value calculation.

Clearly distinguish:

- Nominal contribution totals
- Current value
- Investment growth
- Forecast values

## Example seed data

Provide an optional demo-data seed script using realistic but clearly fictionalized values.

Example accounts:

1. Zimele Fixed Income Fund
   - Category: Fixed Income
   - Currency: KES
   - Current value: KES 4,576,918

2. Madison Money Market Fund
   - Category: Money Market Fund
   - Currency: KES
   - Current value: KES 1,396,000

3. KCB Car Fund
   - Category: Money Market Fund
   - Currency: KES
   - Current value: KES 119,617
   - Linked goal: 2028 Family Car

4. Interactive Brokers VWRA
   - Category: Securities
   - Currency: USD
   - Current value: USD 4,111

5. Southern Bypass Land
   - Category: Land and Real Estate
   - Currency: KES
   - Current value: KES 5,000,000

6. Honda Fit
   - Category: Vehicle
   - Currency: KES
   - Current value: KES 750,000

Example goal:

- Name: 2028 Family Car
- Target: KES 3,250,000
- Target date: July 1, 2028
- Planned monthly contribution: KES 120,000
- Linked account: KCB Car Fund
- Assumed annual return: 8%

Do not expose these exact values unless demo mode is explicitly enabled.
The seed command must require an explicit target username or user ID and must
never add demo data to every user.

## Settings

Create settings for:

- Display name
- Application name
- Base currency
- Supported currencies
- Current exchange rates
- Timezone
- Date format
- Dark theme
- Default dashboard period
- Password change
- Session timeout
- Personal data export and restore
- Category management
- Asset classification
- Default goal return assumption

The initial release can be dark-theme only, but structure the theme tokens so a light theme can be added later.

## Accessibility

Ensure:

- Proper semantic HTML
- Labelled inputs
- Keyboard navigation
- Visible focus states
- Sufficient colour contrast
- Charts include accessible text summaries
- Colour is not the only indication of profit, loss, or status
- Respect reduced-motion preferences

## Error handling

Implement:

- Friendly validation messages
- Toast notifications
- Error boundaries
- Confirmation dialogs for destructive actions
- Database error logging without exposing sensitive data
- Safe handling of duplicate submissions
- Idempotent transfer creation
- Loading and empty states

## Testing

Use:

- Vitest for unit tests
- React Testing Library for component tests
- Playwright for end-to-end tests

Test at minimum:

- Signup for the first and subsequent users
- Rejection of access to the private application before signup or login
- Confirmation that signup creates no financial accounts or demo data
- Login and logout
- Generic login failure without username enumeration
- Password change and per-user session invalidation
- Two simultaneous users with isolated categories, exchange rates, financial
  accounts, transactions, goals, analytics, and settings
- Direct URL and mutation attempts against another user's resource
- Rejection of cross-user transfers, goal links, imports, and idempotency keys
- Per-user exports and restores that contain no other user's data
- Creating an account
- Recording a deposit
- Recording interest
- Updating a valuation
- Creating a goal
- Linking a goal to an account
- Transfer between accounts
- Net-worth calculation
- Liability calculation
- Multi-currency conversion
- Goal projection
- Editing and deleting transactions
- Backup and restore
- Mobile navigation
- PWA manifest

Financial calculation logic should have comprehensive unit tests.

## Deployment

Provide:

- Dockerfile using a multi-stage build
- docker-compose.yml
- Persistent volume for SQLite
- Persistent volume for backups
- Health-check endpoint
- Environment variable example file
- Production startup instructions
- Kubernetes deployment example
- Kubernetes Service
- PersistentVolumeClaim example
- Ingress example
- SecurityContext using a non-root user

Required environment variables should include:

- DATABASE_PATH
- SESSION_SECRET
- APP_URL
- TZ
- BACKUP_PATH

Do not bake secrets into the image.

## Documentation

Create a detailed README with:

- Product overview
- Screenshots placeholder
- Local development
- Docker deployment
- Kubernetes deployment
- Signup and first-user onboarding
- Destructive singleton-to-multi-user upgrade behavior
- Password reset by username
- Per-user export and restore
- Deployment-wide backup and offline restore
- Database migrations
- Updating the application
- PWA installation
- CSV import format
- Security considerations

## Scope exclusions for the first release

Do not implement these in version one:

- Bank account integrations
- Brokerage API integrations
- Automatic trade execution
- Live stock-price APIs
- Tax reporting
- Household budgeting
- Expense categorization
- Recurring bills
- Organizations, households, and teams
- Roles and administrator UI
- Invitations and shared portfolios
- Cross-user financial accounts or transfers
- Email verification and email password recovery
- OAuth, SAML, and enterprise single sign-on
- Social features
- Public profiles
- AI financial advice
- Cryptocurrency wallets
- Complex double-entry accounting
- Full offline synchronization

Keep the first version focused on manually tracking net worth, account values, contributions, investment growth, and financial goals.

## Required migration approach

Evolve the existing application incrementally; do not re-scaffold or rewrite
unrelated features.

Follow this sequence:

1. Back up a representative existing database and establish passing baseline
   unit, component, end-to-end, and build checks.
2. Add `users` and separate credentials from `user_settings`.
3. Add nullable `userId` columns and ownership indexes to every user-owned
   table. Generate and review the Drizzle migration.
4. Delete singleton credentials and every user-owned row without a `userId`.
   Remove obsolete claim storage; do not expose any recovery or import path on
   signup.
5. Enforce non-null owner foreign keys and owner-scoped uniqueness after the
   unowned rows are removed.
6. Thread session-derived `userId` through services, analytics, server actions,
   pages, route handlers, cache keys, imports, and exports. Query resources by
   owner and ID in the database, not through a post-query UI check.
7. Implement the always-available signup flow with no legacy password or
   portfolio-claim option.
8. Add login by username, atomic per-user defaults, password reset by username,
   and per-user session invalidation.
9. Replace user-facing raw database backup and restore with per-user JSON
   portability. Move full SQLite backup and restore to operator-only commands
   and documentation.
10. Add two-user isolation fixtures and tests. Do not deploy the multi-user
    release until the complete signup and isolation suite passes.
11. Add a disposable singleton-schema migration test proving old credentials and
    unowned data are deleted before normal signup.
12. Review the complete migration for authorization, IDOR, cache isolation,
    financial accuracy, rollback behavior, responsive signup/login flows, and
    unnecessary complexity.

After each phase:

- Run linting
- Run type checking
- Run relevant tests
- Fix failures before continuing

## Acceptance criteria

The application is complete when:

- An empty deployment presents signup and cannot create an application user by
  environment variable, default credential, or any route other than signup.
- The first and subsequent users can sign up and log in concurrently. Signup is
  always available and has no enabled or disabled mode.
- Signup creates settings, categories, and rates but no financial accounts or
  sample portfolio data.
- Usernames are unique case-insensitively and login failures do not reveal
  whether a username exists.
- Each user can see and change only their own settings, categories, exchange
  rates, financial accounts, transactions, valuations, goals, reports, imports,
  exports, and idempotent operations.
- Guessing another user's URL or submitting another user's resource ID returns
  not found or a generic authorization failure without leaking data.
- Upgrading an old singleton database removes the old identity and portfolio;
  signup presents no recovery or claim option and creates a fresh empty user.
- I can add Zimele, Madison, KCB, VWRA, land, a car, savings, and liabilities.
- I can manually set or update each account’s value.
- I can record deposits, withdrawals, interest, fees, and transfers.
- I can see current net worth.
- I can see historical net-worth changes.
- I can see allocation by category and institution.
- I can distinguish contributions from investment growth.
- I can create a July 2028 car goal.
- I can link that goal to a car-fund account.
- I can see whether the goal is ahead, on track, or behind.
- I can use the application comfortably on a phone.
- I can install it as a PWA.
- Logging out and signing in as another user on the same device never reveals
  cached data from the previous user.
- My SQLite data persists across application upgrades.
- I can export and restore my own portfolio without receiving another user's
  records or credentials.
- A deployment operator can back up and restore the complete SQLite database
  outside ordinary user routes.
- The dashboard looks like a premium financial application.
- The interface remains simpler and easier to understand than Wealthfolio.
