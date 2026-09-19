GO_PACKAGES := ./cmd/... ./internal/...
DATABASE_URL ?= postgres://wealthboard:wealthboard@localhost:5433/wealthboard?sslmode=disable

.PHONY: go-fmt go-generate go-test go-test-integration go-vet go-run migrate migrate-status postgres-up postgres-down web-install web-generate web-dev web-typecheck web-test web-build

go-fmt:
	test -z "$$(gofmt -l cmd db/postgres internal)"

go-generate:
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate

go-test:
	go test $(GO_PACKAGES) ./db/postgres/...

go-test-integration:
	TEST_DATABASE_URL="$(DATABASE_URL)" go test ./internal/database ./internal/auth ./internal/service -count=1

go-vet:
	go vet $(GO_PACKAGES)

go-run:
	DATABASE_URL="$(DATABASE_URL)" go run ./cmd/wealthboard serve

migrate:
	DATABASE_URL="$(DATABASE_URL)" go run ./cmd/wealthboard migrate

migrate-status:
	DATABASE_URL="$(DATABASE_URL)" go run ./cmd/wealthboard migrate-status

postgres-up:
	docker compose -f docker-compose.go.yml up -d postgres

postgres-down:
	docker compose -f docker-compose.go.yml down

web-install:
	npm --prefix web install

web-generate:
	npm --prefix web run generate:api

web-dev:
	npm --prefix web run dev

web-typecheck:
	npm --prefix web run typecheck

web-test:
	npm --prefix web test

web-build:
	npm --prefix web run build