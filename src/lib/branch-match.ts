/** A branch a customer can choose (open now), in their language. */
export type BranchChoice = { id: string; name: string; address: string | null };

/** A branch named by the customer (in chat), among the open ones: exact name first, then a partial match. */
export function matchBranch(choices: BranchChoice[], named: string): BranchChoice | null {
  const needle = named.trim().toLowerCase();
  if (!needle) return null;
  return (
    choices.find((b) => b.name.toLowerCase() === needle) ??
    choices.find((b) => b.name.toLowerCase().includes(needle) || needle.includes(b.name.toLowerCase())) ??
    null
  );
}
