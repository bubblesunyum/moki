import { useState } from 'react'
import {
  Avatar,
  AvatarBadge,
  FIGMA_ICON_MAP,
  GlassPane,
  Icon,
  IconButton,
  Row,
  SegmentGroup,
  Text,
  type FigmaIconName
} from '../ui'

const SOURCE_OPTIONS = [
  { value: 'all', icon: 'infinity', label: 'All sources', accent: 'var(--moki-accent-cyan)' },
  { value: 'text', icon: 'messages', label: 'Text', accent: 'var(--moki-accent-mint)' },
  { value: 'email', icon: 'mail', label: 'Email', accent: 'var(--moki-accent-amber)' },
  { value: 'slack', icon: 'hash', label: 'Slack', accent: 'var(--moki-accent-violet)' },
  { value: 'discord', icon: 'headset', label: 'Discord', accent: 'var(--moki-accent-coral)' }
] as const satisfies ReadonlyArray<{
  value: string
  icon: FigmaIconName
  label: string
  accent: string
}>

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GlassPane padding="16px" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Text variant="title">{title}</Text>
      {children}
    </GlassPane>
  )
}

export function PrimitivesPage(): React.JSX.Element {
  const [source, setSource] = useState('all')
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        padding: '24px 16px 48px',
        boxSizing: 'border-box'
      }}
    >
      <div style={{ width: '100%', maxWidth: 920, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Text variant="title" as="div" style={{ fontSize: 20 }}>
            Primitives
          </Text>
          <Text variant="control" as="div">
            Tokens + primitives from docs/design/messages-brief.md · dev only
          </Text>
        </div>

        <Section title="Icon — Figma icon/* mapping (16px default)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            {(Object.keys(FIGMA_ICON_MAP) as FigmaIconName[]).map((name) => (
              <span
                key={name}
                title={name}
                style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
              >
                <Icon name={name} />
                <Text variant="small">{name}</Text>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Icon name="search" size={20} />
            <Text variant="small">20px in 36px buttons · 10px in badges</Text>
            <AvatarBadge accent="amber" icon="mail" label="Email" />
          </div>
        </Section>

        <Section title="Avatar — initials + name-seeded gradient (Brooke twice: same gradient)">
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Avatar name="Brooke" />
            <Avatar name="Brooke" />
            <Avatar name="Mom" badge={<AvatarBadge accent="mint" icon="messages" label="Text" />} />
            <Avatar
              name="Aish"
              size={56}
              badge={<AvatarBadge accent="amber" icon="mail" label="Email" />}
            />
            <Avatar name="Ada Lovelace" />
            <Avatar name="Noor" size={40} />
          </div>
        </Section>

        <Section title="IconButton — 36px">
          <div style={{ display: 'flex', gap: 8 }}>
            <IconButton icon="chevron-left" label="Back" />
            <IconButton icon="chevron-right" label="Forward" />
            <IconButton icon="search" label="Search" />
            <IconButton icon="mic" label="Dictate" />
          </div>
        </Section>

        <Section title={`SegmentGroup — selected: ${source}`}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <SegmentGroup
              label="Sources"
              value={source}
              onChange={setSource}
              options={[...SOURCE_OPTIONS]}
            />
            <SegmentGroup
              label="Sources with track"
              value={source}
              onChange={setSource}
              options={[...SOURCE_OPTIONS]}
              variant="track"
            />
          </div>
        </Section>

        <Section title="Text — six Lenses/* styles">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Text variant="text">Lenses/Text · 13/400 · preview copy</Text>
            <Text variant="control">Lenses/Control · 13/500 · row labels</Text>
            <Text variant="control-selected">Lenses/Control selected · 13/700</Text>
            <Text variant="small">Lenses/Small · 11/600 · timestamps</Text>
            <Text variant="title">Lenses/Title · 15/700 · person name</Text>
            <Text variant="body">Lenses/Body · 15/400/1.55 · bubble copy with room to breathe</Text>
          </div>
        </Section>

        <Section title="Row — list row with leading/trailing slots">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row
              leading={<Avatar name="Brooke" badge={<AvatarBadge accent="mint" icon="messages" label="Text" />} />}
              title="Brooke"
              meta="1h"
              preview="Noor: the plant swap is still on for Saturday"
            />
            <Row
              leading={<Avatar name="Mom" />}
              title="Mom"
              meta="Sun"
              preview="Call when you land ✈️"
              selected
              trailing={<IconButton icon="chevron-right" label="Open" />}
            />
          </div>
        </Section>

        <Section title="Selection · lit — shared selected style">
          <div
            className="selected-lit"
            style={{ borderRadius: 'var(--moki-radius-row)', padding: '12px 16px' }}
          >
            <Text variant="control-selected">Sidebar rows, segments and list rows share this.</Text>
          </div>
        </Section>
      </div>
    </main>
  )
}
