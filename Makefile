GO_PACKAGES := ./cmd/... ./internal/...
DATABASE_URL ?= postgres://wealthboard:wealthboard@localhost:5433/wealthboard?sslmode=disable

.PHONY: generate lint typecheck test build migrate-check security test-e2e test-e2e-go go-fmt go-generate go-test go-test-integration go-vet go-run migrate migrate-status backup restore seed-demo postgres-up postgres-down web-install web-generate web-dev web-lint web-typecheck web-test web-build

generate: go-generate web-generate

lint: go-fmt go-vet web-lint

typecheck: web-typecheck

test: go-test web-test
	node scripts/validate-pwa-static.mjs
	node --test tests/node/extraction-worker-protocol.test.mjs

build: web-build
	mkdir -p bin
	go build -trimpath -o bin/wealthboard ./cmd/wealthboard

migrate-check:
	TEST_DATABASE_URL="$(DATABASE_URL)" go test ./internal/database -run '^TestPostgreSQLMigrations$$' -count=1

security:
	go run golang.org/x/vuln/cmd/govulncheck@latest $(GO_PACKAGES)
	npm audit --audit-level=high
	npm --prefix web audit --audit-level=high
	npm --prefix extraction-worker audit --audit-level=high

test-e2e: test-e2e-go

test-e2e-go:
	npm run test:e2e:go

go-fmt:
	test -z "$$(gofmt -l cmd db/postgres internal)"

go-generate:
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate

go-test:
	go test $(GO_PACKAGES) ./db/postgres/...

go-test-integration:
	TEST_DATABASE_URL="$(DATABASE_URL)" go test ./internal/database ./internal/auth ./internal/service ./internal/operator -count=1

go-vet:
	go vet $(GO_PACKAGES)

go-run:
	DATABASE_URL="$(DATABASE_URL)" go run ./cmd/wealthboard serve

migrate:
	DATABASE_URL="$(DATABASE_URL)" go run ./cmd/wealthboard migrate

migrate-status:
	DATABASE_URL="$(DATABASE_URL)" go run ./cmd/wealthboard migrate-status

backup:
	test -n "$(BACKUP_FILE)"
	DATABASE_URL="$(DATABASE_URL)" go run ./cmd/wealthboard backup --file "$(BACKUP_FILE)"

restore:
	test -n "$(RESTORE_FILE)"
	DATABASE_URL="$(DATABASE_URL)" go run ./cmd/wealthboard restore --file "$(RESTORE_FILE)" --confirm-maintenance

seed-demo:
	test "$(DEMO_DATA)" = "true"
	test -n "$(TARGET_USERNAME)"
	DATABASE_URL="$(DATABASE_URL)" DEMO_DATA=true go run ./cmd/wealthboard seed-demo --username "$(TARGET_USERNAME)"

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

web-lint:
	npm --prefix web run lint

web-typecheck:
	npm --prefix web run typecheck

web-test:
	npm --prefix web test

web-build:
	npm --prefix web run build