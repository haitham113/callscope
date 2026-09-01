# Submission screenshots

These screenshots are generated from the production build in real Chrome with generated WebRTC media. Regenerate them with:

```bash
npm run capture:screenshots
```

- `01-healthy.png` — connected peers and truthful Healthy evidence.
- `02-staged-recovery.png` — Critical audio fault with a staged `enable_audio_track` plan.
- `03-approved-still-broken.png` — approval recorded while the actual audio track remains disabled.
- `04-before-after-recovery.png` — fresh recovered comparison and sanitized incident report.
