package auth

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestOIDCLoginJITProvisioningAndConcurrentResolution(t *testing.T) {
	db := openAuthTestDatabase(t)
	service := NewOIDCIdentityService(db, "Africa/Nairobi")
	service.now = func() time.Time { return time.Unix(2_000_000_000, 0).UTC() }
	claims := OIDCIdentityClaims{Issuer: "https://identity.example/realm", Subject: "subject-123", Name: "Alice Example"}

	const callers = 2
	results := make(chan AuthenticatedUser, callers)
	errorsChannel := make(chan error, callers)
	start := make(chan struct{})
	var waitGroup sync.WaitGroup
	for range callers {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			user, err := service.ResolveLogin(context.Background(), claims)
			results <- user
			errorsChannel <- err
		}()
	}
	close(start)
	waitGroup.Wait()
	close(results)
	close(errorsChannel)

	var userID string
	for err := range errorsChannel {
		if err != nil {
			t.Fatalf("resolve concurrent OIDC login: %v", err)
		}
	}
	for user := range results {
		if userID == "" {
			userID = user.UserID.String()
		}
		if user.UserID.String() != userID || user.SessionVersion != 1 || user.SessionTimeoutMinutes != 10080 {
			t.Fatalf("resolved user = %+v, first ID = %s", user, userID)
		}
	}

	var users, identities, settings, categories, accounts int
	for query, destination := range map[string]*int{
		"SELECT count(*) FROM users":           &users,
		"SELECT count(*) FROM oidc_identities": &identities,
		"SELECT count(*) FROM user_settings":   &settings,
		"SELECT count(*) FROM categories":      &categories,
		"SELECT count(*) FROM accounts":        &accounts,
	} {
		if err := db.QueryRow(query).Scan(destination); err != nil {
			t.Fatalf("count provisioned rows: %v", err)
		}
	}
	if users != 1 || identities != 1 || settings != 1 || categories != 11 || accounts != 0 {
		t.Fatalf("JIT rows users:%d identities:%d settings:%d categories:%d accounts:%d", users, identities, settings, categories, accounts)
	}
	var passwordHash sql.NullString
	var displayName string
	if err := db.QueryRow(`SELECT users.password_hash, user_settings.display_name FROM users JOIN user_settings ON user_settings.user_id = users.id`).Scan(&passwordHash, &displayName); err != nil {
		t.Fatalf("read OIDC foundation: %v", err)
	}
	if passwordHash.Valid || displayName != "Alice Example" {
		t.Fatalf("OIDC foundation password = %+v, display name = %q", passwordHash, displayName)
	}
}

func TestOIDCAuthenticationMethodTransitions(t *testing.T) {
	db := openAuthTestDatabase(t)
	ctx := context.Background()
	registration := NewRegistrationService(db, "Africa/Nairobi")
	local, err := registration.RegisterLocal(ctx, RegistrationInput{Username: "alice", DisplayName: "Alice", Password: "correct horse battery staple", BaseCurrency: "KES"})
	if err != nil {
		t.Fatalf("register local user: %v", err)
	}
	service := NewOIDCIdentityService(db, "Africa/Nairobi")
	service.now = func() time.Time { return time.Unix(2_000_000_000, 0).UTC() }
	claims := OIDCIdentityClaims{Issuer: "https://identity.example", Subject: "alice-subject"}

	linked, err := service.Link(ctx, local.UserID, local.SessionVersion, claims)
	if err != nil || linked.SessionVersion != 2 {
		t.Fatalf("link identity = %+v, %v", linked, err)
	}
	if _, err := service.Link(ctx, local.UserID, local.SessionVersion, OIDCIdentityClaims{Issuer: claims.Issuer, Subject: "other"}); !errors.Is(err, ErrAuthenticationMethod) {
		t.Fatalf("stale link error = %v", err)
	}
	if _, err := service.Reauthenticate(ctx, local.UserID, linked.SessionVersion, OIDCIdentityClaims{Issuer: claims.Issuer, Subject: "wrong"}); !errors.Is(err, ErrAuthenticationMethod) {
		t.Fatalf("wrong identity reauth error = %v", err)
	}
	reauthenticated, err := service.Reauthenticate(ctx, local.UserID, linked.SessionVersion, claims)
	if err != nil || reauthenticated.SessionVersion != linked.SessionVersion {
		t.Fatalf("reauthenticate = %+v, %v", reauthenticated, err)
	}
	unlinked, err := service.Unlink(ctx, local.UserID, linked.SessionVersion, claims.Issuer)
	if err != nil || unlinked.SessionVersion != 3 {
		t.Fatalf("unlink identity = %+v, %v", unlinked, err)
	}

	oidcOnly, err := service.ResolveLogin(ctx, OIDCIdentityClaims{Issuer: claims.Issuer, Subject: "oidc-only", PreferredUsername: "OIDC User"})
	if err != nil {
		t.Fatalf("provision OIDC-only user: %v", err)
	}
	if _, err := service.Unlink(ctx, oidcOnly.UserID, oidcOnly.SessionVersion, claims.Issuer); !errors.Is(err, ErrAuthenticationMethod) {
		t.Fatalf("unlink last method error = %v", err)
	}
	enabled, err := service.EnableLocal(ctx, oidcOnly.UserID, oidcOnly.SessionVersion, claims.Issuer, "oidc-user", "another correct horse battery staple")
	if err != nil || enabled.SessionVersion != 2 || enabled.Username != "oidc-user" {
		t.Fatalf("enable local = %+v, %v", enabled, err)
	}
	removed, err := service.RemoveLocal(ctx, oidcOnly.UserID, enabled.SessionVersion, claims.Issuer)
	if err != nil || removed.SessionVersion != 3 {
		t.Fatalf("remove local = %+v, %v", removed, err)
	}
	var localHash sql.NullString
	if err := db.QueryRow(`SELECT password_hash FROM users WHERE id = $1`, oidcOnly.UserID).Scan(&localHash); err != nil {
		t.Fatalf("read local credential: %v", err)
	}
	if localHash.Valid {
		t.Fatal("local credential was not removed")
	}
}
