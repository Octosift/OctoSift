CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`mode` text NOT NULL,
	`mentions_product` integer NOT NULL,
	`includes_link` integer NOT NULL,
	`notes_for_user` text DEFAULT '' NOT NULL,
	`needs_edit` integer DEFAULT false NOT NULL,
	`check_failures_json` text NOT NULL,
	`review_decision` text,
	`review_reasons_json` text NOT NULL,
	`edited_by_user` integer DEFAULT false NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drafts_lead_kind_idx` ON `drafts` (`lead_id`,`kind`,`version`);--> statement-breakpoint
CREATE TABLE `evaluations` (
	`product_id` text NOT NULL,
	`post_id` text NOT NULL,
	`stage` text NOT NULL,
	`verdict` text NOT NULL,
	`reason` text NOT NULL,
	`data_json` text,
	`model` text,
	`run_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`product_id`, `post_id`, `stage`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evaluations_run_idx` ON `evaluations` (`run_id`,`stage`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`lead_id` text,
	`signal` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_product_created_idx` ON `feedback` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`post_id` text NOT NULL,
	`kind` text DEFAULT 'opportunity' NOT NULL,
	`score` integer NOT NULL,
	`model_score` integer NOT NULL,
	`fit` text NOT NULL,
	`intent` text NOT NULL,
	`reason` text NOT NULL,
	`evidence_quote` text NOT NULL,
	`risk_flags_json` text NOT NULL,
	`mention_ok` integer NOT NULL,
	`dm_ok` integer NOT NULL,
	`suggested_angle` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`snoozed_until` integer,
	`dismiss_reason` text,
	`replied_at` integer,
	`replied_with_mention` integer,
	`comment_url` text,
	`draft_error` text,
	`notified_at` integer,
	`run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `leads_product_status_score_idx` ON `leads` (`product_id`,`status`,`score`);--> statement-breakpoint
CREATE UNIQUE INDEX `leads_product_post_idx` ON `leads` (`product_id`,`post_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`subreddit` text NOT NULL,
	`author` text NOT NULL,
	`title` text NOT NULL,
	`body_text` text NOT NULL,
	`url` text NOT NULL,
	`image_url` text,
	`created_at` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`content_hash` text NOT NULL,
	`duplicate_of` text
);
--> statement-breakpoint
CREATE INDEX `posts_subreddit_created_idx` ON `posts` (`subreddit`,`created_at`);--> statement-breakpoint
CREATE INDEX `posts_content_hash_idx` ON `posts` (`content_hash`);--> statement-breakpoint
CREATE TABLE `product_subreddits` (
	`product_id` text NOT NULL,
	`subreddit` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`product_id`, `subreddit`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subreddit`) REFERENCES `subreddits`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`profile_json` text NOT NULL,
	`mode` text DEFAULT 'direct' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reply_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`comment_url` text NOT NULL,
	`due_at` integer NOT NULL,
	`kind` text NOT NULL,
	`result` text,
	`checked_at` integer,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reply_checks_due_idx` ON `reply_checks` (`due_at`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`counts_json` text NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`cost_incomplete` integer DEFAULT false NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `runs_started_idx` ON `runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`nonce` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `serp_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`keyword` text NOT NULL,
	`url` text NOT NULL,
	`post_id` text,
	`rank` integer NOT NULL,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `serp_threads_product_keyword_idx` ON `serp_threads` (`product_id`,`keyword`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subreddits` (
	`name` text PRIMARY KEY NOT NULL,
	`last_polled_at` integer,
	`last_newest_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`block_until` integer,
	`poll_interval_minutes` integer,
	`posts_per_day` real,
	`promotion_policy` text DEFAULT 'unknown' NOT NULL,
	`rules_text` text,
	`rules_summary_json` text,
	`rules_updated_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`stage` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_usd` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `usage_created_idx` ON `usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `usage_run_idx` ON `usage` (`run_id`);