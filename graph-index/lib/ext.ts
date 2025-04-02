export function mapValuesPromise<T extends Record<string, V>, V, W>(
  record: T,
  f: (v: V) => Promise<W>,
): Promise<{ [P in keyof T]: W }> {
  return Promise.all(
    (Object.entries(record)).map(([key, v]) => f(v).then((w) => [key, w])),
  ).then((entries) => Object.fromEntries(entries)) as Promise<
    { [P in keyof T]: W }
  >;
}
