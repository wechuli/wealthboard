package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/wechuli/wealthboard/internal/database/generated"
)

func ResetPassword(
	ctx context.Context,
	queries *generated.Queries,
	username string,
	password string,
	now time.Time,
) error {
	username = NormalizeUsername(username)
	if !ValidUsername(username) {
		return errors.New("TARGET_USERNAME must identify a valid existing username")
	}
	if len(password) < 12 || len(password) > 256 {
		return errors.New("NEW_USER_PASSWORD must contain between 12 and 256 characters")
	}
	user, err := queries.GetPasswordResetUser(ctx, username)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("target user was not found")
		}
		return fmt.Errorf("find reset target: %w", err)
	}
	if !user.PasswordHash.Valid {
		return errors.New("target user does not have a local credential")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return fmt.Errorf("hash replacement password: %w", err)
	}
	if _, err := queries.ResetUserPassword(ctx, generated.ResetUserPasswordParams{
		ID:           user.ID,
		PasswordHash: sql.NullString{String: hash, Valid: true},
		UpdatedAt:    now.UTC(),
	}); err != nil {
		return fmt.Errorf("reset password: %w", err)
	}
	return nil
}
