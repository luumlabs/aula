// Tipos del puente que expone preload.ts en la página del compositor.
export interface VtBridge {
  job(): Promise<unknown>
  write(rel: string, data: Uint8Array): Promise<string>
  log(msg: unknown): void
  done(result: unknown): void
}

export const vt = (globalThis as unknown as { vt: VtBridge }).vt
