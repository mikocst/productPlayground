# Prototype Playground Agent Rules

Read this file before every task. It is non-negotiable.

## Creating a Prototype
1. Work on a branch, create `app/prototypes/<slug>/`.
2. Add thin `page.tsx`, `metadata.json`, and complete `HOW_IT_WORKS.md`.
3. Split state/types/config/pure logic and meaningful UI into separate files.
4. Update `updatedAt` to the ISO edit timestamp on every edit.
5. Never add a create button or create API.
6. Build, lint, type-check, and capture thumbnails in the same commit.
7. Push and open a pull request; end with the preview link.

## Metadata
Use title, description, tags, createdAt, updatedAt, hidden, and public fields. Keep `hidden` and `public` false unless explicitly requested.

## Privacy
Private prototypes exist only under `/prototypes/<slug>`. Public prototypes are additionally reachable only under `/p/<slug>` when `public: true`. Unknown/private public slugs return 404. Never expose private prototype names in public routes.

## Public Sharing
When a prototype is explicitly made public, add `og:image` and `og:video` metadata and provide corresponding assets.

## Design
- Use shared components and semantic tokens. Never hardcode colors or use inline color styles.
- Use one centered `max-w-2xl` column by default.
- Mobile target width is 375px; tap targets are at least 44px.
- Icon-only mobile controls may gain labels at `sm:` and above.
- Dark-first via global theme tokens; do not hardcode dark page classes.
- Control panels provide Reset and Surprise Me/Randomize.
- Desktop controls stay beside the subject; mobile controls stack or use a bottom sheet.
- No decorative icons or redundant copy.

## Motion and Storage
- Use restrained ease-out reveals and physical springs only for physical movement.
- Respect `prefers-reduced-motion`.
- Verify CSS motion actually executes.
- Wrap `localStorage` access in try/catch and load after mount under a prototype-namespaced key.

## AI and APIs
- Run models server-side through API routes. Never expose keys.
- Use try/catch and proper status codes.
- Parse generated JSON defensively.

## Documentation
Keep `HOW_IT_WORKS.md` current with What It Does, ASCII Architecture, Frontend/API, AI Usage, Key Dependencies, Component Tree, Error Handling, and File Structure.

## Thumbnails
- Visual edit: recapture that prototype.
- Global style edit: recapture all prototypes.
- Missing previews fall back to the shared no-preview tile.
- Inspect captured images before commit.

## Validation
Before completion run `npm run lint`, `npm run typecheck`, and `npm run build`. Fix failures caused by the change.

## Lessons
- In Next.js 16, runtime `useSearchParams()` hooks require a `<Suspense>` boundary on the route.
- Use `proxy.ts`, not deprecated `middleware.ts`, for request interception.
- Use the standard Tailwind PostCSS plugin with Turbopack; do not add a custom `@tailwindcss/turbopack` CSS loader.

- Dynamic slug routes in Cache Components use `export const instant = false` unless they are fully prerenderable.
