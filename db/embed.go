// Package db contains immutable migration provenance and the Go baseline.
package db

import "embed"

// Assets retains the original Drizzle history in place while Next.js still runs.
//
//go:embed migrations/*.sql migrations/meta/*.json goose/*.sql schema.sql
var Assets embed.FS
