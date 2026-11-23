# Focus Timer

## What It Does
Runs a configurable focus countdown with reset and randomized session settings.

## Architecture
```text
Settings UI -> TimerControls -> React state -> Countdown loop
     |                                      |
     +-------- localStorage  <---------------+
```

## Frontend / API
- State holds settings, remaining seconds, and running status.
- Uses 44px controls and stacks controls after the timer on mobile.
- Settings persist under `playground:focus-timer:settings`.
- No API or keyboard shortcuts.
- Wraps localStorage access in try/catch.

## AI Usage
No AI usage.

## Key Dependencies
React, Next.js, Lucide icons, shared Button and design tokens.

## Component Tree
`page.tsx` -> `FocusTimer` -> `TimerControls`

## Error Handling
Storage failures are ignored safely; countdown clamps at zero.

## File Structure
- `page.tsx`: thin route entry
- `FocusTimer.tsx`: state and countdown
- `TimerControls.tsx`: parameters and actions
- `types.ts`, `data.ts`, `utils.ts`: decomposed types/config/pure formatting
