package auth

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

type fakeUserRepository struct {
	loginUser       generated.GetLocalLoginUserRow
	loginErr        error
	passwordUser    generated.GetPasswordUserRow
	passwordErr     error
	changedVersion  int32
	changeErr       error
	sessionUser     generated.GetActiveSessionUserRow
	sessionErr      error
	lastLoginUpdate *generated.UpdateUserLastLoginParams
}

func (repository *fakeUserRepository) GetPasswordUser(
	context.Context,
	uuid.UUID,
) (generated.GetPasswordUserRow, error) {
	return repository.passwordUser, repository.passwordErr
}

func (repository *fakeUserRepository) ChangeUserPassword(
	context.Context,
	generated.ChangeUserPasswordParams,
) (int32, error) {
	return repository.changedVersion, repository.changeErr
}

func (repository *fakeUserRepository) GetLocalLoginUser(
	context.Context,
	string,
) (generated.GetLocalLoginUserRow, error) {
	return repository.loginUser, repository.loginErr
}

func (repository *fakeUserRepository) UpdateUserLastLogin(
	_ context.Context,
	params generated.UpdateUserLastLoginParams,
) error {
	repository.lastLoginUpdate = &params
	return nil
}

func (repository *fakeUserRepository) GetActiveSessionUser(
	context.Context,
	generated.GetActiveSessionUserParams,
) (generated.GetActiveSessionUserRow, error) {
	return repository.sessionUser, repository.sessionErr
}

func TestAuthenticateLocal(t *testing.T) {
	userID := uuid.MustParse("00000000-0000-0000-0000-000000000456")
	repository := &fakeUserRepository{loginUser: generated.GetLocalLoginUserRow{
		ID:                    userID,
		Username:              "alice",
		PasswordHash:          sql.NullString{String: nodePasswordFixture, Valid: true},
		Status:                "active",
		SessionVersion:        3,
		SessionTimeoutMinutes: 60,
	}}
	manager, err := NewSessionManager(compatibilitySecret, true)
	if err != nil {
		t.Fatalf("create session manager: %v", err)
	}
	service := NewService(repository, manager)
	service.now = func() time.Time { return time.Unix(2_000_000_000, 0) }

	user, err := service.AuthenticateLocal(context.Background(), " Alice ", "correct horse battery staple")
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if user.UserID != userID || user.Username != "alice" || user.SessionVersion != 3 || user.SessionTimeoutMinutes != 60 {
		t.Fatalf("authenticated user = %+v", user)
	}
	if repository.lastLoginUpdate == nil || repository.lastLoginUpdate.ID != userID {
		t.Fatal("successful login did not update last-login metadata")
	}
}

func TestAuthenticateLocalUsesGenericFailure(t *testing.T) {
	tests := []struct {
		name       string
		repository fakeUserRepository
		password   string
	}{
		{name: "unknown user", repository: fakeUserRepository{loginErr: sql.ErrNoRows}, password: "anything"},
		{name: "wrong password", repository: fakeUserRepository{loginUser: loginUser("active", true)}, password: "wrong"},
		{name: "disabled user", repository: fakeUserRepository{loginUser: loginUser("disabled", true)}, password: "correct horse battery staple"},
		{name: "passwordless user", repository: fakeUserRepository{loginUser: loginUser("active", false)}, password: "anything"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manager, err := NewSessionManager(compatibilitySecret, false)
			if err != nil {
				t.Fatalf("create session manager: %v", err)
			}
			service := NewService(&test.repository, manager)
			_, err = service.AuthenticateLocal(context.Background(), "alice", test.password)
			if !errors.Is(err, ErrInvalidCredentials) {
				t.Fatalf("error = %v, want ErrInvalidCredentials", err)
			}
			if test.repository.lastLoginUpdate != nil {
				t.Fatal("failed login updated last-login metadata")
			}
		})
	}
}

func TestAuthenticateLocalRejectsInvalidSessionTimeout(t *testing.T) {
	repository := &fakeUserRepository{loginUser: loginUser("active", true)}
	repository.loginUser.SessionTimeoutMinutes = 1
	manager, err := NewSessionManager(compatibilitySecret, false)
	if err != nil {
		t.Fatalf("create session manager: %v", err)
	}
	service := NewService(repository, manager)
	_, err = service.AuthenticateLocal(context.Background(), "alice", "correct horse battery staple")
	if err == nil || errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("error = %v, want configuration error", err)
	}
	if repository.lastLoginUpdate != nil {
		t.Fatal("invalid session timeout updated last-login metadata")
	}
}

func TestVerifySessionRechecksDatabaseState(t *testing.T) {
	userID := uuid.MustParse("00000000-0000-0000-0000-000000000456")
	manager, err := NewSessionManager(compatibilitySecret, true)
	if err != nil {
		t.Fatalf("create session manager: %v", err)
	}
	now := time.Unix(2_000_000_000, 0)
	token, err := manager.Sign(Session{
		UserID:    userID,
		Version:   3,
		CSRFToken: "test-csrf-token-that-is-long-enough",
	}, now.Add(-time.Minute), now.Add(time.Hour))
	if err != nil {
		t.Fatalf("sign session: %v", err)
	}

	repository := &fakeUserRepository{sessionUser: generated.GetActiveSessionUserRow{
		ID:             userID,
		Username:       "alice",
		SessionVersion: 3,
	}}
	service := NewService(repository, manager)
	service.now = func() time.Time { return now }
	principal, err := service.VerifySession(context.Background(), token)
	if err != nil {
		t.Fatalf("verify session: %v", err)
	}
	if principal.UserID != userID || principal.Username != "alice" || principal.Version != 3 || principal.CSRFToken == "" {
		t.Fatalf("principal = %+v", principal)
	}

	repository.sessionErr = sql.ErrNoRows
	if _, err := service.VerifySession(context.Background(), token); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("error = %v, want ErrInvalidSession", err)
	}
}

func TestChangePasswordIncrementsSessionVersion(t *testing.T) {
	userID := uuid.MustParse("00000000-0000-0000-0000-000000000456")
	repository := &fakeUserRepository{
		passwordUser: generated.GetPasswordUserRow{
			ID:                    userID,
			Username:              "alice",
			PasswordHash:          sql.NullString{String: nodePasswordFixture, Valid: true},
			Status:                "active",
			SessionVersion:        3,
			SessionTimeoutMinutes: 60,
		},
		changedVersion: 4,
	}
	manager, err := NewSessionManager(compatibilitySecret, false)
	if err != nil {
		t.Fatalf("create session manager: %v", err)
	}
	service := NewService(repository, manager)
	changed, err := service.ChangePassword(
		context.Background(),
		Principal{UserID: userID, Username: "alice", Version: 3},
		"correct horse battery staple",
		"a different secure password",
	)
	if err != nil {
		t.Fatalf("change password: %v", err)
	}
	if changed.SessionVersion != 4 {
		t.Fatalf("session version = %d, want 4", changed.SessionVersion)
	}
}

func loginUser(status string, hasPassword bool) generated.GetLocalLoginUserRow {
	return generated.GetLocalLoginUserRow{
		ID:                    uuid.MustParse("00000000-0000-0000-0000-000000000456"),
		Username:              "alice",
		PasswordHash:          sql.NullString{String: nodePasswordFixture, Valid: hasPassword},
		Status:                status,
		SessionVersion:        3,
		SessionTimeoutMinutes: 60,
	}
}
