# WeasyPrint HTML->PDF renderer on Cloudflare Containers.
# Renders server-built HTML (POST /render {html}) to A4 PDF with embedded
# Cyrillic fonts. Mirrors stirling/ — a standalone Worker deployed on its own.
FROM python:3.12-slim

# Native libs WeasyPrint binds to via CFFI (Pango/Cairo/GDK-PixBuf) + a
# Cyrillic-complete font family (Noto Sans/Serif) so Mongolian glyphs render
# instead of .notdef boxes. fonts-noto-core = Latin+Cyrillic without the heavy
# CJK pack; DejaVu is a fallback. shared-mime-info lets WeasyPrint sniff
# data-URI images.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 \
      libpangoft2-1.0-0 \
      libpangocairo-1.0-0 \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libffi8 \
      shared-mime-info \
      fontconfig \
      fonts-noto-core \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

# Pin WeasyPrint: referenced (external) SVG regressed in v64; we only emit
# INLINE SVG so 63.1 is safe and deterministic. gunicorn fronts Flask.
RUN pip install --no-cache-dir weasyprint==63.1 flask==3.0.3 gunicorn==22.0.0

WORKDIR /app
COPY app.py .

# Must match defaultPort in src/index.ts — Container blocks until this listens.
EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "120", "app:app"]
