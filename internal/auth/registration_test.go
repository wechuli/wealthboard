package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

func TestRegisterLocalCreatesOnlyUserFoundation(t *testing.T) {
	db := openAuthTestDatabase(t)
	service := NewRegistrationService(db, "Africa/Nairobi")
	service.now = func() time.Time { return time.Unix(2_000_000_000, 0) }

	registered, err := service.RegisterLocal(context.Background(), RegistrationInput{
		Username:     " Alice ",
		DisplayName:  "Alice Example",
		Password:     "correct horse battery staple",
		BaseCurrency: "eur",
	})
	if err != nil {
		t.Fatalf("register local user: %v", err)
	}
	if registered.Username != "alice" || registered.SessionVersion != 1 || registered.SessionTimeoutMinutes != 10080 {
		t.Fatalf("registered user = %+v", registered)
	}

	var supportedCurrencies string
	if err := db.QueryRow(`SELECT supported_currencies FROM user_settings WHERE user_id = $1`, registered.UserID).Scan(&supportedCurrencies); err != nil {
		t.Fatalf("read settings: %v", err)
	}
	var categoryCount, accountCount int
	if err := db.QueryRow(`SELECT count(*) FROM categories WHERE user_id = $1 AND is_system`, registered.UserID).Scan(&categoryCount); err != nil {
		t.Fatalf("count categories: %v", err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM accounts WHERE user_id = $1`, registered.UserID).Scan(&accountCount); err != nil {
		t.Fatalf("count accounts: %v", err)
	}
	if supportedCurrencies != `["KES","USD","TZS","UGX","EUR"]` || categoryCount != 11 || accountCount != 0 {
		t.Fatalf("foundation = currencies:%s categories:%d accounts:%d", supportedCurrencies, categoryCount, accountCount)
	}

	_, err = service.RegisterLocal(context.Background(), RegistrationInput{
		Username:     "ALICE",
		DisplayName:  "Another Alice",
		Password:     "another secure password",
		BaseCurrency: "USD",
	})
	if !errors.Is(err, ErrUsernameUnavailable) {
		t.Fatalf("duplicate registration error = %v, want ErrUsernameUnavailable", err)
	}
}

func TestResetPasswordInvalidatesSessions(t *testing.T) {
	db := openAuthTestDatabase(t)
	ctx := context.Background()
	registration := NewRegistrationService(db, "Africa/Nairobi")
	registered, err := registration.RegisterLocal(ctx, RegistrationInput{
		Username: "reset-user", DisplayName: "Reset User", Password: "original secure password", BaseCurrency: "KES",
	})
	if err != nil {
		t.Fatalf("register reset user: %v", err)
	}
	if err := ResetPassword(ctx, generated.New(db), "RESET-USER", "replacement secure password", time.Unix(2_000_000_000, 0)); err != nil {
		t.Fatalf("reset password: %v", err)
	}
	manager, err := NewSessionManager(compatibilitySecret, false)
	if err != nil {
		t.Fatalf("create session manager: %v", err)
	}
	service := NewService(generated.New(db), manager)
	if _, err := service.AuthenticateLocal(ctx, "reset-user", "original secure password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("old password error = %v", err)
	}
	authenticated, err := service.AuthenticateLocal(ctx, "reset-user", "replacement secure password")
	if err != nil {
		t.Fatalf("authenticate replacement password: %v", err)
	}
	if authenticated.SessionVersion != registered.SessionVersion+1 {
		t.Fatalf("session version = %d, want %d", authenticated.SessionVersion, registered.SessionVersion+1)
	}
}
