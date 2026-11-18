# Moki · Messages lens design brief

Source: Figma `EKApBzDoI6hlAwkgJtq4KR`, page **lenses** (`247:18`). Canonical frame `358:5167` "Lenses · Messages · Brooke chat" (1600×980). The Archive page is out of scope. All values were read from Figma variables and design context, not from screenshots.

References:
- `messages-brooke-chat.png`: canonical frame `358:5167`
- `messages-plus-craft.png`: older 2-up variant `282:1613`, which has the Filter button and a tinted segment track
- `source-filter-menu.png`: source filter menu (closed, morphing, open), `366:5574`

## 1. Tokens

Font: **Plus Jakarta Sans** everywhere. Variables are given as `figma-name → value`.

| Token | Value | Use |
|---|---|---|
| `color/ink` | `#E4E9EF` | Primary text: row names, inspector values, person name |
| `color/muted` | `#FFFFFFCF` (white 81%) | Secondary text, sidebar labels, idle icons, previews |
| `color/faint` | `#FFFFFF8F` (white 56%) | Timestamps, "Related" label |
| `color/ground` | `#0D1116` | Defined on the Message row component (not used visibly) |
| `accent/cyan` | `#3DE8FF` | "All" source, selected lens icon, gradient start |
| `accent/violet` | `#8B6CFF` | Slack, gradient end |
| `accent/mint` | `#5CF2B0` | Text (iMessage/SMS) |
| `accent/amber` | `#FFC46B` | Email |
| `accent/coral` | `#FF6B8B` | Discord |
| `space/2,4,8,12,24` | 2 / 4 / 8 / 12 / 24 | Spacing scale |
| `radius/inset` | 4 | Segments inside a track |
| `radius/control` | 6 | Inputs, chips, icon buttons, segment track |
| `radius/row` | 8 | List rows, source badge |
| `radius/card` | 12 | Panes, bubbles, pinned cards |
| `radius/window` | 24 | Window |
| `radius/pill` | 999 | Name tag |

Type styles (Figma line-height 100 means CSS `normal`):

| Style | Spec |
|---|---|
| `Lenses/Text` | 13 / 400 |
| `Lenses/Control` | 13 / 500 |
| `Lenses/Control selected` | 13 / 700 |
| `Lenses/Small` | 11 / 600 |
| `Lenses/Title` | 15 / 700 |
| `Lenses/Body` | 15 / 400 / line-height 1.55 |

Effects and fills:
- **`Lenses/Glass`**: `backdrop-filter: blur(40px)` in Figma. The exported CSS uses `blur(20px)`, because a Figma radius is about 2× the CSS value. Shadow: `0 24px 48px #00000059`.
- **Glass fill and edge** (pane surface): `linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.03))`, `1px solid rgba(255,255,255,.28)`.
- **`Lenses/Popover`**: blur 60 (about 30px CSS), shadow `0 32px 80px #0000008C`.
- **`Lenses/Quiet fill`**: white at 6% opacity, i.e. `rgba(255,255,255,.06)`. Used for bubbles, inputs, chips and the email card.
- **Selection · lit** (shared selected style for lens rows, segments and the pinned card):
  - background: `linear-gradient(180deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 55%), linear-gradient(90deg, rgba(61,232,255,.22), rgba(139,108,255,.22))`
  - border: `1px solid rgba(255,255,255,.42)`
  - shadow: `0 2px 4px rgba(0,0,0,.22), 0 0 6px rgba(95,184,255,.22)`
- **Accent gradient**: `linear-gradient(90deg, #3DE8FF, #8B6CFF)`. Used for outgoing bubbles.
- **Window backdrop** (`Backdrop` component `333:2480`, instance `358:5168`, fills the window behind everything):
  - base: `linear-gradient(~160deg, #0B1030 0%, #090A1A 55%, #140A22 100%)`
  - Four blurred glows, each with Gaussian stdDeviation 80 (about `filter: blur(80px)`). Coordinates are on the 1600×980 frame:
    - ellipse at (350, 50), r 350×250, `#3B5BFF` at 45%
    - circle at (50, 800), r 300, `#FF4FA3` at 28%
    - ellipse at (1100, 860), r 350×210, `#00D8C6` at 22%
    - ellipse at (890, 280), r 210×160, `#8B6CFF` at 30%
  - A dim layer of black at 12% sits on top of everything.

## 2. App shell

1600×980 window with 12px outer padding and 12px gutters between columns:

```
| 12 | Sidebar 153 | 12 | Messages pane 377 | 12 | Thread pane 730 | 12 | Inspector 280 | 12 |
```

All columns are 956 tall (980 minus 2×12).
- The **Messages** and **Thread** panes are glass cards: radius 12, glass fill and edge, blur, shadow.
- The **Sidebar** and **Inspector** have no surface of their own. They sit directly on the backdrop.
- **Window chrome** (sits at the top of the sidebar, row `Window controls`, padding-left 8, gap 8):
  - Traffic lights are 12px dots: `#FF5F57`, then yellow and green. In Electron use native `trafficLightPosition` to match.
  - A flex spacer follows the dots, then Back and Forward buttons. Each is 36×36 with radius 8 and a 20px chevron-left/right icon.
- **Sidebar toggle**: bottom-left of the sidebar (`Bottom` row), 32×32, radius 6, 20px `sidebar-left` icon.
- **Inspector toggle**: bottom-right of the inspector (`Footer`), 32×32, 20px `sidebar-right` icon.
- Both toggles stay in place when their panel collapses. Collapsed sidebar is a 32px icon rail. Hovering the rail opens **Peek**, which floats the expanded sidebar over the content (`431:14729` variants Expanded / Collapsed / Peek). Collapsed inspector is 32 wide (`431:19625`).

## 3. Sidebar (`431:17211`, set `431:14729`)

Layout, top to bottom (column, width 153):
1. **Window controls**
2. An 8px gap
3. **Space picker** "Everything":
   - 40 tall, `border-bottom: 1px rgba(255,255,255,.28)`, backdrop blur 15
   - button: padding 8/4, gap 8, radius 4
   - 16px `infinity` icon, label `Lenses/Control` in muted, 20px chevron-down on the right
4. **Lenses**: padding-top 8, `border-bottom: 1px rgba(0,0,0,.09)`.
5. **Tab list** (flex 1):
   - divider
   - pinned tabs: Inbox (chat icon), Brooke (people icon)
   - divider
   - "New tab": plus icon, row opacity 0.81
   - open tabs: QWELL · #design, Kate · Audience (chat icons), Gmail (globe icon)
6. **Bottom**: the sidebar toggle.

**Row:**
- 32 tall, padding 0 8, gap 8, radius 8, full width
- 16px icon, label `Lenses/Control` 13/500 in `color/muted`, ellipsis
- idle icons are stroked white at 81%

**Selected row:**
- Selection · lit, padding-right 12
- **hugs its content width**: the "Messages" pill is not full width
- label `Lenses/Control selected` 13/700 white, icon stroke `accent/cyan`
- no hover state is drawn

**Divider:** a 16-tall block with a centered 1px line in white at 12%.

**Lens order and icons:**

| Lens | Icon |
|---|---|
| Day | sun |
| Messages | message-circle |
| Docs | file-text |
| Tasks | square-check |
| Calendar | calendar |
| Feed | globe |
| Notifications | ring (circle with an inner circle; nearest Lucide is `circle-dot` or `disc`) |
| Commerce | shopping-bag |
| Library | bookmark |
| Files | folder |
| Places | map-pin |
| People | users |
| Code | code |

## 4. Messages pane (`358:5214`)

- Glass card, padding 8, flex column, 377×956.

**Toolbar** (`407:11328`): row, `padding-bottom: 8`, `border-bottom: 1px rgba(255,255,255,.09)`.
- **Sources segmented control**:
  - padding 2, radius 6
  - transparent track in the canonical frame. The `282:1617` variant uses a white 6% track.
  - five **Icon segments**, each 40×32 with radius 4 and a 16px icon tinted in the source color
  - selected segment uses Selection · lit; idle segments have no fill
  - order: All (`infinity`, cyan), Text (`message-circle`, mint), Email (`mail`, amber), Slack (`hash`, violet), Discord (`headphones`, coral)
  - each segment needs a tooltip
- Flex spacer.
- **Search**: icon button with a 36-tall hit area (44 wide in the canonical frame because of padding 0 12), radius 6, 20px search icon in white 81%.
- **Filter**: hidden in the canonical frame (`407:11337`). Visible in `282:1613`, where it is a 36×36 icon button with the `filter` icon placed before Search.

**Threads** (scrolls on y, padding 8 0):
- **Pinned row** (`371:5605`): three equal cards, gap 8, padding-bottom 12.
  - Card: column, center-aligned, padding 12/8, gap 8, radius 12.
  - The selected card (Brooke) uses Selection · lit. This is how the open chat is shown in the canonical frame.
  - Avatar: 56px circle, `1px rgba(255,255,255,.28)` border, gradient fill, initials 15/700 white.
  - Name: 13 white, 700 when selected and 500 otherwise.
- **Message row** (component `250:115`, instances 361×58):
  - padding 12, gap 12, radius 8, `align-items: flex-start`
  - **Avatar**:
    - 32px circle (radius 16), filled with `linear-gradient(135deg, A 14%, B 86%)`
    - initials 13/500 white, two letters uppercase
    - colors are per person; pick deterministically by hashing the name
  - **Avatar palette** (pairs from the frame):

    | Start | End |
    |---|---|
    | `#9B7BFF` | `#5A4BA0` |
    | `#FFC94A` | `#F07B2E` |
    | `#7BE08A` | `#2E9E6B` |
    | `#6FA8FF` | `#4256D6` |
    | `#FFB86B` | `#D9534F` |
    | `#4FD1E8` | `#2C7FB8` |
    | `#C3A6FF` | `#7E5BEF` |
    | `#F5D76E` | `#C49A22` |
    | `#FF8A8A` | `#C2366B` |
    | `#86E3CE` | `#3BA99C` |
    | `#A0C4FF` | `#5E6AD2` |
    | `#FFA6C9` | `#E0607E` |
    | `#B9E769` | `#5FA83A` |
    | `#F78FB3` | `#9B59B6` |
    | `#55E6C1` | `#1B9CFC` |
    | `#FD7272` | `#C44569` |
    | `#82CCDD` | `#3C6382` |

    Pinned avatars use Brooke `#FF9A6B`→`#E5487A`, Mom `#FF7EB3`→`#B84FD8`, and Aish `#5BD6C8`→`#3A8FD9`.
  - **Source badge**:
    - 16×16, absolutely positioned at left 22 / top 22 of the avatar, so it overhangs 6px right and bottom
    - radius 8, solid fill in the source accent
    - `1px solid #0A0D1A` ring (creates the cutout look)
    - 10px glyph stroked `#0A0D1A` at about 1.1px
    - Email: amber with `mail`. Text: mint with `message-circle`. Slack: violet with `hash`. Discord is not shown in a row; by analogy use coral with `headphones`.
  - **Text column**: flex 1, gap 2.
    - Top line: name `Lenses/Control` 13/500 in `color/ink`, ellipsis, flex 1. Gap 8. Time `Lenses/Small` 11/600 in `color/faint`, no shrink.
    - Preview: `Lenses/Text` 13/400 in `color/muted`, one line with ellipsis.
    - Time format: "1h", "3h", then weekday "Sun"/"Sat"/"Fri", and so on.
    - Group threads prefix the preview with "Noor: …".
  - **Selected variant** (`250:106`, 60 tall; older and not used in the canonical frame):
    - fill `linear-gradient(90deg, rgba(61,232,255,.28), rgba(139,108,255,.18))`
    - border `1px rgba(61,232,255,.8)`, glow `0 0 10px rgba(61,232,255,.35)`
    - text `#F4F7FF`; the badge becomes the accent gradient with a cyan glow
    - The canonical design marks the open chat with the pinned card instead. For non-pinned chats, use Selection · lit on the row. This is my recommendation, not something the design shows.
  - **Hover**: not designed. Suggest a white 6% (Quiet fill) background.

## 5. Thread pane and composer (`396:11100`)

- **Pane**: glass card, 730×955.
  - Messages are bottom-anchored: the History column is pinned to the bottom with padding 16 and gap 12.
  - The top 40px holds a strip with white 3% fill and backdrop blur 3, so content dims as it scrolls under it.
- **Day separator**: centered text, 11/600 white, padding-top 8. Formats: "Wed, Nov 11", "Mon", "Today".
- **Bubble**:
  - padding 10/14, radius 12, text `Lenses/Body` 15/400/1.55, max width about 338 (text wraps at 310)
  - **Incoming**: Quiet fill, white text, left-aligned
  - **Outgoing**: accent gradient (90deg cyan→violet), text `#050F1F`, right-aligned
  - no tails, avatars or timestamps on bubbles
- **Email in thread**:
  - subject line "↪ Plant swap this weekend?" at 15/500 in muted
  - 8px gap, then a full-width card with Quiet fill, radius 12, padding 14/16, and the body in `Lenses/Body` white
- **Name tag** (`431:19694`, "tilted"):
  - glass pill (radius 999) with a `#FF9A6B`→`#E5487A` gradient fill and blur 30
  - shadow `0 32px 40px rgba(0,0,0,.55)`, padding 8 / 12 / 8 / 8
  - 35px avatar plus name 15/700 white
  - The pill is rotated about −3° and floats over the top center of the thread. The avatar counter-rotates (+2.95°) so it stays upright.
- **Composer**:
  - padding 0 6 6
  - Field: 44 tall, Quiet fill, radius 6, padding 0 6, gap 8
  - "Send via" chip: 32 tall, Quiet fill, radius 6, padding 0 10, 16px source icon (shows which channel the reply goes out on)
  - placeholder "Reply" at 15/400 white
  - mic icon button: 36×36 with a 20px glyph

## 6. Inspector (`431:19629`, set `431:19625`)

- Column, gap 24, radius 12, no fill.
- **Ask Moki**:
  - full width, 36 tall, Quiet fill (white 6%), radius 6, padding 12, gap 12
  - placeholder 13/400 in muted
  - 16px `mic` icon on the right
- Body below it: padding 0 16, gap 24, containing the following blocks.
- **Person header**: row, gap 12. 40px avatar (radius 20, gradient `#F6A97A`→`#D9577A`, initials 13/500), then name `Lenses/Title` 15/700 in ink.
- **Identities** (field rows): column, gap 8. Each row has gap 8: a label 13/400 in muted with a fixed width of 56 ("Text", "Email", "Slack"), then a value 13/400 in ink.
- **Tags**: chips in a row, gap 8. Each chip has Quiet fill, radius 6, padding 4/8, and 13/500 text in muted.
- **Related**:
  - label "Related" 13/400 in faint, then rows with gap 8
  - rows reuse the sidebar row: 32 tall, 16px icon (file-text, calendar, square-check), 13/500 in muted
- Spacer, then the **Footer** with the inspector toggle at the bottom right.

## 7. Icons

- The paths are **Lucide**. Infinity, message-circle, mail (the older Lucide rect-and-chevron version), hash, headphones, search, plus, chevron and shopping-bag all match Lucide geometry scaled from the 24px grid.
- Figma naming: `icon/<name>`, with masters in Components `250:29`.
- Stroke width:
  - 1.75px at 16px and 2.19px at 20px. In lucide-react that is `strokeWidth={2.625}` (24-grid units), or `absoluteStrokeWidth` with 1.75.
  - Line caps and joins are round.
- Sizes: 16 for rows and segments, 20 inside 36px icon buttons, 10 inside badges.

| Figma name | Lucide |
|---|---|
| today | sun |
| messages | message-circle |
| notes | file-text |
| tasks | square-check |
| calendar | calendar |
| globe | globe |
| commerce | shopping-bag |
| bookmarks | bookmark |
| files | folder |
| map-pin | map-pin |
| people | users |
| code | code |
| infinity | infinity |
| mail | mail |
| hash | hash |
| headset | headphones |
| search | search |
| filter | list-filter |
| mic | mic |
| sidebar-left / right | panel-left / panel-right |
| chevron-* | chevron-* |
| plus | plus |

## 8. Email and state frames

- **No frame on the lenses page shows the Email segment selected, and none shows an email inbox list.** Every Messages instance has "All" selected. To build an Email view, reuse the Message row with amber badges. The `Email` card in the thread (`371:5657`) is the only email-specific visual.
- **Other Messages frame**: `282:1613` "Lenses · Messages + Craft", in the `spaces` section. It differs from the canonical frame in these ways:
  - The Messages pane is 551.5 wide and shares 2-up space with a web pane.
  - The toolbar has a visible **Filter** button and a white 6% segment track.
  - The pane has no Pinned row.
  - The first row uses the 60px Selected variant (cyan-tinted) instead of a pinned card.
- **Source filter menu**: `366:5574` in "Lenses system" `333:2478`, with states Closed / Open (`366:5528` / `366:5551`) plus a morph sequence.
  - The Filter icon button morphs into a glass surface of 90×36 pills, each with a 16px icon and a label: Email, Text, Slack, Discord.
  - The menu uses `icon/messages` for Discord, while the segment uses headset. This is a design inconsistency; prefer `headphones`.
- **Empty and loading states for Messages: none exist.** The only empty frame is `337:3592` "⌘T · Empty", which is the omnibar, not Messages. Other related system components: `Glass card` `333:2530`, `Segment` `333:2488`, `Icon segment` `368:5581`, `Orb` colors `333:2528`.
