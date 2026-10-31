import { describe, expect, it } from 'vitest';
import { BinaryHeap } from '../src/lib/internal/binary-heap.js';

describe('BinaryHeap', () => {
  it('pushes and pops in priority order', () => {
    const heap = new BinaryHeap<number>();
    heap.push(5, 5);
    heap.push(1, 1);
    heap.push(3, 3);
    heap.push(2, 2);
    heap.push(4, 4);

    expect(heap.pop()).toBe(1);
    expect(heap.pop()).toBe(2);
    expect(heap.pop()).toBe(3);
    expect(heap.pop()).toBe(4);
    expect(heap.pop()).toBe(5);
    expect(heap.pop()).toBeUndefined();
  });

  it('isEmpty on new heap', () => {
    const heap = new BinaryHeap<number>();
    expect(heap.isEmpty).toBe(true);
  });

  it('size reflects pushes', () => {
    const heap = new BinaryHeap<number>();
    heap.push(10, 10);
    heap.push(20, 20);
    expect(heap.size).toBe(2);
    heap.pop();
    expect(heap.size).toBe(1);
  });

  it('peek returns min without removing', () => {
    const heap = new BinaryHeap<number>();
    heap.push(30, 30);
    heap.push(10, 10);
    heap.push(20, 20);
    expect(heap.peek()).toBe(10);
    expect(heap.size).toBe(3);
  });

  it('updatePriority changes order', () => {
    const heap = new BinaryHeap<string>();
    heap.push('a', 5);
    heap.push('b', 3);
    heap.push('c', 4);

    heap.updatePriority('a', 1);
    expect(heap.pop()).toBe('a');
  });

  it('has checks membership', () => {
    const heap = new BinaryHeap<string>();
    heap.push('x', 1);
    expect(heap.has('x')).toBe(true);
    expect(heap.has('y')).toBe(false);
  });

  it('getPriority returns set priority', () => {
    const heap = new BinaryHeap<string>();
    heap.push('item', 42);
    expect(heap.getPriority('item')).toBe(42);
    expect(heap.getPriority('missing')).toBeUndefined();
  });

  it('clear empties the heap', () => {
    const heap = new BinaryHeap<number>();
    heap.push(1, 1);
    heap.push(2, 2);
    heap.clear();
    expect(heap.isEmpty).toBe(true);
  });

  it('re-pushing a live item updates its priority instead of duplicating it', () => {
    const heap = new BinaryHeap<string>();
    heap.push('a', 5);
    heap.push('b', 3);
    // Duplicate push of 'a' with a better priority: must not create a
    // second node (which would corrupt the item→index map).
    heap.push('a', 1);

    expect(heap.size).toBe(2);
    expect(heap.pop()).toBe('a');
    expect(heap.pop()).toBe('b');
    expect(heap.has('a')).toBe(false);
  });

  it('re-pushing a live item with a worse priority keeps the better one', () => {
    const heap = new BinaryHeap<string>();
    heap.push('a', 1);
    heap.push('b', 2);
    heap.push('a', 9);

    expect(heap.size).toBe(2);
    expect(heap.getPriority('a')).toBe(9);
    expect(heap.pop()).toBe('b');
    expect(heap.pop()).toBe('a');
  });

  it('a popped item can be pushed again', () => {
    const heap = new BinaryHeap<string>();
    heap.push('a', 1);
    expect(heap.pop()).toBe('a');
    expect(heap.has('a')).toBe(false);

    heap.push('a', 2);
    expect(heap.size).toBe(1);
    expect(heap.pop()).toBe('a');
  });
});
