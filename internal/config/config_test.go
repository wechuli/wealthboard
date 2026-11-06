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

func TestLoadMCPSettings(t *testing.T) {
	env := func(values map[string]string) func(string) string {
		return func(key string) string {
			if key == "DATABASE_URL" {
				return "postgres://localhost/wealthboard"
			}
			return values[key]
		}
	}
	cfg, err := load(env(nil))
	if err != nil || !cfg.MCP.Enabled || cfg.MCP.RequestsPerMinute != 120 {
		t.Fatalf("default MCP = %+v, error %v", cfg.MCP, err)
	}
	cfg, err = load(env(map[string]string{"MCP_ENABLED": "false", "MCP_REQUESTS_PER_MINUTE": "30"}))
	if err != nil || cfg.MCP.Enabled || cfg.MCP.RequestsPerMinute != 30 {
		t.Fatalf("configured MCP = %+v, error %v", cfg.MCP, err)
	}
	for name, values := range map[string]map[string]string{
		"enabled spelling": {"MCP_ENABLED": "yes"},
		"zero limit":       {"MCP_REQUESTS_PER_MINUTE": "0"},
		"huge limit":       {"MCP_REQUESTS_PER_MINUTE": "10001"},
		"text limit":       {"MCP_REQUESTS_PER_MINUTE": "many"},
	} {
		if _, err := load(env(values)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}
