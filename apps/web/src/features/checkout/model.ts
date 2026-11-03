export function canReleaseAttempt(
  status: number,
  fields: Record<string, string>,
) {
  return (
    status === 400 || status === 422 || (status === 409 && !fields.request_key)
  );
}
