package config

import "testing"

func TestLoadRequiresDatabaseURL(t *testing.T) {
	_, err := load(func(string) string { return "" })
	if err == nil {
		t.Fatal("expected missing DATABASE_URL to fail")
	}
}

func TestLoadUsesDefaults(t *testing.T) {
	cfg, err := load(func(key string) string {
		if key == "DATABASE_URL" {
			return "postgres://wealthboard:secret@localhost/wealthboard"
		}
		return ""
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.HTTP.Address != ":3000" {
		t.Fatalf("address = %q, want :3000", cfg.HTTP.Address)
	}
	if cfg.Database.MaxOpenConns != 10 {
		t.Fatalf("max open connections = %d, want 10", cfg.Database.MaxOpenConns)
	}
}

func TestLoadRejectsInvalidPort(t *testing.T) {
	_, err := load(func(key string) string {
		switch key {
		case "DATABASE_URL":
			return "postgres://wealthboard:secret@localhost/wealthboard"
		case "PORT":
			return "70000"
		default:
			return ""
		}
	})
	if err == nil {
		t.Fatal("expected invalid PORT to fail")
	}
}
