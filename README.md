# SportZoneBD Frontend

The SportZoneBD frontend is a responsive React application for browsing sports matches and TV channels, watching streams, managing user accounts, and operating the platform through a role-protected admin console.

## Overview

The application uses React 19, TypeScript, Vite, React Router, Redux Toolkit with RTK Query, and Tailwind CSS. Route-level screens are lazy-loaded. Shared UI primitives use Radix UI, with Lucide icons and CSS-variable theme tokens.

The frontend communicates with the SportZoneBD API and uses Socket.IO for live application updates. It can also be installed as a PWA; offline behavior is limited to the app shell and cached static assets.

## Features

- Browse live and upcoming matches; search and filter by status or premium availability.
- Browse channels by category, search locally, switch grid/list views, and save channel or match favorites.
- Open match and channel watch pages with a custom ReactPlayer-based player, stream selection, subtitles, playback controls, and retry/fallback handling.
- Register and sign in, verify email, recover a password, continue with Google, and use public pages as a guest.
- View account settings, subscriptions, payment history, reports, and in-app notifications. Browser push notifications are optional and require browser support and public VAPID configuration.
- Use a separate admin console for dashboards and analytics, user and role management, matches, channels, streams, payments, advertisements, events, notifications, reports, audit logs, and settings.
- Switch between dark and light themes. Layouts include responsive navigation for mobile and desktop.
- Install the PWA, receive service-worker update prompts, and use the cached shell when offline. API requests and live video streams are not cached for offline use.

## Application Structure

| Path | Responsibility |
| --- | --- |
| `src/app` | Redux store, typed hooks, API setup, and application providers. |
| `src/features` | Domain state and API endpoints, including auth, matches, admin, notifications, favorites, and settings. |
| `src/routes` | Lazy-loaded user and admin routes, login actions, and route protection. |
| `src/pages` | Route-level screens, grouped into areas such as admin, auth, matches, and explore. |
| `src/components` | Shared UI, authentication, layout, and video-player components. |
| `src/hooks` | Shared behavior hooks and layouts under `src/hooks/common/layouts`. |
| `src/shared` | Shared UI and application types. |
| `src/assets`, `src/lib`, `src/utils` | Static assets and shared integration/helper code. |
| `public` | Static files, PWA manifest, service worker, and site metadata. |

## User and Admin Architecture

Public routes include the home page, matches, channels, categories, highlights, standings, events, and advertisements. Authenticated user routes include profiles, settings, payment history, reports, and notifications.

Admin pages are nested under `/admin` and rendered through a separate admin layout. The route guard requires an `admin` or `super_admin` role; unauthenticated users are redirected to the appropriate login route, and unauthorized users are sent to the unauthorized page. Admin authentication uses a dedicated login route and action.

## State and API Communication

Redux Toolkit holds application state such as authentication, theme, favorites, recent items, and notifications. API endpoints are injected into one RTK Query API slice, which provides request caching, tag invalidation, and shared query state.

The API base query sends browser credentials and handles session refresh after an eligible unauthorized response. Refresh requests are serialized so concurrent requests do not start parallel refreshes. Session cookies and credentials are managed by the application and are not documented here.

Socket.IO is used for real-time features such as viewer counts and application updates. It is separate from RTK Query's request/cache layer.

## Authentication

The app checks the existing session during startup, then loads the current user. User and admin sign-in use separate API operations. The UI also includes registration, email verification, password recovery, and a Google sign-in redirect. Protected routes use the authenticated user and role information; the API remains responsible for enforcing authorization.

## Playback and Channels

The player is loaded on demand and wraps `react-player` with SportZoneBD controls and playback hooks. HLS streams can use the application stream proxy when a stream ID is available, with retry/fallback behavior handled by the player. Channel browsing supports categories, premium filtering, local text search, favorites, and alternate grid/list layouts. Admin channel management supports channel and category administration.

Never place private stream URLs, signed URLs, or provider credentials in this README or in frontend examples.

## Notifications and PWA

In-app notifications can be viewed, paginated, marked as read, and deleted. Browser push subscription is optional and depends on browser support and a public VAPID key.

In production, `src/main.tsx` registers `public/sw.js`. The worker caches the app shell and eligible static same-origin assets, excludes API and media requests, and provides an offline navigation fallback. The app also handles install prompts and service-worker updates. These behaviors do not make live sports data or streams available offline.

## Styling and Responsive Design

Tailwind CSS is integrated through Vite. `src/index.css` defines the shared dark/light theme variables, typography defaults, and global styles. Reuse the existing UI components and theme tokens when extending the interface. User and admin layouts provide responsive navigation for smaller screens.

## Environment Variables

The frontend reads these optional public configuration values. Use local environment files for development and configure deployment values in the hosting environment. Do not commit secrets or real environment-file contents.

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | API base URL; defaults to `/api/v1`. |
| `VITE_API_PROXY_TARGET` | Vite development proxy target; defaults to `http://localhost:5000`. |
| `VITE_SOCKET_URL` | Optional Socket.IO origin override. In development the default follows the proxy target or local backend; in production it defaults to the frontend origin. |
| `VITE_WEB_PUSH_PUBLIC_KEY` | Optional public VAPID key used to enable browser push subscriptions. |
| `VITE_CLOUDINARY_CLOUD_NAME` | Optional Cloudinary cloud name used by the image URL helper for transformations. |

Placeholder example only:

```dotenv
VITE_API_URL=<api-base-url>
VITE_API_PROXY_TARGET=<local-backend-origin>
VITE_SOCKET_URL=<socket-server-origin>
VITE_WEB_PUSH_PUBLIC_KEY=<public-vapid-key>
VITE_CLOUDINARY_CLOUD_NAME=<cloud-name>
```

## Installation and Development

Use Node.js and npm with the checked-in `package-lock.json`:

```bash
npm ci
npm run dev
```

The Vite development server listens on port `5174` and proxies `/api` to the local backend by default. Set `VITE_API_PROXY_TARGET` when the backend runs at a different origin. The development server uses a strict port and will report a conflict rather than selecting another port.

## Quality Checks and Build

```bash
npm run lint
npm run build
npm run preview
```

Lint runs ESLint with warnings treated as errors. The production build runs the TypeScript project build followed by Vite. `npm run preview` serves the generated production build locally.

## Deployment

The repository includes a Vercel configuration with an SPA fallback and an `/api` rewrite. Configure deployment environment values in the hosting platform; this README intentionally omits deployment endpoints and credentials.

## Development Guidelines

- Add API endpoints through the existing RTK Query API slice and follow its cache/tag conventions.
- Reuse shared components and theme variables instead of introducing parallel UI patterns.
- Keep user and admin route boundaries and role checks intact.
- Preserve responsive behavior, accessibility, and the distinction between cached static resources and live API or stream data.
- Run `npm run lint` and `npm run build` before submitting frontend changes.
