/** Fixed-capacity FIFO; insertion and eviction never reindex retained records. */
export class RingBuffer<T> {
  private readonly values: Array<T | undefined>
  private head = 0
  private size = 0

  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('Buffer capacity must be a positive safe integer')
    }
    this.values = new Array(capacity)
  }

  push(value: T): T | undefined {
    const index = (this.head + this.size) % this.capacity
    const evicted = this.values[index]
    this.values[index] = value
    if (this.size === this.capacity) {
      this.head = (this.head + 1) % this.capacity
    } else {
      this.size += 1
    }
    return evicted
  }

  toArray(): T[] {
    return Array.from({ length: this.size }, (_, index) => this.values[(this.head + index) % this.capacity] as T)
  }

  clear(): void {
    this.values.fill(undefined)
    this.head = this.size = 0
  }
}
