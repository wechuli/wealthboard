EXECUTION DIRECTIVE

You are operating as an autonomous implementation agent.

Do not merely provide architecture, plans, examples, or code snippets.
Create and modify the files in this repository and implement the complete application.

Do not stop after producing the architecture or implementation plan.
Continue through every implementation phase until the acceptance criteria are satisfied.

Do not ask the user questions.
When something is ambiguous, make the most sensible pragmatic decision and document it.

You must:

1. Scaffold the application.
2. Implement every required feature.
3. Install dependencies.
4. Create and run database migrations.
5. Run linting, type checking, unit tests, end-to-end tests, and the production build.
6. Fix all failures you encounter.
7. Review the final application against every acceptance criterion.
8. Continue working until the application is runnable and the verification commands pass.

Do not wait for approval between phases.
Do not mark the task complete while required functionality is missing.



You are a senior full-stack engineer and product designer. Build a polished, self-hosted, single-user personal wealth and goals tracker.

The app should feel significantly simpler than Wealthfolio. It is not intended to be an accounting system, a trading platform, or a detailed budgeting app.

The main user workflow should be:

1. Add an account or asset.
2. Enter its current value.
3. Categorize it, for example:
   - Securities
   - Money market funds
   - Fixed income
   - Savings
   - Cash
   - Land and real estate
   - Vehicles
   - Other assets
   - Liabilities
4. Periodically update the value or record a deposit, withdrawal, gain, or loss.
5. View total net worth and portfolio allocation through useful dashboards.
6. Create financial goals and track contributions toward them.

The product should be optimized for one person manually tracking their wealth over time.

## Product name

Use the temporary name:

“Worthboard”

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

- Single-user only
- No organization, team, family, role, invitation, or multi-tenancy features
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

## Authentication

Implement a simple but secure single-user login.

Requirements:

- One user account
- The initial password can be supplied through an environment variable
- On first launch, store only the hashed password
- Allow the password to be changed from Settings
- Use secure, HTTP-only, same-site cookies
- Sessions should expire after a configurable period
- Include logout functionality
- Protect every application route except the login page and PWA assets
- Add basic login rate limiting
- Do not implement password reset through email
- Provide a documented CLI or environment-based password-reset method
- Never log passwords or sensitive form values

## Core data model

Design a clean SQLite schema using Drizzle.

### User settings

Fields should include:

- id
- displayName
- passwordHash
- baseCurrency
- timezone
- preferredDateFormat
- appName
- createdAt
- updatedAt

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
- name
- slug
- icon
- displayOrder
- assetOrLiability
- optional description
- createdAt
- updatedAt

Allow the user to create, rename, reorder, archive, and assign icons to custom categories.

### Accounts and assets

Treat bank accounts, investments, vehicles, and land as trackable holdings under one flexible model.

Fields:

- id
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
- baseCurrency
- quoteCurrency
- rate
- effectiveDate
- source
- createdAt

Initially, exchange rates can be entered manually.

Provide a settings area where the user can update the current USD/KES exchange rate.

All dashboard totals should be converted into the configured base currency.

Keep the design ready for an optional exchange-rate API later, but do not require one.

### Goals

Fields:

- id
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

## Import and export

Support:

- Export all data as JSON
- Export transactions as CSV
- Export accounts as CSV
- Import transactions from CSV
- Full SQLite database backup
- Full database restore

Before restoring a database:

- Validate the file
- Warn the user that current data will be replaced
- Automatically create a pre-restore backup

Provide a documented backup directory for Docker deployments.

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
- Backup and restore
- Data export
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

- Login and logout
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
- INITIAL_ADMIN_PASSWORD
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
- First login
- Password reset
- Backup and restore
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
- Multi-user support
- Social features
- Public profiles
- AI financial advice
- Cryptocurrency wallets
- Complex double-entry accounting
- Full offline synchronization

Keep the first version focused on manually tracking net worth, account values, contributions, investment growth, and financial goals.

## Required implementation approach

Do not attempt to generate the entire application as one unstructured code dump.

Follow this sequence:

1. Produce a concise architecture proposal.
2. Produce the database schema.
3. Produce the route and component structure.
4. Produce the implementation plan in phases.
5. Scaffold the application.
6. Implement authentication.
7. Implement accounts and categories.
8. Implement transactions and valuations.
9. Implement dashboard calculations.
10. Implement goals.
11. Implement reports.
12. Implement import, export, and backups.
13. Implement PWA support.
14. Add tests.
15. Add Docker and Kubernetes deployment files.
16. Review the complete implementation for security, financial accuracy, responsive behavior, and unnecessary complexity.

After each phase:

- Run linting
- Run type checking
- Run relevant tests
- Fix failures before continuing

## Acceptance criteria

The application is complete when:

- I can log in securely as the single user.
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
- My SQLite data persists across application upgrades.
- I can back up and restore all data.
- The dashboard looks like a premium financial application.
- The interface remains simpler and easier to understand than Wealthfolio.