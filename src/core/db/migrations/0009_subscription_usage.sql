ALTER TABLE `runs` ADD `api_equivalent_usd` real;--> statement-breakpoint
ALTER TABLE `usage` ADD `cached_input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage` ADD `api_equivalent_usd` real;