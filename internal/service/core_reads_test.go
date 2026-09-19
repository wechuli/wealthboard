package service

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type fakeCoreReadRepository struct {
	ownerID          uuid.UUID
	foreignAccountID uuid.UUID
	accountCalls     []uuid.UUID
	activityCalls    int
	transactions     []TransactionRow
}

func (repository *fakeCoreReadRepository) GetSettings(context.Context, uuid.UUID) (SettingsRow, error) {
	return SettingsRow{}, nil
}

func (repository *fakeCoreReadRepository) ListCategories(context.Context, uuid.UUID) ([]CategoryRow, error) {
	return nil, nil
}

func (repository *fakeCoreReadRepository) ListInstitutions(context.Context, uuid.UUID) ([]InstitutionRow, error) {
	return nil, nil
}

func (repository *fakeCoreReadRepository) ListAccounts(context.Context, uuid.UUID, string) ([]AccountRow, error) {
	return nil, nil
}

func (repository *fakeCoreReadRepository) GetAccount(_ context.Context, userID, accountID uuid.UUID) (AccountRow, error) {
	repository.accountCalls = append(repository.accountCalls, userID)
	if userID != repository.ownerID || accountID != repository.foreignAccountID {
		return AccountRow{}, sql.ErrNoRows
	}
	return AccountRow{ID: accountID, Name: "Private account", CurrentValueMinor: 999}, nil
}

func (repository *fakeCoreReadRepository) ListTransactions(context.Context, uuid.UUID, ActivityFilter) ([]TransactionRow, error) {
	return repository.transactions, nil
}

func (repository *fakeCoreReadRepository) ListValuations(context.Context, uuid.UUID, ActivityFilter) ([]ValuationRow, error) {
	return nil, nil
}

func (repository *fakeCoreReadRepository) ListActivity(context.Context, uuid.UUID, ActivityFilter) ([]ActivityRow, error) {
	repository.activityCalls++
	return nil, nil
}

func TestCoreReadsRejectForeignAccountBeforeActivityQuery(t *testing.T) {
	userOne := uuid.New()
	userTwo := uuid.New()
	accountID := uuid.New()
	repository := &fakeCoreReadRepository{ownerID: userTwo, foreignAccountID: accountID}

	_, err := NewCoreReadService(repository).Activity(context.Background(), userOne, ActivityFilter{
		AccountID: &accountID,
	})

	if !errors.Is(err, ErrCoreReadNotFound) {
		t.Fatalf("Activity() error = %v, want ErrCoreReadNotFound", err)
	}
	if len(repository.accountCalls) != 1 || repository.accountCalls[0] != userOne {
		t.Fatalf("owner lookup user IDs = %v, want only %s", repository.accountCalls, userOne)
	}
	if repository.activityCalls != 0 {
		t.Fatalf("activity repository called %d times after ownership miss", repository.activityCalls)
	}
}

func TestCoreReadsTransactionsSerializeMoneyDatesAndPagination(t *testing.T) {
	userID := uuid.New()
	accountID := uuid.New()
	repository := &fakeCoreReadRepository{
		ownerID:          userID,
		foreignAccountID: accountID,
		transactions: []TransactionRow{
			{ID: uuid.New(), AccountID: accountID, AccountName: "Cash", Type: "deposit", AmountMinor: 9_007_199_254_740_993, Currency: "KES", TransactionDate: time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)},
			{ID: uuid.New(), AccountID: accountID, AccountName: "Cash", Type: "fee", AmountMinor: -125, Currency: "KES", TransactionDate: time.Date(2026, 9, 19, 0, 0, 0, 0, time.UTC)},
		},
	}

	page, err := NewCoreReadService(repository).Transactions(context.Background(), userID, ActivityFilter{
		Page:      ReadPage{Limit: 1},
		AccountID: &accountID,
	})
	if err != nil {
		t.Fatalf("Transactions() error = %v", err)
	}
	if len(page.Items) != 1 || !page.HasMore {
		t.Fatalf("page = %+v, want one item and hasMore", page)
	}
	if page.Items[0].AmountMinor != "9007199254740993" || page.Items[0].TransactionDate != "2026-09-20" {
		t.Fatalf("serialized transaction = %+v", page.Items[0])
	}
}

func TestCoreReadsRejectUnboundedPagination(t *testing.T) {
	_, err := NewCoreReadService(&fakeCoreReadRepository{}).Transactions(
		context.Background(),
		uuid.New(),
		ActivityFilter{Page: ReadPage{Limit: MaxReadLimit + 1}},
	)
	if err == nil {
		t.Fatal("Transactions() error = nil, want pagination validation error")
	}
}
