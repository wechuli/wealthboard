package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	webauth "github.com/wechuli/wealthboard/internal/auth"
	"github.com/wechuli/wealthboard/internal/service"
)

type fakeGoalMutationAuthorizer struct {
	principal webauth.Principal
	err       error
}

func (authorizer fakeGoalMutationAuthorizer) AuthorizePortfolioMutation(*http.Request) (webauth.Principal, error) {
	return authorizer.principal, authorizer.err
}

type fakeGoalMutationService struct {
	lastUserID      uuid.UUID
	lastGoalID      uuid.UUID
	lastMilestoneID uuid.UUID
	goalInput       service.GoalMutationInput
	err             error
}

func (fake *fakeGoalMutationService) CreateGoal(_ context.Context, userID uuid.UUID, input service.GoalMutationInput) (service.GoalMutationResult, error) {
	fake.lastUserID, fake.goalInput = userID, input
	return service.GoalMutationResult{ID: uuid.New()}, fake.err
}

func (fake *fakeGoalMutationService) UpdateGoal(_ context.Context, userID, goalID uuid.UUID, input service.GoalMutationInput) error {
	fake.lastUserID, fake.lastGoalID, fake.goalInput = userID, goalID, input
	return fake.err
}

func (fake *fakeGoalMutationService) SetGoalStatus(_ context.Context, userID, goalID uuid.UUID, _ string) error {
	fake.lastUserID, fake.lastGoalID = userID, goalID
	return fake.err
}

func (fake *fakeGoalMutationService) DeleteGoal(_ context.Context, userID, goalID uuid.UUID) error {
	fake.lastUserID, fake.lastGoalID = userID, goalID
	return fake.err
}

func (fake *fakeGoalMutationService) CreateMilestone(_ context.Context, userID, goalID uuid.UUID, _ service.GoalMilestoneInput) (uuid.UUID, error) {
	fake.lastUserID, fake.lastGoalID = userID, goalID
	return uuid.New(), fake.err
}

func (fake *fakeGoalMutationService) DeleteMilestone(_ context.Context, userID, goalID, milestoneID uuid.UUID) error {
	fake.lastUserID, fake.lastGoalID, fake.lastMilestoneID = userID, goalID, milestoneID
	return fake.err
}

func (fake *fakeGoalMutationService) DismissAlert(_ context.Context, userID, goalID uuid.UUID) error {
	fake.lastUserID, fake.lastGoalID = userID, goalID
	return fake.err
}

func TestGoalMutationCreatePassesOwnerAndIdempotencyKey(t *testing.T) {
	ownerID, requestKey := uuid.New(), uuid.New()
	fake := &fakeGoalMutationService{}
	router := goalMutationRouter(fakeGoalMutationAuthorizer{principal: webauth.Principal{
		UserID: ownerID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}}, fake)
	request := httptest.NewRequest(http.MethodPost, "/goals", strings.NewReader(validGoalJSON()))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", requestKey.String())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated || fake.lastUserID != ownerID {
		t.Fatalf("status=%d owner=%s body=%s", response.Code, fake.lastUserID, response.Body.String())
	}
	if fake.goalInput.IdempotencyKey == nil || *fake.goalInput.IdempotencyKey != requestKey || fake.goalInput.AssumedAnnualReturn != "8.125" {
		t.Fatalf("goal input = %+v", fake.goalInput)
	}
}

func TestGoalMutationMapsAuthorizationAndStrictJSONErrors(t *testing.T) {
	tests := []struct {
		name    string
		authErr error
		body    string
		want    int
	}{
		{name: "authentication", authErr: errMutationUnauthorized, body: validGoalJSON(), want: http.StatusUnauthorized},
		{name: "origin", authErr: errMutationOrigin, body: validGoalJSON(), want: http.StatusForbidden},
		{name: "scope", authErr: errMutationScope, body: validGoalJSON(), want: http.StatusForbidden},
		{name: "unknown field", body: `{"name":"Goal","unexpected":true}`, want: http.StatusBadRequest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fake := &fakeGoalMutationService{}
			request := httptest.NewRequest(http.MethodPost, "/goals", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			goalMutationRouter(fakeGoalMutationAuthorizer{principal: webauth.Principal{UserID: uuid.New()}, err: test.authErr}, fake).ServeHTTP(response, request)
			if response.Code != test.want || fake.lastUserID != uuid.Nil {
				t.Fatalf("status=%d want=%d service owner=%s body=%s", response.Code, test.want, fake.lastUserID, response.Body.String())
			}
		})
	}
}

func TestGoalMutationForeignGoalReturnsNotFoundForSecondUser(t *testing.T) {
	ownerID, secondUserID, goalID := uuid.New(), uuid.New(), uuid.New()
	fake := &fakeGoalMutationService{err: service.ErrGoalMutationNotFound}
	auth := fakeGoalMutationAuthorizer{principal: webauth.Principal{
		UserID: secondUserID, Method: "api_key", Scopes: []webauth.Scope{webauth.ScopePortfolioWrite},
	}}
	request := httptest.NewRequest(http.MethodPatch, "/goals/"+goalID.String()+"/status", strings.NewReader(`{"status":"paused"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	goalMutationRouter(auth, fake).ServeHTTP(response, request)

	if ownerID == secondUserID || response.Code != http.StatusNotFound {
		t.Fatalf("status=%d owner=%s second=%s body=%s", response.Code, ownerID, secondUserID, response.Body.String())
	}
	if fake.lastUserID != secondUserID || fake.lastGoalID != goalID {
		t.Fatalf("service identifiers=%s/%s", fake.lastUserID, fake.lastGoalID)
	}
}

func TestGoalMutationRejectsMismatchedIdempotencyKeys(t *testing.T) {
	fake := &fakeGoalMutationService{}
	bodyKey := uuid.New()
	body := strings.Replace(validGoalJSON(), `"name":"Emergency fund"`, `"idempotencyKey":"`+bodyKey.String()+`","name":"Emergency fund"`, 1)
	request := httptest.NewRequest(http.MethodPost, "/goals", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", uuid.NewString())
	response := httptest.NewRecorder()
	goalMutationRouter(fakeGoalMutationAuthorizer{principal: webauth.Principal{UserID: uuid.New()}}, fake).ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity || fake.lastUserID != uuid.Nil {
		t.Fatalf("status=%d service owner=%s body=%s", response.Code, fake.lastUserID, response.Body.String())
	}
}

func goalMutationRouter(auth goalMutationAuthorizer, mutations goalMutationService) http.Handler {
	router := chi.NewRouter()
	RegisterGoalMutationRoutes(router, NewGoalMutationHandler(auth, mutations))
	return router
}

func validGoalJSON() string {
	return `{"name":"Emergency fund","targetAmount":"10000.00","currentAmount":"0.00","currency":"KES","targetDate":"2027-12-31","icon":"Target","status":"active","priority":1,"assumedAnnualReturn":8.125,"plannedContribution":"500.00","frequency":"monthly","planStartDate":"2026-09-20","planEndDate":""}`
}
