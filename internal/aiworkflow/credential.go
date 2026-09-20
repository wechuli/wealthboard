package aiworkflow

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/google/uuid"
)

const credentialVersion = "v1"

type CredentialCodec struct {
	aead cipher.AEAD
}

func NewCredentialCodecFromEnvironment() (*CredentialCodec, error) {
	return NewCredentialCodec(os.Getenv("AI_CREDENTIAL_ENCRYPTION_KEY"))
}

func NewCredentialCodec(encodedKey string) (*CredentialCodec, error) {
	key, err := base64.StdEncoding.Strict().DecodeString(encodedKey)
	if err != nil || len(key) != 32 || base64.StdEncoding.EncodeToString(key) != encodedKey {
		return nil, errors.New("AI_CREDENTIAL_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("initialize AI credential cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("initialize AI credential GCM: %w", err)
	}
	return &CredentialCodec{aead: aead}, nil
}

func (codec *CredentialCodec) Encrypt(userID uuid.UUID, apiKey string) (string, error) {
	value := strings.TrimSpace(apiKey)
	if len(value) < 8 || len(value) > 4096 {
		return "", fmt.Errorf("%w: enter a valid provider API key", ErrInvalidInput)
	}
	nonce := make([]byte, codec.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate AI credential nonce: %w", err)
	}
	sealed := codec.aead.Seal(nil, nonce, []byte(value), credentialAAD(userID))
	tagSize := codec.aead.Overhead()
	ciphertext, tag := sealed[:len(sealed)-tagSize], sealed[len(sealed)-tagSize:]
	return strings.Join([]string{
		credentialVersion,
		base64.RawURLEncoding.EncodeToString(nonce),
		base64.RawURLEncoding.EncodeToString(tag),
		base64.RawURLEncoding.EncodeToString(ciphertext),
	}, "."), nil
}

func (codec *CredentialCodec) Decrypt(userID uuid.UUID, value string) (string, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 4 || parts[0] != credentialVersion {
		return "", errors.New("stored AI credential is invalid")
	}
	nonce, nonceErr := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	tag, tagErr := base64.RawURLEncoding.Strict().DecodeString(parts[2])
	ciphertext, cipherErr := base64.RawURLEncoding.Strict().DecodeString(parts[3])
	if nonceErr != nil || tagErr != nil || cipherErr != nil || len(nonce) != codec.aead.NonceSize() || len(tag) != codec.aead.Overhead() || len(ciphertext) == 0 {
		return "", errors.New("stored AI credential is invalid")
	}
	plaintext, err := codec.aead.Open(nil, nonce, append(ciphertext, tag...), credentialAAD(userID))
	if err != nil {
		return "", errors.New("stored AI credential could not be decrypted")
	}
	return string(plaintext), nil
}

func CredentialHint(apiKey string) string {
	value := strings.TrimSpace(apiKey)
	if len(value) < 4 {
		return ""
	}
	return "..." + value[len(value)-4:]
}

func credentialAAD(userID uuid.UUID) []byte {
	return []byte("wealthboard-ai-credential:" + credentialVersion + ":" + userID.String())
}
