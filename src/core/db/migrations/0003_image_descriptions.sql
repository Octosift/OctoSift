CREATE TABLE `image_descriptions` (
	`url` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL
);
