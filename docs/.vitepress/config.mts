import { defineConfig } from "vitepress";

const repository = "https://github.com/wechuliprojects/wealthboard";

export default defineConfig({
  title: "Wealthboard Guide",
  description:
    "Learn how to track wealth, record activity, plan goals, and prepare an estate summary with Wealthboard.",
  lang: "en",
  base: process.env.DOCS_BASE ?? "/wealthboard/",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: "https://wechuliprojects.github.io/wealthboard/" },
  head: [
    ["meta", { name: "theme-color", content: "#0d5f4b" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Wealthboard Guide" }],
  ],
  themeConfig: {
    siteTitle: "Wealthboard Guide",
    logo: "/images/wealthboard-mark.svg",
    search: { provider: "local" },
    nav: [
      { text: "Get started", link: "/getting-started/" },
      { text: "Guides", link: "/guides/accounts" },
      { text: "Estate planning", link: "/guides/estate-planning" },
      { text: "Operate", link: "/admin/deployment" },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Welcome", link: "/" },
          { text: "Get started", link: "/getting-started/" },
          {
            text: "Build your first portfolio",
            link: "/getting-started/first-portfolio",
          },
          { text: "Understand the numbers", link: "/getting-started/concepts" },
        ],
      },
      {
        text: "Use Wealthboard",
        items: [
          { text: "Accounts and assets", link: "/guides/accounts" },
          {
            text: "Position-tracked investments",
            link: "/guides/investments",
          },
          { text: "Transactions and values", link: "/guides/activity" },
          { text: "Goals", link: "/guides/goals" },
          { text: "Reports and privacy", link: "/guides/reports" },
          { text: "Estate planning", link: "/guides/estate-planning" },
          {
            text: "Import, export, and restore",
            link: "/guides/data-portability",
          },
        ],
      },
      {
        text: "Run your server",
        items: [
          { text: "Deployment", link: "/admin/deployment" },
          { text: "Authentication", link: "/admin/authentication" },
          { text: "Backup and recovery", link: "/admin/backup-recovery" },
          { text: "Troubleshooting", link: "/admin/troubleshooting" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Financial behavior", link: "/reference/financial-behavior" },
          {
            text: "Investment History v1",
            link: "/reference/investment-import",
          },
          { text: "Security and privacy", link: "/reference/security" },
          { text: "Architecture", link: "/ARCHITECTURE" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repository }],
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: "Improve this page",
    },
    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous", next: "Next" },
    footer: {
      message: "Private wealth tracking, on infrastructure you control.",
      copyright: "Wealthboard documentation",
    },
  },
});
