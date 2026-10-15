package aiworkflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	MaxSourceBytes = 5 << 20
	MaxTextBytes   = 64 << 10
	MaxSourceUnits = 1000
	MaxResponse    = 8 << 20
)

var (
	ErrNotConfigured = errors.New("configure an AI provider before continuing")
	ErrCredential    = errors.New("enter an API key or store one in AI settings")
	ErrRateLimited   = errors.New("AI request rate limit reached")
	ErrBudget        = errors.New("monthly AI token limit reached")
	ErrInvalidInput  = errors.New("invalid AI workflow input")

	ErrProvider            = errors.New("the AI provider could not complete the request")
	ErrProviderCredential  = fmt.Errorf("%w: the provider rejected the API key", ErrProvider)
	ErrProviderModel       = fmt.Errorf("%w: the provider does not recognize the selected model", ErrProvider)
	ErrProviderRateLimited = fmt.Errorf("%w: the provider rate limited the request", ErrProvider)
	ErrProviderOutput      = fmt.Errorf("%w: provider returned a result that does not match the required structure", ErrInvalidInput)
)

type Provider string

const (
	ProviderOpenAI    Provider = "openai"
	ProviderDeepSeek  Provider = "deepseek"
	ProviderAnthropic Provider = "anthropic"
)

// BaseURL is the fixed API endpoint for a supported provider, or "" for an
// unsupported one.
func (provider Provider) BaseURL() string {
	switch provider {
	case ProviderOpenAI:
		return "https://api.openai.com/v1"
	case ProviderDeepSeek:
		return "https://api.deepseek.com"
	case ProviderAnthropic:
		return "https://api.anthropic.com"
	default:
		return ""
	}
}

type SettingsInput struct {
	Provider            Provider `json:"provider"`
	Model               string   `json:"model"`
	IncludeExactAmounts bool     `json:"includeExactAmounts"`
	IncludeAccountNames bool     `json:"includeAccountNames"`
	MonthlyTokenLimit   int      `json:"monthlyTokenLimit"`
	MaxOutputTokens     int      `json:"maxOutputTokens"`
}

type Settings struct {
	SettingsInput
	BaseURL         string    `json:"baseUrl"`
	HasStoredAPIKey bool      `json:"hasStoredApiKey"`
	APIKeyHint      *string   `json:"apiKeyHint"`
	UpdatedAt       time.Time `json:"updatedAt"`
	EncryptedAPIKey string    `json:"-"`
}

type UsageEvent struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	Provider      Provider
	EndpointHost  string
	Model         string
	RequestType   string
	Status        string
	BillingMonth  string
	ChargedTokens int
	InputTokens   *int
	OutputTokens  *int
	LatencyMS     *int
	ErrorCode     *string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type Reservation struct {
	ID             uuid.UUID
	ReservedTokens int
}

type CompleteUsage struct {
	Status                   string
	InputTokens              *int
	OutputTokens             *int
	LatencyMS                int
	ErrorCode                string
	RetainReservationOnError bool
}

type Repository interface {
	GetSettings(context.Context, uuid.UUID) (*Settings, error)
	SaveSettings(context.Context, uuid.UUID, SettingsInput) (*Settings, error)
	SaveCredential(context.Context, uuid.UUID, string, string) error
	DeleteCredential(context.Context, uuid.UUID) error
	DeleteSettings(context.Context, uuid.UUID) error
	ClearUsage(context.Context, uuid.UUID) (int64, error)
	ReserveUsage(context.Context, uuid.UUID, int, string, time.Time) (Reservation, error)
	CompleteUsage(context.Context, uuid.UUID, uuid.UUID, CompleteUsage, time.Time) error
}

type ReviewRequest struct {
	Period              string          `json:"period"`
	Focus               string          `json:"focus"`
	IncludeExactAmounts bool            `json:"includeExactAmounts"`
	IncludeAccountNames bool            `json:"includeAccountNames"`
	APIKey              string          `json:"apiKey,omitempty"`
	Snapshot            json.RawMessage `json:"snapshot"`
}

type ReviewFinding struct {
	ID           string   `json:"id" jsonschema_description:"Short stable identifier for the finding."`
	Category     string   `json:"category" jsonschema:"enum=data-quality,enum=allocation,enum=liquidity,enum=cash-flow,enum=goals,enum=general"`
	Severity     string   `json:"severity" jsonschema:"enum=info,enum=attention,enum=high"`
	Confidence   string   `json:"confidence" jsonschema:"enum=low,enum=medium,enum=high"`
	Title        string   `json:"title"`
	Explanation  string   `json:"explanation"`
	EvidenceRefs []string `json:"evidenceRefs" jsonschema_description:"One to six exact evidenceId values copied from the snapshot."`
}

// ReviewContent is the structured output the portfolio review flow asks the
// model for.
type ReviewContent struct {
	Headline           string          `json:"headline"`
	ExecutiveSummary   string          `json:"executiveSummary"`
	DataQuality        []ReviewFinding `json:"dataQuality"`
	Strengths          []ReviewFinding `json:"strengths"`
	AttentionItems     []ReviewFinding `json:"attentionItems"`
	GoalObservations   []ReviewFinding `json:"goalObservations"`
	Questions          []string        `json:"questions"`
	PossibleNextChecks []string        `json:"possibleNextChecks" jsonschema_description:"Questions to investigate, never financial instructions."`
	Limitations        []string        `json:"limitations" jsonschema_description:"At least one limitation of this analysis."`
}

type Review struct {
	SchemaVersion int `json:"schemaVersion"`
	ReviewContent
}

type Usage struct {
	InputTokens  *int
	OutputTokens *int
}

type SourceUnit struct {
	ID       string `json:"id"`
	Location string `json:"location"`
	Text     string `json:"text"`
}

type Source struct {
	Units    []SourceUnit `json:"units"`
	Warnings []string     `json:"warnings"`
}

type ExtractionField struct {
	Name  string `json:"name" jsonschema:"enum=external_id,enum=type,enum=amount,enum=date,enum=description,enum=notes,enum=name,enum=symbol,enum=identifier_type,enum=identifier,enum=exchange_mic,enum=asset_type,enum=quote_currency,enum=instrument_external_id,enum=quantity,enum=unit_price,enum=trade_currency,enum=fee_amount,enum=fee_currency,enum=cash_effect,enum=applied_exchange_rate,enum=opening_cost_basis,enum=event_group_id,enum=trade_date,enum=settlement_date,enum=price,enum=effective_date,enum=source,enum=provenance"`
	Value string `json:"value" jsonschema_description:"Value copied from the source, or an empty string when the source has none."`
}

type ExtractionRecord struct {
	Collection string            `json:"collection" jsonschema:"enum=transactions,enum=instruments,enum=position_events,enum=cash_transactions,enum=prices"`
	SourceIDs  []string          `json:"sourceIds" jsonschema_description:"Source section IDs this record was derived from."`
	Fields     []ExtractionField `json:"fields"`
}

type Exclusion struct {
	SourceID string `json:"sourceId"`
	Reason   string `json:"reason"`
}

// Extraction is the structured output the import conversion flow asks the
// model for.
type Extraction struct {
	Records    []ExtractionRecord `json:"records"`
	Exclusions []Exclusion        `json:"exclusions"`
	Issues     []string           `json:"issues"`
}

type ConversionRequest struct {
	Source            Source `json:"source"`
	ConfigurationHash string `json:"configurationHash"`
	Consent           bool   `json:"consent"`
	APIKey            string `json:"apiKey,omitempty"`
	TrackingMode      string `json:"trackingMode"`
	Currency          string `json:"currency"`
}

type DraftReference struct {
	Collection string   `json:"collection"`
	Row        int      `json:"row"`
	SourceIDs  []string `json:"sourceIds"`
}

type ConversionDraft struct {
	Content    string           `json:"content"`
	References []DraftReference `json:"references"`
	Exclusions []Exclusion      `json:"exclusions"`
	Issues     []string         `json:"issues"`
}
