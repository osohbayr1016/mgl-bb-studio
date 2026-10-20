-- Гүйцэтгэлийн тайлан — нэгтгэсэн график блокийн line chart-д зориулсан
-- төслийн нийт явцын өдрөөр тооцсон цуваа. Issue хийх үед хөлдөөж
-- хадгална (team_progress_json-тай адил), draft-д live тооцоолно.
-- Хуучин тайлангуудад NULL — frontend empty-state эсвэл live endpoint.
ALTER TABLE project_performance_reports ADD COLUMN progress_timeseries_json TEXT;
