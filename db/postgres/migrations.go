package postgres

import "embed"

// Migrations contains the embedded PostgreSQL Goose migration history.
//
//go:embed migrations/*.sql
var Migrations embed.FS
