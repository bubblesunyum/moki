// Line-buffered stdout parsing for the helper's newline-delimited JSON-RPC.
// stdout arrives in arbitrary chunks; this splits complete `\n`-terminated
// lines off and holds the trailing partial line for the next chunk.

export class LineBuffer {
  private buf = ''

  /** Append a chunk, returning every complete line (without the newline). */
  push(chunk: string): string[] {
    this.buf += chunk
    const lines: string[] = []
    let idx: number
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      let line = this.buf.slice(0, idx)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      lines.push(line)
      this.buf = this.buf.slice(idx + 1)
    }
    return lines
  }

  /** Remaining partial line (empty when the buffer ends on a newline). */
  remainder(): string {
    return this.buf
  }

  /** Drop any buffered partial line (e.g. the helper died mid-line). */
  clear(): void {
    this.buf = ''
  }
}
