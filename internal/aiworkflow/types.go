package aiworkflow

import (
	"context"
	"encoding/json"
	"errors"
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
)

type Provider string

const (
	ProviderOpenAI   Provider = "openai"
	ProviderDeepSeek Provider = "deepseek"
	ProviderCustom   Provider = "custom"
)

type SettingsInput struct {
	Provider            Provider `json:"provider"`
	BaseURL             string   `json:"baseUrl"`
	Model               string   `json:"model"`
	IncludeExactAmounts bool     `json:"includeExactAmounts"`
	IncludeAccountNames bool     `json:"includeAccountNames"`
	MonthlyTokenLimit   int      `json:"monthlyTokenLimit"`
	MaxOutputTokens     int      `json:"maxOutputTokens"`
}

type Settings struct {
	SettingsInput
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
	ID           string   `json:"id"`
	Category     string   `json:"category"`
	Severity     string   `json:"severity"`
	Confidence   string   `json:"confidence"`
	Title        string   `json:"title"`
	Explanation  string   `json:"explanation"`
	EvidenceRefs []string `json:"evidenceRefs"`
}

type Review struct {
	SchemaVersion      int             `json:"schemaVersion"`
	Headline           string          `json:"headline"`
	ExecutiveSummary   string          `json:"executiveSummary"`
	DataQuality        []ReviewFinding `json:"dataQuality"`
	Strengths          []ReviewFinding `json:"strengths"`
	AttentionItems     []ReviewFinding `json:"attentionItems"`
	GoalObservations   []ReviewFinding `json:"goalObservations"`
	Questions          []string        `json:"questions"`
	PossibleNextChecks []string        `json:"possibleNextChecks"`
	Limitations        []string        `json:"limitations"`
}

type ProviderCall struct {
	Provider        Provider
	BaseURL         string
	APIKey          string
	Model           string
	MaxOutputTokens int
	Prompt          string
	ResponseSchema  json.RawMessage
}

type ProviderResult struct {
	Content      json.RawMessage
	InputTokens  *int
	OutputTokens *int
	RequestID    string
}

type Transport interface {
	Call(context.Context, ProviderCall) (ProviderResult, error)
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
	Name  string  `json:"name"`
	Value *string `json:"value"`
}

type ExtractionRecord struct {
	Collection string            `json:"collection"`
	SourceIDs  []string          `json:"sourceIds"`
	Fields     []ExtractionField `json:"fields"`
}

type Exclusion struct {
	SourceID string `json:"sourceId"`
	Reason   string `json:"reason"`
}

type Extraction struct {
	SchemaVersion  int                `json:"schemaVersion"`
	SourceCurrency *string            `json:"sourceCurrency"`
	Records        []ExtractionRecord `json:"records"`
	Exclusions     []Exclusion        `json:"exclusions"`
	Issues         []string           `json:"issues"`
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
