package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/wechuli/wealthboard/internal/config"
	"github.com/wechuli/wealthboard/internal/database"
	"github.com/wechuli/wealthboard/internal/service"
)

func runSeedDemoCommand(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("seed-demo", flag.ContinueOnError)
	flags.SetOutput(stderr)
	username := flags.String("username", "", "existing username that will receive fictional demo data")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *username == "" {
		return errors.New("usage: wealthboard seed-demo --username <existing-username>")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := database.Open(ctx, cfg.Database)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := service.NewDemoSeeder(db).Seed(ctx, *username, os.Getenv("DEMO_DATA") == "true"); err != nil {
		return err
	}
	_, err = fmt.Fprintf(stdout, "Fictional Wealthboard demo data seeded for %s.\n", *username)
	return err
}
