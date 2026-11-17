export async function isValidBearerToken(
  authorization: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  if (!expected || expected.length < 32) return false;
  if (!authorization?.startsWith("Bearer ")) return false;

  const supplied = authorization.slice(7);
  if (!supplied) return false;

  const digest = async (value: string): Promise<Uint8Array> =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );

  const [left, right] = await Promise.all([digest(supplied), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
