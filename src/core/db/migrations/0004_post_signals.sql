ALTER TABLE `posts` ADD `score` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `comment_count` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `nsfw` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `removed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `partial` integer DEFAULT false NOT NULL;