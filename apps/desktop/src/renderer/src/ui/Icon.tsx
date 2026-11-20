import type { LucideProps } from 'lucide-react'
import {
  Bookmark,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Code,
  Copy,
  Ellipsis,
  Expand,
  ExternalLink,
  FileText,
  Folder,
  Globe,
  Hash,
  Headphones,
  Infinity as InfinityIcon,
  ListFilter,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Mic,
  PanelLeft,
  PanelRight,
  Pause,
  Pin,
  Play,
  Plus,
  RotateCw,
  Search,
  ShoppingBag,
  SkipForward,
  SquareCheck,
  Star,
  Sun,
  Timer,
  Trash,
  Users,
  VolumeX,
  X
} from 'lucide-react'

/* Figma `icon/<name>` -> Lucide mapping (brief §7). `filter` is the newer
 * Lucide `list-filter`; Discord uses `headphones` (the source-filter menu's
 * `icon/messages` is a design inconsistency, per the brief). */
export const FIGMA_ICON_MAP = {
  today: Sun,
  messages: MessageCircle,
  notes: FileText,
  tasks: SquareCheck,
  calendar: Calendar,
  globe: Globe,
  notifications: CircleDot,
  commerce: ShoppingBag,
  bookmarks: Bookmark,
  files: Folder,
  'map-pin': MapPin,
  people: Users,
  code: Code,
  infinity: InfinityIcon,
  mail: Mail,
  hash: Hash,
  headset: Headphones,
  search: Search,
  filter: ListFilter,
  mic: Mic,
  'sidebar-left': PanelLeft,
  'sidebar-right': PanelRight,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'rotate-cw': RotateCw,
  expand: Expand,
  lock: Lock,
  'external-link': ExternalLink,
  plus: Plus,
  star: Star,
  x: X,
  trash: Trash,
  pin: Pin,
  ellipsis: Ellipsis,
  play: Play,
  pause: Pause,
  check: Check,
  'skip-forward': SkipForward,
  timer: Timer,
  copy: Copy,
  'volume-x': VolumeX,
  camera: Camera
} as const

export type FigmaIconName = keyof typeof FIGMA_ICON_MAP

export interface IconProps extends Omit<LucideProps, 'size' | 'children'> {
  name: FigmaIconName
  size?: number
}

/* 16px icons use strokeWidth 2.625 to match Figma's 1.75px strokes on the
 * 24px Lucide grid (2.625/24*16 = 1.75; at 20px it lands on 2.19, also per
 * the brief). Round caps/joins everywhere; 10px badge glyphs use the same
 * width (≈1.1px at 10px). */
export function Icon({
  name,
  size = 16,
  strokeWidth = 2.625,
  strokeLinecap = 'round',
  strokeLinejoin = 'round',
  ...rest
}: IconProps): React.JSX.Element {
  const C = FIGMA_ICON_MAP[name]
  return (
    <C
      size={size}
      strokeWidth={strokeWidth}
      strokeLinecap={strokeLinecap}
      strokeLinejoin={strokeLinejoin}
      {...rest}
    />
  )
}
