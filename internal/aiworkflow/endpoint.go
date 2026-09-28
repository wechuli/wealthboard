package aiworkflow

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

const (
	openAIBaseURL   = "https://api.openai.com/v1"
	deepSeekBaseURL = "https://api.deepseek.com"
)

type IPResolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type EndpointPolicy struct {
	allowed  map[string]struct{}
	resolver IPResolver
}

func NewEndpointPolicyFromEnvironment(resolver IPResolver) (*EndpointPolicy, error) {
	return NewEndpointPolicy(strings.Split(os.Getenv("AI_ALLOWED_ENDPOINTS"), ","), resolver)
}

func NewEndpointPolicy(allowed []string, resolver IPResolver) (*EndpointPolicy, error) {
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	policy := &EndpointPolicy{allowed: make(map[string]struct{}), resolver: resolver}
	for _, value := range allowed {
		if strings.TrimSpace(value) == "" {
			continue
		}
		normalized, err := normalizeEndpoint(value)
		if err != nil {
			return nil, err
		}
		policy.allowed[normalized] = struct{}{}
	}
	return policy, nil
}

func (policy *EndpointPolicy) Resolve(ctx context.Context, provider Provider, requested string) (string, error) {
	value := requested
	switch provider {
	case ProviderOpenAI:
		value = openAIBaseURL
	case ProviderDeepSeek:
		value = deepSeekBaseURL
	case ProviderCustom:
		if strings.TrimSpace(value) == "" {
			return "", fmt.Errorf("%w: enter an operator-approved endpoint", ErrInvalidInput)
		}
	default:
		return "", fmt.Errorf("%w: unsupported provider", ErrInvalidInput)
	}
	normalized, err := normalizeEndpoint(value)
	if err != nil {
		return "", err
	}
	if provider == ProviderCustom {
		if _, ok := policy.allowed[normalized]; !ok {
			return "", fmt.Errorf("%w: endpoint is not approved by the operator", ErrInvalidInput)
		}
	}
	parsed, _ := url.Parse(normalized)
	addresses, err := policy.resolver.LookupIPAddr(ctx, parsed.Hostname())
	if err != nil || len(addresses) == 0 {
		return "", fmt.Errorf("%w: endpoint host could not be resolved", ErrInvalidInput)
	}
	for _, address := range addresses {
		if blockedProviderIP(address.IP) {
			return "", fmt.Errorf("%w: endpoint resolves to a private or local address", ErrInvalidInput)
		}
	}
	return normalized, nil
}

func normalizeEndpoint(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return "", fmt.Errorf("%w: AI endpoint must use HTTP or HTTPS", ErrInvalidInput)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("%w: AI endpoint cannot contain credentials, query parameters, or fragments", ErrInvalidInput)
	}
	parsed.Path = strings.TrimRight(parsed.EscapedPath(), "/")
	parsed.RawPath = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func blockedProviderIP(ip net.IP) bool {
	if ip == nil || ip.IsUnspecified() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	if ipv4 := ip.To4(); ipv4 != nil {
		return ipv4[0] == 0 || ipv4[0] >= 224 || (ipv4[0] == 100 && ipv4[1]&0xc0 == 64) || (ipv4[0] == 192 && ipv4[1] == 0 && ipv4[2] == 0)
	}
	return ip.IsInterfaceLocalMulticast()
}
