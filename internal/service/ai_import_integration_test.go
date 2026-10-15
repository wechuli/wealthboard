package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	anthropicsdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/firebase/genkit/go/ai"
	"github.com/firebase/genkit/go/genkit"
	"github.com/google/uuid"

	"github.com/wechuli/wealthboard/internal/aiworkflow"
)

// Runs the AI import path end to end: Genkit conversion with a fake model, then
// the draft through the same account-history preview the import page uses.
func TestAIConversionDraftPreviewsAsAccountHistory(t *testing.T) {
	db := openServiceTestDatabase(t)
	ctx := context.Background()
	ownerID, categoryID := uuid.New(), uuid.New()
	seedLedgerOwner(t, ctx, db, ownerID, categoryID, "ai-import-owner-")
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id=$1`, ownerID)
	})
	opened := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	accountID := createLedgerAccount(t, ctx, NewLedgerService(db), ownerID, categoryID, "AI imported history", 0, opened, uuid.New())
	if _, err := db.ExecContext(ctx, `
INSERT INTO ai_provider_settings (id, user_id, provider, base_url, model, max_output_tokens, created_at, updated_at)
VALUES ($1, $2, 'anthropic', 'https://api.anthropic.com', 'test-model', 1200, now(), now())`, uuid.New(), ownerID); err != nil {
		t.Fatalf("seed AI settings: %v", err)
	}

	g := genkit.Init(t.Context())
	genkit.DefineModelAction(g, "anthropic/test-model", &ai.ModelOptions{
		Supports: &ai.ModelSupports{Multiturn: true, SystemRole: true, Output: []string{"text", "json"}, Constrained: ai.ConstrainedSupportAll},
	}, func(context.Context, *ai.ModelRequest, anthropicsdk.MessageNewParams, ai.ModelStreamCallback) (*ai.ModelResponse, error) {
		return &ai.ModelResponse{
			FinishReason: ai.FinishReasonStop,
			Message: ai.NewModelTextMessage(`{"records":[{"collection":"transactions","sourceIds":["source-1"],"fields":[
				{"name":"external_id","value":"stmt-1"},{"name":"type","value":"deposit"},{"name":"amount","value":"24.00"},
				{"name":"date","value":"2026-09-15"},{"name":"description","value":"Salary"},{"name":"notes","value":""},
				{"name":"source","value":"bank statement"}]}],"exclusions":[],"issues":[]}`),
			Usage: &ai.GenerationUsage{InputTokens: 40, OutputTokens: 20},
		}, nil
	})
	conversions := aiworkflow.NewService(aiworkflow.NewPostgresRepository(db), nil, aiworkflow.DefineFlows(g))
	hash, err := conversions.ConfigurationHash(ctx, ownerID, "balance", "KES")
	if err != nil {
		t.Fatal(err)
	}
	draft, err := conversions.Convert(ctx, ownerID, aiworkflow.ConversionRequest{
		Source: aiworkflow.Source{
			Units:    []aiworkflow.SourceUnit{{ID: "source-1", Location: "Page 1", Text: "15 Sep 2026 Salary 24.00"}},
			Warnings: []string{},
		},
		ConfigurationHash: hash,
		Consent:           true,
		APIKey:            "session-provider-key",
		TrackingMode:      "balance",
		Currency:          "KES",
	})
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	response, err := json.Marshal(draft)
	if err != nil {
		t.Fatal(err)
	}
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(response, &shape); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"references", "exclusions", "issues"} {
		if !strings.HasPrefix(string(shape[field]), "[") {
			t.Fatalf("conversion response %s = %s, want an array", field, shape[field])
		}
	}
	if !strings.Contains(string(shape["issues"]), `Removed field \"source\"`) {
		t.Fatalf("issues = %s", shape["issues"])
	}

	preview, err := NewAccountHistoryImportService(db).Preview(ctx, ownerID, accountID, []byte(draft.Content), ImportFormatJSON)
	if err != nil {
		t.Fatalf("preview AI draft: %v\n%s", err, draft.Content)
	}
	if preview.Summary.Ready != 1 || preview.Summary.Failed != 0 || preview.ProjectedBalanceMinor != 2400 {
		t.Fatalf("preview = %+v", preview.Summary)
	}
}
