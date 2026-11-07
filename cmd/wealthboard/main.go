package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/wechuli/wealthboard/internal/api"
	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/config"
	"github.com/wechuli/wealthboard/internal/database"
	"github.com/wechuli/wealthboard/internal/database/generated"
	"github.com/wechuli/wealthboard/internal/mcpserver"
	"github.com/wechuli/wealthboard/internal/oauth"
	"github.com/wechuli/wealthboard/internal/service"
	staticfiles "github.com/wechuli/wealthboard/internal/static"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("wealthboard stopped", "error", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return usageError()
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	switch args[0] {
	case "backup":
		return runBackupCommand(ctx, args[1:], os.Stdout, os.Stderr)
	case "restore":
		return runRestoreCommand(ctx, args[1:], os.Stdout, os.Stderr)
	case "seed-demo":
		return runSeedDemoCommand(ctx, args[1:], os.Stdout, os.Stderr)
	}
	if args[0] == "healthcheck" {
		if len(args) != 1 {
			return usageError()
		}
		return healthcheck()
	}
	if args[0] != "reset-password" && len(args) != 1 {
		return usageError()
	}
	if args[0] == "reset-password" && (len(args) != 3 || args[1] != "--username") {
		return usageError()
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	db, err := database.Open(ctx, cfg.Database)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	switch args[0] {
	case "serve":
		if err := database.MigrateUp(ctx, db); err != nil {
			return err
		}
		return serve(ctx, logger, cfg, db)
	case "migrate":
		return database.MigrateUp(ctx, db)
	case "migrate-status":
		return database.MigrateStatus(ctx, db)
	case "reset-password":
		policy, err := webauth.ParsePolicy(os.Getenv("AUTH_METHODS"))
		if err != nil {
			return err
		}
		if !policy.LocalEnabled {
			return errors.New("password reset is unavailable because local authentication is disabled")
		}
		return webauth.ResetPassword(ctx, generated.New(db), args[2], os.Getenv("NEW_USER_PASSWORD"), time.Now())
	default:
		return usageError()
	}
}

func serve(ctx context.Context, logger *slog.Logger, cfg config.Config, db *sql.DB) error {
	policy, err := webauth.ParsePolicy(os.Getenv("AUTH_METHODS"))
	if err != nil {
		return err
	}
	oidcConfig, err := webauth.ParseOIDCConfig(policy, os.Getenv)
	if err != nil {
		return err
	}
	secureCookies := os.Getenv("NODE_ENV") == "production"
	sessions, err := webauth.NewSessionManager(
		os.Getenv("SESSION_SECRET"),
		secureCookies,
	)
	if err != nil {
		return err
	}
	trustedOrigin, err := webauth.TrustedOrigin(os.Getenv("APP_URL"))
	if err != nil {
		return err
	}
	limiter, err := webauth.NewLoginRateLimiter(db, os.Getenv("SESSION_SECRET"))
	if err != nil {
		return err
	}
	authService := webauth.NewService(generated.New(db), sessions)
	registration := webauth.NewRegistrationService(db, os.Getenv("TZ"))
	authHandler := api.NewAuthHandler(authService, registration, limiter, sessions, policy, trustedOrigin)
	apiKeys := webauth.NewAPIKeyService(generated.New(db))
	authHandler.EnableAPIKeys(apiKeys)
	overviewHandler := api.NewOverviewHandler(authHandler, service.NewOverviewService(generated.New(db)))
	coreReadService := service.NewCoreReadService(service.NewSQLCoreReadRepository(db))
	goalsReportsService := service.NewGoalsReportsService(service.NewSQLGoalsReportsRepository(db))
	insightsService := service.NewInsightsService(service.NewSQLGoalsReportsRepository(db))
	coreReads := api.NewCoreReadHandler(authHandler, coreReadService)
	goalsReports := api.NewGoalsReportsHandler(authHandler, goalsReportsService)
	insights := api.NewInsightsHandler(authHandler, insightsService)
	ledgerService := service.NewLedgerService(db)
	var mcpHandler, oauthHandler http.Handler
	var connectedApps *api.ConnectedAppsHandler
	if cfg.MCP.Enabled {
		oauthService := oauth.NewService(db, oauth.Config{Issuer: trustedOrigin, Logger: logger})
		oauthHandler = oauth.NewHandler(oauthService, oauth.HandlerOptions{})
		connectedApps = api.NewConnectedAppsHandler(authHandler, oauthService)
		manage := &mcpserver.Management{
			Ledger: ledgerService, Catalog: coreReadService, Statements: service.NewStatementImportService(db),
			Imports: service.NewImportBatchService(db), Investments: service.NewInvestmentMutations(db), Features: service.NewFeatureReads(db),
			Rates: service.NewMetadataMutations(db), Goals: service.NewGoalMutationService(service.NewSQLGoalMutationRepository(db)),
			Simulator: goalsReportsService, Performance: insightsService, Audit: service.NewAuditLog(db),
		}
		mcpHandler = mcpserver.NewHandler(mcpserver.Readers{Core: coreReadService, Reports: goalsReportsService, Insights: insightsService, Ledger: ledgerService, Manage: manage}, apiKeys, mcpserver.Options{
			RequestsPerMinute: cfg.MCP.RequestsPerMinute, Logger: logger, OAuth: oauthService,
		})
	}
	featureReads := api.NewFeatureReadHandler(authHandler, service.NewFeatureReads(db))
	mutations := api.MutationHandlers{
		Metadata:    api.NewMetadataMutationHandler(authHandler, service.NewMetadataMutations(db)),
		Ledger:      api.NewLedgerHandler(authHandler, ledgerService, trustedOrigin),
		Goals:       api.NewGoalMutationHandler(authHandler, service.NewGoalMutationService(service.NewSQLGoalMutationRepository(db))),
		Investment:  api.NewInvestmentMutationHandler(authHandler, service.NewInvestmentMutations(db), trustedOrigin),
		Conversion:  api.NewAccountConversionHandler(authHandler, service.NewAccountConversionService(db)),
		Corporate:   api.NewCorporateActionHandler(authHandler, service.NewCorporateActions(db), trustedOrigin),
		Imports:     api.NewImportHandler(authHandler, service.NewAccountHistoryImportService(db), service.NewInvestmentHistoryImportService(db), trustedOrigin),
		Portability: api.NewPortabilityHandler(authHandler, service.NewPortabilityService(db)),
		Estate:      api.NewEstateMutationHandler(authHandler, service.NewEstateMutations(db)),
	}
	distPath := os.Getenv("WEB_DIST_PATH")
	if distPath == "" {
		distPath = "web/dist"
	}
	spa, err := staticfiles.NewSPA(distPath)
	if err != nil {
		return err
	}
	var oidcClient *webauth.OIDCClient
	if oidcConfig != nil {
		oidcClient = webauth.NewOIDCClient(*oidcConfig, secureCookies)
		authHandler.EnableOIDC(oidcClient, webauth.NewOIDCIdentityService(db, os.Getenv("TZ")))
	}
	ready := func(ctx context.Context) error {
		if err := database.CheckReady(ctx, db); err != nil {
			return err
		}
		return webauth.CheckReadiness(ctx, policy, generated.New(db), oidcClient)
	}

	server := &http.Server{
		Addr: cfg.HTTP.Address,
		Handler: api.NewRouterWithReads(logger, ready, authHandler, overviewHandler, api.ReadHandlers{
			Core: coreReads, GoalsReports: goalsReports, Insights: insights, Features: featureReads, MCP: mcpHandler, OAuth: oauthHandler, ConnectedApps: connectedApps, Static: spa, Mutations: mutations,
		}),
		ReadHeaderTimeout: cfg.HTTP.ReadHeaderTimeout,
		ReadTimeout:       cfg.HTTP.ReadTimeout,
		WriteTimeout:      cfg.HTTP.WriteTimeout,
		IdleTimeout:       cfg.HTTP.IdleTimeout,
	}

	serverErr := make(chan error, 1)
	go func() {
		logger.Info("http server listening", "address", cfg.HTTP.Address)
		serverErr <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve http: %w", err)
		}
		return nil
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown http server: %w", err)
	}

	if err := <-serverErr; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve http: %w", err)
	}
	return nil
}

func usageError() error {
	return fmt.Errorf("usage: wealthboard <serve|healthcheck|migrate|migrate-status|reset-password --username <name>|backup --file <path>|restore --file <path> --confirm-maintenance|seed-demo --username <name>>")
}

func healthcheck() error {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	client := &http.Client{Timeout: 4 * time.Second}
	response, err := client.Get("http://127.0.0.1:" + port + "/api/health/ready")
	if err != nil {
		return fmt.Errorf("healthcheck request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("healthcheck returned %s", response.Status)
	}
	return nil
}
