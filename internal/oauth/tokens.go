package oauth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net"
	"net/url"
	"regexp"
	"strings"
)

const (
	accessTokenPrefix  = "wbo_at_"
	refreshTokenPrefix = "wbo_rt_"
	clientIDPrefix     = "wbc_"
	clientSecretPrefix = "wbcs_"

	maxRedirectURIs      = 10
	maxRedirectURILength = 2000
)

var (
	codeChallengePattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)
	codeVerifierPattern  = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)
	customSchemePattern  = regexp.MustCompile(`^[a-z][a-z0-9+.-]*$`)
	blockedSchemes       = map[string]bool{"javascript": true, "data": true, "file": true, "vbscript": true, "about": true, "blob": true, "ftp": true, "ws": true, "wss": true}
)

// IsAccessToken reports whether a bearer token has the OAuth access-token shape,
// so callers can route it here instead of to API-key verification.
func IsAccessToken(token string) bool { return strings.HasPrefix(token, accessTokenPrefix) }

func randomToken(prefix string, size int) string {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		panic("read random bytes: " + err.Error())
	}
	return prefix + base64.RawURLEncoding.EncodeToString(buffer)
}

func hashToken(token string) []byte {
	digest := sha256.Sum256([]byte(token))
	return digest[:]
}

func sameHash(stored []byte, candidate string) bool {
	computed := hashToken(candidate)
	return len(stored) == len(computed) && subtle.ConstantTimeCompare(stored, computed) == 1
}

// verifyPKCE checks an S256 code verifier against the stored challenge (RFC 7636).
func verifyPKCE(challenge, verifier string) bool {
	if !codeVerifierPattern.MatchString(verifier) {
		return false
	}
	digest := sha256.Sum256([]byte(verifier))
	computed := base64.RawURLEncoding.EncodeToString(digest[:])
	return subtle.ConstantTimeCompare([]byte(computed), []byte(challenge)) == 1
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// validateRedirectURI accepts HTTPS URIs, HTTP loopback URIs for native apps, and
// private-use schemes such as cursor:// (RFC 8252), never fragments or credentials.
func validateRedirectURI(value string) bool {
	if value == "" || len(value) > maxRedirectURILength || strings.ContainsAny(value, " \t\r\n") {
		return false
	}
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.Fragment != "" || strings.Contains(value, "#") || parsed.User != nil {
		return false
	}
	switch parsed.Scheme {
	case "https":
		return parsed.Hostname() != ""
	case "http":
		return isLoopbackHost(parsed.Hostname())
	default:
		return customSchemePattern.MatchString(parsed.Scheme) && !blockedSchemes[parsed.Scheme]
	}
}

// redirectMatches compares a requested redirect URI with a registered one. Loopback
// HTTP URIs match on any port because native apps choose a free port at run time.
func redirectMatches(registered, requested string) bool {
	if registered == requested {
		return true
	}
	want, err := url.Parse(registered)
	if err != nil || want.Scheme != "http" || !isLoopbackHost(want.Hostname()) {
		return false
	}
	got, err := url.Parse(requested)
	if err != nil || got.Scheme != "http" || got.Fragment != "" || got.User != nil {
		return false
	}
	return got.Hostname() == want.Hostname() && got.Path == want.Path && got.RawQuery == want.RawQuery
}

// redirectDisplay is what the consent screen shows as the destination.
func redirectDisplay(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return value
	}
	return parsed.Scheme + "://" + parsed.Host
}

// withQuery adds parameters to a redirect URI, keeping any query it already has.
func withQuery(target string, values url.Values) string {
	parsed, err := url.Parse(target)
	if err != nil {
		return target
	}
	query := parsed.Query()
	for key, list := range values {
		for _, value := range list {
			if value != "" {
				query.Set(key, value)
			}
		}
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

// cleanText trims a client-supplied display string and removes control characters.
func cleanText(value string, limit int) string {
	value = strings.Map(func(character rune) rune {
		if character < 0x20 || character == 0x7f {
			return -1
		}
		return character
	}, strings.TrimSpace(value))
	if len([]rune(value)) > limit {
		value = string([]rune(value)[:limit])
	}
	return value
}
