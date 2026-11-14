ALTER TABLE `reply_checks` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `reply_checks` SET `result` = 'removed' WHERE `result` = 'hidden';
