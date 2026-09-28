package auth

import (
	"context"
	"testing"
	"time"
)

func TestLoginRateLimiter(t *testing.T) {
	ctx := context.Background()
	db := openAuthTestDatabase(t)

	limiter, err := NewLoginRateLimiter(db, compatibilitySecret)
	if err != nil {
		t.Fatalf("create limiter: %v", err)
	}
	limiter.now = func() time.Time { return time.Unix(2_000_000_000, 0) }

	var decision LoginRateLimit
	for attempt := 0; attempt < maxLoginFailures; attempt++ {
		decision, err = limiter.Take(ctx, " Alice ", "127.0.0.1")
		if err != nil {
			t.Fatalf("take attempt %d: %v", attempt+1, err)
		}
		if !decision.Allowed {
			t.Fatalf("attempt %d was blocked early", attempt+1)
		}
	}
	decision, err = limiter.Take(ctx, "alice", "127.0.0.1")
	if err != nil {
		t.Fatalf("take blocked attempt: %v", err)
	}
	if decision.Allowed || decision.RetryAfter != loginRateLimitWindow {
		t.Fatalf("blocked decision = %+v", decision)
	}

	if err := limiter.RecordSuccess(ctx, decision); err != nil {
		t.Fatalf("record success: %v", err)
	}
	decision, err = limiter.Take(ctx, "alice", "127.0.0.1")
	if err != nil {
		t.Fatalf("take after success: %v", err)
	}
	if !decision.Allowed {
		t.Fatal("successful login did not reset throttling buckets")
	}

	for attempt := 0; attempt < maxLoginFailures; attempt++ {
		decision, err = limiter.TakeSignup(ctx, "127.0.0.2")
		if err != nil || !decision.Allowed {
			t.Fatalf("signup attempt %d = %+v, error %v", attempt+1, decision, err)
		}
	}
	decision, err = limiter.TakeSignup(ctx, "127.0.0.2")
	if err != nil || decision.Allowed {
		t.Fatalf("blocked signup decision = %+v, error %v", decision, err)
	}

	for attempt := 0; attempt < oidcStartLimit; attempt++ {
		decision, err = limiter.TakeOIDC(ctx, "start", "127.0.0.3")
		if err != nil || !decision.Allowed {
			t.Fatalf("OIDC start attempt %d = %+v, error %v", attempt+1, decision, err)
		}
	}
	decision, err = limiter.TakeOIDC(ctx, "start", "127.0.0.3")
	if err != nil || decision.Allowed {
		t.Fatalf("blocked OIDC start = %+v, error %v", decision, err)
	}
}
