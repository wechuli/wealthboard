package static

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSPAServesAssetsAndFallback(t *testing.T) {
	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, "assets"), 0o755); err != nil {
		t.Fatalf("create assets: %v", err)
	}
	if err := os.WriteFile(filepath.Join(directory, "index.html"), []byte("<main>app</main>"), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}
	if err := os.WriteFile(filepath.Join(directory, "assets", "app-123.js"), []byte("export{}"), 0o644); err != nil {
		t.Fatalf("write asset: %v", err)
	}
	spa, err := NewSPA(directory)
	if err != nil {
		t.Fatalf("create SPA: %v", err)
	}

	asset := httptest.NewRecorder()
	spa.ServeHTTP(asset, httptest.NewRequest(http.MethodGet, "/assets/app-123.js", nil))
	if asset.Code != http.StatusOK || !strings.Contains(asset.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("asset status = %d, cache = %q", asset.Code, asset.Header().Get("Cache-Control"))
	}

	fallback := httptest.NewRecorder()
	spa.ServeHTTP(fallback, httptest.NewRequest(http.MethodGet, "/accounts/example", nil))
	if fallback.Code != http.StatusOK || fallback.Body.String() != "<main>app</main>" || fallback.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("fallback = %d %q %q", fallback.Code, fallback.Body.String(), fallback.Header().Get("Cache-Control"))
	}

	missingAsset := httptest.NewRecorder()
	spa.ServeHTTP(missingAsset, httptest.NewRequest(http.MethodGet, "/assets/missing.js", nil))
	if missingAsset.Code != http.StatusNotFound {
		t.Fatalf("missing asset status = %d, want 404", missingAsset.Code)
	}
}
