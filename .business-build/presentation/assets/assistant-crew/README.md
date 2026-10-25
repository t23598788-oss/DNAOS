# Assistant crew

Four owner-requested animated UI studies: น้องพร้อม, น้องแฟ้ม, น้องมิว,
น้องออร์บ. Includes ready, idle, busy, notification and completed states.

- `characters.fragment.html`: editable source (HTML/CSS/JavaScript).
- `preview.html`: standalone rendered preview, served inside the protected
  `/admin/ui-gallery/assistants` page with an isolated script sandbox.

These are UI studies, not operational agents. Counts and schedules are examples.
They neither read business records nor dispatch tasks. Speech requires an explicit
click and a locally available Thai voice; no automatic speech or microphone access.
Reduced-motion preferences and the pause button stop animation.

Keep both files together. After changing the fragment, regenerate `preview.html`
with the visualize skill's `scripts/render.py` and `--force`.
