UPDATE `runs` SET `cost_usd` = max(0, `cost_usd` - `data_cost_usd`) WHERE `data_cost_usd` > 0;--> statement-breakpoint
DELETE FROM `usage` WHERE `stage` = 'reddit_data';--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('reddit.provider', 'reddit.providerPriceUsd');--> statement-breakpoint
UPDATE `settings` SET `value_json` = '"session"' WHERE `key` = 'reddit.source' AND `value_json` = '"provider"';--> statement-breakpoint
DELETE FROM `settings` WHERE `key` = 'state.sourceFailover' AND 'provider' IN (json_extract(`value_json`, '$.from'), json_extract(`value_json`, '$.to'));--> statement-breakpoint
DELETE FROM `secrets` WHERE `name` NOT IN ('openai_api_key', 'anthropic_api_key', 'google_api_key', 'openai_compatible_api_key', 'reddit_session_cookie', 'dataforseo_login', 'dataforseo_password', 'webhook_url', 'reddit_proxy_url');--> statement-breakpoint
ALTER TABLE `posts` DROP COLUMN `partial`;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `data_cost_usd`;
