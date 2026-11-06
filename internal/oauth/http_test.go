package oauth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRateLimitsAreKeyedByClientWithAnAddressBackstop(t *testing.T) {
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)
	handler := NewHandler(NewService(nil, Config{Issuer: "https://wealth.example"}), HandlerOptions{
		Now: func() time.Time { return now }, ClientRequestsPerMinute: 2, AddressRequestsPerMinute: 7,
	})
	attempt := func(clientID string) int {
		request := httptest.NewRequest(http.MethodPost, "/oauth/token", nil)
		request.RemoteAddr = "10.0.0.1:5000"
		response := httptest.NewRecorder()
		if handler.limited(response, request, clientID, false) {
			return response.Code
		}
		return http.StatusOK
	}
	// Behind a proxy every request has the same peer address; one busy client must not block another.
	for range 2 {
		if attempt("wbc_attacker") != http.StatusOK {
			t.Fatal("first requests were limited")
		}
	}
	if attempt("wbc_attacker") != http.StatusTooManyRequests {
		t.Fatal("client limit not applied")
	}
	if attempt("wbc_claude") != http.StatusOK {
		t.Fatal("another client was blocked by the first")
	}
	// Made-up client IDs share one bucket instead of each getting a fresh one.
	if attempt("random-1") != http.StatusOK || attempt("random-2") != http.StatusOK || attempt("random-3") != http.StatusTooManyRequests {
		t.Fatal("unknown client IDs bypassed the client limit")
	}
	// The address backstop (7) caps everything from one address.
	if attempt("wbc_third") != http.StatusTooManyRequests {
		t.Fatal("address backstop not applied")
	}
	now = now.Add(time.Minute)
	if attempt("wbc_attacker") != http.StatusOK {
		t.Fatal("limits did not reset")
	}
}

func TestAuthorizeRateLimitShowsAPageInsteadOfRedirecting(t *testing.T) {
	handler := NewHandler(NewService(nil, Config{Issuer: "https://wealth.example"}), HandlerOptions{ClientRequestsPerMinute: 1})
	request := httptest.NewRequest(http.MethodGet, "/oauth/authorize?client_id=wbc_x", nil)
	handler.clients.Allow("client:wbc_x")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Location") != "" || response.Header().Get("Retry-After") == "" {
		t.Fatalf("limited authorize = %d %v", response.Code, response.Header())
	}
}
