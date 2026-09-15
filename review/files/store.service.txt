import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildSeed } from './seed';
import { StoreShape } from './interfaces';

// The whole "database" for the alpha: one JSON file on disk, held in memory
// and flushed back down on a short timer. Repository classes (OrdersRepo,
// CouriersRepo, LedgerRepo, OutboxRepo, ...) read and write through this
// service so nothing else touches the filesystem directly. Swapping this out
// for real Postgres later means only rewriting the repositories against
// postgres.repo.stub.ts, the rest of the app stays the same.
@Injectable()
export class StoreService implements OnModuleInit, OnModuleDestroy {
  private data!: StoreShape;
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly filePath = path.join(__dirname, '..', '..', 'data', 'store.json');

  onModuleInit(): void {
    this.load();
    this.flushTimer = setInterval(() => this.flush(), 2000);
  }

  onModuleDestroy(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush();
  }

  private load(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = JSON.parse(raw) as StoreShape;
    } else {
      this.data = buildSeed();
      this.writeNow();
    }
  }

  private writeNow(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    this.dirty = false;
  }

  // Called constantly (courier position ticks). Marks the store dirty and
  // relies on the 2s timer to actually hit disk, so a busy simulator loop
  // does not turn into a write on every single tick.
  markDirty(): void {
    this.dirty = true;
  }

  // Called after anything a client is about to read back immediately
  // (order created, status changed) so a crash right after does not lose it.
  persist(): void {
    this.writeNow();
  }

  flush(): void {
    if (this.dirty) this.writeNow();
  }

  get state(): StoreShape {
    return this.data;
  }
}
