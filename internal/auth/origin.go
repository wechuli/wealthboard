package auth

import (
	"fmt"
	"net/url"
)

func TrustedOrigin(appURL string) (string, error) {
	parsed, err := url.Parse(appURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("APP_URL must be an absolute URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return "", fmt.Errorf("APP_URL must contain only a scheme and host")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && parsed.Hostname() == "localhost") && !(parsed.Scheme == "http" && parsed.Hostname() == "127.0.0.1") {
		return "", fmt.Errorf("APP_URL must use HTTPS outside local development")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}
