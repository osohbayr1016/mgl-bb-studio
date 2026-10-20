-- Цайны цагийг ажилласан цагаас хасах тохиргоо (Ирцийн самбараас тохируулна).
--   lunch_enabled : '1' идэвхтэй / '0' унтраалттай (default идэвхтэй).
--   lunch_start   : цайны эхлэх цаг 'HH:MM' (UB).
--   lunch_end     : цайны дуусах цаг 'HH:MM' (UB).
-- Ажилласан цаг (hours_worked) тооцохдоо [clock_in, clock_out]-ийн
-- [lunch_start, lunch_end]-тай давхцсан хэсгийг хасна (9 цаг → цайны 1 цаг
-- хасвал 8 цаг).  Зөвхөн ШИНЭ бүртгэлд үйлчилнэ; хадгалагдсан өмнөх
-- hours_worked хэвээр (шаардвал тусдаа backfill хийнэ).
INSERT INTO app_settings (key, value) VALUES
  ('lunch_enabled', '1'),
  ('lunch_start', '12:00'),
  ('lunch_end', '13:00')
ON CONFLICT(key) DO NOTHING;
