-- Store the approved DNA OS logo variants and their intended contexts in the
-- central application configuration database. This is metadata only; it does
-- not start a worker or add a runtime process.
INSERT INTO public.app_configs (title, data)
VALUES (
  'dna-os-brand-asset-usage',
  $brand_assets${
    "schema_version": "1.0.0",
    "brand": "DNA OS",
    "asset_base_url": "https://dnaos.dev/assets/brand/dna-os/v1/",
    "variants": [
      {
        "asset": "dna-os-horizontal-mono.svg",
        "format": "svg",
        "presentation": "monochrome",
        "shape": "horizontal",
        "use_for": ["markdown_document_header", "public_document_header"],
        "background": "transparent"
      },
      {
        "asset": "dna-os-mark-mono.svg",
        "format": "svg",
        "presentation": "monochrome",
        "shape": "square_mark",
        "use_for": ["compact_monochrome_icon"],
        "background": "transparent",
        "fit": "contain",
        "preserve_safe_area": true
      },
      {
        "asset": "dna-os-horizontal-color.svg",
        "format": "svg",
        "presentation": "original_color",
        "shape": "horizontal",
        "use_for": ["application_or_service_header"],
        "background": "transparent"
      },
      {
        "asset": "dna-os-mark-color.svg",
        "format": "svg",
        "presentation": "original_color",
        "shape": "square_mark",
        "use_for": ["compact_application_or_platform_icon"],
        "background": "transparent",
        "fit": "contain",
        "preserve_safe_area": true
      }
    ],
    "source_manifest": "https://dnaos.dev/assets/brand/dna-os/v1/brand-assets.json",
    "source_guide": "https://dnaos.dev/system-map"
  }$brand_assets$
)
ON CONFLICT (title) DO UPDATE
SET data = EXCLUDED.data,
    updated_at = now();
