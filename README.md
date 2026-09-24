# Keyboard Forensics

Browser-only helper for investigating screen recordings for keyboard-activity evidence.

## Features
- Local video playback and frame sampling
- Abrupt visual-change detection
- Timestamped evidence timeline
- Confidence labels
- JSON/CSV export

## Limits
A screen recording does not normally contain the Chromebook's raw keyboard-event log. Exact keys can only be recovered when the recording provides enough evidence (for example visible UI changes, an on-screen keyboard, captured keystroke overlay, or suitable audio/other artifacts). This project deliberately reports evidence and inference rather than inventing keypresses.

## Run
Open `index.html` in a browser, or enable GitHub Pages for the repository.

