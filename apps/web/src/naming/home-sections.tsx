import {
  Award,
  CalendarCheck,
  CalendarClock,
  CalendarHeart,
  CreditCard,
  Gift,
  Mail,
  MousePointerClick,
  PartyPopper,
  PenLine,
  ScrollText,
  Sparkles,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./accordion";
import { Button } from "./button";

const NAME_MAX_LENGTH = 40;
const DATES = {
  buyDeadline: "December 31, 2026",
  nameDeadline: "January 14, 2027",
  fameStart: "February 1, 2027",
  fameEnd: "January 31, 2028",
};

const FAQS = [
  {
    q: "What exactly am I buying?",
    a: "An Udderly Ridiculous Farm Life gift card, redeemable toward our farm experiences. Naming rights to a farm object, a digital certificate and a Wall of Names spot are promotional bonuses for qualifying purchases.",
  },
  {
    q: "How do I receive the gift card?",
    a: "Your gift card is delivered by email through FareHarbor, our checkout provider.",
  },
  {
    q: "How do I receive the naming link?",
    a: "Once your qualifying payment is confirmed, you'll receive a separate email from Udderly Ridiculous containing your private link to name your object.",
  },
  {
    q: "Can I buy this as a gift for someone else?",
    a: "Absolutely — that's the whole idea! The gift card and naming rights make a memorable present.",
  },
  {
    q: "Can I give the gift card myself instead of having it emailed to the recipient?",
    a: "Yes. Enter your own email address at checkout. You'll receive both the gift card and the naming email, so you can present the gift whenever you're ready.",
  },
  {
    q: "What if I purchase a gift card for less than the object's minimum?",
    a: "Your gift card is still valid, but it won't include naming rights, the certificate or Wall of Names recognition. We'll email you automatically to let you know.",
  },
  {
    q: "How long do naming rights last?",
    a: `One year, from ${DATES.fameStart} to ${DATES.fameEnd}.`,
  },
  {
    q: "When is the naming deadline?",
    a: `Submit your name by ${DATES.nameDeadline} at 11:59 p.m. Eastern Time. You can name your object right after purchasing. Names must be family-friendly and are reviewed by our farm team.`,
  },
  {
    q: "What names are allowed?",
    a: `Family-friendly names up to ${NAME_MAX_LENGTH} characters, including spaces and punctuation. Offensive or inappropriate names are not allowed.`,
  },
  {
    q: "What happens if my chosen object is already claimed?",
    a: "Each object can only be claimed once. If it's marked Claimed or On Hold, pick another available object — there are plenty of ridiculous things left.",
  },
  {
    q: "Can I redeem the gift card after the campaign ends?",
    a: "The campaign dates apply only to naming rights. They do not determine your gift card's redemption period.",
  },
  {
    q: "What is the Wall of Names?",
    a: "A large poster inside our farm store listing every named object and its new name, displayed for the one-year recognition period.",
  },
];

function SectionTitle({
  kicker,
  title,
  intro,
}: {
  kicker?: string;
  title: string;
  intro?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      {kicker ? (
        <p className="font-accent text-xl italic text-primary-accent">{kicker}</p>
      ) : null}
      <h2 className="mt-1 font-display text-[clamp(2.4rem,7vw,5rem)] font-black uppercase leading-[0.85] text-headline">
        {title}
      </h2>
      {intro ? (
        <p className="mx-auto mt-4 max-w-2xl text-lg text-body-copy">{intro}</p>
      ) : null}
    </div>
  );
}

export function CampaignHome({ catalog }: { catalog: ReactNode }) {
  return (
    <main className="overflow-x-clip">
      <Hero />
      <WhatYouGet />
      <HowItWorks />
      <ImportantDates />
      <section id="objects" className="scroll-mt-20 bg-farm-blue px-5 py-20 md:px-8 md:py-28">
        <SectionTitle title="Meet the Things That Need Names." />
        <BeforeYouBuy />
        <div className="mx-auto mt-10 max-w-[1400px]">{catalog}</div>
      </section>
      <Faq />
      <FinalCta />
    </main>
  );
}

function Hero() {
  return (
    <section className="relative isolate flex min-h-[32rem] items-center overflow-hidden md:min-h-[40rem]">
      <img
        src="/campaign/farm-sunset.jpg"
        alt="Sunset over the pastures at Udderly Ridiculous Farm Life"
        width={1920}
        height={1080}
        fetchPriority="high"
        className="absolute inset-0 -z-10 h-full w-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-headline/55" aria-hidden="true" />
      <div className="mx-auto max-w-4xl px-5 py-16 text-center md:px-8">
        <h1 className="font-display text-[clamp(3.6rem,14vw,10rem)] font-black uppercase leading-[0.8] text-background">
          Name That <span className="text-secondary-accent">Thing!</span>
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-background md:text-xl">
          Give the gift of core memories with an Udderly Ridiculous Farm Life
          gift card and gift naming rights to a real item on the farm, from
          every day tools to the goat tower. Promo ends December 31.
          First-come, first-served.
        </p>
      </div>
    </section>
  );
}

function WhatYouGet() {
  const bonuses = [
    {
      icon: CalendarHeart,
      title: "One Year of Naming Rights",
      body: "Choose a real farm object and give it a name that's entirely your own, within our family-friendly naming guidelines.",
    },
    {
      icon: ScrollText,
      title: "An Official Naming Certificate",
      body: "Receive a personalized digital certificate that can be downloaded, printed, framed, or proudly displayed.",
    },
    {
      icon: Award,
      title: "A Spot on Our Wall of Names",
      body: "Your object and its new name will be featured on a large poster inside our farm store for one year.",
    },
  ];
  return (
    <section className="bg-background px-5 py-20 md:px-8 md:py-28">
      <SectionTitle title="What You Get" />
      <div className="mx-auto mt-12 grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div className="chunky-card rounded-3xl bg-farm-beige p-6 md:p-8">
          <img
            src="/campaign/goat-certificate.png"
            alt="A smiling goat on an Udderly Ridiculous gift certificate"
            width={1200}
            height={1200}
            loading="lazy"
            className="photo-frame aspect-square w-full rounded-xl object-cover"
          />
          <h3 className="mt-6 flex items-center gap-2 font-display text-3xl font-black uppercase text-headline">
            <Gift aria-hidden="true" className="text-primary-accent" /> A Farm
            Experience Gift Card
          </h3>
          <p className="mt-2 text-lg text-body-copy">
            Give someone unforgettable moments with our animals and the freedom
            to choose their favourite farm experiences.
          </p>
        </div>
        <div>
          <p className="mb-4 flex items-center gap-2 font-display text-xl font-extrabold uppercase text-primary-accent">
            <Sparkles aria-hidden="true" /> Plus these ridiculous bonuses
          </p>
          <ul className="space-y-4">
            {bonuses.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="flex gap-4 rounded-2xl border-2 border-headline/20 bg-background p-5"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary-accent text-headline">
                  <Icon aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-display text-2xl font-black uppercase leading-tight text-headline">
                    {title}
                  </h3>
                  <p className="mt-1 text-body-copy">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: MousePointerClick,
      title: "Pick Your Thing",
      body: "Browse the farm objects below and choose which one you'd like to gift naming rights to.",
    },
    {
      icon: CreditCard,
      title: "Buy & Claim",
      body: "Click “Buy & Claim” on your chosen item to purchase a qualifying gift card and claim its naming rights.",
    },
    {
      icon: Mail,
      title: "Check Your Email",
      body: "After purchasing, we'll send a separate email to the address you entered at checkout with a link to name your item and receive a personalized digital certificate.",
    },
    {
      icon: PartyPopper,
      title: "Enjoy Your Farm Fame",
      body: `Your chosen name will be displayed in our farm store for one year, starting ${DATES.fameStart}.`,
    },
  ];
  return (
    <section className="bg-farm-beige px-5 py-20 md:px-8 md:py-28">
      <SectionTitle title="How It Works" />
      <ol className="mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-x-6 gap-y-10 md:grid-cols-2">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="chunky-card relative flex flex-col rounded-2xl bg-background p-6 pt-8"
          >
            <span className="absolute -top-5 left-6 flex size-12 items-center justify-center rounded-full border-2 border-headline bg-primary-accent font-display text-2xl font-black text-primary-foreground">
              {index + 1}
            </span>
            <step.icon
              aria-hidden="true"
              className="absolute right-6 top-6 text-secondary-accent"
              size={28}
            />
            <h3 className="font-display text-2xl font-black uppercase text-headline">
              {step.title}
            </h3>
            <p className="mt-2 text-body-copy">{step.body}</p>
            {index === 1 ? (
              <div className="mt-4 rounded-xl bg-farm-gold/50 p-4 text-sm text-headline">
                <p className="flex items-center gap-2 font-display text-base font-extrabold uppercase">
                  <Users size={16} aria-hidden="true" /> Giving the gift yourself?
                </p>
                <p className="mt-1">
                  Enter your own email address at checkout. You'll receive both
                  the gift card and the naming link so you can give them
                  together whenever you're ready.
                </p>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ImportantDates() {
  const dates = [
    {
      icon: CalendarCheck,
      date: DATES.buyDeadline,
      title: "Last Day to Buy & Claim",
      body: "Purchase your qualifying gift card and claim your farm object by this deadline.",
      tone: "bg-primary-accent text-primary-foreground",
    },
    {
      icon: PenLine,
      date: DATES.nameDeadline,
      title: "Last Day to Submit Your Name",
      body: "Already claimed an object? Submit its name through your private email link.",
      tone: "bg-secondary-accent text-headline",
    },
    {
      icon: CalendarClock,
      date: `${DATES.fameStart} – ${DATES.fameEnd}`,
      title: "Your Year of Farm Fame",
      body: "Your naming rights begin February 1, 2027, and your name appears on the Wall of Names until January 31, 2028.",
      tone: "bg-farm-gold text-headline",
    },
  ];
  return (
    <section className="bg-background px-5 py-20 md:px-8 md:py-28">
      <SectionTitle title="Important Dates" />
      <div className="mx-auto mt-12 grid max-w-6xl gap-6 lg:grid-cols-3">
        {dates.map((date) => (
          <article key={date.title} className="chunky-card overflow-hidden rounded-2xl bg-background">
            <div className={`p-6 ${date.tone}`}>
              <date.icon size={22} aria-hidden="true" />
              <p className="mt-2 font-display text-[clamp(2rem,5vw,2.6rem)] font-black uppercase leading-[0.9]">
                {date.date}
              </p>
            </div>
            <div className="p-6">
              <h3 className="font-display text-2xl font-black uppercase text-headline">
                {date.title}
              </h3>
              <p className="mt-2 text-body-copy">{date.body}</p>
            </div>
          </article>
        ))}
      </div>
      <p className="mx-auto mt-8 max-w-2xl text-center text-sm font-medium text-muted-foreground">
        These dates apply to naming rights only. They do not determine the
        redemption period of the gift card itself.
      </p>
    </section>
  );
}

function BeforeYouBuy() {
  return (
    <div className="mx-auto mt-8 max-w-3xl rounded-2xl border-2 border-headline bg-background px-5 py-5 text-left md:px-8">
      <h3 className="font-display text-2xl font-black uppercase text-headline">
        Before you buy
      </h3>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-base text-body-copy">
        <li>First come, first served. Claimed and on-hold items are unavailable.</li>
        <li>
          Your gift card must meet that item's minimum price to include naming
          rights. Pay less, and the gift card is still valid, but naming rights
          are not included.
        </li>
        <li>
          Promo ends {DATES.buyDeadline}. Names must be submitted by{" "}
          {DATES.nameDeadline}.
        </li>
      </ul>
      <p className="mt-4 text-center">
        <a
          href="#faq"
          className="inline-flex min-h-11 items-center justify-center px-3 font-display text-lg font-extrabold uppercase text-headline underline decoration-primary-accent decoration-2 underline-offset-4"
        >
          Read the full FAQs & campaign terms
        </a>
      </p>
    </div>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 bg-background px-5 py-20 md:px-8 md:py-28">
      <SectionTitle kicker="Good questions" title="Frequently Asked Questions" />
      <div className="mx-auto mt-10 grid max-w-6xl gap-10 lg:grid-cols-[1fr_1.6fr]">
        <img
          src="/campaign/highland-cows.png"
          alt="Two mini Highland cows cuddling at the farm"
          width={1200}
          height={1200}
          loading="lazy"
          className="photo-frame-pink max-h-80 w-full rounded-2xl object-cover lg:max-h-none"
        />
        <Accordion type="single" collapsible className="w-full">
          {FAQS.map((faq, index) => (
            <AccordionItem key={faq.q} value={`faq-${index}`}>
              <AccordionTrigger>{faq.q}</AccordionTrigger>
              <AccordionContent>{faq.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden">
      <img
        src="/campaign/farm-sunset.jpg"
        alt=""
        width={1920}
        height={1080}
        loading="lazy"
        className="absolute inset-0 -z-10 h-full w-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-headline/70" aria-hidden="true" />
      <div className="mx-auto max-w-4xl px-5 py-24 text-center md:py-32">
        <h2 className="font-display text-[clamp(2.8rem,9vw,7rem)] font-black uppercase leading-[0.82] text-background">
          Your Favourite Thing Won't Name Itself.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-background">
          Browse the available objects, grab a gift card, and secure your spot
          in farm history.
        </p>
        <Button asChild size="large" className="mt-8">
          <a href="#objects">Browse the Things</a>
        </Button>
      </div>
    </section>
  );
}
