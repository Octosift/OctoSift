UPDATE `settings` SET `value_json` = json_set(`value_json`, '$.triage', json('null')) WHERE `key` = 'ai.stages' AND json_extract(`value_json`, '$.triage.provider') = 'google';--> statement-breakpoint
UPDATE `settings` SET `value_json` = json_set(`value_json`, '$.qualify', json('null')) WHERE `key` = 'ai.stages' AND json_extract(`value_json`, '$.qualify.provider') = 'google';--> statement-breakpoint
UPDATE `settings` SET `value_json` = json_set(`value_json`, '$.draft', json('null')) WHERE `key` = 'ai.stages' AND json_extract(`value_json`, '$.draft.provider') = 'google';--> statement-breakpoint
UPDATE `settings` SET `value_json` = json_set(`value_json`, '$.review', json('null')) WHERE `key` = 'ai.stages' AND json_extract(`value_json`, '$.review.provider') = 'google';--> statement-breakpoint
UPDATE `settings` SET `value_json` = (SELECT json_group_object(`entry`.`key`, json(`entry`.`value`)) FROM json_each(`settings`.`value_json`) AS `entry` WHERE `entry`.`key` NOT LIKE 'google/%') WHERE `key` = 'ai.prices';--> statement-breakpoint
DELETE FROM `secrets` WHERE `name` = 'google_api_key';
