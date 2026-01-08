# Notes App

A notes-inspired personal website built with Next.js and Replit's storage solutions.

## Overview

This is a session-based notes application with public and private notes:
- **Public notes**: Viewable by everyone, managed by the site owner
- **Private notes**: Created per browser session, only visible to the creator

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: Replit PostgreSQL (via Drizzle ORM)
- **File Storage**: Replit Object Storage
- **Styling**: Tailwind CSS
- **Markdown**: react-markdown with GitHub Flavored Markdown support

## Project Structure

```
app/
  notes/           # Main notes pages
    [slug]/        # Dynamic note pages
    api/og/        # OpenGraph image generation
    revalidate/    # Cache revalidation endpoint
  api/
    notes/         # Notes CRUD API routes
    uploads/       # Image upload API routes
components/        # React components
lib/
  db.ts           # Database repository layer
  types.ts        # TypeScript types
  note-utils.ts   # Note utility functions
  create-note.ts  # Note creation logic
  image-upload.ts # Image upload utilities
shared/
  schema.ts       # Drizzle database schema
server/
  db.ts           # Database connection
```

## Database

The app uses Replit's PostgreSQL database with Drizzle ORM. The schema includes:
- `notes` table with fields: id, title, content, session_id, public, slug, category, emoji, created_at

To push schema changes:
```bash
npm run db:push
```

## API Routes

- `GET /api/notes?session_id=xxx` - Get session notes
- `POST /api/notes` - Create a new note
- `PATCH /api/notes/[id]` - Update a note
- `DELETE /api/notes/[id]` - Delete a note
- `POST /api/uploads` - Get presigned URL for image upload
- `GET /api/uploads/serve/[...path]` - Serve uploaded images

## Development

The app runs on port 5000 with `npm run dev -- -p 5000 -H 0.0.0.0`.

## UI Features

- **Collapsible Sidebar**: Toggle with the panel icon or press `[` key
- **Search Bar**: Located in the top header (right side) - matches iOS Notes layout
- **Formatting Toolbar**: Appears for private notes when editing, includes text formatting, lists, checklists, tables, and links
- **Circular Checkboxes**: Gold/yellow when checked, matching iOS Notes style

## Key Components

- `components/header.tsx` - Top header bar with search
- `components/sidebar-layout.tsx` - Main layout with collapsible sidebar
- `components/note-content.tsx` - Note editor (markdown for public, plain text for private)

## Recent Changes

- **Simplified Private Notes**: Private notes now use simple plain text editing with a Textarea component
  - No formatting toolbar, bullet points, or checklists
  - Plain text only - matches the simplicity users requested
  - Private notes always stay in edit mode (like iOS Notes)
- **macOS-style Header**: Traffic light buttons (close/minimize/maximize), sidebar toggle, Notes title, new note button
- Restructured layout to match iOS Notes (search in header, collapsible sidebar)
- Migrated from Supabase to Replit PostgreSQL and Object Storage
- Created API routes for all database operations with input validation and ownership verification
- Implemented presigned URL upload flow for images
- Added unique index on slug column to prevent duplicates

## Content Storage

- **Public notes**: Store markdown, rendered with ReactMarkdown
- **Private notes**: Store plain text, edited with simple Textarea component
