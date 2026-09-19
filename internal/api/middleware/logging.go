package middleware

import (
	"log/slog"
	"net/http"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

func Logger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			startedAt := time.Now()
			wrapped := chimiddleware.NewWrapResponseWriter(response, request.ProtoMajor)
			next.ServeHTTP(wrapped, request)
			logger.InfoContext(
				request.Context(),
				"http request",
				"request_id", chimiddleware.GetReqID(request.Context()),
				"method", request.Method,
				"path", request.URL.Path,
				"status", wrapped.Status(),
				"bytes", wrapped.BytesWritten(),
				"duration_ms", time.Since(startedAt).Milliseconds(),
			)
		})
	}
}
