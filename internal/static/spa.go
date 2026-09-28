package static

import (
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"strings"
)

type SPA struct {
	files fs.FS
	index []byte
}

func NewSPA(directory string) (*SPA, error) {
	files := os.DirFS(directory)
	index, err := fs.ReadFile(files, "index.html")
	if err != nil {
		return nil, errors.New("Vite build is unavailable; run npm --prefix web run build")
	}
	return &SPA{files: files, index: index}, nil
}

func (spa *SPA) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		http.Error(response, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	requested := strings.TrimPrefix(path.Clean("/"+request.URL.Path), "/")
	if requested != "." && requested != "" {
		contents, err := fs.ReadFile(spa.files, requested)
		if err == nil {
			if mediaType := mime.TypeByExtension(path.Ext(requested)); mediaType != "" {
				response.Header().Set("Content-Type", mediaType)
			}
			if strings.HasPrefix(requested, "assets/") {
				response.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				response.Header().Set("Cache-Control", "no-cache")
			}
			response.WriteHeader(http.StatusOK)
			if request.Method == http.MethodGet {
				_, _ = response.Write(contents)
			}
			return
		}
		if strings.HasPrefix(requested, "assets/") || path.Ext(requested) != "" {
			http.NotFound(response, request)
			return
		}
	}

	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	response.WriteHeader(http.StatusOK)
	if request.Method == http.MethodGet {
		_, _ = response.Write(spa.index)
	}
}
