# Founder preferences — sources of truth

| Preference | Account DB (`founder_preferences`) | Browser |
|---|---|---|
| Response style / detail | **SoT** — drives companion personality grounding | Cookies unused |
| Sound enabled / volume | **SoT** — saved from Control Center; hydrated into `ghost.sound` localStorage on Settings load | `ghost.sound` is the runtime sound engine cache |
| Appearance | **SoT** + `ghost.appearance` cookie for SSR | `data-theme` / PreferenceShell |
| Reduced motion | **SoT** + `ghost.reduce_motion` cookie | `data-reduce-motion` |
| Voice on/off, URI, rate, auto-read | Not stored in DB (voices are device-specific) | **SoT** `ghost.voice` localStorage |

## Multi-device / stale browser notes

- Opening Settings on a device writes account sound prefs into that browser’s `ghost.sound`.
- Another device keeps its own `ghost.sound` until Settings is opened (or a future sync pass).
- Changing volume only in the browser Sound panel does **not** update the account row until the founder saves preferences.
- Voice URI lists differ per OS/browser; keeping voice device-local avoids invalid remote URIs.
