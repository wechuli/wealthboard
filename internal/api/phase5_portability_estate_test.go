package api

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type fakePhase5Authorizer struct {
	principal webauth.Principal
	readErr   error
	writeErr  error
}

func (fake fakePhase5Authorizer) AuthenticateRequest(*http.Request) (webauth.Principal, error) {
	return fake.principal, fake.readErr
}

func (fake fakePhase5Authorizer) AuthorizePortfolioMutation(*http.Request) (webauth.Principal, error) {
	return fake.principal, fake.writeErr
}

type fakePortabilityService struct {
	lastUserID uuid.UUID
	restore    []byte
	err        error
}

func (fake *fakePortabilityService) ExportJSON(_ context.Context, userID uuid.UUID) ([]byte, error) {
	fake.lastUserID = userID
	return []byte(`{"version":8}`), fake.err
}
func (fake *fakePortabilityService) TransactionsCSV(_ context.Context, userID uuid.UUID) ([]byte, error) {
	fake.lastUserID = userID
	return []byte("id\n"), fake.err
}
func (fake *fakePortabilityService) AccountsCSV(_ context.Context, userID uuid.UUID) ([]byte, error) {
	fake.lastUserID = userID
	return []byte("id\n"), fake.err
}
func (fake *fakePortabilityService) RestoreJSON(_ context.Context, userID uuid.UUID, data []byte) (service.RestoreSummary, error) {
	fake.lastUserID, fake.restore = userID, append([]byte(nil), data...)
	return service.RestoreSummary{Accounts: 1}, fake.err
}

func TestPortabilityRoutesUseAuthenticatedOwnerAndBoundRestore(t *testing.T) {
	ownerID := uuid.New()
	auth := fakePhase5Authorizer{principal: webauth.Principal{UserID: ownerID, Method: "session"}}
	fake := &fakePortabilityService{}
	routes := NewPortabilityRoutes(auth, fake)

	exportRequest := httptest.NewRequest(http.MethodGet, "/exports/user", nil)
	exportResponse := httptest.NewRecorder()
	routes.ServeHTTP(exportResponse, exportRequest)
	if exportResponse.Code != http.StatusOK || fake.lastUserID != ownerID || exportResponse.Header().Get("Content-Disposition") == "" {
		t.Fatalf("export status=%d owner=%s headers=%v", exportResponse.Code, fake.lastUserID, exportResponse.Header())
	}

	restoreRequest := httptest.NewRequest(http.MethodPost, "/restore/user", strings.NewReader(`{"version":8}`))
	restoreRequest.Header.Set("Content-Type", "application/json")
	restoreResponse := httptest.NewRecorder()
	routes.ServeHTTP(restoreResponse, restoreRequest)
	if restoreResponse.Code != http.StatusOK || fake.lastUserID != ownerID || string(fake.restore) != `{"version":8}` {
		t.Fatalf("restore status=%d owner=%s body=%s", restoreResponse.Code, fake.lastUserID, restoreResponse.Body.String())
	}

	oversized := httptest.NewRequest(http.MethodPost, "/restore/user", bytes.NewReader(make([]byte, service.MaxUserArchiveBytes+1)))
	oversized.Header.Set("Content-Type", "application/json")
	oversizedResponse := httptest.NewRecorder()
	routes.ServeHTTP(oversizedResponse, oversized)
	if oversizedResponse.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status=%d body=%s", oversizedResponse.Code, oversizedResponse.Body.String())
	}
}

func TestPortabilityExportRequiresExportOrPortfolioReadScope(t *testing.T) {
	auth := fakePhase5Authorizer{principal: webauth.Principal{UserID: uuid.New(), Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite}}}
	response := httptest.NewRecorder()
	NewPortabilityRoutes(auth, &fakePortabilityService{}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/exports/user", nil))
	if response.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

type fakeEstateMutationService struct {
	lastUserID     uuid.UUID
	lastResourceID uuid.UUID
	err            error
}

func (fake *fakeEstateMutationService) UpdatePlan(_ context.Context, userID uuid.UUID, _ service.EstatePlanInput) (service.EstatePlan, error) {
	fake.lastUserID = userID
	return service.EstatePlan{}, fake.err
}
func (fake *fakeEstateMutationService) CreateBeneficiary(_ context.Context, userID uuid.UUID, _ service.BeneficiaryInput) (service.EstateMutationResult, error) {
	fake.lastUserID = userID
	return service.EstateMutationResult{ID: uuid.New()}, fake.err
}
func (fake *fakeEstateMutationService) UpdateBeneficiary(_ context.Context, userID, id uuid.UUID, _ service.BeneficiaryInput) error {
	fake.lastUserID, fake.lastResourceID = userID, id
	return fake.err
}
func (fake *fakeEstateMutationService) SetBeneficiaryArchived(_ context.Context, userID, id uuid.UUID, _ bool) error {
	fake.lastUserID, fake.lastResourceID = userID, id
	return fake.err
}
func (fake *fakeEstateMutationService) UpsertDirective(_ context.Context, userID, id uuid.UUID, _ service.EstateDirectiveInput) (service.EstateMutationResult, error) {
	fake.lastUserID, fake.lastResourceID = userID, id
	return service.EstateMutationResult{ID: uuid.New()}, fake.err
}
func (fake *fakeEstateMutationService) UpsertAllocation(_ context.Context, userID, id uuid.UUID, _ service.EstateAllocationInput) (service.EstateMutationResult, error) {
	fake.lastUserID, fake.lastResourceID = userID, id
	return service.EstateMutationResult{ID: uuid.New()}, fake.err
}
func (fake *fakeEstateMutationService) DeleteAllocation(_ context.Context, userID, id uuid.UUID) error {
	fake.lastUserID, fake.lastResourceID = userID, id
	return fake.err
}
func (fake *fakeEstateMutationService) UpsertResiduaryAllocation(_ context.Context, userID uuid.UUID, _ service.EstateAllocationInput) (service.EstateMutationResult, error) {
	fake.lastUserID = userID
	return service.EstateMutationResult{ID: uuid.New()}, fake.err
}
func (fake *fakeEstateMutationService) DeleteResiduaryAllocation(_ context.Context, userID, id uuid.UUID) error {
	fake.lastUserID, fake.lastResourceID = userID, id
	return fake.err
}
func (fake *fakeEstateMutationService) CreateSnapshot(_ context.Context, userID uuid.UUID) (service.EstateSnapshotResult, error) {
	fake.lastUserID = userID
	return service.EstateSnapshotResult{}, fake.err
}
func (fake *fakeEstateMutationService) DeleteSnapshot(_ context.Context, userID, id uuid.UUID) error {
	fake.lastUserID, fake.lastResourceID = userID, id
	return fake.err
}

func TestEstateMutationRoutesMaskForeignResources(t *testing.T) {
	ownerID, foreignID := uuid.New(), uuid.New()
	fake := &fakeEstateMutationService{err: service.ErrEstateNotFound}
	auth := fakePhase5Authorizer{principal: webauth.Principal{UserID: ownerID, Method: "session"}}
	response := httptest.NewRecorder()
	NewEstateMutationRoutes(auth, fake).ServeHTTP(response, httptest.NewRequest(http.MethodDelete, "/estate/snapshots/"+foreignID.String(), nil))
	if response.Code != http.StatusNotFound || fake.lastUserID != ownerID || fake.lastResourceID != foreignID {
		t.Fatalf("status=%d owner=%s resource=%s body=%s", response.Code, fake.lastUserID, fake.lastResourceID, response.Body.String())
	}

	unauthorized := httptest.NewRecorder()
	NewEstateMutationRoutes(fakePhase5Authorizer{writeErr: errMutationScope}, fake).ServeHTTP(unauthorized, httptest.NewRequest(http.MethodPost, "/estate/snapshots", nil))
	if unauthorized.Code != http.StatusForbidden {
		t.Fatalf("scope status=%d body=%s", unauthorized.Code, unauthorized.Body.String())
	}
}

func TestEstateMutationValidationMapsToUnprocessable(t *testing.T) {
	fake := &fakeEstateMutationService{err: errors.Join(service.ErrEstateValidation, errors.New("bad allocation"))}
	auth := fakePhase5Authorizer{principal: webauth.Principal{UserID: uuid.New(), Method: "session"}}
	request := httptest.NewRequest(http.MethodPut, "/estate/residuary", strings.NewReader(`{"beneficiaryId":"`+uuid.NewString()+`","tier":"primary","allocationBps":10001}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewEstateMutationRoutes(auth, fake).ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
