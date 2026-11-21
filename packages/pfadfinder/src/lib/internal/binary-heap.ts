/** What `IntrusiveHeap` orders: an object that carries its own heap state. */
export interface HeapEntry {
  priority: number;
  /** Current position in the heap array; maintained by the heap. */
  index: number;
}

export interface HeapNode<T> extends HeapEntry {
  readonly item: T;
}

/**
 * Binary min-heap over entries that track their own position, so changing a
 * priority needs no lookup. An entry may be in one heap at a time and only
 * once; `update()` takes an entry that is in this heap.
 */
export class IntrusiveHeap<E extends HeapEntry> {
  private entries: E[] = [];

  get size(): number {
    return this.entries.length;
  }

  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  push(entry: E, priority: number): void {
    const idx = this.entries.length;
    entry.priority = priority;
    entry.index = idx;
    this.entries.push(entry);
    this.siftUp(idx);
  }

  pop(): E | undefined {
    if (this.entries.length === 0) {
      return undefined;
    }
    const top = this.entries[0]!;
    const last = this.entries.pop()!;
    if (this.entries.length > 0) {
      this.entries[0] = last;
      last.index = 0;
      this.siftDown(0);
    }
    return top;
  }

  peek(): E | undefined {
    return this.entries[0];
  }

  update(entry: E, priority: number): void {
    const oldPriority = entry.priority;
    entry.priority = priority;
    if (priority < oldPriority) {
      this.siftUp(entry.index);
    } else if (priority > oldPriority) {
      this.siftDown(entry.index);
    }
  }

  clear(): void {
    this.entries = [];
  }

  private siftUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.entries[idx]!.priority < this.entries[parent]!.priority) {
        this.swap(idx, parent);
        idx = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(idx: number): void {
    const n = this.entries.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;

      if (left < n && this.entries[left]!.priority < this.entries[smallest]!.priority) {
        smallest = left;
      }
      if (right < n && this.entries[right]!.priority < this.entries[smallest]!.priority) {
        smallest = right;
      }

      if (smallest !== idx) {
        this.swap(idx, smallest);
        idx = smallest;
      } else {
        break;
      }
    }
  }

  private swap(i: number, j: number): void {
    const a = this.entries[i]!;
    const b = this.entries[j]!;
    this.entries[i] = b;
    this.entries[j] = a;
    b.index = i;
    a.index = j;
  }
}

/**
 * Generic binary min-heap for items of any type.
 * Ordering is by `priority` (ascending = min-heap).
 *
 * An item may only be pushed once while it is in the heap. Pushing an
 * item that is already present updates its priority instead, so the
 * internal item→node map can never point at a stale node.
 */
export class BinaryHeap<T> {
  private readonly heap = new IntrusiveHeap<HeapNode<T>>();
  private readonly nodeOf: Map<T, HeapNode<T>> = new Map();

  get size(): number {
    return this.heap.size;
  }

  get isEmpty(): boolean {
    return this.heap.isEmpty;
  }

  push(item: T, priority: number): void {
    const known = this.nodeOf.get(item);
    if (known) {
      // Re-push of a live item: keep one node per item.
      this.heap.update(known, priority);
      return;
    }
    const node: HeapNode<T> = { item, priority, index: 0 };
    this.nodeOf.set(item, node);
    this.heap.push(node, priority);
  }

  pop(): T | undefined {
    const top = this.heap.pop();
    if (!top) {
      return undefined;
    }
    this.nodeOf.delete(top.item);
    return top.item;
  }

  peek(): T | undefined {
    return this.heap.peek()?.item;
  }

  updatePriority(item: T, priority: number): boolean {
    const node = this.nodeOf.get(item);
    if (!node) {
      return false;
    }
    this.heap.update(node, priority);
    return true;
  }

  has(item: T): boolean {
    return this.nodeOf.has(item);
  }

  getPriority(item: T): number | undefined {
    return this.nodeOf.get(item)?.priority;
  }

  clear(): void {
    this.heap.clear();
    this.nodeOf.clear();
  }
}
