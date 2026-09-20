package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"

	requestmiddleware "github.com/wechuli/wealthboard/internal/api/middleware"
)

type readinessCheck func(context.Context) error

type ReadHandlers struct {
	Core         *CoreReadHandler
	GoalsReports *GoalsReportsHandler
	Features     *FeatureReadHandler
	Static       http.Handler
	Mutations    MutationHandlers
}

type MutationHandlers struct {
	Metadata   *MetadataMutationHandler
	Ledger     *LedgerHandler
	Goals      *GoalMutationHandler
	Investment *InvestmentMutationHandler
	Conversion *AccountConversionHandler
}

func NewRouter(logger *slog.Logger, ready readinessCheck) http.Handler {
	return NewRouterWithAuth(logger, ready, nil)
}

func NewRouterWithAuth(logger *slog.Logger, ready readinessCheck, auth *AuthHandler) http.Handler {
	return NewRouterWithServices(logger, ready, auth, nil)
}

func NewRouterWithServices(logger *slog.Logger, ready readinessCheck, auth *AuthHandler, overview *OverviewHandler) http.Handler {
	return NewRouterWithReads(logger, ready, auth, overview, ReadHandlers{})
}

func NewRouterWithReads(logger *slog.Logger, ready readinessCheck, auth *AuthHandler, overview *OverviewHandler, reads ReadHandlers) http.Handler {
	router := chi.NewRouter()
	router.Use(chimiddleware.RequestID)
	router.Use(chimiddleware.Recoverer)
	router.Use(requestmiddleware.Logger(logger))

	legacyReadiness := readinessHandler(ready)
	router.Get("/api/health", legacyReadiness)
	router.Route("/api/health", func(router chi.Router) {
		router.Get("/live", healthHandler(http.StatusOK, "ok"))
		router.Get("/ready", readinessHandler(ready))
		router.Get("/", legacyReadiness)
	})

	router.Route("/api", func(router chi.Router) {
		if auth != nil {
			router.Route("/v1", func(router chi.Router) {
				if overview != nil {
					router.Get("/overview", overview.ServeHTTP)
				}
				if reads.Core != nil {
					router.Get("/categories", reads.Core.Categories)
					router.Get("/institutions", reads.Core.Institutions)
					router.Get("/accounts", reads.Core.Accounts)
					router.Get("/accounts/{accountID}", reads.Core.Account)
					router.Get("/accounts/{accountID}/transactions", reads.Core.AccountTransactions)
					router.Get("/accounts/{accountID}/valuations", reads.Core.AccountValuations)
					router.Get("/accounts/{accountID}/activity", reads.Core.AccountActivity)
					router.Get("/transactions", reads.Core.Transactions)
				}
				if reads.GoalsReports != nil {
					RegisterGoalsReportsRoutes(router, reads.GoalsReports)
				}
				if reads.Features != nil {
					RegisterFeatureReadRoutes(router, reads.Features)
				}
				if reads.Mutations.Metadata != nil {
					RegisterMetadataMutationRoutes(router, reads.Mutations.Metadata)
				}
				if reads.Mutations.Ledger != nil {
					RegisterLedgerRoutes(router, reads.Mutations.Ledger)
				}
				if reads.Mutations.Goals != nil {
					RegisterGoalMutationRoutes(router, reads.Mutations.Goals)
				}
				if reads.Mutations.Investment != nil {
					RegisterInvestmentMutationRoutes(router, reads.Mutations.Investment)
				}
				if reads.Mutations.Conversion != nil {
					RegisterAccountConversionRoutes(router, reads.Mutations.Conversion)
				}
				if auth.apiKeys != nil {
					router.Get("/api-keys", auth.ListAPIKeys)
					router.Post("/api-keys", auth.CreateAPIKey)
					router.Delete("/api-keys/{id}", auth.RevokeAPIKey)
					router.Post("/api-keys/revoke-all", auth.RevokeAllAPIKeys)
				}
				router.Post("/auth/change-password", auth.ChangePassword)
				router.Get("/auth/config", auth.Config)
				router.Get("/auth/oidc/start", auth.OIDCStart)
				router.Get("/auth/oidc/callback", auth.OIDCCallback)
				router.Post("/auth/oidc/link", auth.OIDCLinkStart)
				router.Post("/auth/oidc/reauth", auth.OIDCReauthStart)
				router.Delete("/auth/oidc/link", auth.OIDCUnlink)
				router.Post("/auth/local-credential", auth.EnableLocalCredential)
				router.Delete("/auth/local-credential", auth.RemoveLocalCredential)
				router.Post("/auth/login", auth.Login)
				router.Post("/auth/logout", auth.Logout)
				router.Get("/auth/principal", auth.Principal)
				router.Post("/auth/signup", auth.Signup)
				router.Get("/session", auth.Session)
			})
		}
		router.NotFound(problemNotFound)
	})
	if reads.Static != nil {
		router.Mount("/", reads.Static)
	}

	return router
}

func readinessHandler(ready readinessCheck) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		defer cancel()
		if err := ready(ctx); err != nil {
			healthHandler(http.StatusServiceUnavailable, "unavailable")(response, request)
			return
		}
		healthHandler(http.StatusOK, "ready")(response, request)
	}
}

func healthHandler(statusCode int, status string) http.HandlerFunc {
	return func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(statusCode)
		_ = json.NewEncoder(response).Encode(map[string]string{
			"status":  status,
			"service": "wealthboard",
		})
	}
}

func problemNotFound(response http.ResponseWriter, request *http.Request) {
	writeProblem(response, http.StatusNotFound, "Not Found", "The requested API endpoint does not exist.")
}

func writeProblem(response http.ResponseWriter, status int, title, detail string) {
	response.Header().Set("Content-Type", "application/problem+json")
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(map[string]any{
		"type":   "about:blank",
		"title":  title,
		"status": status,
		"detail": detail,
	})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
