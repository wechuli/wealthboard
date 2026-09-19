package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/wechuli/wealthboard/internal/database/generated"
	"github.com/wechuli/wealthboard/internal/domain"
)

var ErrUsernameUnavailable = errors.New("username unavailable")

var defaultCategories = []struct {
	name             string
	slug             string
	icon             string
	assetOrLiability string
	isLiquid         bool
	isInvestible     bool
}{
	{"Securities", "securities", "ChartCandlestick", "asset", false, true},
	{"Money Market Fund", "money-market-fund", "Landmark", "asset", true, true},
	{"Fixed Income", "fixed-income", "BadgeDollarSign", "asset", true, true},
	{"Savings", "savings", "PiggyBank", "asset", true, true},
	{"Cash", "cash", "WalletCards", "asset", true, true},
	{"Land and Real Estate", "land-real-estate", "House", "asset", false, false},
	{"Vehicle", "vehicle", "CarFront", "asset", false, false},
	{"Retirement", "retirement", "Umbrella", "asset", false, true},
	{"Business", "business", "BriefcaseBusiness", "asset", false, true},
	{"Other Asset", "other-asset", "Gem", "asset", false, false},
	{"Liability", "liability", "CreditCard", "liability", false, false},
}

type RegistrationInput struct {
	Username     string
	DisplayName  string
	Password     string
	BaseCurrency string
}

type RegistrationService struct {
	db       *sql.DB
	timezone string
	now      func() time.Time
}

func NewRegistrationService(db *sql.DB, timezone string) *RegistrationService {
	if timezone == "" {
		timezone = "Africa/Nairobi"
	}
	return &RegistrationService{db: db, timezone: timezone, now: time.Now}
}

func (service *RegistrationService) RegisterLocal(
	ctx context.Context,
	input RegistrationInput,
) (AuthenticatedUser, error) {
	username := NormalizeUsername(input.Username)
	displayName := strings.TrimSpace(input.DisplayName)
	currency := domain.NormalizeCurrency(input.BaseCurrency)
	if !ValidUsername(username) || displayName == "" || len(displayName) > 80 || hasControlCharacter(displayName) || len(input.Password) < 12 || len(input.Password) > 256 || !domain.IsSupportedCurrency(currency) {
		return AuthenticatedUser{}, errors.New("invalid registration input")
	}

	passwordHash, err := HashPassword(input.Password)
	if err != nil {
		return AuthenticatedUser{}, fmt.Errorf("hash password: %w", err)
	}
	enabledCurrencies := []string{"KES", "USD", "TZS", "UGX"}
	foundCurrency := false
	for _, enabledCurrency := range enabledCurrencies {
		if enabledCurrency == currency {
			foundCurrency = true
			break
		}
	}
	if !foundCurrency {
		enabledCurrencies = append(enabledCurrencies, currency)
	}
	supportedCurrencies, err := json.Marshal(enabledCurrencies)
	if err != nil {
		return AuthenticatedUser{}, fmt.Errorf("encode supported currencies: %w", err)
	}

	tx, err := service.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return AuthenticatedUser{}, fmt.Errorf("begin registration: %w", err)
	}
	defer tx.Rollback()
	queries := generated.New(tx)
	userID := uuid.New()
	now := service.now().UTC()

	if err := queries.CreateLocalUser(ctx, generated.CreateLocalUserParams{
		ID:           userID,
		Username:     username,
		PasswordHash: sql.NullString{String: passwordHash, Valid: true},
		LastLoginAt:  sql.NullTime{Time: now, Valid: true},
	}); err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" && postgresError.ConstraintName == "users_username_unique" {
			return AuthenticatedUser{}, ErrUsernameUnavailable
		}
		return AuthenticatedUser{}, fmt.Errorf("create user: %w", err)
	}

	registered, err := createUserFoundation(ctx, queries, userFoundationInput{
		UserID:         userID,
		Username:       username,
		DisplayName:    displayName,
		BaseCurrency:   currency,
		CurrenciesJSON: string(supportedCurrencies),
		Timezone:       service.timezone,
		Now:            now,
	})
	if err != nil {
		return AuthenticatedUser{}, err
	}

	if err := tx.Commit(); err != nil {
		return AuthenticatedUser{}, fmt.Errorf("commit registration: %w", err)
	}
	return registered, nil
}

type userFoundationInput struct {
	UserID         uuid.UUID
	Username       string
	DisplayName    string
	BaseCurrency   string
	CurrenciesJSON string
	Timezone       string
	Now            time.Time
}

func createUserFoundation(ctx context.Context, queries *generated.Queries, input userFoundationInput) (AuthenticatedUser, error) {
	if err := queries.CreateUserSettings(ctx, generated.CreateUserSettingsParams{
		ID:                  uuid.New(),
		UserID:              input.UserID,
		DisplayName:         input.DisplayName,
		BaseCurrency:        input.BaseCurrency,
		SupportedCurrencies: input.CurrenciesJSON,
		Timezone:            input.Timezone,
		CreatedAt:           input.Now,
	}); err != nil {
		return AuthenticatedUser{}, fmt.Errorf("create user settings: %w", err)
	}

	for displayOrder, category := range defaultCategories {
		if err := queries.CreateSystemCategory(ctx, generated.CreateSystemCategoryParams{
			ID:               uuid.New(),
			UserID:           input.UserID,
			Name:             category.name,
			Slug:             category.slug,
			Icon:             category.icon,
			DisplayOrder:     int32(displayOrder),
			AssetOrLiability: category.assetOrLiability,
			IsLiquid:         category.isLiquid,
			IsInvestible:     category.isInvestible,
			CreatedAt:        input.Now,
		}); err != nil {
			return AuthenticatedUser{}, fmt.Errorf("create system category: %w", err)
		}
	}
	return AuthenticatedUser{
		UserID:                input.UserID,
		Username:              input.Username,
		SessionVersion:        1,
		SessionTimeoutMinutes: 10080,
	}, nil
}
