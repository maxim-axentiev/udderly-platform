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
      className="chunky-card rounded-3xl bg-farm-beige px-6 py-8 sm:px-10"
    >
      <p className="font-display text-sm font-black uppercase tracking-[0.18em] text-primary-accent">
        Udderly Ridiculous
      </p>
      <h2 className="mt-3 font-display text-4xl font-black uppercase text-headline">
        Naming certificate
      </h2>
      <p className="mt-6 font-accent text-3xl text-headline">{submittedName}</p>
      <p className="mt-2 text-lg text-body-copy">{objectName}</p>
      {description ? (
        <p className="mt-4 max-w-prose text-body-copy">{description}</p>
      ) : null}
      <div className="mt-6 max-w-sm overflow-hidden rounded-2xl border-2 border-headline">
        <ObjectPhoto src={photoUrl} name={objectName} />
      </div>
      <p className="mt-8 text-sm text-body-copy">
        This certificate records the name submitted for this object. This name
        is recognized at Udderly Ridiculous from February 1, 2027 through
        January 31, 2028.
      </p>
    </section>
  );
}
