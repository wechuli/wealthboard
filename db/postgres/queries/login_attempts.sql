-- name: AcquireLoginRateLimitLock :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(client_key), 0));

-- name: DeleteExpiredLoginAttempts :exec
DELETE FROM login_attempts
WHERE attempted_at < $1;

-- name: CountRecentFailedLoginAttempts :one
SELECT count(*)
FROM login_attempts
WHERE client_key = $1
  AND succeeded = FALSE
  AND attempted_at >= $2;

-- name: CountRecentLoginAttempts :one
SELECT count(*)
FROM login_attempts
WHERE client_key = $1
  AND attempted_at >= $2;

-- name: CreateLoginAttempt :exec
INSERT INTO login_attempts (id, client_key, succeeded, attempted_at)
VALUES ($1, $2, $3, $4);

-- name: DeleteLoginAttemptsForKey :exec
DELETE FROM login_attempts
WHERE client_key = $1;