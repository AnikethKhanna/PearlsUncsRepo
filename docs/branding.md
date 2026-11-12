# NMU branding and UI changes

Verified against [No More Under's official website](https://www.nomoreunder.org/) on November 11, 2026. The supplied Google image-search thumbnail was not used as a brand authority.

- Original logo: the official homepage's header image and business-logo metadata point to [NMU_Logo copy.png](https://static.wixstatic.com/media/98f741_18e68ac30ab44814a5200a999796d966~mv2.png). Stored unchanged at `public/brand/nmu-logo.png`; rendered with descriptive alt text and its aspect ratio preserved.
- Observed website theme colors: cyan `#3EBFEF` (`--color_23` / `--color_42`), pale cyan `#BCE9FA` (`--color_21`), dark blue `#373B60` (`--color_29`), navy `#080D38` (`--color_30`), ink `#14171F` (`--color_15`). These are verified site colors, not a claim that an official brand manual was supplied.
- App-only surface tint `#F0F9FE` and neutral backgrounds are supporting UI colors, not invented official brand standards. Cyan is an accent or pale selection background, not a low-contrast white-text button. Primary buttons use the darker verified blue and navy.

The existing system font stack is retained for readable text without extra remote font requests. Header navigation has current-page indicators and a separate user area; headings/actions wrap at smaller widths. Cards, inputs and buttons retain the existing shared UI components. Task dashboards keep collapsible groups and their five-row previews.

Accessibility: skip-to-main link, visible focus outlines, semantic navigation/table/fieldset controls, labels for preset fields and ordering buttons, non-color-only selected navigation, status/error announcements, pending/disabled controls, reduced-motion preference, and horizontally scrollable export tables. Disabled/archived choices remain explicit in text.

No external analytics, tracking, image hotlinking, new icon library or generated replacement logo was added. NMU retains ownership of its logo.
