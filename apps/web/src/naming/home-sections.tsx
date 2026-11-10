import {
  AlertTriangle,
  ArrowDown,
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
  Star,
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
      <Tiers />
      <BeforeYouBuy />
      <section id="objects" className="scroll-mt-20 bg-farm-blue px-5 py-20 md:px-8 md:py-28">
        <SectionTitle
          title="Meet the Things That Need Names."
          intro="Some are useful. Some are questionable. All are waiting for their moment of glory."
        />
        <div className="mx-auto mt-10 max-w-[1400px]">{catalog}</div>
      </section>
      <Faq />
      <FinalCta />
    </main>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <img
        src="/campaign/homepage-hero.png"
        alt="Goats and farm animals at Udderly Ridiculous Farm Life"
        width={1920}
        height={1080}
        fetchPriority="high"
        className="absolute inset-0 -z-10 h-full w-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-headline/70" aria-hidden="true" />
      <div className="mx-auto max-w-5xl px-5 py-20 text-center md:px-8 md:py-32">
        <p className="gentle-float mx-auto inline-block rounded-full bg-farm-gold px-4 py-1 font-display text-sm font-extrabold uppercase text-headline">
          Not an animal. An actual object.
        </p>
        <h1 className="mt-5 font-display text-[clamp(3.6rem,14vw,10rem)] font-black uppercase leading-[0.8] text-background">
          Name That <span className="text-secondary-accent">Thing!</span>
        </h1>
        <p className="mt-5 font-accent text-[clamp(1.4rem,4vw,2.4rem)] italic text-farm-gold">
          Grab a gift card. Name something ridiculous.
        </p>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-background">
          Give the gift of core memories with an Udderly Ridiculous Farm Life
          gift card, and get the ridiculously unique bonus of naming a real
          farm object.
        </p>
        <p className="mx-auto mt-3 max-w-2xl text-base text-background/85">
          A wheelbarrow, a bucket, a goat slide, maybe even our famous goat
          tower. Because apparently, everything deserves a name.
        </p>
        <p className="mx-auto mt-4 max-w-xl text-base text-background/90">
          The name is the bonus: your gift card has to meet that object's
          minimum price.
        </p>
        <Button asChild size="large" className="mt-8">
          <a href="#objects">
            Browse the Things <ArrowDown aria-hidden="true" />
          </a>
        </Button>
        <ul className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-3">
          {[
            { icon: Gift, text: "Gift cards from $100" },
            { icon: Star, text: "Limited objects available" },
            { icon: CalendarHeart, text: "One year of naming rights" },
          ].map(({ icon: Icon, text }) => (
            <li
              key={text}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-background/40 bg-headline/50 px-4 py-3 font-display text-lg font-bold uppercase text-background"
            >
              <Icon aria-hidden="true" size={20} className="text-secondary-accent" />
              {text}
            </li>
          ))}
        </ul>
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
      <SectionTitle kicker="The gift + the giggle" title="What You Get" />
      <div className="mx-auto mt-12 grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div className="chunky-card rounded-3xl bg-farm-beige p-6 md:p-8">
          <span className="inline-block rounded-full bg-cta px-3 py-1 font-display text-sm font-extrabold uppercase text-cta-foreground">
            What you're buying
          </span>
          <img
            src="/campaign/gift-card.jpg"
            alt="Udderly Ridiculous Farm Life gift card"
            width={1200}
            height={800}
            loading="lazy"
            className="photo-frame mt-5 w-full rounded-xl"
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
      body: "Browse the available farm objects below and select the one you'd like to claim. Each object belongs to a specific gift-card price tier. First come, first served.",
    },
    {
      icon: CreditCard,
      title: "Buy Your Gift Card",
      body: "Click “Buy & Claim” and complete your gift-card purchase through our FareHarbor checkout. Your amount must be at least the minimum for your selected object.",
      tip: true,
    },
    { icon: Mail, title: "Check Your Email", emails: true },
    {
      icon: PenLine,
      title: "Name Your Masterpiece",
      body: `Open the private naming link, choose a family-friendly name of up to ${NAME_MAX_LENGTH} characters, and submit it by ${DATES.nameDeadline} at 11:59 p.m. Eastern Time.`,
    },
    {
      icon: ScrollText,
      title: "Get Your Certificate",
      body: "After submitting your name, download or print your personalized digital naming certificate.",
    },
    {
      icon: PartyPopper,
      title: "Enjoy Your Farm Fame",
      body: `Your object's name will appear on our Wall of Names inside the farm store for one year, beginning ${DATES.fameStart}.`,
    },
  ];
  return (
    <section className="bg-farm-beige px-5 py-20 md:px-8 md:py-28">
      <SectionTitle kicker="Six easy steps" title="How It Works" />
      <ol className="mx-auto mt-12 grid max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-3">
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
            {"body" in step && step.body ? (
              <p className="mt-2 text-body-copy">{step.body}</p>
            ) : null}
            {"tip" in step && step.tip ? (
              <div className="mt-4 rounded-xl bg-farm-gold/50 p-4 text-sm text-headline">
                <p className="flex items-center gap-2 font-display text-base font-extrabold uppercase">
                  <Users size={16} aria-hidden="true" /> Giving the gift yourself?
                </p>
                <p className="mt-1">
                  Enter <strong>YOUR</strong> email address at checkout. You'll
                  receive both the gift card and the separate naming email, so
                  you can present the gift yourself whenever you're ready.
                </p>
              </div>
            ) : null}
            {"emails" in step && step.emails ? (
              <div className="mt-3 space-y-3 text-sm">
                <div className="rounded-xl border-2 border-secondary-accent p-3">
                  <p className="font-display text-base font-extrabold uppercase text-headline">
                    Email 1 · From FareHarbor
                  </p>
                  <p className="text-body-copy">Your gift card.</p>
                </div>
                <div className="rounded-xl border-2 border-primary-accent p-3">
                  <p className="font-display text-base font-extrabold uppercase text-headline">
                    Email 2 · From Udderly Ridiculous
                  </p>
                  <p className="text-body-copy">
                    A <strong>separate</strong> email, sent once your qualifying
                    payment is confirmed, with your private link to name your
                    object.
                  </p>
                </div>
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
      time: "11:59 p.m. Eastern Time",
      title: "Last Day to Buy & Claim",
      body: "Purchase your qualifying gift card and claim your farm object by this deadline. After it, no new naming-rights purchases will be available.",
      tone: "bg-primary-accent text-primary-foreground",
    },
    {
      icon: PenLine,
      date: DATES.nameDeadline,
      time: "11:59 p.m. Eastern Time",
      title: "Last Day to Submit Your Name",
      body: "Already claimed an object? Submit its name through your private email link. You don't have to wait — you can name it immediately after purchasing.",
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
      <SectionTitle kicker="Mark your calendar" title="Important Dates" />
      <div className="mx-auto mt-12 grid max-w-6xl gap-6 lg:grid-cols-3">
        {dates.map((date, index) => (
          <article key={date.title} className="chunky-card overflow-hidden rounded-2xl bg-background">
            <div className={`p-6 ${date.tone}`}>
              <p className="flex items-center gap-2 font-display text-sm font-extrabold uppercase opacity-90">
                <date.icon size={18} aria-hidden="true" /> Milestone {index + 1}
              </p>
              <p className="mt-2 font-display text-[clamp(2rem,5vw,2.6rem)] font-black uppercase leading-[0.9]">
                {date.date}
              </p>
              {"time" in date && date.time ? (
                <p className="mt-2 font-display text-sm font-extrabold uppercase">
                  {date.time}
                </p>
              ) : null}
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

function Tiers() {
  const tiers = [
    { price: "$100", label: "Everyday Heroes", example: "Buckets, pails, trusty farm tools", offset: "md:mt-16" },
    { price: "$250", label: "Fan Favourites", example: "Goat slides, picnic tables", offset: "md:mt-10" },
    { price: "$500", label: "Big Deals", example: "Tractors and heritage equipment", offset: "md:mt-4" },
    { price: "$1,000", label: "Farm Landmarks", example: "Icons like the Goat Tower", offset: "" },
  ];
  return (
    <section className="bg-farm-blue px-5 py-20 md:px-8 md:py-28">
      <SectionTitle
        kicker="Pick your level of glory"
        title="Gift Card Tiers"
        intro="The value of your gift card determines which objects you can claim. Bigger tiers unlock bigger, more iconic farm things."
      />
      <div className="mx-auto mt-12 grid max-w-6xl grid-cols-2 gap-4 md:grid-cols-4 md:items-end md:gap-6">
        {tiers.map((tier, index) => (
          <div
            key={tier.price}
            className={`chunky-card rounded-2xl bg-background p-5 text-center ${tier.offset}`}
          >
            <p className="font-display text-sm font-extrabold uppercase text-primary-accent">
              Tier {index + 1}
            </p>
            <p className="font-display text-[clamp(2.4rem,6vw,3.6rem)] font-black leading-none text-headline">
              {tier.price}
            </p>
            <p className="text-xs font-bold uppercase text-muted-foreground">CAD</p>
            <p className="mt-3 font-display text-xl font-black uppercase text-headline">
              {tier.label}
            </p>
            <p className="mt-1 text-sm text-body-copy">{tier.example}</p>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 max-w-3xl rounded-2xl bg-background p-6 text-center text-body-copy">
        <p>
          Purchase a gift card <strong>equal to or greater than</strong> your
          selected object's tier. Each qualifying transaction claims{" "}
          <strong>one</strong> selected object — a $1,000 card claims one
          object, not several.
        </p>
      </div>
    </section>
  );
}

function BeforeYouBuy() {
  const rules = [
    {
      icon: Users,
      title: "First Come, First Served",
      body: "Each object can only be claimed once. Objects can become unavailable when another customer reserves or purchases them.",
    },
    {
      icon: PenLine,
      title: "Family-Friendly Names Only",
      body: `Names are limited to ${NAME_MAX_LENGTH} characters, including spaces and punctuation. Offensive or inappropriate names are not allowed.`,
    },
    {
      icon: CalendarClock,
      title: "Don't Miss the Naming Deadline",
      body: `All names must be submitted by ${DATES.nameDeadline} at 11:59 p.m. Eastern Time.`,
    },
  ];
  return (
    <section className="bg-background px-5 py-20 md:px-8 md:py-24">
      <div className="mx-auto max-w-5xl">
        <div className="chunky-card rounded-3xl border-status-held bg-farm-beige p-6 md:p-10">
          <p className="flex items-center gap-2 font-display text-lg font-extrabold uppercase text-primary-accent">
            <AlertTriangle aria-hidden="true" /> Important information before
            purchasing
          </p>
          <h2 className="mt-2 font-display text-[clamp(2rem,5.5vw,3.6rem)] font-black uppercase leading-[0.9] text-headline">
            Your gift card must meet your object's minimum price.
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border-2 border-status-available bg-background p-5">
              <p className="font-display text-lg font-extrabold uppercase text-status-available">
                ✓ Qualifies
              </p>
              <p className="mt-1 text-body-copy">
                You pick the <strong>Goat Slide</strong> ($250 tier) and buy a
                gift card worth <strong>$250 CAD or more</strong>. You get the
                naming rights, certificate and Wall of Names spot.
              </p>
            </div>
            <div className="rounded-2xl border-2 border-destructive bg-background p-5">
              <p className="font-display text-lg font-extrabold uppercase text-destructive">
                ✗ Doesn't qualify
              </p>
              <p className="mt-1 text-body-copy">
                You pick the Goat Slide but enter a custom amount of{" "}
                <strong>$100</strong>. Your $100 gift card is still valid, but
                there's no naming rights, certificate or Wall of Names
                recognition. We'll email you automatically if this happens.
              </p>
            </div>
          </div>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {rules.map((rule) => (
              <li key={rule.title} className="rounded-2xl bg-background p-5">
                <rule.icon aria-hidden="true" className="text-primary-accent" />
                <h3 className="mt-2 font-display text-xl font-black uppercase text-headline">
                  {rule.title}
                </h3>
                <p className="mt-1 text-sm text-body-copy">{rule.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-center">
            <a
              href="#faq"
              className="inline-flex min-h-11 items-center justify-center px-3 font-display text-lg font-extrabold uppercase text-headline underline decoration-primary-accent decoration-2 underline-offset-4"
            >
              Read the full FAQs & campaign terms
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 bg-background px-5 py-20 md:px-8 md:py-28">
      <SectionTitle kicker="Good questions" title="Frequently Asked Questions" />
      <div className="mx-auto mt-10 grid max-w-6xl gap-10 lg:grid-cols-[1fr_1.6fr]">
        <img
          src="/campaign/farm-store.jpg"
          alt="Inside the Udderly Ridiculous farm store, home of the Wall of Names"
          width={1200}
          height={1200}
          loading="lazy"
          className="photo-frame-pink hidden w-full rounded-2xl object-cover lg:block"
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
        src="/campaign/highland-cta.jpg"
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
