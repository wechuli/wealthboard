package oauth

import (
	"net/url"
	"testing"
)

func TestRedirectURIRules(t *testing.T) {
	for value, want := range map[string]bool{
		"https://claude.ai/api/mcp/auth_callback":               true,
		"https://chatgpt.com/connector_platform_oauth_redirect": true,
		"http://localhost:33418/callback":                       true,
		"http://127.0.0.1/callback":                             true,
		"http://[::1]:8080/cb":                                  true,
		"cursor://anysphere.cursor-retrieval/oauth/callback":    true,
		"http://evil.example/callback":                          false,
		"https://claude.ai/cb#fragment":                         false,
		"https://user:pass@claude.ai/cb":                        false,
		"javascript://alert(1)":                                 false,
		"data:text/html,hi":                                     false,
		"file:///etc/passwd":                                    false,
		"/relative/callback":                                    false,
		"https:///no-host":                                      false,
		"":                                                      false,
	} {
		if got := validateRedirectURI(value); got != want {
			t.Errorf("validateRedirectURI(%q) = %v, want %v", value, got, want)
		}
	}
}

func TestLoopbackRedirectsMatchOnAnyPort(t *testing.T) {
	for _, test := range []struct {
		registered, requested string
		want                  bool
	}{
		{"https://claude.ai/cb", "https://claude.ai/cb", true},
		{"https://claude.ai/cb", "https://claude.ai/cb?x=1", false},
		{"http://localhost:33418/callback", "http://localhost:51234/callback", true},
		{"http://127.0.0.1/callback", "http://127.0.0.1:9000/callback", true},
		{"http://localhost:33418/callback", "http://127.0.0.1:33418/callback", false},
		{"http://localhost:33418/callback", "http://localhost:33418/other", false},
		{"http://localhost/callback", "http://localhost.evil.example/callback", false},
	} {
		if got := redirectMatches(test.registered, test.requested); got != test.want {
			t.Errorf("redirectMatches(%q, %q) = %v, want %v", test.registered, test.requested, got, test.want)
		}
	}
}

func TestScopeAndPKCE(t *testing.T) {
	for value, want := range map[string]string{
		"": "portfolio:read", "portfolio:read": "portfolio:read", "portfolio:read offline_access": "portfolio:read",
		"portfolio:write": "portfolio:read portfolio:write", "offline_access portfolio:write portfolio:read": "portfolio:read portfolio:write",
		"openid": "", "portfolio:read portfolio:admin": "",
	} {
		if got, ok := normalizeScope(value); got != want || ok != (want != "") {
			t.Errorf("normalizeScope(%q) = %q, %v, want %q", value, got, ok, want)
		}
	}
	for _, test := range []struct {
		requested, level string
		allow            bool
		want             string
	}{
		{"portfolio:read portfolio:write", DataLevelDetailed, true, "portfolio:read portfolio:write"},
		{"portfolio:read portfolio:write", DataLevelDetailed, false, "portfolio:read"},
		{"portfolio:read portfolio:write", DataLevelSummary, false, "portfolio:read"},
		{"portfolio:read portfolio:write", DataLevelSummary, true, ""},
		{"portfolio:read", DataLevelDetailed, true, ""},
	} {
		got, err := grantedScope(test.requested, test.level, test.allow)
		if got != test.want || (err != nil) != (test.want == "") {
			t.Errorf("grantedScope(%q, %s, %v) = %q, %v", test.requested, test.level, test.allow, got, err)
		}
	}
	// RFC 7636 appendix B.
	verifier, challenge := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	if !verifyPKCE(challenge, verifier) || verifyPKCE(challenge, verifier+"x") || verifyPKCE(challenge, "short") {
		t.Fatal("PKCE verification is wrong")
	}
}

func TestWithQueryKeepsExistingParameters(t *testing.T) {
	got := withQuery("https://client.example/cb?tenant=a", url.Values{"code": {"c"}, "state": {""}})
	parsed, _ := url.Parse(got)
	if parsed.Query().Get("tenant") != "a" || parsed.Query().Get("code") != "c" || parsed.Query().Has("state") {
		t.Fatalf("withQuery = %s", got)
	}
}
