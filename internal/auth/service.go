package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrInvalidSession     = errors.New("invalid session")
)

const dummyPasswordHash = "$2b$12$.k.QQTfYsnvqQ2AQM/k64uRyi/xvL62XBKNzS7nr5wBG.u7UmFoui"

type UserRepository interface {
	ChangeUserPassword(context.Context, generated.ChangeUserPasswordParams) (int32, error)
	GetActiveSessionUser(context.Context, generated.GetActiveSessionUserParams) (generated.GetActiveSessionUserRow, error)
	GetLocalLoginUser(context.Context, string) (generated.GetLocalLoginUserRow, error)
	GetPasswordUser(context.Context, uuid.UUID) (generated.GetPasswordUserRow, error)
	UpdateUserLastLogin(context.Context, generated.UpdateUserLastLoginParams) error
}

type Service struct {
	users    UserRepository
	sessions *SessionManager
	now      func() time.Time
}

type AuthenticatedUser struct {
	UserID                uuid.UUID
	Username              string
	SessionVersion        int
	SessionTimeoutMinutes int
}

type Principal struct {
	UserID    uuid.UUID
	Username  string
	Version   int
	CSRFToken string
	Method    string
	KeyID     uuid.UUID
	Scopes    []Scope
}

func NewService(users UserRepository, sessions *SessionManager) *Service {
	return &Service{users: users, sessions: sessions, now: time.Now}
}

func NormalizeUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

func ValidUsername(username string) bool {
	return usernamePattern.MatchString(username)
}

func (service *Service) AuthenticateLocal(
	ctx context.Context,
	usernameInput string,
	password string,
) (AuthenticatedUser, error) {
	user, err := service.users.GetLocalLoginUser(ctx, NormalizeUsername(usernameInput))
	found := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return AuthenticatedUser{}, err
	}

	hash := dummyPasswordHash
	if found && user.PasswordHash.Valid {
		hash = user.PasswordHash.String
	}
	validPassword := VerifyPassword(hash, password)
	if !found || user.Status != "active" || !user.PasswordHash.Valid || !validPassword {
		return AuthenticatedUser{}, ErrInvalidCredentials
	}
	if user.SessionTimeoutMinutes < 15 || user.SessionTimeoutMinutes > 525600 {
		return AuthenticatedUser{}, errors.New("invalid session timeout configuration")
	}

	now := service.now().UTC()
	if err := service.users.UpdateUserLastLogin(ctx, generated.UpdateUserLastLoginParams{
		ID:          user.ID,
		LastLoginAt: sql.NullTime{Time: now, Valid: true},
	}); err != nil {
		return AuthenticatedUser{}, err
	}

	return AuthenticatedUser{
		UserID:                user.ID,
		Username:              user.Username,
		SessionVersion:        int(user.SessionVersion),
		SessionTimeoutMinutes: int(user.SessionTimeoutMinutes),
	}, nil
}

func (service *Service) VerifyLocalPassword(ctx context.Context, userID uuid.UUID, password string) (bool, error) {
	if len(password) < 1 || len(password) > 256 {
		return false, nil
	}
	user, err := service.users.GetPasswordUser(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return user.Status == "active" && user.PasswordHash.Valid && VerifyPassword(user.PasswordHash.String, password), nil
}

func (service *Service) VerifySession(
	ctx context.Context,
	rawToken string,
) (Principal, error) {
	session, err := service.sessions.Verify(rawToken, service.now())
	if err != nil {
		return Principal{}, ErrInvalidSession
	}

	user, err := service.users.GetActiveSessionUser(ctx, generated.GetActiveSessionUserParams{
		ID:             session.UserID,
		SessionVersion: int32(session.Version),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Principal{}, ErrInvalidSession
		}
		return Principal{}, err
	}

	return Principal{
		UserID:    user.ID,
		Username:  user.Username,
		Version:   int(user.SessionVersion),
		CSRFToken: session.CSRFToken,
		Method:    "session",
	}, nil
}

func (service *Service) ChangePassword(
	ctx context.Context,
	principal Principal,
	currentPassword string,
	newPassword string,
) (AuthenticatedUser, error) {
	if len(currentPassword) < 1 || len(currentPassword) > 256 || len(newPassword) < 12 || len(newPassword) > 256 {
		return AuthenticatedUser{}, ErrInvalidCredentials
	}
	user, err := service.users.GetPasswordUser(ctx, principal.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthenticatedUser{}, ErrInvalidCredentials
		}
		return AuthenticatedUser{}, err
	}
	if user.Status != "active" || !user.PasswordHash.Valid || !VerifyPassword(user.PasswordHash.String, currentPassword) {
		return AuthenticatedUser{}, ErrInvalidCredentials
	}
	if int(user.SessionVersion) != principal.Version {
		return AuthenticatedUser{}, ErrInvalidSession
	}

	passwordHash, err := HashPassword(newPassword)
	if err != nil {
		return AuthenticatedUser{}, fmt.Errorf("hash password: %w", err)
	}
	version, err := service.users.ChangeUserPassword(ctx, generated.ChangeUserPasswordParams{
		ID:             user.ID,
		SessionVersion: int32(principal.Version),
		PasswordHash:   sql.NullString{String: passwordHash, Valid: true},
		UpdatedAt:      service.now().UTC(),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthenticatedUser{}, ErrInvalidSession
		}
		return AuthenticatedUser{}, err
	}
	return AuthenticatedUser{
		UserID:                user.ID,
		Username:              user.Username,
		SessionVersion:        int(version),
		SessionTimeoutMinutes: int(user.SessionTimeoutMinutes),
	}, nil
}
