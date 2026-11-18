import { describe, expect, it } from 'vitest'
import { LineBuffer } from './lineBuffer'

describe('LineBuffer', () => {
  it('splits complete lines and holds the partial tail', () => {
    const buf = new LineBuffer()
    expect(buf.push('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}'])
    expect(buf.remainder()).toBe('')
  })

  it('buffers split chunks until the newline arrives', () => {
    const buf = new LineBuffer()
    expect(buf.push('{"id":1')).toEqual([])
    expect(buf.push(',"method":"x"}\n')).toEqual(['{"id":1,"method":"x"}'])
  })

  it('strips carriage returns and skips nothing else', () => {
    const buf = new LineBuffer()
    expect(buf.push('a\r\nb\n')).toEqual(['a', 'b'])
  })

  it('handles multiple pushes with several lines each', () => {
    const buf = new LineBuffer()
    expect(buf.push('1\n2\n3')).toEqual(['1', '2'])
    expect(buf.push('\n4\n')).toEqual(['3', '4'])
    expect(buf.remainder()).toBe('')
  })

  it('drops a buffered partial line on clear', () => {
    const buf = new LineBuffer()
    expect(buf.push('{"id":1')).toEqual([])
    buf.clear()
    expect(buf.remainder()).toBe('')
    expect(buf.push('{"id":2}\n')).toEqual(['{"id":2}'])
  })
})
