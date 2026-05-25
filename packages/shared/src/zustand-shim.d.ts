declare module "zustand" {
  export type SetState<T> = (partial: Partial<T> | T | ((state: T) => Partial<T> | T)) => void;
  export type GetState<T> = () => T;
  export interface UseBoundStore<T> {
    (): T;
    <U>(selector: (state: T) => U): U;
    getState(): T;
    setState: SetState<T>;
  }
  export function create<T>(initializer: (set: SetState<T>, get: GetState<T>) => T): UseBoundStore<T>;
}
