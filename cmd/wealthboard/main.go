package main

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/wechuli/wealthboard/internal/database"
)

func main() {
	os.Exit(run(context.Background(), os.Args[1:], os.Stdout, os.Stderr))
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	usage := func() int {
		fmt.Fprintln(stderr, "usage: wealthboard migrate | migrate-status | migrate-adopt --confirm-offline")
		return 2
	}
	if len(args) == 0 {
		return usage()
	}
	config := database.ConfigFromEnv()
	var err error
	switch args[0] {
	case "migrate":
		if len(args) != 1 {
			return usage()
		}
		err = database.Migrate(ctx, config)
		if err == nil {
			fmt.Fprintln(stdout, "Goose baseline is current.")
		}
	case "migrate-status":
		if len(args) != 1 {
			return usage()
		}
		var status database.MigrationStatus
		status, err = database.Status(ctx, config)
		if err == nil {
			fmt.Fprintf(stdout, "state=%s goose=%d legacy=%d\n", status.State, status.GooseVersion, status.LegacyMigrations)
		}
	case "migrate-adopt":
		if len(args) > 2 || (len(args) == 2 && args[1] != "--confirm-offline") {
			return usage()
		}
		var result database.AdoptionResult
		result, err = database.Adopt(ctx, config, len(args) == 2)
		if err == nil {
			if result.AlreadyAdopted {
				fmt.Fprintln(stdout, "Goose baseline already recorded.")
			} else {
				fmt.Fprintf(stdout, "Adoption complete. Pre-adoption backup: %s\n", result.BackupPath)
			}
		}
	default:
		return usage()
	}
	if err != nil {
		fmt.Fprintln(stderr, database.OperatorError(err))
		return 1
	}
	return 0
}
