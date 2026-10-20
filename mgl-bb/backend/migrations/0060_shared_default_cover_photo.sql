-- Same asset as default-profile-photo.png (already in R2); banner crops client-side.
UPDATE users
SET cover_image = '/media/default-profile-photo.png',
    updated_at = datetime('now');
