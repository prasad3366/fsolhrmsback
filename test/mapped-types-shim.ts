export function PartialType<T extends new (...args: any[]) => object>(classRef: T) {
  return class PartialTypeClass extends classRef {
    constructor(...args: any[]) {
      super(...args);
    }
  };
}
