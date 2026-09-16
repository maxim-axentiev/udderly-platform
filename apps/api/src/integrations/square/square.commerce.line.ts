export function orderLineExternalId(input: {
  orderId: string;
  version: unknown;
  uid: string | undefined;
  index: number;
}): string {
  if (input.uid) {
    return `${input.orderId}:${input.uid}`;
  }
  const version =
    typeof input.version === "number" && Number.isFinite(input.version)
      ? String(input.version)
      : "none";
  return `${input.orderId}:version:${version}:pos:${input.index}`;
}
