CREATE TABLE `serp_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`keywords` integer NOT NULL,
	`threads` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `serp_runs_product_started_idx` ON `serp_runs` (`product_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `serp_threads` ADD `subreddit` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `serp_threads` ADD `title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `serp_threads` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `serp_threads` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `serp_threads` ADD `run_id` text REFERENCES serp_runs(id);--> statement-breakpoint
CREATE UNIQUE INDEX `serp_threads_product_keyword_url_idx` ON `serp_threads` (`product_id`,`keyword`,`url`);