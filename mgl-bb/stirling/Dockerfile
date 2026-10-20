# Stirling-PDF on Cloudflare Containers.
# Full image so every op (compress, page-numbers, watermark, merge, password)
# works out of the box. For a cheaper 1 GiB ("basic") instance limited to the
# pdfbox-only ops, swap the tag to ":latest-ultra-lite" and set
# instance_type = "basic" in wrangler.toml.
FROM docker.stirlingpdf.com/stirlingtools/stirling-pdf:latest

# Lean runtime: skip the heavy optional pipelines we don't call from MGL.
ENV DISABLE_ADDITIONAL_FEATURES=true \
    SYSTEM_DEFAULTLOCALE=en-US \
    METRICS_ENABLED=false

# Stirling serves HTTP on 8080 — this must match defaultPort in src/index.ts.
EXPOSE 8080
