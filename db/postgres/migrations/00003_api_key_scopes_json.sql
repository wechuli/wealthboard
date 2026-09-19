-- +goose Up
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_check;
ALTER TABLE api_keys
    ALTER COLUMN scopes DROP DEFAULT,
    ALTER COLUMN scopes TYPE JSONB USING to_jsonb(scopes),
    ALTER COLUMN scopes SET DEFAULT '["portfolio:read"]'::JSONB;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_check CHECK (
    jsonb_typeof(scopes) = 'array'
    AND jsonb_array_length(scopes) > 0
    AND scopes <@ '["portfolio:read","portfolio:write","imports:write","exports:read","ai:invoke"]'::JSONB
);

-- +goose Down
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_check;
ALTER TABLE api_keys
    ALTER COLUMN scopes DROP DEFAULT,
    ALTER COLUMN scopes TYPE TEXT[] USING ARRAY(SELECT jsonb_array_elements_text(scopes)),
    ALTER COLUMN scopes SET DEFAULT ARRAY['portfolio:read']::TEXT[];
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_check CHECK (
    cardinality(scopes) > 0
    AND scopes <@ ARRAY[
        'portfolio:read',
        'portfolio:write',
        'imports:write',
        'exports:read',
        'ai:invoke'
    ]::TEXT[]
);