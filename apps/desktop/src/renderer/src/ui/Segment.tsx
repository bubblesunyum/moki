import { useRef, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type Ref } from 'react'
import './Segment.css'
import { Icon, type FigmaIconName } from './Icon'

export interface SegmentOption {
  value: string
  icon: FigmaIconName
  label: string
  accent?: string
}

export interface SegmentProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onSelect'> {
  value: string
  icon: FigmaIconName
  label: string
  accent?: string
  selected?: boolean
  onSelect?: (value: string) => void
  ref?: Ref<HTMLButtonElement>
}

export function Segment({
  value,
  icon,
  label,
  accent,
  selected = false,
  onSelect,
  onClick,
  className,
  type = 'button',
  ref,
  ...rest
}: SegmentProps): React.JSX.Element {
  return (
    <button
      type={type}
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      data-value={value}
      {...rest}
      ref={ref}
      onClick={(e) => {
        onSelect?.(value)
        onClick?.(e)
      }}
      className={['moki-segment', selected ? 'selected-lit' : null, className]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon name={icon} size={16} color={accent} />
    </button>
  )
}

export type SegmentVariant = 'default' | 'track'

export interface SegmentGroupProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  value: string
  onChange: (value: string) => void
  options: SegmentOption[]
  label: string
  variant?: SegmentVariant
}

export function SegmentGroup({
  value,
  onChange,
  options,
  label,
  variant = 'default',
  className,
  onKeyDown,
  ...rest
}: SegmentGroupProps): React.JSX.Element {
  const buttons = useRef(new Map<string, HTMLButtonElement>())

  function select(next: string): void {
    onChange(next)
    buttons.current.get(next)?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const index = options.findIndex((opt) => opt.value === value)
    let next: number | null = null
    switch (e.key) {
      case 'ArrowRight':
        next = (index + 1) % options.length
        break
      case 'ArrowLeft':
        next = (index - 1 + options.length) % options.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = options.length - 1
        break
      default:
        break
    }
    onKeyDown?.(e)
    if (next === null || options[next] === undefined) return
    e.preventDefault()
    select(options[next].value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      {...rest}
      onKeyDown={handleKeyDown}
      className={['moki-segment-group', variant === 'track' ? 'moki-segment-group-track' : null, className]
        .filter(Boolean)
        .join(' ')}
    >
      {options.map((opt) => (
        <Segment
          key={opt.value}
          value={opt.value}
          icon={opt.icon}
          label={opt.label}
          accent={opt.accent}
          selected={opt.value === value}
          tabIndex={opt.value === value ? 0 : -1}
          onSelect={onChange}
          ref={(el) => {
            if (el) buttons.current.set(opt.value, el)
            else buttons.current.delete(opt.value)
          }}
        />
      ))}
    </div>
  )
}
