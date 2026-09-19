package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

const (
	loginRateLimitWindow  = 15 * time.Minute
	loginAttemptRetention = 24 * time.Hour
	maxLoginFailures      = 5
	oidcStartLimit        = 20
	oidcCallbackLimit     = 40
)

type LoginRateLimit struct {
	Keys       []string
	Allowed    bool
	RetryAfter time.Duration
}

type LoginRateLimiter struct {
	db     *sql.DB
	secret string
	now    func() time.Time
}

func NewLoginRateLimiter(db *sql.DB, secret string) (*LoginRateLimiter, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("SESSION_SECRET must contain at least 32 characters")
	}
	return &LoginRateLimiter{db: db, secret: secret, now: time.Now}, nil
}

func (limiter *LoginRateLimiter) Take(
	ctx context.Context,
	username string,
	clientAddress string,
) (LoginRateLimit, error) {
	return limiter.take(ctx, []string{
		"login-user:" + NormalizeUsername(username) + ":" + clientAddress,
		"login-client:" + clientAddress,
	}, maxLoginFailures, false, false)
}

func (limiter *LoginRateLimiter) TakeSignup(
	ctx context.Context,
	clientAddress string,
) (LoginRateLimit, error) {
	return limiter.take(ctx, []string{"signup-client:" + clientAddress}, maxLoginFailures, false, false)
}

func (limiter *LoginRateLimiter) TakeOIDC(
	ctx context.Context,
	kind string,
	clientAddress string,
) (LoginRateLimit, error) {
	maximum := int64(oidcStartLimit)
	if kind == "callback" {
		maximum = oidcCallbackLimit
	} else if kind != "start" {
		return LoginRateLimit{}, errors.New("invalid OIDC rate-limit kind")
	}
	return limiter.take(ctx, []string{"oidc-" + kind + ":" + clientAddress}, maximum, true, true)
}

func (limiter *LoginRateLimiter) take(
	ctx context.Context,
	rawKeys []string,
	maximum int64,
	countAll bool,
	succeeded bool,
) (LoginRateLimit, error) {
	keys := make([]string, 0, len(rawKeys))
	for _, key := range rawKeys {
		keys = append(keys, limiter.hashKey(key))
	}
	sort.Strings(keys)

	tx, err := limiter.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return LoginRateLimit{}, fmt.Errorf("begin login rate-limit transaction: %w", err)
	}
	defer tx.Rollback()
	queries := generated.New(tx)

	for _, key := range keys {
		if err := queries.AcquireLoginRateLimitLock(ctx, key); err != nil {
			return LoginRateLimit{}, fmt.Errorf("lock login rate limit: %w", err)
		}
	}

	now := limiter.now().UTC()
	if err := queries.DeleteExpiredLoginAttempts(ctx, now.Add(-loginAttemptRetention)); err != nil {
		return LoginRateLimit{}, fmt.Errorf("clean login attempts: %w", err)
	}

	allowed := true
	for _, key := range keys {
		var count int64
		var err error
		if countAll {
			count, err = queries.CountRecentLoginAttempts(ctx, generated.CountRecentLoginAttemptsParams{
				ClientKey: key, AttemptedAt: now.Add(-loginRateLimitWindow),
			})
		} else {
			count, err = queries.CountRecentFailedLoginAttempts(ctx, generated.CountRecentFailedLoginAttemptsParams{
				ClientKey: key, AttemptedAt: now.Add(-loginRateLimitWindow),
			})
		}
		if err != nil {
			return LoginRateLimit{}, fmt.Errorf("count login attempts: %w", err)
		}
		if count >= maximum {
			allowed = false
		}
	}

	if allowed {
		for _, key := range keys {
			if err := queries.CreateLoginAttempt(ctx, generated.CreateLoginAttemptParams{
				ID:          uuid.New(),
				ClientKey:   key,
				Succeeded:   succeeded,
				AttemptedAt: now,
			}); err != nil {
				return LoginRateLimit{}, fmt.Errorf("record login attempt: %w", err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return LoginRateLimit{}, fmt.Errorf("commit login rate limit: %w", err)
	}
	return LoginRateLimit{Keys: keys, Allowed: allowed, RetryAfter: loginRateLimitWindow}, nil
}

func (limiter *LoginRateLimiter) RecordSuccess(ctx context.Context, limit LoginRateLimit) error {
	tx, err := limiter.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin login success transaction: %w", err)
	}
	defer tx.Rollback()
	queries := generated.New(tx)

	keys := append([]string(nil), limit.Keys...)
	sort.Strings(keys)
	for _, key := range keys {
		if err := queries.AcquireLoginRateLimitLock(ctx, key); err != nil {
			return fmt.Errorf("lock login success: %w", err)
		}
		if err := queries.DeleteLoginAttemptsForKey(ctx, key); err != nil {
			return fmt.Errorf("clear login attempts: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit login success: %w", err)
	}
	return nil
}

func (limiter *LoginRateLimiter) hashKey(value string) string {
	digest := sha256.Sum256([]byte(limiter.secret + ":" + value))
	return hex.EncodeToString(digest[:])
}
