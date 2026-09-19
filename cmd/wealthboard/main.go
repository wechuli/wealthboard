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
	"github.com/wechuli/wealthboard/internal/service"
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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := database.Open(ctx, cfg.Database)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	switch args[0] {
	case "serve":
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
	authHandler.EnableAPIKeys(webauth.NewAPIKeyService(generated.New(db)))
	overviewHandler := api.NewOverviewHandler(authHandler, service.NewOverviewService(generated.New(db)))
	coreReads := api.NewCoreReadHandler(authHandler, service.NewCoreReadService(service.NewSQLCoreReadRepository(db)))
	goalsReports := api.NewGoalsReportsHandler(authHandler, service.NewGoalsReportsService(service.NewSQLGoalsReportsRepository(db)))
	featureReads := api.NewFeatureReadHandler(authHandler, service.NewFeatureReads(db))
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
			Core: coreReads, GoalsReports: goalsReports, Features: featureReads,
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
	return fmt.Errorf("usage: wealthboard <serve|migrate|migrate-status|reset-password --username <name>>")
}
