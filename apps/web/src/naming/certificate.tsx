import { ObjectPhoto } from "./object-photo";

/**
 * The naming-link response includes the object name, description, photo, and
 * submitted name. It does not include when the name was submitted, who
 * purchased the gift card, the gift-card amount, or a certificate number.
 * Those fields are omitted rather than filled in.
 */
export function NamingCertificate({
  objectName,
  description,
  photoUrl,
  submittedName,
}: {
  objectName: string;
  description: string;
  photoUrl: string | null;
  submittedName: string;
}) {
  return (
    <section
      id="naming-certificate"
      aria-label="Naming certificate"
      className="border-2 border-stone-300 bg-white px-6 py-8 sm:px-10"
    >
      <p className="text-sm uppercase tracking-[0.18em] text-stone-500">
        Udderly Ridiculous
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight">
        Naming certificate
      </h2>
      <p className="mt-6 text-lg">
        <span className="text-stone-600">Name </span>
        <span className="font-semibold">{submittedName}</span>
      </p>
      <p className="mt-2 text-lg">
        <span className="text-stone-600">Object </span>
        <span className="font-semibold">{objectName}</span>
      </p>
      {description ? (
        <p className="mt-4 max-w-prose text-stone-700">{description}</p>
      ) : null}
      <div className="mt-6 max-w-sm">
        <ObjectPhoto src={photoUrl} name={objectName} />
      </div>
      <p className="mt-8 text-sm text-stone-600">
        This certificate records the name submitted for this object. This name
        is recognized at Udderly Ridiculous from February 1, 2027 through
        January 31, 2028.
      </p>
    </section>
  );
}
