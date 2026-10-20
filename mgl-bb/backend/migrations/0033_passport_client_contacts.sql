-- =============================================
-- Multi-row client contacts in project passport
-- =============================================
-- Хуучин `client_pm` (TEXT, нэг л мөр) -г олон холбогдох хүнтэй массив
-- болгоно.  JSON буюу `[{full_name, position, phone, email}, ...]`
-- хэлбэрээр нэг баганад хадгална.  Хуучин баганыг устгахгүй,
-- зөвхөн UI ашиглахаа болино.
ALTER TABLE project_passport
  ADD COLUMN client_contacts_json TEXT;
