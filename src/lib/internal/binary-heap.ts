export interface HeapNode<T> {
  readonly item: T
  priority: number
}

/**
 * Generic binary min-heap.
 * Used as priority queue for A* on the portal graph.
 * Ordering is by `priority` (ascending = min-heap).
 *
 * An item may only be pushed once while it is in the heap. Pushing an
 * item that is already present updates its priority instead, so the
 * internal item→index map can never point at a stale node.
 */
export class BinaryHeap<T> {
  private nodes: HeapNode<T>[] = [];
  private readonly indexMap: Map<T, number> = new Map();

  get size(): number {
    return this.nodes.length;
  }

  get isEmpty(): boolean {
    return this.nodes.length === 0;
  }

  push(item: T, priority: number): void {
    if (this.indexMap.has(item)) {
      // Re-push of a live item: keep one node per item so the
      // index map stays consistent — act like updatePriority.
      this.updatePriority(item, priority);
      return;
    }
    const node: HeapNode<T> = { item, priority };
    const idx = this.nodes.length;
    this.nodes.push(node);
    this.indexMap.set(item, idx);
    this.siftUp(idx);
  }

  pop(): T | undefined {
    if (this.nodes.length === 0) {
      return undefined;
    }
    const top = this.nodes[0]!;
    this.indexMap.delete(top.item);

    const last = this.nodes.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      this.indexMap.set(last.item, 0);
      this.siftDown(0);
    }
    return top.item;
  }

  peek(): T | undefined {
    return this.nodes[0]?.item;
  }

  updatePriority(item: T, priority: number): boolean {
    const idx = this.indexMap.get(item);
    if (idx === undefined) {
      return false;
    }

    const oldPriority = this.nodes[idx]!.priority;
    this.nodes[idx]!.priority = priority;
    if (priority < oldPriority) {
      this.siftUp(idx);
    }
    else if (priority > oldPriority) {
      this.siftDown(idx);
    }
    return true;
  }

  has(item: T): boolean {
    return this.indexMap.has(item);
  }

  getPriority(item: T): number | undefined {
    const idx = this.indexMap.get(item);
    return idx !== undefined ? this.nodes[idx]!.priority : undefined;
  }

  clear(): void {
    this.nodes = [];
    this.indexMap.clear();
  }

  private siftUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.nodes[idx]!.priority < this.nodes[parent]!.priority) {
        this.swap(idx, parent);
        idx = parent;
      }
      else {
        break;
      }
    }
  }

  private siftDown(idx: number): void {
    const n = this.nodes.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;

      if (left < n && this.nodes[left]!.priority < this.nodes[smallest]!.priority) {
        smallest = left;
      }
      if (right < n && this.nodes[right]!.priority < this.nodes[smallest]!.priority) {
        smallest = right;
      }

      if (smallest !== idx) {
        this.swap(idx, smallest);
        idx = smallest;
      }
      else {
        break;
      }
    }
  }

  private swap(i: number, j: number): void {
    const tmp = this.nodes[i]!;
    this.nodes[i] = this.nodes[j]!;
    this.nodes[j] = tmp;
    this.indexMap.set(this.nodes[i]!.item, i);
    this.indexMap.set(this.nodes[j]!.item, j);
  }
}
