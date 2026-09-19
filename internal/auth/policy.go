package auth

import (
	"fmt"
	"strings"
)

type Method string

const (
	MethodLocal Method = "local"
	MethodOIDC  Method = "oidc"
)

type Policy struct {
	Methods      []Method
	LocalEnabled bool
	OIDCEnabled  bool
}

func ParsePolicy(value string) (Policy, error) {
	if value == "" {
		value = string(MethodLocal)
	}

	parts := strings.Split(value, ",")
	methods := make([]Method, 0, len(parts))
	seen := make(map[Method]bool, len(parts))
	for _, part := range parts {
		method := Method(strings.TrimSpace(part))
		if method != MethodLocal && method != MethodOIDC {
			return Policy{}, fmt.Errorf("AUTH_METHODS must be local, oidc, or local,oidc")
		}
		if seen[method] {
			return Policy{}, fmt.Errorf("AUTH_METHODS must not contain duplicates")
		}
		seen[method] = true
		methods = append(methods, method)
	}

	if len(methods) == 2 && (methods[0] != MethodLocal || methods[1] != MethodOIDC) {
		return Policy{}, fmt.Errorf("AUTH_METHODS must be local, oidc, or local,oidc")
	}

	return Policy{
		Methods:      methods,
		LocalEnabled: seen[MethodLocal],
		OIDCEnabled:  seen[MethodOIDC],
	}, nil
}
