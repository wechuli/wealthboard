package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const SessionCookieName = "wealthboard_session"

type Session struct {
	UserID    uuid.UUID
	Version   int
	CSRFToken string
}

type sessionClaims struct {
	Version int    `json:"version"`
	CSRF    string `json:"csrf,omitempty"`
	jwt.RegisteredClaims
}

type SessionManager struct {
	secret        []byte
	secureCookies bool
}

func NewSessionManager(secret string, secureCookies bool) (*SessionManager, error) {
	if len(secret) < 32 {
		return nil, errors.New("SESSION_SECRET must contain at least 32 characters")
	}
	return &SessionManager{secret: []byte(secret), secureCookies: secureCookies}, nil
}

func (manager *SessionManager) Sign(session Session, issuedAt, expiresAt time.Time) (string, error) {
	if session.UserID == uuid.Nil || session.Version < 1 || !expiresAt.After(issuedAt) {
		return "", errors.New("invalid session")
	}

	claims := sessionClaims{
		Version: session.Version,
		CSRF:    session.CSRFToken,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   session.UserID.String(),
			IssuedAt:  jwt.NewNumericDate(issuedAt.UTC()),
			ExpiresAt: jwt.NewNumericDate(expiresAt.UTC()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(manager.secret)
}

func (manager *SessionManager) Verify(rawToken string, now time.Time) (Session, error) {
	claims := &sessionClaims{}
	token, err := jwt.ParseWithClaims(
		rawToken,
		claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected signing method")
			}
			return manager.secret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithTimeFunc(func() time.Time { return now }),
	)
	if err != nil || !token.Valid || claims.Version < 1 {
		return Session{}, errors.New("invalid session token")
	}

	userID, err := uuid.Parse(claims.Subject)
	if err != nil || userID == uuid.Nil {
		return Session{}, errors.New("invalid session subject")
	}
	return Session{UserID: userID, Version: claims.Version, CSRFToken: claims.CSRF}, nil
}

func NewCSRFToken() (string, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("generate CSRF token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(random), nil
}

func VerifyCSRF(expected, presented string) bool {
	if expected == "" || presented == "" || len(expected) != len(presented) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(presented)) == 1
}

func (manager *SessionManager) Cookie(token string, expiresAt time.Time) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt.UTC(),
		HttpOnly: true,
		Secure:   manager.secureCookies,
		SameSite: http.SameSiteStrictMode,
	}
}

func (manager *SessionManager) ExpiredCookie() *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Path:     "/",
		Expires:  time.Unix(0, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   manager.secureCookies,
		SameSite: http.SameSiteStrictMode,
	}
}
