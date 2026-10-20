-- Add extended profile fields
ALTER TABLE users ADD COLUMN profile_image TEXT;
ALTER TABLE users ADD COLUMN cover_image TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN description TEXT;
ALTER TABLE users ADD COLUMN social_links TEXT;
