package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type fakeAccountConversionService struct {
	preview      service.AccountConversionPreview
	result       service.AccountConversionResult
	err          error
	lastUserID   uuid.UUID
	lastInput    service.AccountConversionInput
	previewCalls int
	executeCalls int
}

func (fake *fakeAccountConversionService) Preview(_ context.Context, userID uuid.UUID, input service.AccountConversionInput) (service.AccountConversionPreview, error) {
	fake.lastUserID, fake.lastInput, fake.previewCalls = userID, input, fake.previewCalls+1
	return fake.preview, fake.err
}

func (fake *fakeAccountConversionService) Execute(_ context.Context, userID uuid.UUID, input service.AccountConversionInput) (service.AccountConversionResult, error) {
	fake.lastUserID, fake.lastInput, fake.executeCalls = userID, input, fake.executeCalls+1
	return fake.result, fake.err
}

func TestAccountConversionRoutesPassOwnerAndIdempotency(t *testing.T) {
	ownerID, sourceID, instrumentID, targetID, key := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	fake := &fakeAccountConversionService{result: service.AccountConversionResult{TargetAccountID: targetID}}
	router := accountConversionRouter(fakeMetadataAuthorizer{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}}, fake)
	body := `{"sourceAccountId":"` + sourceID.String() + `","targetName":"Brokerage Positions","conversionDate":"2026-09-20","openingCash":"0","holdings":[{"instrumentId":"` + instrumentID.String() + `","quantity":"1.2500","price":"8.00"}]}`

	previewRequest := httptest.NewRequest(http.MethodPost, "/account-conversions/preview", strings.NewReader(body))
	previewRequest.Header.Set("Content-Type", "application/json")
	previewRequest.Header.Set("Idempotency-Key", key.String())
	previewResponse := httptest.NewRecorder()
	router.ServeHTTP(previewResponse, previewRequest)
	if previewResponse.Code != http.StatusOK || fake.previewCalls != 1 || fake.lastUserID != ownerID || fake.lastInput.IdempotencyKey != key {
		t.Fatalf("preview status=%d calls=%d owner=%s input=%+v body=%s", previewResponse.Code, fake.previewCalls, fake.lastUserID, fake.lastInput, previewResponse.Body.String())
	}

	executeRequest := httptest.NewRequest(http.MethodPost, "/account-conversions", strings.NewReader(body))
	executeRequest.Header.Set("Content-Type", "application/json")
	executeRequest.Header.Set("Idempotency-Key", key.String())
	executeResponse := httptest.NewRecorder()
	router.ServeHTTP(executeResponse, executeRequest)
	if executeResponse.Code != http.StatusCreated || fake.executeCalls != 1 || !strings.Contains(executeResponse.Body.String(), targetID.String()) {
		t.Fatalf("execute status=%d calls=%d body=%s", executeResponse.Code, fake.executeCalls, executeResponse.Body.String())
	}
}

func TestAccountConversionRoutesEnforceMutationAuthorization(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want int
	}{
		{name: "authentication", err: errMutationUnauthorized, want: http.StatusUnauthorized},
		{name: "session origin", err: errMutationOrigin, want: http.StatusForbidden},
		{name: "portfolio write", err: errMutationScope, want: http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			fake := &fakeAccountConversionService{}
			request := httptest.NewRequest(http.MethodPost, "/account-conversions/preview", strings.NewReader(`{}`))
			response := httptest.NewRecorder()
			accountConversionRouter(fakeMetadataAuthorizer{err: test.err}, fake).ServeHTTP(response, request)
			if response.Code != test.want || fake.previewCalls != 0 {
				t.Fatalf("status=%d want=%d calls=%d", response.Code, test.want, fake.previewCalls)
			}
		})
	}
}

func TestAccountConversionRoutesRejectKeyMismatchAndMapForeignNotFound(t *testing.T) {
	bodyKey, headerKey := uuid.New(), uuid.New()
	fake := &fakeAccountConversionService{}
	auth := fakeMetadataAuthorizer{principal: webauth.Principal{UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}}
	request := httptest.NewRequest(http.MethodPost, "/account-conversions", strings.NewReader(`{"conversionDate":"2026-09-20","idempotencyKey":"`+bodyKey.String()+`"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", headerKey.String())
	response := httptest.NewRecorder()
	accountConversionRouter(auth, fake).ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity || fake.executeCalls != 0 {
		t.Fatalf("key mismatch status=%d calls=%d body=%s", response.Code, fake.executeCalls, response.Body.String())
	}

	fake.err = errors.Join(service.ErrAccountConversionNotFound, errors.New("foreign source"))
	request = httptest.NewRequest(http.MethodPost, "/account-conversions/preview", strings.NewReader(`{"conversionDate":"2026-09-20"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", uuid.NewString())
	response = httptest.NewRecorder()
	accountConversionRouter(auth, fake).ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("foreign preview status=%d body=%s", response.Code, response.Body.String())
	}
}

func accountConversionRouter(auth accountConversionAuthorizer, conversions accountConversionService) http.Handler {
	router := chi.NewRouter()
	RegisterAccountConversionRoutes(router, NewAccountConversionHandler(auth, conversions))
	return router
}
