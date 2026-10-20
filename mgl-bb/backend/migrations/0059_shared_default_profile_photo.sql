-- Shared office photo used as every user's profile_image until they change it.
-- Seed the object in R2 first: `npm run media:put-default-avatar` (or `:local`).
UPDATE users
SET profile_image = '/media/default-profile-photo.png',
    updated_at = datetime('now');
