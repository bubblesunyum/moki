import type { DocItem, DocSource } from '../../../../../../../packages/protocol/src/index'

/* CANONICAL Docs fixture table — the single source of truth for Docs lens
 * fixtures (12 per source with real open URLs, so the lens UX lands before
 * any network). The Swift helper mirrors this table row-for-row under
 * MOKI_FIXTURES=1 (DriveFixtures.listFiles, notionFixtureRecents,
 * DocsFixtures.craftRecents); the two sides cannot share one file across
 * the TS/Swift boundary, so the id/title/URL lists are pinned by contract
 * tests on both sides ("docs fixtures mirror the canonical contract" here,
 * "fixtureRowsMirrorCanonicalContract" in DocsRecentsTests). Change rows
 * here AND there together, or the contract tests fail.
 *
 * `updatedAt` stays within the
 * last day, newest first — generated relative to now so ?mokiDoc pins and
 * "within last day" hold at any wall-clock time. */

function at(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

function drive(id: string, title: string, minutesAgo: number): DocItem {
  return { id, title, source: 'drive', updatedAt: at(minutesAgo), openUrl: `https://drive.google.com/file/d/${id}/view` }
}

function notion(id: string, title: string, minutesAgo: number): DocItem {
  return {
    id,
    title,
    source: 'notion',
    updatedAt: at(minutesAgo),
    openUrl: `https://www.notion.so/${id}`
  }
}

function craft(id: string, editorId: string, title: string, minutesAgo: number): DocItem {
  return {
    id,
    title,
    source: 'craft',
    updatedAt: at(minutesAgo),
    /* Craft previews at its web editor built from the API's clickableLink
     * values (spaceId + documentId); a row with no validated link carries
     * an empty openUrl and opens natively via deepLink. */
    openUrl: `https://docs.craft.do/editor/d/fixture-space/${encodeURIComponent(editorId)}`,
    deepLink: `craftdocs://open?spaceId=fixture-space&documentId=${editorId}`
  }
}

export const DOC_SOURCES: DocSource[] = ['drive', 'notion', 'craft']

export const DOC_SOURCE_LABEL: Record<DocSource, string> = {
  drive: 'Drive',
  notion: 'Notion',
  craft: 'Craft'
}

/* Preview rule shared by the lens: a row previews in the right pane only
 * when it carries an in-pane URL. A Craft row with no validated
 * clickableLink carries an empty openUrl, opens out-of-app via its
 * craftdocs:// deepLink, and never touches the selection. */
export function isPreviewable(doc: DocItem): boolean {
  return doc.openUrl !== ''
}

export const DOC_FIXTURES: Record<DocSource, DocItem[]> = {
  drive: [
    drive('1a2b3c4d5e6f7g8h9i0j', 'Launch plan v3', 12),
    drive('2b3c4d5e6f7g8h9i0j1k', 'Board deck — November', 48),
    drive('3c4d5e6f7g8h9i0j1k2l', 'Hiring rubric', 95),
    drive('4d5e6f7g8h9i0j1k2l3m', 'Pricing experiments', 150),
    drive('5e6f7g8h9i0j1k2l3m4n', 'Offsite notes', 220),
    drive('6f7g8h9i0j1k2l3m4n5o', 'Q4 budget', 300),
    drive('7g8h9i0j1k2l3m4n5o6p', 'Design critique thread', 410),
    drive('8h9i0j1k2l3m4n5o6p7q', 'API migration checklist', 520),
    drive('9i0j1k2l3m4n5o6p7q8r', 'Customer visit notes', 640),
    drive('0j1k2l3m4n5o6p7q8r9s', 'Brand refresh brief', 780),
    drive('1k2l3m4n5o6p7q8r9s0t', 'All-hands agenda', 900),
    drive('2l3m4n5o6p7q8r9s0t1u', 'Reading list', 1100)
  ],
  notion: [
    notion('Tansy-Roadmap-9f2c1a', 'Tansy roadmap', 20),
    notion('Weekly-Review-7d4b2e', 'Weekly review', 65),
    notion('Meeting-Notes-3a8f1c', 'Meeting notes', 130),
    notion('Product-Spec-5e6a9d', 'Life OS spec', 200),
    notion('Habit-Tracker-1b3d7f', 'Habit tracker', 280),
    notion('Book-Notes-8c2e4a', 'Book notes', 360),
    notion('Travel-Plans-6f1a3c', 'Travel plans', 470),
    notion('Gift-Ideas-2d9b5e', 'Gift ideas', 590),
    notion('Home-Renovation-4a7c1e', 'Home renovation', 700),
    notion('Side-Project-9e3f8b', 'Side project log', 830),
    notion('Recipes-5b8d2f', 'Recipes', 960),
    notion('Journal-7c1e6a', 'Journal', 1200)
  ],
  craft: [
    craft('s/launch-checklist-a1b2c3', 'A7C5E2D4-93B1-4F0E-9F27-F1B2C3D4E5F6', 'Launch checklist', 35),
    craft('s/essay-draft-d4e5f6', '4b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e', 'Essay draft', 80),
    craft('s/trip-itinerary-g7h8i9', 'B3A4F5E6-D7C8-4A9B-8C0D-1E2F3A4B5C6D', 'Trip itinerary', 160),
    craft('s/reading-notes-j0k1l2', '7d8e9f0a-1b2c-4d3e-9f0a-1b2c3d4e5f6a', 'Reading notes', 240),
    craft('s/garden-plan-m3n4o5', 'C9D8E7F6-A5B4-4C3D-8E9F-0A1B2C3D4E5F', 'Garden plan', 330),
    craft('s/talk-outline-p6q7r8', '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d', 'Talk outline', 450),
    craft('s/budget-review-s9t0u1', 'D0E1F2A3-B4C5-4D6E-8F90-1A2B3C4D5E6F', 'Budget review', 570),
    craft('s/book-club-v2w3x4', '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c', 'Book club picks', 690),
    craft('s/workout-log-y5z6a7', 'E1F2A3B4-C5D6-4E7F-8A9B-0C1D2E3F4A5B', 'Workout log', 810),
    craft('s/gift-list-b8c9d0', '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d', 'Gift list', 930),
    craft('s/home-inventory-e1f2g3', 'F2A3B4C5-D6E7-4F8A-9B0C-1D2E3F4A5B6C', 'Home inventory', 1050),
    craft('s/ideas-inbox-h4i5j6', '3b4c5d6e-7f8a-4b9c-0d1e-2f3a4b5c6d7e', 'Ideas inbox', 1180)
  ]
}
