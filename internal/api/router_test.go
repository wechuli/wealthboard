package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLivenessDoesNotDependOnDatabase(t *testing.T) {
	router := testRouter(func(context.Context) error { return errors.New("database unavailable") })
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/health/live", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", response.Header().Get("Cache-Control"))
	}
	if !strings.Contains(response.Body.String(), `"status":"ok"`) {
		t.Fatalf("body = %q, want ok status", response.Body.String())
	}
}

func TestReadinessChecksDatabase(t *testing.T) {
	tests := []struct {
		name       string
		check      readinessCheck
		wantStatus int
		wantBody   string
	}{
		{
			name:       "available",
			check:      func(context.Context) error { return nil },
			wantStatus: http.StatusOK,
			wantBody:   `"status":"ready"`,
		},
		{
			name:       "unavailable",
			check:      func(context.Context) error { return errors.New("database unavailable") },
			wantStatus: http.StatusServiceUnavailable,
			wantBody:   `"status":"unavailable"`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			testRouter(test.check).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/health/ready", nil))
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if !strings.Contains(response.Body.String(), test.wantBody) {
				t.Fatalf("body = %q, want %q", response.Body.String(), test.wantBody)
			}
		})
	}
}

func TestLegacyHealthEndpointUsesReadiness(t *testing.T) {
	response := httptest.NewRecorder()
	testRouter(func(context.Context) error { return nil }).ServeHTTP(
		response,
		httptest.NewRequest(http.MethodGet, "/api/health", nil),
	)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if !strings.Contains(response.Body.String(), `"status":"ready"`) {
		t.Fatalf("body = %q, want ready status", response.Body.String())
	}
}

func TestUnknownAPIEndpointUsesProblemJSON(t *testing.T) {
	response := httptest.NewRecorder()
	testRouter(func(context.Context) error { return nil }).ServeHTTP(
		response,
		httptest.NewRequest(http.MethodGet, "/api/v1/missing", nil),
	)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", contentType)
	}
}

func TestStaticFallbackDoesNotCaptureAPI(t *testing.T) {
	static := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte("spa"))
	})
	router := NewRouterWithReads(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		func(context.Context) error { return nil },
		nil,
		nil,
		ReadHandlers{Static: static},
	)

	apiResponse := httptest.NewRecorder()
	router.ServeHTTP(apiResponse, httptest.NewRequest(http.MethodGet, "/api/v1/missing", nil))
	if apiResponse.Code != http.StatusNotFound || apiResponse.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("API fallback = %d %q", apiResponse.Code, apiResponse.Header().Get("Content-Type"))
	}

	spaResponse := httptest.NewRecorder()
	router.ServeHTTP(spaResponse, httptest.NewRequest(http.MethodGet, "/accounts/example", nil))
	if spaResponse.Code != http.StatusOK || spaResponse.Body.String() != "spa" {
		t.Fatalf("SPA fallback = %d %q", spaResponse.Code, spaResponse.Body.String())
	}
}

func testRouter(check readinessCheck) http.Handler {
	return NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), check)
}
