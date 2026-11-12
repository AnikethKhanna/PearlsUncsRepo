import Image from "next/image";

/** Original logo from nomoreunder.org; provenance is recorded in docs/branding.md. */
export function Brand() {
  return <Image src="/brand/nmu-logo.png" alt="No More Under" width={298} height={139} unoptimized priority className="h-14 w-auto" />;
}
