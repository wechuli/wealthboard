-- name: GetAccount :one
SELECT * FROM "accounts" WHERE `user_id` = sqlc.arg(user_id) AND `id` = sqlc.arg(id);

-- name: ListAccounts :many
SELECT * FROM "accounts" WHERE `user_id` = sqlc.arg(user_id) ORDER BY `name`, `id`;
