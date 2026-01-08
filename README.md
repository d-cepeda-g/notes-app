# [notes](https://dcepedag.com)

a notes-inspired personal website, forked from [alana goyal's original repo](https://github.com/alanagoyal/alanagoyal).

> *"i'm obsessed with re-creating apple products. this one is a notes-inspired website that doubles as my personal website."* — alana goyal

## what's different from the original

this fork includes several modifications from the original implementation:

### backend changes

- **migrated from supabase to replit postgresql** — uses [drizzle orm](https://orm.drizzle.team/) instead of supabase's client
- **replit object storage for images** — replaced supabase storage with replit's built-in object storage
- **api routes for all database operations** — created dedicated api routes with input validation and ownership verification:
  - `GET /api/notes?session_id=xxx` — get session notes
  - `POST /api/notes` — create a new note
  - `PATCH /api/notes/[id]` — update a note
  - `DELETE /api/notes/[id]` — delete a note
  - `POST /api/uploads` — get presigned url for image upload
  - `GET /api/uploads/serve/[...path]` — serve uploaded images
- **presigned url upload flow** — implemented secure image uploads
- **unique index on slug column** — prevents duplicate slugs

### ui/ux changes

visual changes aimed at mirroring apple's latest ios 26 notes app (mobile and web):

- **simplified private notes** — private notes now use plain text editing with a simple textarea component (no formatting toolbar, bullet points, or checklists)
- **macos-style header** — traffic light buttons (close/minimize/maximize), sidebar toggle, notes title, new note button
- **restructured layout** — matches ios notes more closely (search in header, collapsible sidebar)
- **private notes always in edit mode** — like ios notes, private notes stay editable

### storage differences

- **public notes**: store markdown, rendered with reactmarkdown
- **private notes**: store plain text, edited with simple textarea component

## original implementation

for details on the original architecture and implementation, see the [original repo](https://github.com/alanagoyal/alanagoyal):

- next.js 14 with app router
- session-based architecture (public + private notes)
- markdown with github flavored markdown support
- isr caching for public notes
- vim-inspired keyboard shortcuts
- dynamic og image generation

## setup

### database

this version uses replit's postgresql database with drizzle orm. to push schema changes:

```bash
npm run db:push
```

### environment variables

```
DATABASE_URL="<your-replit-postgres-url>"
REVALIDATE_TOKEN="<your-revalidation-token>"
```

### install & run

```bash
npm install
npm run dev
```

## credits

original project by [alana goyal](https://alanagoyal.com) — [github repo](https://github.com/alanagoyal/alanagoyal)

## license

licensed under the [mit license](https://github.com/alanagoyal/alanagoyal/blob/main/LICENSE.md).
