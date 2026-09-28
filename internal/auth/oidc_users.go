package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/wechuli/wealthboard/internal/database/generated"
	"github.com/wechuli/wealthboard/internal/domain"
)

var ErrAuthenticationMethod = errors.New("authentication method could not be changed")

type OIDCIdentityService struct {
	db       *sql.DB
	timezone string
	now      func() time.Time
}

func NewOIDCIdentityService(db *sql.DB, timezone string) *OIDCIdentityService {
	if timezone == "" {
		timezone = "Africa/Nairobi"
	}
	return &OIDCIdentityService{db: db, timezone: timezone, now: time.Now}
}

func (service *OIDCIdentityService) ResolveLogin(ctx context.Context, claims OIDCIdentityClaims) (AuthenticatedUser, error) {
	if claims.Issuer == "" || len(claims.Issuer) > 2048 || !validOIDCSubject(claims.Subject) {
		return AuthenticatedUser{}, ErrOIDCProtocol
	}
	registered, err := service.resolveLoginTransaction(ctx, claims)
	if err == nil {
		return registered, nil
	}
	var postgresError *pgconn.PgError
	if !errors.As(err, &postgresError) || (postgresError.Code != "23505" && postgresError.Code != "40001") {
		return AuthenticatedUser{}, err
	}
	return service.resolveExistingAfterRace(ctx, claims)
}

func (service *OIDCIdentityService) resolveLoginTransaction(ctx context.Context, claims OIDCIdentityClaims) (AuthenticatedUser, error) {
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return AuthenticatedUser{}, fmt.Errorf("begin OIDC login: %w", err)
	}
	defer tx.Rollback()
	queries := generated.New(tx)
	now := service.now().UTC()
	if existing, found, err := resolveExistingOIDCLogin(ctx, queries, claims.Issuer, claims.Subject, now); err != nil {
		return AuthenticatedUser{}, err
	} else if found {
		if err := tx.Commit(); err != nil {
			return AuthenticatedUser{}, fmt.Errorf("commit OIDC login: %w", err)
		}
		return existing, nil
	}

	username, err := availableOIDCUsername(ctx, queries, claims.Issuer, claims.Subject)
	if err != nil {
		return AuthenticatedUser{}, err
	}
	userID := uuid.New()
	if err := queries.CreateOIDCUser(ctx, generated.CreateOIDCUserParams{
		ID: userID, Username: username, LastLoginAt: sql.NullTime{Time: now, Valid: true},
	}); err != nil {
		return AuthenticatedUser{}, fmt.Errorf("create OIDC user: %w", err)
	}
	registered, err := createUserFoundation(ctx, queries, userFoundationInput{
		UserID: userID, Username: username, DisplayName: oidcDisplayName(claims, username), BaseCurrency: domain.DefaultCurrency,
		CurrenciesJSON: `["KES","USD","TZS","UGX"]`, Timezone: service.timezone, Now: now,
	})
	if err != nil {
		return AuthenticatedUser{}, err
	}
	if err := queries.CreateOIDCIdentity(ctx, generated.CreateOIDCIdentityParams{
		ID: uuid.New(), UserID: userID, Issuer: claims.Issuer, Subject: claims.Subject, CreatedAt: now,
	}); err != nil {
		return AuthenticatedUser{}, fmt.Errorf("create OIDC identity: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return AuthenticatedUser{}, fmt.Errorf("commit OIDC registration: %w", err)
	}
	return registered, nil
}

func (service *OIDCIdentityService) resolveExistingAfterRace(ctx context.Context, claims OIDCIdentityClaims) (AuthenticatedUser, error) {
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return AuthenticatedUser{}, err
	}
	defer tx.Rollback()
	registered, found, err := resolveExistingOIDCLogin(ctx, generated.New(tx), claims.Issuer, claims.Subject, service.now().UTC())
	if err != nil || !found {
		if err == nil {
			err = ErrOIDCProtocol
		}
		return AuthenticatedUser{}, err
	}
	if err := tx.Commit(); err != nil {
		return AuthenticatedUser{}, err
	}
	return registered, nil
}

func resolveExistingOIDCLogin(ctx context.Context, queries *generated.Queries, issuer, subject string, now time.Time) (AuthenticatedUser, bool, error) {
	user, err := queries.GetOIDCLoginUser(ctx, generated.GetOIDCLoginUserParams{Issuer: issuer, Subject: subject})
	if errors.Is(err, sql.ErrNoRows) {
		return AuthenticatedUser{}, false, nil
	}
	if err != nil {
		return AuthenticatedUser{}, false, err
	}
	if user.Status != "active" || user.SessionTimeoutMinutes < 15 || user.SessionTimeoutMinutes > 525600 {
		return AuthenticatedUser{}, true, ErrInvalidCredentials
	}
	if err := queries.UpdateOIDCLogin(ctx, generated.UpdateOIDCLoginParams{ID: user.IdentityID, LastLoginAt: now}); err != nil {
		return AuthenticatedUser{}, true, err
	}
	if err := queries.UpdateUserLastLogin(ctx, generated.UpdateUserLastLoginParams{ID: user.ID, LastLoginAt: sql.NullTime{Time: now, Valid: true}}); err != nil {
		return AuthenticatedUser{}, true, err
	}
	return AuthenticatedUser{UserID: user.ID, Username: user.Username, SessionVersion: int(user.SessionVersion), SessionTimeoutMinutes: int(user.SessionTimeoutMinutes)}, true, nil
}

func availableOIDCUsername(ctx context.Context, queries *generated.Queries, issuer, subject string) (string, error) {
	for attempt := 0; attempt < 100; attempt++ {
		digest := sha256.Sum256([]byte(issuer + "\x00" + subject + "\x00" + strconv.Itoa(attempt)))
		username := "oidc-" + hex.EncodeToString(digest[:])[:27]
		exists, err := queries.UsernameExists(ctx, username)
		if err != nil {
			return "", err
		}
		if !exists {
			return username, nil
		}
	}
	return "", errors.New("OIDC username could not be allocated")
}

func oidcDisplayName(claims OIDCIdentityClaims, fallback string) string {
	for _, candidate := range []string{claims.Name, claims.PreferredUsername} {
		candidate = strings.TrimSpace(candidate)
		if candidate != "" && len(candidate) <= 80 && !hasControlCharacter(candidate) {
			return candidate
		}
	}
	return fallback
}

func (service *OIDCIdentityService) Link(ctx context.Context, userID uuid.UUID, expectedVersion int, claims OIDCIdentityClaims) (AuthenticatedUser, error) {
	if claims.Issuer == "" || !validOIDCSubject(claims.Subject) {
		return AuthenticatedUser{}, ErrAuthenticationMethod
	}
	return service.authMethodTransaction(ctx, userID, expectedVersion, func(queries *generated.Queries, user generated.GetAuthMethodUserRow, now time.Time) (int32, error) {
		if !user.PasswordHash.Valid {
			return 0, ErrAuthenticationMethod
		}
		if _, err := queries.GetOIDCIdentity(ctx, generated.GetOIDCIdentityParams{Issuer: claims.Issuer, Subject: claims.Subject}); !errors.Is(err, sql.ErrNoRows) {
			return 0, ErrAuthenticationMethod
		}
		if _, err := queries.GetUserOIDCIdentity(ctx, generated.GetUserOIDCIdentityParams{UserID: userID, Issuer: claims.Issuer}); !errors.Is(err, sql.ErrNoRows) {
			return 0, ErrAuthenticationMethod
		}
		if err := queries.CreateOIDCIdentity(ctx, generated.CreateOIDCIdentityParams{ID: uuid.New(), UserID: userID, Issuer: claims.Issuer, Subject: claims.Subject, CreatedAt: now}); err != nil {
			return 0, ErrAuthenticationMethod
		}
		return queries.IncrementSessionVersion(ctx, generated.IncrementSessionVersionParams{ID: userID, SessionVersion: user.SessionVersion, UpdatedAt: now})
	})
}

func (service *OIDCIdentityService) Reauthenticate(ctx context.Context, userID uuid.UUID, expectedVersion int, claims OIDCIdentityClaims) (AuthenticatedUser, error) {
	return service.authMethodTransaction(ctx, userID, expectedVersion, func(queries *generated.Queries, user generated.GetAuthMethodUserRow, now time.Time) (int32, error) {
		identity, err := queries.GetOIDCIdentity(ctx, generated.GetOIDCIdentityParams{Issuer: claims.Issuer, Subject: claims.Subject})
		if err != nil || identity.UserID != userID {
			return 0, ErrAuthenticationMethod
		}
		if err := queries.UpdateOIDCLogin(ctx, generated.UpdateOIDCLoginParams{ID: identity.ID, LastLoginAt: now}); err != nil {
			return 0, err
		}
		return user.SessionVersion, nil
	})
}

func (service *OIDCIdentityService) Unlink(ctx context.Context, userID uuid.UUID, expectedVersion int, issuer string) (AuthenticatedUser, error) {
	return service.authMethodTransaction(ctx, userID, expectedVersion, func(queries *generated.Queries, user generated.GetAuthMethodUserRow, now time.Time) (int32, error) {
		if !user.PasswordHash.Valid {
			return 0, ErrAuthenticationMethod
		}
		identity, err := queries.GetUserOIDCIdentity(ctx, generated.GetUserOIDCIdentityParams{UserID: userID, Issuer: issuer})
		if err != nil {
			return 0, ErrAuthenticationMethod
		}
		deleted, err := queries.DeleteUserOIDCIdentity(ctx, generated.DeleteUserOIDCIdentityParams{ID: identity.ID, UserID: userID})
		if err != nil || deleted != 1 {
			return 0, ErrAuthenticationMethod
		}
		return queries.IncrementSessionVersion(ctx, generated.IncrementSessionVersionParams{ID: userID, SessionVersion: user.SessionVersion, UpdatedAt: now})
	})
}

func (service *OIDCIdentityService) EnableLocal(ctx context.Context, userID uuid.UUID, expectedVersion int, issuer, username, password string) (AuthenticatedUser, error) {
	username = NormalizeUsername(username)
	if !ValidUsername(username) || len(password) < 12 || len(password) > 256 {
		return AuthenticatedUser{}, ErrAuthenticationMethod
	}
	passwordHash, err := HashPassword(password)
	if err != nil {
		return AuthenticatedUser{}, err
	}
	authenticated, err := service.authMethodTransaction(ctx, userID, expectedVersion, func(queries *generated.Queries, user generated.GetAuthMethodUserRow, now time.Time) (int32, error) {
		if user.PasswordHash.Valid {
			return 0, ErrAuthenticationMethod
		}
		if _, err := queries.GetUserOIDCIdentity(ctx, generated.GetUserOIDCIdentityParams{UserID: userID, Issuer: issuer}); err != nil {
			return 0, ErrAuthenticationMethod
		}
		version, err := queries.EnableLocalCredential(ctx, generated.EnableLocalCredentialParams{ID: userID, SessionVersion: user.SessionVersion, Username: username, PasswordHash: sql.NullString{String: passwordHash, Valid: true}, UpdatedAt: now})
		if err != nil {
			var postgresError *pgconn.PgError
			if errors.As(err, &postgresError) && postgresError.Code == "23505" {
				return 0, ErrUsernameUnavailable
			}
		}
		return version, err
	})
	if err == nil {
		authenticated.Username = username
	}
	return authenticated, err
}

func (service *OIDCIdentityService) RemoveLocal(ctx context.Context, userID uuid.UUID, expectedVersion int, issuer string) (AuthenticatedUser, error) {
	return service.authMethodTransaction(ctx, userID, expectedVersion, func(queries *generated.Queries, user generated.GetAuthMethodUserRow, now time.Time) (int32, error) {
		if !user.PasswordHash.Valid {
			return 0, ErrAuthenticationMethod
		}
		if _, err := queries.GetUserOIDCIdentity(ctx, generated.GetUserOIDCIdentityParams{UserID: userID, Issuer: issuer}); err != nil {
			return 0, ErrAuthenticationMethod
		}
		return queries.RemoveLocalCredential(ctx, generated.RemoveLocalCredentialParams{ID: userID, SessionVersion: user.SessionVersion, UpdatedAt: now})
	})
}

func (service *OIDCIdentityService) authMethodTransaction(ctx context.Context, userID uuid.UUID, expectedVersion int, mutate func(*generated.Queries, generated.GetAuthMethodUserRow, time.Time) (int32, error)) (AuthenticatedUser, error) {
	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return AuthenticatedUser{}, err
	}
	defer tx.Rollback()
	queries := generated.New(tx)
	user, err := queries.GetAuthMethodUser(ctx, userID)
	if err != nil || user.Status != "active" || int(user.SessionVersion) != expectedVersion {
		return AuthenticatedUser{}, ErrAuthenticationMethod
	}
	version, err := mutate(queries, user, service.now().UTC())
	if err != nil {
		return AuthenticatedUser{}, err
	}
	if err := tx.Commit(); err != nil {
		return AuthenticatedUser{}, err
	}
	return AuthenticatedUser{UserID: user.ID, Username: user.Username, SessionVersion: int(version), SessionTimeoutMinutes: int(user.SessionTimeoutMinutes)}, nil
}
