package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/wechuli/wealthboard/internal/operator"
)

func runBackupCommand(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("backup", flag.ContinueOnError)
	flags.SetOutput(stderr)
	filePath := flags.String("file", "", "explicit output path for the PostgreSQL custom-format archive")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("usage: wealthboard backup --file <path>")
	}
	tools := operator.NewPostgresTools(stdout, stderr)
	if err := tools.Backup(ctx, operator.BackupOptions{DatabaseURL: os.Getenv("DATABASE_URL"), FilePath: *filePath}); err != nil {
		return err
	}
	_, err := fmt.Fprintf(stdout, "PostgreSQL backup written to %s\n", *filePath)
	return err
}

func runRestoreCommand(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("restore", flag.ContinueOnError)
	flags.SetOutput(stderr)
	filePath := flags.String("file", "", "explicit path to a PostgreSQL custom-format archive")
	confirm := flags.Bool("confirm-maintenance", false, "confirm the application is stopped for destructive restore")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("usage: wealthboard restore --file <path> --confirm-maintenance")
	}
	tools := operator.NewPostgresTools(stdout, stderr)
	result, err := tools.Restore(ctx, operator.RestoreOptions{
		DatabaseURL: os.Getenv("DATABASE_URL"), FilePath: *filePath, ConfirmMaintenance: *confirm,
	})
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(stdout, "PostgreSQL restore completed; pre-restore safety backup: %s\n", result.SafetyDumpPath)
	return err
}
