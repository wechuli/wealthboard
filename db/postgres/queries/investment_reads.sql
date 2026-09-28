-- name: ListInvestmentPositionEvents :many
SELECT id, account_id, instrument_id, related_instrument_id, type, quantity::text,
       COALESCE(unit_price::text, '')::text AS unit_price, trade_currency, fee_amount_minor, fee_currency,
       cash_effect_minor, COALESCE(applied_exchange_rate::text, '')::text AS applied_exchange_rate, opening_cost_basis_minor,
       COALESCE(action_ratio_numerator::text, '')::text AS action_ratio_numerator,
       COALESCE(action_ratio_denominator::text, '')::text AS action_ratio_denominator, trade_date,
       event_sequence, settlement_date, external_id, event_group_id, description,
       notes, created_at, updated_at
FROM position_events
WHERE user_id = $1 AND account_id = $2
ORDER BY trade_date DESC, event_sequence DESC, created_at DESC, id DESC
LIMIT $3 OFFSET $4;

-- name: GetInvestmentPositionEvent :one
SELECT id, account_id, instrument_id, related_instrument_id, type, quantity::text,
       COALESCE(unit_price::text, '')::text AS unit_price, trade_currency, fee_amount_minor, fee_currency,
       cash_effect_minor, COALESCE(applied_exchange_rate::text, '')::text AS applied_exchange_rate, opening_cost_basis_minor,
       COALESCE(action_ratio_numerator::text, '')::text AS action_ratio_numerator,
       COALESCE(action_ratio_denominator::text, '')::text AS action_ratio_denominator, trade_date,
       event_sequence, settlement_date, external_id, event_group_id, description,
       notes, created_at, updated_at
FROM position_events
WHERE user_id = $1 AND account_id = $2 AND id = $3;
