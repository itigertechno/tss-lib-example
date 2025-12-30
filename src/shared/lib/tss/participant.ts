export type PreParams = Record<string, any>;

/**
 * Участник группы.
 *
 * Например:
 * ```js
 * {
 *      id: "alice",
 *      moniker: "Alice",
 *      uniqueKey: "1"
 * }
 * ```
 */
export interface Participant {
  id: string;
  moniker: string;
  uniqueKey: string;
}
