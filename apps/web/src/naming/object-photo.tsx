import { useEffect, useState } from "react";
import { safePhotoUrl } from "./format";

export function ObjectPhoto({
  src,
  name,
  emptyLabel = "No photograph",
}: {
  src: string | null;
  name: string;
  emptyLabel?: string;
}) {
  const photoUrl = safePhotoUrl(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  if (!photoUrl || failed) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center bg-stone-200 px-4 text-center text-sm text-stone-600">
        {emptyLabel}
        <span className="sr-only"> for {name}</span>
      </div>
    );
  }

  return (
    <img
      src={photoUrl}
      alt=""
      className="aspect-[4/3] w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}
