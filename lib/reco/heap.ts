// Binary min-heap (priority queue). Pure data structure — the priority queue
// that powers Dijkstra (graph.ts). Keyed by a numeric priority; smaller = higher
// priority (popped first). We use lazy deletion in Dijkstra (push duplicates,
// skip stale pops) instead of decrease-key, so this stays a plain binary heap.

export class MinHeap<T> {
  private keys: number[] = [];
  private values: T[] = [];

  get size(): number {
    return this.keys.length;
  }

  isEmpty(): boolean {
    return this.keys.length === 0;
  }

  push(key: number, value: T): void {
    this.keys.push(key);
    this.values.push(value);
    this.siftUp(this.keys.length - 1);
  }

  /** Remove and return the smallest-key entry, or undefined when empty. */
  pop(): { key: number; value: T } | undefined {
    const n = this.keys.length;
    if (n === 0) return undefined;
    const top = { key: this.keys[0], value: this.values[0] };
    const lastKey = this.keys.pop()!;
    const lastVal = this.values.pop()!;
    if (n > 1) {
      this.keys[0] = lastKey;
      this.values[0] = lastVal;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.keys.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < n && this.keys[left] < this.keys[smallest]) smallest = left;
      if (right < n && this.keys[right] < this.keys[smallest]) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i];
    this.keys[i] = this.keys[j];
    this.keys[j] = k;
    const v = this.values[i];
    this.values[i] = this.values[j];
    this.values[j] = v;
  }
}
