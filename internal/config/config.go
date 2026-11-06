package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

const (
	defaultPort              = 3000
	defaultMaxOpenConns      = 10
	defaultMaxIdleConns      = 5
	defaultConnMaxLifetime   = 30 * time.Minute
	defaultConnMaxIdleTime   = 5 * time.Minute
	defaultReadHeaderTimeout = 5 * time.Second
	defaultReadTimeout       = 15 * time.Second
	defaultWriteTimeout      = 30 * time.Second
	defaultIdleTimeout       = 60 * time.Second
	defaultShutdownTimeout   = 10 * time.Second
	defaultMCPRequestsPerMin = 120
	maxMCPRequestsPerMin     = 10_000
)

type Config struct {
	HTTP     HTTP
	Database Database
	MCP      MCP
}

// MCP configures the read-only Model Context Protocol endpoint for AI assistants.
type MCP struct {
	Enabled           bool
	RequestsPerMinute int
}

type HTTP struct {
	Address           string
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
}

type Database struct {
	URL             string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration
	PingTimeout     time.Duration
}

func Load() (Config, error) {
	return load(os.Getenv)
}

func load(getenv func(string) string) (Config, error) {
	databaseURL := getenv("DATABASE_URL")
	if databaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}

	port := defaultPort
	if value := getenv("PORT"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 65535 {
			return Config{}, fmt.Errorf("PORT must be an integer between 1 and 65535")
		}
		port = parsed
	}

	mcp := MCP{Enabled: true, RequestsPerMinute: defaultMCPRequestsPerMin}
	switch getenv("MCP_ENABLED") {
	case "", "true":
	case "false":
		mcp.Enabled = false
	default:
		return Config{}, errors.New("MCP_ENABLED must be true or false")
	}
	if value := getenv("MCP_REQUESTS_PER_MINUTE"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > maxMCPRequestsPerMin {
			return Config{}, fmt.Errorf("MCP_REQUESTS_PER_MINUTE must be an integer between 1 and %d", maxMCPRequestsPerMin)
		}
		mcp.RequestsPerMinute = parsed
	}

	return Config{
		MCP: mcp,
		HTTP: HTTP{
			Address:           fmt.Sprintf(":%d", port),
			ReadHeaderTimeout: defaultReadHeaderTimeout,
			ReadTimeout:       defaultReadTimeout,
			WriteTimeout:      defaultWriteTimeout,
			IdleTimeout:       defaultIdleTimeout,
			ShutdownTimeout:   defaultShutdownTimeout,
		},
		Database: Database{
			URL:             databaseURL,
			MaxOpenConns:    defaultMaxOpenConns,
			MaxIdleConns:    defaultMaxIdleConns,
			ConnMaxLifetime: defaultConnMaxLifetime,
			ConnMaxIdleTime: defaultConnMaxIdleTime,
			PingTimeout:     5 * time.Second,
		},
	}, nil
}
