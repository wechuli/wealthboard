.PHONY: generate check-generated lint lint-go typecheck test test-go test-e2e build build-go migrate-check security

generate:
	go tool sqlc generate

check-generated:
	go tool sqlc diff
	go mod tidy -diff

lint: lint-go
	npm run lint

lint-go:
	@files="$$(gofmt -l cmd internal db)" && \
		{ test -z "$$files" || { printf 'Run gofmt on:\n%s\n' "$$files"; exit 1; }; }
	go vet ./...

typecheck:
	npm run typecheck

test: test-go
	npm test

test-go:
	go test ./...

test-e2e:
	npm run test:e2e

# Until cutover, this builds the existing web app and the Go migration CLI.
build: build-go
	npm run build

build-go:
	CGO_ENABLED=0 go build -trimpath -o dist/wealthboard ./cmd/wealthboard

migrate-check:
	go test -count=1 ./internal/database/... ./cmd/wealthboard/...

security:
	go tool govulncheck ./...
	npm audit --omit=dev
