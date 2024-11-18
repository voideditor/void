import { LRUCache } from 'lru-cache';

const DEFAULT_MAX_SIZE = 20


export class SimpleLRUCache<T extends {}> {
	private cache: LRUCache<number, T>;
	private maxSize: number
	public length: number

	constructor(maxSize?: number) {

		maxSize = maxSize ?? DEFAULT_MAX_SIZE

		this.cache = new LRUCache<number, T>({ max: maxSize });
		this.length = 0
		this.maxSize = maxSize
	}

	push(value: T): void {
		const key = this.cache.size;
		this.cache.set(key, value);
		this.length++
		this.length = Math.min(this.length, this.maxSize)
	}

	values() {
		return this.cache.values()
	}


}