# Provider brand assets — source provenance

These are real provider/product logos, not icons drawn for DNA OS. They are
stored locally so the Workspace baseline does not depend on a third-party CDN
at runtime. The Business Tool Launcher references them from
`public/brand/providers/*` through `/brand/providers/*`.

| File | Provider | Source |
|---|---|---|
| `line.svg` | LINE | Wikimedia Commons — `LINE_logo.svg` |
| `facebook.svg` | Facebook | Wikimedia Commons — `2021_Facebook_icon.svg` |
| `messenger.svg` | Messenger | Wikimedia Commons — `Facebook_Messenger_logo_2020.svg` |
| `instagram.png` | Instagram | Wikimedia Commons — `Instagram_icon.png` (resized to 128×128) |
| `tiktok.svg` | TikTok | Simple Icons — `tiktok` (brand icon, monochrome) |
| `gmail.svg` | Gmail | Wikimedia Commons — `Gmail_icon_(2020).svg` |
| `outlook.svg` | Outlook | Wikimedia Commons — `Microsoft_Outlook_Icon_(2025–present).svg` |
| `pdf.svg` | PDF | Wikimedia Commons — `PDF_file_icon.svg` |
| `drive.svg` | Google Drive | Simple Icons — `googledrive` |
| `docs.svg` | Google Docs | Wikimedia Commons — `Google_Docs_Editors_2020_Logo.svg` |
| `sheets.svg` | Google Sheets | Simple Icons — `googlesheets` |
| `kbank.svg` | Kasikornbank | Wikimedia Commons — `Kasikornbank_Logo.svg` |
| `google-maps.svg` | Google Maps | Wikimedia Commons — `Google_Maps_icon_(2020).svg` |
| `google.svg` | Google (Sign in with Google G) | Google Identity branding — official multicolour G mark |
| `apple.svg` | Apple | Simple Icons — `apple` (official Apple mark) |
| `microsoft.svg` | Microsoft | Microsoft brand guidelines — four-square logo |
| `github.svg` | GitHub | Simple Icons — `github` (official Octocat mark) |

Existing asset inventory checked before adding these:
`app/admin/ui-gallery/_lib/visualAssets.ts` declares most provider logos as
`MISSING_ASSET` / `REVIEW_REQUIRED`; `plugins/capabilities.ts` already contains
real Wikimedia URLs for LINE, Facebook, Messenger, Instagram, TikTok, Gmail,
Google Drive, and PDF. This folder supplies the same real logos locally and
fills the missing Outlook / Google Docs / Google Sheets / Kasikornbank entries
with their official brand assets. No logo is generated or recolored into a new
invented mark.
