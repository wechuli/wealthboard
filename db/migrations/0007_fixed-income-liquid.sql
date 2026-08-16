UPDATE `categories`
SET `is_liquid` = 1
WHERE `slug` = 'fixed-income'
	AND `asset_or_liability` = 'asset'
	AND `is_system` = 1;