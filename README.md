# Clean Article Reader

Chrome MV3 extension that turns noisy article pages into a focused reader view.

## Load

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked extension from this directory.
4. Open an article page and click the extension icon. `Alt+R` also toggles it.

## Behavior

- Extracts the most article-like area from `main`, `article`, `section`, and content-heavy `div` elements.
- Removes scripts, nav, headers, footers, forms, cookie banners, related cards, social/share blocks, and other low-value wrappers.
- Preserves headings, paragraphs, links, lists, quotes, images, code blocks, and tables.
- Adds a Mercury-style isolated overlay with dark/light/sepia themes, font size, width, and serif controls.
